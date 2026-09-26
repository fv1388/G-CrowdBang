// src/app/api/admin/campaigns/route.js
// G-CrowdBang / F-CrowdBang · 商户创建悬赏任务接口（App Router Route Handler）
// 职责：接收表单 → 归属硬约束（owner 必须是当前商户）→ 写 campaigns 集合。
// 说明：仅做合规入库；规则层已锁 owner_merchant_id == auth.uid，服务端二次校验。

import { NextResponse } from "next/server";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

// 归属：生产环境应从认证会话取当前商户 uid；此处以环境变量作服务端兜底示意。
function currentMerchantId() {
  return process.env.MERCHANT_ID ?? "mch_placeholder";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      title,
      video_url,
      caption_text,
      target_hashtags,
      geotargeting_config,
      escrow_summary,
    } = body || {};

    if (!title || !escrow_summary) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    const merchantId = currentMerchantId();

    const campaign = {
      campaign_id: null, // 落库时生成
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
      escrow_summary: {
        total_slots: Number(escrow_summary?.total_slots) || 0,
        slots_used: 0,
        payout_rate: Number(escrow_summary?.payout_rate) || 0,
        platform_fee: Number(escrow_summary?.platform_fee) || 0,
      },
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const ref = db.collection("campaigns").doc();
    campaign.campaign_id = ref.id;
    await ref.set(campaign);

    return NextResponse.json({ campaignId: ref.id, status: "open" }, { status: 201 });
  } catch (err) {
    console.error("[admin/campaigns]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
