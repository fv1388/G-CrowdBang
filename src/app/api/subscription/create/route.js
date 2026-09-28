// src/app/api/subscription/create/route.js
// G-CrowdBang / F-CrowdBang · 商家订阅收费创建接口（App Router Route Handler）
// 职责：接收商户订阅申请 → 校验商户与套餐 → 写入 subscriptions 账本（按套餐计费）。
// 平台收入构成（方案 B）：项目佣金（campaign.platform_fee）+ 固定月订阅 + 增值服务。
// 兼容：装有 firebase-admin 时写 Firestore；未装/占位凭证时降级本地 mock（便于本地联调）。

import { NextResponse } from "next/server";

let db = null;
let firebaseAvailable = false;

try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const fstore = await import("firebase-admin/firestore");
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
  console.warn("[subscription/create] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// 标准订阅套餐（月费美元）
const PLANS = {
  starter: { name: "Starter", price_usd: 0, features: ["10 tasks/mo", "Standard support"] },
  pro: { name: "Pro", price_usd: 99, features: ["Unlimited tasks", "Priority distribution", "Advanced audit"] },
  enterprise: { name: "Enterprise", price_usd: 299, features: ["Unlimited tasks", "Dedicated manager", "Custom audit window"] },
};

// 本地 mock 订阅账本（模块级，进程存活期内可用）
const mockSubscriptions = new Map();

export async function POST(request) {
  try {
    const body = await request.json();
    const { merchantId, plan, paymentOrderId } = body || {};
    const planConfig = PLANS[plan];

    // 校验：商户 ID 存在、套餐合法
    if (!merchantId) {
      return NextResponse.json({ error: "MERCHANT_REQUIRED" }, { status: 400 });
    }
    if (!planConfig) {
      return NextResponse.json({ error: "INVALID_PLAN" }, { status: 400 });
    }
    if (planConfig.price_usd > 0 && !paymentOrderId) {
      return NextResponse.json({ error: "PAYMENT_ORDER_REQUIRED" }, { status: 400 });
    }

    const now = new Date();
    const startedAt = now.toISOString();
    const renewsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const subscription = {
      merchant_id: merchantId,
      plan,
      plan_name: planConfig.name,
      price_usd: planConfig.price_usd,
      status: "active",
      payment_order_id: paymentOrderId || `free_plan`,
      started_at: startedAt,
      renews_at: renewsAt,
      features: planConfig.features,
      updated_at: startedAt,
    };

    let subscriptionId;

    if (firebaseAvailable) {
      const ref = db.collection("subscriptions").doc();
      subscription.subscription_id = ref.id;
      subscriptionId = ref.id;
      await db.runTransaction(async (tx) => {
        // 若该商户已有活动订阅，先置为 expired（只保留一条 active）
        const existing = await tx.get(db.collection("subscriptions").where("merchant_id", "==", merchantId).where("status", "==", "active"));
        existing.forEach((d) => {
          tx.update(d.ref, { status: "expired", updated_at: startedAt });
        });
        tx.set(ref, subscription);
      });
    } else {
      subscriptionId = `sub_local_${Date.now()}`;
      subscription.subscription_id = subscriptionId;
      // 本地 mock：直接覆盖为该商户最新活动订阅（简化）
      mockSubscriptions.set(merchantId, subscription);
    }

    return NextResponse.json(
      {
        subscriptionId,
        plan,
        plan_name: planConfig.name,
        price_usd: planConfig.price_usd,
        status: "active",
        renews_at: renewsAt,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[subscription/create]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
