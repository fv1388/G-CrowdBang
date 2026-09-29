// src/app/api/paypal/webhook/route.js
// ==========================================================================
// G-CrowdBang / F-CrowdBang · PayPal Webhook 自动对账接口
// --------------------------------------------------------------------------
// 职责：接收 PayPal 官方异步事件，对账两类关键资金流转，作为主流程的双保险：
//   1) PAYMENT.CAPTURE.COMPLETED  商家充值订单款项已真实捕获 → 幂等入账余额
//   2) PAYMENT.PAYOUTSBATCH.*      平台向老外打款批次状态变化 → 更新对账单
// 安全：配置 PAYPAL_WEBHOOK_ID 后启用官方验签；未配置则仅记录（联调阶段）。
// 幂等：以 PayPal 事件资源 ID 作唯一键，防止 Webhook 重放导致重复入账。
// ==========================================================================

import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/paypal";

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
  console.warn("[paypal/webhook] firebase-admin unavailable, skipping db sync");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// 事件类型 → 处理函数
const HANDLERS = {
  "PAYMENT.CAPTURE.COMPLETED": handleCaptureCompleted,
  "PAYMENT.PAYOUTSBATCH.SUCCESS": handlePayoutBatch,
  "PAYMENT.PAYOUTSBATCH.PROCESSING": handlePayoutBatch,
  "PAYMENT.PAYOUTSBATCH.DENIED": handlePayoutBatch,
  "PAYMENT.PAYOUTSBATCH.CANCELED": handlePayoutBatch,
};

export async function GET() {
  return NextResponse.json({ ok: true, message: "PayPal webhook endpoint ready." });
}

export async function POST(request) {
  try {
    const raw = await request.text();
    const body = JSON.parse(raw || "{}");
    const headers = Object.fromEntries(request.headers.entries());

    // 验签：未配置 PAYPAL_WEBHOOK_ID 时跳过（联调）；配置后强制校验
    const verified = await verifyWebhook({ headers, body });
    if (process.env.PAYPAL_WEBHOOK_ID && !verified) {
      return NextResponse.json({ error: "SIGNATURE_MISMATCH" }, { status: 400 });
    }

    const eventType = body?.event_type;
    const handler = HANDLERS[eventType];
    if (handler) {
      await handler(body?.resource);
    }
    // 记录原始事件（可审计）
    if (firebaseAvailable) {
      await db.collection("paypal_webhook_events").add({
        event_type: eventType,
        resource_id: body?.resource?.id || body?.resource?.capture_id || null,
        received_at: new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[paypal/webhook]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

// ---- 1) 充值订单款项已捕获：幂等入账 ----
async function handleCaptureCompleted(resource) {
  if (!db || !firebaseAvailable) return;
  const merchantId = resource?.reference_id; // 创建订单时写入的商户 UID
  const captureId = resource?.id;
  const amount = Number(resource?.amount?.value ?? 0);
  if (!merchantId || !captureId || !Number.isFinite(amount) || amount <= 0) return;

  await db.runTransaction(async (tx) => {
    // 幂等去重：以 capture_id 查充值流水
    const q = await tx.get(
      db.collection("deposit_history").where("payment_capture_id", "==", captureId).limit(1)
    );
    if (!q.empty) return; // 已入账，跳过

    const ref = db.collection("merchants").doc(merchantId);
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data()?.balance_usd || 0) : 0;
    if (snap.exists) {
      tx.update(ref, { balance_usd: FieldValue.increment(amount), updated_at: new Date().toISOString() });
    } else {
      tx.set(ref, {
        merchant_id: merchantId,
        balance_usd: amount,
        currency: "USD",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const logRef = db.collection("deposit_history").doc();
    tx.set(logRef, {
      deposit_id: logRef.id,
      merchant_id: merchantId,
      amount_usd: amount,
      payment_capture_id: captureId,
      payment_order_id: resource?.supplementary_data?.related_ids?.order_id || null,
      status: "COMPLETED",
      source: "paypal_webhook",
      created_at: new Date().toISOString(),
    });
  });
}

// ---- 2) 打款批次状态变化：更新老外提现对账单 ----
async function handlePayoutBatch(resource) {
  if (!db || !firebaseAvailable) return;
  const batchId = resource?.batch_header?.payout_batch_id;
  const status = resource?.batch_header?.batch_status; // SUCCESS / PROCESSING / DENIED ...
  if (!batchId || !status) return;

  const q = await db.collection("payout_requests").where("transfer_reference", "==", batchId).limit(5);
  const snap = await q.get();
  const batch = db.batch();
  snap.forEach((doc) => {
    batch.update(doc.ref, {
      status: status === "SUCCESS" ? "SUCCESS" : status === "DENIED" ? "DENIED" : status,
      processed_at: status === "SUCCESS" ? new Date().toISOString() : null,
    });
  });
  await batch.commit();
}
