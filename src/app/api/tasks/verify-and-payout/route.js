// src/app/api/tasks/verify-and-payout/route.js
// G-CrowdBang / F-CrowdBang · 结算验证接口（App Router Route Handler）
// 职责：读 submission → 官方公开API反查视频公开状态 → 托管分账 / 熔断拒付。
// 合规声明：仅使用官方公开 API + 显式平台标识的标准 fetch，不含任何指纹伪造或规避检测逻辑。

import { NextResponse } from "next/server";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ---- Firebase Admin 单例（F-CrowdBang）----
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

// 分账常量：佣金（worker）与平台纯技术服务费（官方利润账户）
const PLATFORM_PAYOUT = 3.0;
const PLATFORM_FEE = 1.0;

/**
 * 官方公开 API 视频状态反查（合规适配层）。
 * 使用平台官方公开接口 + 服务端标准凭证，显式声明平台标识，不伪装、不抹指纹。
 * 返回 { ok, public, ... }；ok=false 表示视频不可见（不存在/已删除/非公开）。
 */
async function lookupPublishedVideo(publishedVideoId) {
  // 按实际对接的社交平台官方公开 API 填端点和凭据（服务端环境变量，勿前端暴露）。
  const token = process.env.SOCIAL_PLATFORM_API_TOKEN;
  const url =
    `https://api.platform.example/v1/videos/${encodeURIComponent(publishedVideoId)}` +
    `?fields=id,status,visibility`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return { ok: false, reason: `API_HTTP_${res.status}` };

  const data = await res.json();
  // 仅当平台标记为 active 且 visibility=public 才算公开在线
  const isPublic = data.status === "active" && data.visibility === "public";
  return { ok: isPublic, public: isPublic, raw: data };
}

export async function POST(request) {
  try {
    const { submissionId } = await request.json();
    if (!submissionId) {
      return NextResponse.json({ error: "SUBMISSION_ID_REQUIRED" }, { status: 400 });
    }

    const subRef = db.collection("submissions").doc(submissionId);
    const subSnap = await subRef.get();
    if (!subSnap.exists) {
      return NextResponse.json({ error: "SUBMISSION_NOT_FOUND" }, { status: 404 });
    }
    const submission = subSnap.data();

    // 仅 pending 可结算；终态不可逆
    if (submission.audit_metadata?.verification_status !== "pending") {
      return NextResponse.json(
        { error: "NOT_PENDING", status: submission.audit_metadata?.verification_status },
        { status: 409 }
      );
    }

    // 1) 官方公开 API 反查视频公开状态
    const video = await lookupPublishedVideo(
      submission.audit_metadata?.published_video_id
    );

    if (!video.ok) {
      // 视频不存在 / 已删除 / 非公开 → 终止结算，物理置为 REJECTED，退还托管
      await subRef.update({
        "audit_metadata.verification_status": "rejected",
        "audit_metadata.reject_reason": "VIDEO_NOT_PUBLIC",
        payout_status: "released",
        updated_at: new Date().toISOString(),
      });
      return NextResponse.json(
        { result: "rejected", reason: "VIDEO_NOT_PUBLIC" },
        { status: 200 }
      );
    }

    // 2) 核验通过 → 托管分账（事务原子：状态推进 + 佣金 + 平台服务费）
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(subRef);
      if (!snap.exists) return;
      const data = snap.data();
      // 事务内二次确认仍是 pending，防止并发重复结算
      if (data.audit_metadata?.verification_status !== "pending") return;

      tx.update(subRef, {
        "audit_metadata.verification_status": "verified",
        submitted_at: new Date().toISOString(),
        payout_status: "paid",
        updated_at: new Date().toISOString(),
      });

      // 佣金：$3.00 划入接单人可用提现余额
      const workerRef = db.collection("users").doc(data.worker_id);
      tx.set(workerRef, {
        balance_usd: FieldValue.increment(PLATFORM_PAYOUT),
      }, { merge: true });

      // 平台纯技术服务费：$1.00 计入总部官方利润账户
      const platformRef = db.collection("platform_accounts").doc("official_profit");
      tx.set(platformRef, {
        service_fee_balance_usd: FieldValue.increment(PLATFORM_FEE),
      }, { merge: true });

      // 任务名额递增（与 campaigns.escrow_summary 对账）
      const campaignRef = db.collection("campaigns").doc(data.campaign_id);
      tx.update(campaignRef, {
        "escrow_summary.slots_used": FieldValue.increment(1),
      });
    });

    return NextResponse.json(
      {
        result: "verified",
        payout: { worker_usd: PLATFORM_PAYOUT, platform_fee_usd: PLATFORM_FEE },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[verify-and-payout]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
