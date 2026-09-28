// src/app/api/tasks/auto-approve/route.js
// G-CrowdBang / F-CrowdBang · 超时自动放行接口（App Router Route Handler）
// --------------------------------------------------------------------------
// 职责：零绑定 + 人工核验模式下，为"商家不点核验"提供自动兜底。
//       扫描所有 PENDING_AUDIT 对账单：
//         - 老外已回填完工链接（published_video_url）且 submitted_at 距今超过任务设定的
//           自动放行窗口（audit_strategy.auto_approve_after_hours，默认 48h）→ 自动放行分账：
//           老外 +$3.00、平台 +$1.00，状态 verified/paid。
//         - 未回填链接，或未到窗口 → 跳过，保持 PENDING_AUDIT（商家仍可在窗口内手动拒付）。
// 合规：纯时间判定 + 标准账本分账，不依赖任何 TikTok 令牌、不做任何第三方反爬/伪装。
// 触发：vercel.json crons 定时 GET 调用；配置 CRON_SECRET 时校验 Bearer，防外部盗刷。
// --------------------------------------------------------------------------

import { NextResponse } from "next/server";
import {
  mockSubmissions,
  mockUsers,
  mockPlatform,
  mockCampaigns,
  applyFlatUpdate,
} from "../_mock-store";

// ---- Firebase Admin 单例（F-CrowdBang）；缺依赖时降级本地 mock ----
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
  console.warn("[auto-approve] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

const WORKER_PAYOUT = 3.0;
const PLATFORM_FEE = 1.0;
const DEFAULT_WINDOW_HOURS = 48; // 商家未设窗口时的默认保护窗口

/** 读取任务的自动放行窗口（小时）。取不到则用默认 48h。 */
async function windowHoursFor(campaignId) {
  if (firebaseAvailable) {
    try {
      const snap = await db.collection("campaigns").doc(campaignId).get();
      if (snap.exists) {
        const h = snap.data()?.audit_strategy?.auto_approve_after_hours;
        if (Number(h) > 0) return Number(h);
      }
    } catch (_) {
      /* 读不到就回退默认 */
    }
    return DEFAULT_WINDOW_HOURS;
  }
  const camp = mockCampaigns.get(campaignId);
  const h = camp?.audit_strategy?.auto_approve_after_hours;
  return Number(h) > 0 ? Number(h) : DEFAULT_WINDOW_HOURS;
}

/** 读取任务的分账配置（达人佣金 + 平台费），不再写死 $3/$1。 */
async function resolveCampaignPayout(campaignId) {
  if (firebaseAvailable) {
    try {
      const snap = await db.collection("campaigns").doc(campaignId).get();
      if (snap.exists) {
        const esc = snap.data()?.escrow_summary || {};
        const p = Number(esc.payout_rate) > 0 ? Number(esc.payout_rate) : 3.0;
        const f = Number(esc.platform_fee) >= 0 ? Number(esc.platform_fee) : 1.0;
        return { workerPayout: p, platformFee: f };
      }
    } catch (_) { /* 读不到回退默认 */ }
    return { workerPayout: WORKER_PAYOUT, platformFee: PLATFORM_FEE };
  }
  const camp = mockCampaigns.get(campaignId);
  const p = Number(camp?.payout) > 0 ? Number(camp.payout) : WORKER_PAYOUT;
  const f = Number(camp?.platformFee) >= 0 ? Number(camp.platformFee) : PLATFORM_FEE;
  return { workerPayout: p, platformFee: f };
}

/** 放行一笔已超时的对账单（Firestore 事务原子 / mock 直接变更），与 manual-verify 分账一致。 */
async function settleAuto(submissionId, data) {
  const { workerPayout, platformFee } = await resolveCampaignPayout(data.campaign_id);
  if (firebaseAvailable) {
    const subRef = db.collection("submissions").doc(submissionId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(subRef);
      if (!snap.exists) return;
      const d = snap.data();
      if (d.audit_metadata?.verification_status !== "PENDING_AUDIT") return;
      tx.update(subRef, {
        "audit_metadata.verification_status": "verified",
        "audit_metadata.auditor": "system",
        "audit_metadata.audited_at": new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        payout_status: "paid",
        updated_at: new Date().toISOString(),
      });
      const workerRef = db.collection("users").doc(d.worker_id);
      tx.set(workerRef, { balance_usd: FieldValue.increment(workerPayout) }, { merge: true });
      const platformRef = db.collection("platform_accounts").doc("official_profit");
      tx.set(platformRef, { service_fee_balance_usd: FieldValue.increment(platformFee) }, { merge: true });
    });
    return;
  }
  const m = mockSubmissions.get(submissionId);
  if (!m || m.audit_metadata?.verification_status !== "PENDING_AUDIT") return;
  applyFlatUpdate(m, {
    "audit_metadata.verification_status": "verified",
    "audit_metadata.auditor": "system",
    "audit_metadata.audited_at": new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    payout_status: "paid",
    updated_at: new Date().toISOString(),
  });
  mockUsers.set(m.worker_id, { balance_usd: (mockUsers.get(m.worker_id)?.balance_usd || 0) + workerPayout });
  mockPlatform.service_fee_balance_usd += platformFee;
}

export async function GET(request) {
  // 安全闸：若配置 CRON_SECRET，校验 Authorization: Bearer <CRON_SECRET>
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
      for (const doc of snap.docs) pending.push({ submissionId: doc.id, data: doc.data() });
    } else {
      for (const [id, m] of mockSubmissions) {
        if (m.audit_metadata?.verification_status === "PENDING_AUDIT") {
          pending.push({ submissionId: id, data: m });
        }
      }
    }

    // 2) 逐笔判定：已回填链接 + 超时 → 自动放行；否则跳过
    const now = Date.now();
    const autoApproved = [];
    const skipped = [];

    for (const { submissionId, data } of pending) {
      const publishedUrl = data.audit_metadata?.published_video_url;

      // 老外还没回填完工链接 → 跳过（核验前提不成立）
      if (!publishedUrl) {
        skipped.push({ submissionId, reason: "NO_PUBLISHED_URL" });
        continue;
      }

      const submittedAt = new Date(data.submitted_at || data.claim_timestamp || 0).getTime();
      const windowHours = await windowHoursFor(data.campaign_id);
      const elapsedHours = (now - submittedAt) / 3600000;

      // 未到自动放行窗口 → 跳过（商家仍可在窗口内手动拒付）
      if (submittedAt <= 0 || elapsedHours < windowHours) {
        skipped.push({ submissionId, reason: "WITHIN_WINDOW", window_hours: windowHours, elapsed_hours: +elapsedHours.toFixed(2) });
        continue;
      }

      // 超时 → 自动放行分账
      await settleAuto(submissionId, data);
      autoApproved.push({ submissionId, window_hours: windowHours, elapsed_hours: +elapsedHours.toFixed(2) });
    }

    return NextResponse.json(
      {
        status: "ok",
        scanned: pending.length,
        auto_approved: autoApproved.length,
        skipped: skipped.length,
        details: { auto_approved: autoApproved, skipped },
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[auto-approve]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
