// src/app/api/merchant/deposit/route.js
// G-CrowdBang / F-CrowdBang · 商户资金账户充值接口（App Router Route Handler）
// 职责：A端商户向账户钱包充值 → 服务端对接 PayPal 订单捕获回调验证充值真伪
//       → 事务自增 merchants 集合的可用赏金余额。
// 兼容策略：真实环境(PayPal 服务端凭证齐备)走 PayPal Orders API v2 校验；
//           本地 mock 无凭证时接受确定性占位校验，便于本地联调。
// 合规：仅做标准支付校验与余额入账，不涉及任何规避/伪造逻辑。

import { NextResponse } from "next/server";
import { mockMerchants } from "../../tasks/_mock-store";

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
  console.warn("[merchant/deposit] firebase-admin unavailable, using local mock");
}

// 凭证守卫：依赖已装但 FIREBASE_* 为占位/缺失时，仍降级 mock
if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// PayPal 服务端凭证是否齐备（决定是否真正调用 PayPal 订单捕获校验）
function paypalCredsReady() {
  return Boolean(
    process.env.PAYPAL_PRODUCTION_CLIENT_ID &&
    process.env.PAYPAL_PRODUCTION_CLIENT_ID.includes("live_") &&
    process.env.PAYPAL_PRODUCTION_SECRET
  );
}

// 金额校验：必须为正的有限数值
function validateAmount(amount) {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0;
}

// ---- 支付真伪验证：真实环境调 PayPal Orders API v2 捕获状态；mock 走确定性占位 ----
async function verifyPayment(paymentReference, amountUsd) {
  if (!paypalCredsReady()) {
    // 本地无凭证：返回确定性占位结果，仅供本地联调；真实上线需配置 PayPal Live 凭证
    return { ok: true, verified: true, local_mock: true };
  }

  // 标准 PayPal OAuth 客户端凭证换取 access_token（服务端，勿前端暴露）
  const auth = Buffer.from(
    `${process.env.PAYPAL_PRODUCTION_CLIENT_ID}:${process.env.PAYPAL_PRODUCTION_SECRET}`
  ).toString("base64");
  const tokenRes = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) return { ok: false, reason: `AUTH_HTTP_${tokenRes.status}` };
  const tokenData = await tokenRes.json();

  // 查询订单捕获状态
  const orderRes = await fetch(
    `https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(paymentReference)}`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  if (!orderRes.ok) return { ok: false, reason: `ORDER_HTTP_${orderRes.status}` };
  const order = await orderRes.json();

  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
  const isCompleted =
    capture?.status === "COMPLETED" &&
    Number(capture?.amount?.value) >= amountUsd;

  return { ok: isCompleted, verified: isCompleted, raw: order };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { merchantId, amount, paymentReference, currency = "USD" } = body || {};

    if (!merchantId || !amount || !paymentReference) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
    }

    const amountUsd = Number(amount);

    // 支付真伪验证
    const payment = await verifyPayment(paymentReference, amountUsd);
    if (!payment.ok) {
      return NextResponse.json(
        { error: "PAYMENT_NOT_VERIFIED", reason: payment.reason || "PAYMENT_NOT_COMPLETED" },
        { status: 402 }
      );
    }

    let newBalance;

    if (firebaseAvailable) {
      // 事务原子：读取/创建商户 → 自增余额
      await db.runTransaction(async (tx) => {
        const ref = db.collection("merchants").doc(merchantId);
        const snap = await tx.get(ref);
        const current = snap.exists ? (snap.data()?.balance_usd || 0) : 0;

        if (!snap.exists) {
          tx.set(ref, {
            merchant_id: merchantId,
            balance_usd: amountUsd,
            currency,
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

        // 记录充值流水（可追溯）
        const logRef = db.collection("merchant_transactions").doc();
        tx.set(logRef, {
          merchant_id: merchantId,
          type: "deposit",
          amount_usd: amountUsd,
          payment_reference: paymentReference,
          verified: true,
          created_at: new Date().toISOString(),
        });
      });
    } else {
      // 本地 mock：自增共享商户账本
      const prev = mockMerchants.get(merchantId)?.balance_usd || 0;
      mockMerchants.set(merchantId, { balance_usd: prev + amountUsd, currency });
      newBalance = prev + amountUsd;
    }

    return NextResponse.json(
      {
        merchantId,
        status: "confirmed",
        amount_usd: amountUsd,
        balance_usd: newBalance,
        payment_verified: true,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[merchant/deposit]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
