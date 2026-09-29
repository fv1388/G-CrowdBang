// src/app/api/tasks/manual-verify/route.js
// G-CrowdBang / F-CrowdBang · 人工核验对账接口（App Router Route Handler）
// --------------------------------------------------------------------------
// 职责：零绑定模式下，由【商户本人在后台】肉眼核验老外回填的公开视频链接，
//       确认视频确实发布到了商户手动指定的目标账号（target_account），再决定：
//         - approve（放行）→ 触发托管分账：老外 +$3.00 佣金、平台 +$1.00 技术服务费。
//         - reject（拒付） → 将该笔对账状态物理置为 rejected，保全商家托管资金。
// 合规：不依赖任何 TikTok OAuth 令牌，不做任何第三方 API 反爬/伪装；
//       放行权归属任务发布商户（owner），杜绝接单人自审自放。
// 状态机：PENDING_AUDIT → verified(paid) | rejected(released)。终态不可逆。
// --------------------------------------------------------------------------

import { NextResponse } from "next/server";
import {
  mockSubmissions,
  mockUsers,
  mockPlatform,
  mockCampaigns,
  mockMerchants,
  applyFlatUpdate,
} from "../_mock-store";

// ---- Firebase Admin 单例（F-CrowdBang）；缺依赖时降级本地 mock，保证本地联调可运行 ----
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
  console.warn("[manual-verify] firebase-admin unavailable, using local mock");
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

// 分账兜底默认（真库任务取 escrow_summary.payout_rate / platform_fee）
const WORKER_PAYOUT = 10.0;
const PLATFORM_FEE = 2.0;
// 返工次数上限：最多 2 次；第 3 次仍不合格只能拒付，保全托管
const MAX_REWORK = 2;

/**
 * 校验该笔对账是否归当前商户所有（防止接单人自审自放 / 越权放款）。
 * 归属判定：submission 自带 owner_merchant_id，否则回退到对应 campaign 的 merchantId。
 */
async function resolveOwnerMerchantId(submission) {
  if (submission.owner_merchant_id) return submission.owner_merchant_id;
  if (firebaseAvailable) {
    const snap = await db.collection("campaigns").doc(submission.campaign_id).get();
    if (snap.exists) return snap.data()?.owner_merchant_id ?? null;
    return null;
  }
  const camp = mockCampaigns.get(submission.campaign_id);
  return camp?.merchantId ?? null;
}

/**
 * 读取任务的分账配置（达人单条佣金 + 平台单条服务费）。
 * 生产：campaign.escrow_summary.payout_rate / platform_fee；
 * mock：list-shaped 的 payout / platformFee。缺省回退 $3 / $1。
 */
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

export async function POST(request) {
  try {
    const { submissionId, merchantId, decision, note } = await request.json();

    if (!submissionId || !merchantId) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "reject" && decision !== "rework") {
      return NextResponse.json({ error: "INVALID_DECISION", hint: "use 'approve', 'reject' or 'rework'" }, { status: 400 });
    }

    // 1) 取回对账单
    let submission, subRef = null;
    if (firebaseAvailable) {
      subRef = db.collection("submissions").doc(submissionId);
      const snap = await subRef.get();
      if (!snap.exists) return NextResponse.json({ error: "SUBMISSION_NOT_FOUND" }, { status: 404 });
      submission = snap.data();
    } else {
      const m = mockSubmissions.get(submissionId);
      if (!m) return NextResponse.json({ error: "SUBMISSION_NOT_FOUND" }, { status: 404 });
      submission = m;
    }

    // 2) 状态卡点：仅 PENDING_AUDIT 可核验；终态不可逆
    if (submission.audit_metadata?.verification_status !== "PENDING_AUDIT") {
      return NextResponse.json(
        { error: "NOT_PENDING", status: submission.audit_metadata?.verification_status },
        { status: 409 }
      );
    }

    // 3) 商户归属校验（合规）：放行/拒付权只归任务发布商户本人
    const owner = await resolveOwnerMerchantId(submission);
    if (owner && owner !== merchantId) {
      return NextResponse.json(
        { error: "FORBIDDEN", hint: "only the campaign owner merchant can audit this submission" },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();

    // ---- 决策 R：rework（需返工）——视频质量不合格，退回老外重拍；超过限次后只能放行/拒付 ----
    if (decision === "rework") {
      const cur = Number(submission.audit_metadata?.revision_count || 0);
      if (cur >= MAX_REWORK) {
        return NextResponse.json(
          { error: "REWORK_LIMIT", hint: `already reworked ${cur} times; only approve or reject now` },
          { status: 409 }
        );
      }
      const update = {
        "audit_metadata.verification_status": "revision_requested",
        "audit_metadata.revision_count": cur + 1,
        "audit_metadata.revision_reason": note || "Video quality did not meet merchant requirements",
        "audit_metadata.audited_by": merchantId,
        "audit_metadata.audited_at": nowIso,
        updated_at: nowIso,
      };
      if (firebaseAvailable) {
        await subRef.update(update);
      } else {
        applyFlatUpdate(mockSubmissions.get(submissionId), update);
      }
      return NextResponse.json(
        { result: "rework_requested", revision_count: cur + 1, source: firebaseAvailable ? "firestore" : "mock" },
        { status: 200 }
      );
    }

    // ---- 决策 A：reject（拒付）——状态物理置为 rejected，并把该单冻结资金退回商家 ----
    if (decision === "reject") {
      // 该单冻结的托管额（佣金+平台服务费）全部释放回商家可用余额，保全商家资金
      const { workerPayout, platformFee } = await resolveCampaignPayout(submission.campaign_id);
      const releaseUsd = workerPayout + platformFee;
      const update = {
        "audit_metadata.verification_status": "rejected",
        "audit_metadata.reject_reason": "MANUAL_REJECT",
        "audit_metadata.auditor_note": note || "",
        "audit_metadata.audited_by": merchantId,
        "audit_metadata.audited_at": nowIso,
        payout_status: "released",
        updated_at: nowIso,
      };
      if (firebaseAvailable) {
        await db.runTransaction(async (tx) => {
          tx.update(subRef, update);
          // 退回商家可用余额
          const owner = await resolveOwnerMerchantId(submission);
          if (owner) {
            tx.update(db.collection("merchants").doc(owner), {
              balance_usd: FieldValue.increment(releaseUsd),
              updated_at: nowIso,
            });
          }
          // 递减任务冻结池
          tx.update(db.collection("campaigns").doc(submission.campaign_id), {
            escrow_locked_usd: FieldValue.increment(-releaseUsd),
            updated_at: nowIso,
          });
        });
      } else {
        applyFlatUpdate(mockSubmissions.get(submissionId), update);
        const owner = await resolveOwnerMerchantId(submission);
        if (owner && mockMerchants.has(owner)) {
          mockMerchants.set(owner, {
            balance_usd: (mockMerchants.get(owner)?.balance_usd || 0) + releaseUsd,
            currency: "USD",
          });
        }
      }
      return NextResponse.json(
        { result: "rejected", released_usd: releaseUsd, source: firebaseAvailable ? "firestore" : "mock" },
        { status: 200 }
      );
    }

    // ---- 决策 B：approve（放行）→ 原子托管分账 ----
    // 分账按任务设定（达人佣金 + 平台服务费），不再写死 $3/$1
    const { workerPayout, platformFee } = await resolveCampaignPayout(submission.campaign_id);
    if (firebaseAvailable) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(subRef);
        if (!snap.exists) return;
        const data = snap.data();
        // 事务内二次确认仍为 PENDING_AUDIT，防止并发重复结算
        if (data.audit_metadata?.verification_status !== "PENDING_AUDIT") return;

        tx.update(subRef, {
          "audit_metadata.verification_status": "verified",
          "audit_metadata.auditor_note": note || "",
          "audit_metadata.audited_by": merchantId,
          "audit_metadata.audited_at": nowIso,
          submitted_at: nowIso,
          payout_status: "paid",
          updated_at: nowIso,
        });

        // 佣金：达人佣金划入接单人可用提现余额（users/<worker_id>.balance_usd）
        const workerRef = db.collection("users").doc(data.worker_id);
        tx.set(workerRef, { balance_usd: FieldValue.increment(workerPayout) }, { merge: true });

        // 平台服务费：计入总部官方利润账户
        const platformRef = db.collection("platform_accounts").doc("official_profit");
        tx.set(
          platformRef,
          { service_fee_balance_usd: FieldValue.increment(platformFee) },
          { merge: true }
        );

        // 递减任务冻结池 + 累加已用名额（该单托管资金已完成分配）
        tx.update(db.collection("campaigns").doc(data.campaign_id), {
          escrow_locked_usd: FieldValue.increment(-(workerPayout + platformFee)),
          slots_used: FieldValue.increment(1),
          updated_at: nowIso,
        });
      });
    } else {
      // 本地 mock 分账
      const m = mockSubmissions.get(submissionId);
      if (m.audit_metadata?.verification_status !== "PENDING_AUDIT") {
        return NextResponse.json(
          { error: "NOT_PENDING", status: m.audit_metadata?.verification_status },
          { status: 409 }
        );
      }
      applyFlatUpdate(m, {
        "audit_metadata.verification_status": "verified",
        "audit_metadata.auditor_note": note || "",
        "audit_metadata.audited_by": merchantId,
        "audit_metadata.audited_at": nowIso,
        submitted_at: nowIso,
        payout_status: "paid",
        updated_at: nowIso,
      });
      const workerBalance = (mockUsers.get(m.worker_id)?.balance_usd || 0) + workerPayout;
      mockUsers.set(m.worker_id, { balance_usd: workerBalance });
      mockPlatform.service_fee_balance_usd += platformFee;
    }

    return NextResponse.json(
      {
        result: "verified",
        payout: { worker_usd: workerPayout, platform_fee_usd: platformFee },
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[manual-verify]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
