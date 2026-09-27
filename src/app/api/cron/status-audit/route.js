// src/app/api/cron/status-audit/route.js
// G-CrowdBang · 全自动定时 Webhook 状态巡检蜘蛛（Vercel Cron Background Worker）
// 由 vercel.json 的 crons 配置触发（默认每 15 分钟一次，GET 请求）。
// 职责：批量拉取 submissions 中 audit_metadata.verification_status == "PENDING_AUDIT" 的对账单，
//       → 对已发布视频（published_video_id）逐笔走官方公开 API 公开状态反查：
//         · 反查通过 → 自动结算（$3 佣金入 worker 余额，$1 平台服务费入官方利润，状态 verified）。
//         · 视频不存在/已删除/非公开 → 自动置 rejected，退还托管（payout_status: released）。
//         · 未发布（无 published_video_id）或无有效 TikTok Bearer → 跳过，保持 PENDING_AUDIT 待续。
// 安全：若配置了 CRON_SECRET，则校验请求头 Authorization: Bearer <CRON_SECRET>，防止被外部盗刷触发。
// 合规：仅对官方公开 API 做标准 Bearer 反查，不伪装、不规避。

import { NextResponse } from "next/server";
import { mockSubmissions, mockUsers, mockPlatform, mockCampaigns, applyFlatUpdate } from "../../tasks/_mock-store";
import { resolveTikTokBearer } from "../../tiktok/oauth/_resolve";

// ---- Firebase Admin 单例 ----
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
  console.warn("[cron/status-audit] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

const PLATFORM_PAYOUT = 3.0;
const PLATFORM_FEE = 1.0;

// 官方公开 API 视频状态反查（与 verify-and-payout 一致的合规适配层）
async function lookupPublishedVideo(publishedVideoId, accessToken) {
  if (!firebaseAvailable) {
    return { ok: true, public: true, raw: { status: "active", visibility: "public", local_mock: true } };
  }
  const token = accessToken || process.env.SOCIAL_PLATFORM_API_TOKEN;
  const url =
    `https://api.platform.example/v1/videos/${encodeURIComponent(publishedVideoId)}` +
    `?fields=id,status,visibility`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, reason: `API_HTTP_${res.status}` };
  const data = await res.json();
  const isPublic = data.status === "active" && data.visibility === "public";
  return { ok: isPublic, public: isPublic, raw: data };
}

// 结算一笔已核验通过的接单（Firestore 事务原子 / mock 直接变更）
async function settleVerified(submissionId, data) {
  if (firebaseAvailable) {
    const subRef = db.collection("submissions").doc(submissionId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(subRef);
      if (!snap.exists) return;
      const d = snap.data();
      if (d.audit_metadata?.verification_status !== "PENDING_AUDIT") return;
      tx.update(subRef, {
        "audit_metadata.verification_status": "verified",
        submitted_at: new Date().toISOString(),
        payout_status: "paid",
        updated_at: new Date().toISOString(),
      });
      const workerRef = db.collection("users").doc(d.worker_id);
      tx.set(workerRef, { balance_usd: FieldValue.increment(PLATFORM_PAYOUT) }, { merge: true });
      const platformRef = db.collection("platform_accounts").doc("official_profit");
      tx.set(platformRef, { service_fee_balance_usd: FieldValue.increment(PLATFORM_FEE) }, { merge: true });
      const campaignRef = db.collection("campaigns").doc(d.campaign_id);
      tx.update(campaignRef, { "escrow_summary.slots_used": FieldValue.increment(1) });
    });
    return;
  }
  const m = mockSubmissions.get(submissionId);
  if (!m || m.audit_metadata?.verification_status !== "PENDING_AUDIT") return;
  Object.assign(m, {
    "audit_metadata.verification_status": "verified",
    submitted_at: new Date().toISOString(),
    payout_status: "paid",
    updated_at: new Date().toISOString(),
  });
  mockUsers.set(m.worker_id, { balance_usd: (mockUsers.get(m.worker_id)?.balance_usd || 0) + PLATFORM_PAYOUT });
  mockPlatform.service_fee_balance_usd += PLATFORM_FEE;
}

// 拒付一笔（视频不存在/已删除/非公开）：状态 rejected，退还托管
async function rejectSubmission(submissionId, data) {
  const update = {
    "audit_metadata.verification_status": "rejected",
    "audit_metadata.reject_reason": "VIDEO_NOT_PUBLIC",
    payout_status: "released",
    updated_at: new Date().toISOString(),
  };
  if (firebaseAvailable) {
    await db.collection("submissions").doc(submissionId).update(update);
  } else {
    const m = mockSubmissions.get(submissionId);
    if (m) applyFlatUpdate(m, update);
  }
}

export async function GET(request) {
  // 安全闸：若配置 CRON_SECRET，校验 Authorization: Bearer <CRON_SECRET>，防止外部盗刷
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "UNAUTHORIZED_CRON" }, { status: 401 });
    }
  }

  try {
    // 1) 批量拉取 PENDING_AUDIT 对账单
    const pending = [];

    if (firebaseAvailable) {
      const snap = await db
        .collection("submissions")
        .where("audit_metadata.verification_status", "==", "PENDING_AUDIT")
        .limit(200)
        .get();
      for (const doc of snap.docs) {
        pending.push({ submissionId: doc.id, data: doc.data() });
      }
    } else {
      for (const [id, m] of mockSubmissions) {
        if (m.audit_metadata?.verification_status === "PENDING_AUDIT") {
          pending.push({ submissionId: id, data: m });
        }
      }
    }

    // 2) 逐笔巡检
    const settled = [];
    const rejected = [];
    const skipped = [];

    for (const { submissionId, data } of pending) {
      const publishedId = data.audit_metadata?.published_video_id;

      // 未发布视频 → 跳过（仍等待接单人回填发布 ID）
      if (!publishedId) { skipped.push({ submissionId, reason: "NO_PUBLISHED_VIDEO" }); continue; }

      // 解析该商户有效 TikTok Bearer；无有效令牌 → 跳过（商户尚未连接，无法反查）
      const ownerMerchantId =
        data.owner_merchant_id ||
        mockCampaigns.get(data.campaign_id)?.merchantId ||
        process.env.MERCHANT_ID ||
        "mch_placeholder";
      const bearer = await resolveTikTokBearer(ownerMerchantId);
      if (!bearer.ok) { skipped.push({ submissionId, reason: "NO_TIKTOK_TOKEN" }); continue; }

      // 官方公开 API 反查
      const video = await lookupPublishedVideo(publishedId, bearer.accessToken);

      if (!video.ok) {
        await rejectSubmission(submissionId, data);
        rejected.push({ submissionId, reason: "VIDEO_NOT_PUBLIC" });
      } else {
        await settleVerified(submissionId, data);
        settled.push({ submissionId, payout_usd: PLATFORM_PAYOUT, platform_fee_usd: PLATFORM_FEE });
      }
    }

    return NextResponse.json(
      {
        status: "ok",
        scanned: pending.length,
        settled: settled.length,
        rejected: rejected.length,
        skipped: skipped.length,
        details: { settled, rejected, skipped },
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[cron/status-audit]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
