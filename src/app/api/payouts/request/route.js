// src/app/api/payouts/request/route.js
// G-CrowdBang / F-CrowdBang · 提现申请与打款对账单接口（App Router Route Handler）
// 职责：B端接单人申请将可用余额提现 → 校验金额与账户 → 原子扣减可用余额
//       → 向 payout_requests 集合写入一条 status="PENDING_TRANSFER" 的对账单。
// 兼容策略：装有 firebase-admin 且凭证真实时写 Firestore；否则写共享本地 mock 账本。
// 合规：仅做标准金额校验与余额扣减，不涉及任何规避/伪造逻辑。

import { NextResponse } from "next/server";
import { mockUsers, mockPayoutRequests } from "../../tasks/_mock-store";
import { createPayout, paypalCredsReady } from "@/lib/paypal";

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
  console.warn("[payouts/request] firebase-admin unavailable, using local mock");
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

// 当前接单人：生产从认证会话取 uid；此处以环境变量作服务端兜底示意
function currentWorkerId() {
  return process.env.WORKER_ID ?? "usr_current";
}

// 金额校验：必须为正的有限数值，且不小于最小提现额
// 财务风控：PayPal 跨境打款每笔有固定通道费，最小提现额锁定为 $10.00（放宽友好，
//           约 2 单纯上传或 1 单实拍即可提现），平衡达人体验与平台防拆单纯利。
function validateAmount(amount) {
  const n = Number(amount);
  const MIN_WITHDRAWAL = 10.0;
  return Number.isFinite(n) && n >= MIN_WITHDRAWAL;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      workerId = currentWorkerId(),
      amount,
      payoutMethod,   // 如 "paypal"
      destination,    // 提现账户地址，如 PayPal 邮箱
    } = body || {};

    if (!amount || !payoutMethod || !destination) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
    }
    if (typeof destination !== "string" || destination.trim().length < 3) {
      return NextResponse.json({ error: "INVALID_DESTINATION" }, { status: 400 });
    }

    const amountUsd = Number(amount);

    // 读取当前可用余额
    let balanceUsd = 0;
    let workerRef = null;

    if (firebaseAvailable) {
      workerRef = db.collection("users").doc(workerId);
      const snap = await workerRef.get();
      if (!snap.exists) {
        return NextResponse.json({ error: "WORKER_NOT_FOUND" }, { status: 404 });
      }
      balanceUsd = snap.data()?.balance_usd || 0;
    } else {
      balanceUsd = mockUsers.get(workerId)?.balance_usd || 0;
      if (!mockUsers.has(workerId)) {
        return NextResponse.json({ error: "WORKER_NOT_FOUND" }, { status: 404 });
      }
    }

    // 余额不足 → 400 拒绝提现
    if (balanceUsd < amountUsd) {
      return NextResponse.json(
        { error: "INSUFFICIENT_BALANCE", balance_usd: balanceUsd, requested: amountUsd },
        { status: 400 }
      );
    }

    // 构建对账单
    const payoutRequest = {
      worker_id: workerId,
      amount_usd: amountUsd,
      payout_method: payoutMethod,
      destination: destination.trim(),
      status: "PENDING_TRANSFER", // 等待官方人工或自动批量打款
      request_timestamp: new Date().toISOString(),
      processed_at: null,
      transfer_reference: null,
    };

    let payoutRequestId;

    if (firebaseAvailable) {
      // 事务原子：扣减余额 + 写入对账单，防止并发超额提现
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(workerRef);
        if (!snap.exists) return;
        const current = snap.data()?.balance_usd || 0;
        if (current < amountUsd) throw new Error("INSUFFICIENT_BALANCE");

        tx.update(workerRef, { balance_usd: FieldValue.increment(-amountUsd) });
        const ref = db.collection("payout_requests").doc();
        payoutRequestId = ref.id;
        tx.set(ref, { ...payoutRequest, payout_request_id: ref.id });
      });
      payoutRequestId = payoutRequestId || `payout_${Date.now()}`;
    } else {
      // 本地 mock：扣减余额 + 写入共享对账表
      const prev = mockUsers.get(workerId)?.balance_usd || 0;
      mockUsers.set(workerId, { balance_usd: prev - amountUsd });
      payoutRequestId = `payout_local_${Date.now()}`;
      mockPayoutRequests.set(payoutRequestId, { ...payoutRequest, payout_request_id: payoutRequestId });
    }

    // ---- 真实打款：仅当配置了 PayPal 真实凭证且提现方式为 PayPal ----
    // 调用 PayPal Payouts API 向老外的 PayPal 邮箱打款；成功则更新对账单状态。
    let payoutStatus = "PENDING_TRANSFER";
    let payoutBatchId = null;
    let payoutError = null;

    if (paypalCredsReady() && String(payoutMethod).toLowerCase() === "paypal") {
      try {
        const senderBatchId = `cb_${workerId}_${Date.now()}`;
        const payout = await createPayout({
          recipientEmail: destination.trim(),
          amountUsd,
          payoutBatchId: senderBatchId,
        });
        payoutBatchId = payout.batch_id || null;
        payoutStatus = payoutBatchId ? "PROCESSING" : "PENDING_TRANSFER";
      } catch (e) {
        // 打款失败：保留对账单（已扣余额），标记失败并提示人工处理退款
        payoutStatus = "PAYOUT_FAILED";
        payoutError = e?.message || "PAYOUT_ERROR";
        console.error("[payouts/request] PayPal payout failed", e);
      }

      if (firebaseAvailable && payoutRequestId) {
        await db.collection("payout_requests").doc(payoutRequestId).update({
          status: payoutStatus,
          transfer_reference: payoutBatchId,
          processed_at: payoutBatchId ? new Date().toISOString() : null,
          payout_error: payoutError,
        });
      } else if (mockPayoutRequests.has(payoutRequestId)) {
        const rec = mockPayoutRequests.get(payoutRequestId);
        rec.status = payoutStatus;
        rec.transfer_reference = payoutBatchId;
        rec.payout_error = payoutError;
        mockPayoutRequests.set(payoutRequestId, rec);
      }
    }

    return NextResponse.json(
      {
        payoutRequestId,
        status: payoutStatus,
        amount_usd: amountUsd,
        payout_batch_id: payoutBatchId,
        remaining_balance_usd: firebaseAvailable
          ? undefined
          : (mockUsers.get(workerId)?.balance_usd ?? 0),
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 201 }
    );
  } catch (err) {
    // 事务内抛出的余额不足会被这里兜住
    if (err?.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json({ error: "INSUFFICIENT_BALANCE" }, { status: 400 });
    }
    console.error("[payouts/request]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
