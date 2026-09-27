// src/app/api/tasks/verify-and-payout/route.js
// G-CrowdBang / F-CrowdBang · 结算验证接口（App Router Route Handler）
// 职责：读 submission → 官方公开API反查视频公开状态 → 托管分账 / 熔断拒付。
// 合规声明：仅使用官方公开 API + 显式平台标识的标准 fetch，不含任何指纹伪造或规避检测逻辑。

import { NextResponse } from "next/server";
import { mockSubmissions, mockUsers, mockPlatform, mockCampaigns } from "../_mock-store";
import { resolveTikTokBearer } from "../../tiktok/oauth/_resolve";

// ---- Firebase Admin 单例（F-CrowdBang）；缺依赖时降级本地 mock，保证本地联调可运行 ----
let db = null;
let firebaseAvailable = false;
try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
  db = getFirestore();
  firebaseAvailable = true;
} catch (e) {
  console.warn("[verify-and-payout] firebase-admin unavailable, using local mock");
}

// 凭证守卫：依赖已装但 FIREBASE_* 为占位/缺失时，仍降级 mock（避免用假凭证连真库）
if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// 分账常量：佣金（worker）与平台纯技术服务费（官方利润账户）
const PLATFORM_PAYOUT = 3.0;
const PLATFORM_FEE = 1.0;

/**
 * 官方公开 API 视频状态反查（合规适配层）。
 * 使用平台官方公开接口 + 服务端标准凭证，显式声明平台标识，不伪装、不抹指纹。
 * 返回 { ok, public, ... }；ok=false 表示视频不可见（不存在/已删除/非公开）。
 */
async function lookupPublishedVideo(publishedVideoId, accessToken) {
  // 本地 mock 模式（firebase-admin 未装）：返回确定性占位结果，仅用于本地闭环联调，非真实反查
  if (!firebaseAvailable) {
    return { ok: true, public: true, raw: { status: "active", visibility: "public", local_mock: true } };
  }

  // 真实环境：按实际对接的社交平台官方公开 API 填端点和凭据（服务端环境变量，勿前端暴露）。
  // 优先使用已连接的 TikTok OAuth access_token 作合规 Bearer；否则回退到平台应用级 Token。
  const token = accessToken || process.env.SOCIAL_PLATFORM_API_TOKEN;
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
    const { submissionId, merchantId } = await request.json();
    if (!submissionId) {
      return NextResponse.json({ error: "SUBMISSION_ID_REQUIRED" }, { status: 400 });
    }

    let submission, subRef = null;

    if (firebaseAvailable) {
      subRef = db.collection("submissions").doc(submissionId);
      const subSnap = await subRef.get();
      if (!subSnap.exists) {
        return NextResponse.json({ error: "SUBMISSION_NOT_FOUND" }, { status: 404 });
      }
      submission = subSnap.data();
    } else {
      const m = mockSubmissions.get(submissionId);
      if (!m) {
        return NextResponse.json({ error: "SUBMISSION_NOT_FOUND" }, { status: 404 });
      }
      submission = m;
    }

    // 仅 PENDING_AUDIT 可结算；终态不可逆
    if (submission.audit_metadata?.verification_status !== "PENDING_AUDIT") {
      return NextResponse.json(
        { error: "NOT_PENDING", status: submission.audit_metadata?.verification_status },
        { status: 409 }
      );
    }

    // 【TikTok 令牌绑定】结算前须有该商户有效 OAuth access_token 作合规 Bearer，
    // 否则无法执行官方公开状态反查 → 拒绝结算，防止无凭据放款。
    const ownerMerchantId =
      merchantId ||
      submission.owner_merchant_id ||
      mockCampaigns.get(submission.campaign_id)?.merchantId ||
      process.env.MERCHANT_ID ||
      "mch_placeholder";
    const bearer = await resolveTikTokBearer(ownerMerchantId);
    if (!bearer.ok) {
      return NextResponse.json(
        { error: "TIKTOK_TOKEN_REQUIRED", reason: bearer.reason, hint: "Merchant must connect a TikTok account before settlement." },
        { status: 409 }
      );
    }

    // 1) 官方公开 API 反查视频公开状态（使用 TikTok 合规 Bearer）
    const video = await lookupPublishedVideo(
      submission.audit_metadata?.published_video_id,
      bearer.accessToken
    );

    if (!video.ok) {
      // 视频不存在 / 已删除 / 非公开 → 终止结算，物理置为 rejected，退还托管
      const update = {
        "audit_metadata.verification_status": "rejected",
        "audit_metadata.reject_reason": "VIDEO_NOT_PUBLIC",
        payout_status: "released",
        updated_at: new Date().toISOString(),
      };
      if (firebaseAvailable) {
        await subRef.update(update);
      } else {
        Object.assign(mockSubmissions.get(submissionId), update);
      }
      return NextResponse.json(
        { result: "rejected", reason: "VIDEO_NOT_PUBLIC", source: firebaseAvailable ? "firestore" : "mock" },
        { status: 200 }
      );
    }

    // 2) 核验通过 → 托管分账（事务原子：状态推进 + 佣金 + 平台服务费）
    if (firebaseAvailable) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(subRef);
        if (!snap.exists) return;
        const data = snap.data();
        // 事务内二次确认仍是 PENDING_AUDIT，防止并发重复结算
        if (data.audit_metadata?.verification_status !== "PENDING_AUDIT") return;

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
    } else {
      // 本地 mock 结算
      const m = mockSubmissions.get(submissionId);
      if (m.audit_metadata?.verification_status !== "PENDING_AUDIT") {
        return NextResponse.json({ error: "NOT_PENDING", status: m.audit_metadata?.verification_status }, { status: 409 });
      }
      Object.assign(m, {
        "audit_metadata.verification_status": "verified",
        submitted_at: new Date().toISOString(),
        payout_status: "paid",
        updated_at: new Date().toISOString(),
      });
      const balance = (mockUsers.get(m.worker_id)?.balance_usd || 0) + PLATFORM_PAYOUT;
      mockUsers.set(m.worker_id, { balance_usd: balance });
      mockPlatform.service_fee_balance_usd += PLATFORM_FEE;
    }

    return NextResponse.json(
      {
        result: "verified",
        payout: { worker_usd: PLATFORM_PAYOUT, platform_fee_usd: PLATFORM_FEE },
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[verify-and-payout]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
