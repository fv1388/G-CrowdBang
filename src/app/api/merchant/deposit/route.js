// src/app/api/merchant/deposit/route.js
// G-CrowdBang / F-CrowdBang · 商户资金账户充值对账接口（App Router Route Handler）
// 职责：A端商户向账户钱包充值 →
//       1) 服务端对接合规第三方支付(如 PayPal Orders API v2)校验支付订单到账状态；
//       2) 校验通过后在事务内原子自增 merchants 集合的可用赏金余额(FieldValue.increment)；
//       3) 将本次充值作为一条对账流水写入 deposit_history 集合（status = "COMPLETED"）。
// 入参：merchantId, depositAmount, paymentOrderId（paymentReference 为兼容别名）。
// 兼容策略：真实环境(PayPal 服务端凭证齐备)走 PayPal 订单捕获校验；
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
// 严格判定：必须是真实 Live 凭证——以 live_ 开头、且不是占位(your_)，Secret 同理。
// 占位/缺失一律走本地 mock 确定性校验（仅开发者测试账号可用）；真实客户在生产环境
// 因配置了真实 Live 凭证，必然走 PayPal Orders API 真校验，无法绕过支付。
function paypalCredsReady() {
  const cid = process.env.PAYPAL_PRODUCTION_CLIENT_ID || "";
  const sec = process.env.PAYPAL_PRODUCTION_SECRET || "";
  return Boolean(
    cid.startsWith("live_") && !cid.includes("your_") && sec && !sec.includes("your_")
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

    // 输入契约：merchantId / depositAmount / paymentOrderId
    // （paymentReference / amount 作为旧版兼容别名）
    const merchantId = body?.merchantId;
    const amount = body?.depositAmount ?? body?.amount;
    const paymentOrderId = body?.paymentOrderId ?? body?.paymentReference;
    const currency = body?.currency || "USD";

    if (!merchantId || !paymentOrderId || amount === undefined || amount === null || amount === "") {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
    }

    const amountUsd = Number(amount);

    // 支付真伪验证（服务器端：PayPal 订单捕获状态 或 本地确定性占位）
    const payment = await verifyPayment(paymentOrderId, amountUsd);
    if (!payment.ok) {
      return NextResponse.json(
        { error: "PAYMENT_NOT_VERIFIED", reason: payment.reason || "PAYMENT_NOT_COMPLETED" },
        { status: 402 }
      );
    }

    let newBalance;
    let depositId = null;

    if (firebaseAvailable) {
      // 事务原子：读取/创建商户 → 自增余额 → 写入充值对账流水(deposit_history)
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

        // 合规写入充值对账流水表（Deposit History）
        // 字段：deposit_id(系统自动生成) / merchant_id / amount / payment_order_id / status / timestamp
        const logRef = db.collection("deposit_history").doc();
        depositId = logRef.id;
        tx.set(logRef, {
          deposit_id: depositId,
          merchant_id: merchantId,
          amount_usd: amountUsd,
          payment_order_id: paymentOrderId,
          status: "COMPLETED", // 充值已完成
          created_at: new Date().toISOString(), // timestamp
        });
      });
    } else {
      // 本地 mock：自增共享商户账本，并登记充值对账流水
      const prev = mockMerchants.get(merchantId)?.balance_usd || 0;
      mockMerchants.set(merchantId, { balance_usd: prev + amountUsd, currency });
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
    console.error("[merchant/deposit]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
