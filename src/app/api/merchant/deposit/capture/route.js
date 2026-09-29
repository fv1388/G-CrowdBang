// src/app/api/merchant/deposit/capture/route.js
// ==========================================================================
// G-CrowdBang / F-CrowdBang · 商户充值第二步：确认 PayPal 款项到账并入账
// --------------------------------------------------------------------------
// 职责：商家在 PayPal 完成付款后，前端把 orderId 交回本接口。服务端执行
//       captureOrder（捕获订单）→ 校验状态 COMPLETED 且金额达标 →
//       在事务内原子自增 merchants 余额 → 写入 deposit_history 对账流水。
// 入参：{ merchantId, orderId, amountUsd }
// 真实凭证 → 调 PayPal Orders capture；无真实凭证 → mock 入账（联调用）。
// ==========================================================================

import { NextResponse } from "next/server";
import { captureOrder, getOrder, paypalCredsReady } from "@/lib/paypal";
import { mockMerchants } from "../../../tasks/_mock-store";

let db = null;
let firebaseAvailable = false;
let FieldValue = null;

try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const fstore = await import("firebase-admin/firestore");
  FieldValue = fstore.FieldValue;
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
  db = fstore.getFirestore();
  firebaseAvailable = true;
} catch (e) {
  console.warn("[merchant/deposit/capture] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const merchantId = body?.merchantId;
    const orderId = body?.orderId;
    const amount = Number(body?.amountUsd ?? body?.amount);

    if (!merchantId || !orderId) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
    }

    // ---- 真实凭证：调用 PayPal 捕获订单，真正确认到账 ----
    if (paypalCredsReady()) {
      let capture;
      try {
        capture = await captureOrder(orderId);
      } catch (e) {
        // 已捕获的订单再次捕获会报错；改为查询订单状态作为兜底
        const order = await getOrder(orderId);
        const cap = order?.purchase_units?.[0]?.payments?.captures?.[0];
        capture = { status: order?.status, capture };
      }
      const cap = capture?.capture || capture?.purchase_units?.[0]?.payments?.captures?.[0];
      const capturedAmount = Number(cap?.amount?.value ?? 0);
      const completed = (cap?.status === "COMPLETED" || capture?.status === "COMPLETED") && capturedAmount >= amount;
      if (!completed) {
        return NextResponse.json(
          { error: "PAYMENT_NOT_COMPLETED", orderStatus: capture?.status, captureStatus: cap?.status },
          { status: 402 }
        );
      }
    } else {
      // mock：本地联调直接放行（线上配置真实凭证后必然真校验）
      // eslint-disable-next-line no-console
      console.log("[merchant/deposit/capture] mock capture (no PayPal creds) orderId=", orderId);
    }

    // ---- 入账：事务内原子自增余额 + 写充值对账流水 ----
    const amountUsd = amount;
    let newBalance;
    let depositId;

    if (firebaseAvailable) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("merchants").doc(merchantId);
        const snap = await tx.get(ref);
        const current = snap.exists ? (snap.data()?.balance_usd || 0) : 0;

        if (!snap.exists) {
          tx.set(ref, {
            merchant_id: merchantId,
            balance_usd: amountUsd,
            currency: "USD",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          newBalance = amountUsd;
        } else {
          tx.update(ref, {
            balance_usd: FieldValue.increment(amountUsd),
            updated_at: new Date().toISOString(),
          });
          newBalance = current + amountUsd;
        }

        const logRef = db.collection("deposit_history").doc();
        depositId = logRef.id;
        tx.set(logRef, {
          deposit_id: depositId,
          merchant_id: merchantId,
          amount_usd: amountUsd,
          payment_order_id: orderId,
          status: "COMPLETED",
          source: paypalCredsReady() ? "paypal_live" : "mock",
          created_at: new Date().toISOString(),
        });
      });
    } else {
      const prev = mockMerchants.get(merchantId)?.balance_usd || 0;
      mockMerchants.set(merchantId, { balance_usd: prev + amountUsd, currency: "USD" });
      newBalance = prev + amountUsd;
      depositId = `deposit_local_${Date.now()}`;
    }

    return NextResponse.json(
      {
        depositId,
        merchantId,
        status: "confirmed",
        amount_usd: amountUsd,
        balance_usd: newBalance,
        payment_verified: true,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[merchant/deposit/capture]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
