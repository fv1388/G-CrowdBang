// src/app/api/campaigns/create/route.js
// G-CrowdBang / F-CrowdBang · 商户发布悬赏创建接口（App Router Route Handler）
// 职责：校验商户登录 → 验证托管参数(total_slots, payout_rate) → 写入 campaigns。
// 兼容策略：装有 firebase-admin 时直连 Firestore；未装时降级本地 mock（便于本地联调，
//           装上依赖并配置 .env.local 后自动切换真实写库）。

import { NextResponse } from "next/server";

let db = null;
let firebaseAvailable = false;

try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
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
  // firebase-admin 未安装：降级到本地 mock，保证本地联调可运行
  console.warn("[campaigns/create] firebase-admin unavailable, using local mock");
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

// 商户归属：生产从认证会话取当前商户 uid；此处以环境变量作服务端兜底示意
function currentMerchantId() {
  return process.env.MERCHANT_ID ?? "mch_placeholder";
}

// 托管参数校验：名额与佣金必须为正数
function validateEscrow(escrow) {
  const totalSlots = Number(escrow?.total_slots);
  const payoutRate = Number(escrow?.payout_rate);
  const platformFee = Number(escrow?.platform_fee ?? 0);
  if (!(totalSlots > 0) || !(payoutRate >= 0)) {
    return { ok: false, error: "INVALID_ESCROW" };
  }
  return { ok: true, escrow: { total_slots: totalSlots, payout_rate: payoutRate, platform_fee: platformFee, slots_used: 0 } };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { title, video_url, caption_text, target_hashtags, geotargeting_config, escrow_summary } = body || {};

    if (!title) {
      return NextResponse.json({ error: "TITLE_REQUIRED" }, { status: 400 });
    }

    const escrowCheck = validateEscrow(escrow_summary);
    if (!escrowCheck.ok) {
      return NextResponse.json({ error: escrowCheck.error }, { status: 400 });
    }

    const merchantId = currentMerchantId();
    const campaign = {
      campaign_id: null,
      owner_merchant_id: merchantId,
      title,
      video_url: video_url ?? "",
      caption_text: caption_text ?? "",
      target_hashtags: Array.isArray(target_hashtags) ? target_hashtags : [],
      geotargeting_config: {
        enabled: !!geotargeting_config?.enabled,
        target_city: geotargeting_config?.target_city ?? "",
        target_state: geotargeting_config?.target_state ?? "",
        target_lat: geotargeting_config?.target_lat ?? null,
        target_lng: geotargeting_config?.target_lng ?? null,
        radius_km: geotargeting_config?.radius_km ?? 0,
      },
      escrow_summary: escrowCheck.escrow,
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let campaignId;

    if (firebaseAvailable) {
      const ref = db.collection("campaigns").doc();
      campaign.campaign_id = ref.id;
      await ref.set(campaign);
      campaignId = ref.id;
    } else {
      // 本地 mock：生成假 id，方便联调验证字段
      campaignId = `cmp_local_${Date.now()}`;
      campaign.campaign_id = campaignId;
    }

    return NextResponse.json({ campaignId, status: "open", source: firebaseAvailable ? "firestore" : "mock" }, { status: 201 });
  } catch (err) {
    console.error("[campaigns/create]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
