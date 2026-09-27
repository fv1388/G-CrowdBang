// src/app/api/admin/campaigns/route.js
// G-CrowdBang / F-CrowdBang · 商户创建悬赏任务接口（App Router Route Handler）
// 职责：接收表单 → 归属硬约束（owner 必须是当前商户）→ 写 campaigns 集合。
// 说明：仅做合规入库；规则层已锁 owner_merchant_id == auth.uid，服务端二次校验。

import { NextResponse } from "next/server";
import { mockMerchants, mockCampaigns, mockMerchantTransactions } from "../../tasks/_mock-store";

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
  console.warn("[admin/campaigns] firebase-admin unavailable, using local mock");
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

// 归属：生产环境应从认证会话取当前商户 uid；此处以环境变量作服务端兜底示意。
function currentMerchantId() {
  return process.env.MERCHANT_ID ?? "mch_placeholder";
}

// ---- 本地 mock 任务（无 firebase-admin 时供商户看板演示）----
const MOCK_MERCHANT_CAMPAIGNS = [
  {
    id: "cmp_demo_001", title: "Unbox & Showcase — Home Gadget", status: "open",
    city: "Jacksonville", state: "FL", slots: 12, slots_used: 4, payout: 3.0,
    audits: { PENDING_AUDIT: 2, verified: 2 },
  },
  {
    id: "cmp_demo_002", title: "Budget Hack Reel — Kitchen Tool", status: "open",
    city: "Orlando", state: "FL", slots: 8, slots_used: 3, payout: 3.0,
    audits: { PENDING_AUDIT: 3, verified: 0 },
  },
];

export async function GET() {
  try {
    const merchantId = currentMerchantId();

    if (!firebaseAvailable) {
      return NextResponse.json({ campaigns: MOCK_MERCHANT_CAMPAIGNS, source: "mock" }, { status: 200 });
    }

    // 仅返回该商户自己的任务（归属过滤）
    const snap = await db.collection("campaigns")
      .where("owner_merchant_id", "==", merchantId)
      .orderBy("created_at", "desc")
      .limit(50)
      .get();

    const campaigns = snap.docs.map((doc) => {
      const d = doc.data();
      const geo = d.geotargeting_config || {};
      const escrow = d.escrow_summary || {};
      return {
        id: doc.id,
        title: d.title || "Untitled",
        status: d.status || "open",
        city: geo.enabled ? geo.target_city : "Anywhere",
        state: geo.enabled ? geo.target_state : "US",
        slots: escrow.total_slots || 0,
        slots_used: escrow.slots_used || 0,
        payout: escrow.payout_rate ?? 0,
        created_at: d.created_at || null,
      };
    });

    return NextResponse.json({ campaigns, source: "firestore" }, { status: 200 });
  } catch (err) {
    console.error("[admin/campaigns] GET", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
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

    // 托管参数
    const totalSlots = Number(escrow_summary?.total_slots) || 0;
    const payoutRate = Number(escrow_summary?.payout_rate) || 0;
    const platformFee = Number(escrow_summary?.platform_fee) || 0;
    if (!(totalSlots > 0)) {
      return NextResponse.json({ error: "INVALID_ESCROW" }, { status: 400 });
    }

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
        total_slots: totalSlots,
        slots_used: 0,
        payout_rate: payoutRate,
        platform_fee: platformFee,
      },
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 本次发单需冻结资金：名额 × (佣金 + 平台服务费)
    const requiredFunds = totalSlots * (payoutRate + platformFee);

    let campaignId;

    if (firebaseAvailable) {
      // 事务原子：校验商户余额 → 扣减余额 → 建单 → 写流水，防止并发超发
      await db.runTransaction(async (tx) => {
        const merchantRef = db.collection("merchants").doc(merchantId);
        const mSnap = await tx.get(merchantRef);
        if (!mSnap.exists) {
          throw new Error("MERCHANT_NOT_FOUND");
        }
        const balance = mSnap.data()?.balance_usd || 0;
        if (balance < requiredFunds) {
          throw new Error("INSUFFICIENT_MERCHANT_BALANCE");
        }

        tx.update(merchantRef, {
          balance_usd: FieldValue.increment(-requiredFunds),
          updated_at: new Date().toISOString(),
        });

        const ref = db.collection("campaigns").doc();
        campaign.campaign_id = ref.id;
        campaignId = ref.id;
        tx.set(ref, campaign);

        const txnRef = db.collection("merchant_transactions").doc();
        tx.set(txnRef, {
          merchant_id: merchantId,
          type: "debit",
          amount_usd: requiredFunds,
          payment_reference: ref.id,
          verified: true,
          created_at: new Date().toISOString(),
        });
      });
    } else {
      // 本地 mock：校验/扣减共享商户账本 + 写入 mockCampaigns（list-shaped）使大厅可见
      // 无钱包时播种默认余额，代表已充值商户，便于本地联调演示扣款逻辑
      if (!mockMerchants.has(merchantId)) {
        mockMerchants.set(merchantId, { balance_usd: 500, currency: "USD" });
      }
      const balance = mockMerchants.get(merchantId)?.balance_usd || 0;
      if (balance < requiredFunds) {
        return NextResponse.json(
          { error: "INSUFFICIENT_MERCHANT_BALANCE", balance_usd: balance, required: requiredFunds },
          { status: 402 }
        );
      }
      mockMerchants.set(merchantId, { balance_usd: balance - requiredFunds, currency: "USD" });

      campaignId = `cmp_local_${Date.now()}`;
      campaign.campaign_id = campaignId;
      const geo = campaign.geotargeting_config;
      const escrow = campaign.escrow_summary;
      mockCampaigns.set(campaignId, {
        id: campaignId,
        title: campaign.title,
        video_url: campaign.video_url,
        caption_text: campaign.caption_text,
        city: geo.enabled ? geo.target_city : "Anywhere",
        state: geo.enabled ? geo.target_state : "US",
        payout: escrow.payout_rate ?? 3.0,
        slotsRemaining: totalSlots,
        boundary: {
          enabled: !!geo.enabled,
          center: { latitude: geo.target_lat ?? 0, longitude: geo.target_lng ?? 0 },
          radiusKm: geo.radius_km ?? 0,
          maxAcceptableAccuracyMeters: 200,
        },
      });
      mockMerchantTransactions.set(`mt_local_${Date.now()}`, {
        merchant_id: merchantId,
        type: "debit",
        amount_usd: requiredFunds,
        payment_reference: campaignId,
        verified: true,
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      {
        campaignId,
        status: "open",
        funds_held_usd: requiredFunds,
        merchant_balance_after_usd: firebaseAvailable
          ? undefined
          : (mockMerchants.get(merchantId)?.balance_usd ?? 0),
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 201 }
    );
  } catch (err) {
    if (err?.message === "INSUFFICIENT_MERCHANT_BALANCE") {
      return NextResponse.json({ error: "INSUFFICIENT_MERCHANT_BALANCE" }, { status: 402 });
    }
    if (err?.message === "MERCHANT_NOT_FOUND") {
      return NextResponse.json({ error: "MERCHANT_NOT_FOUND", hint: "deposit first" }, { status: 404 });
    }
    console.error("[admin/campaigns]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
