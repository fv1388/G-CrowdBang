// src/app/api/campaigns/create/route.js
// G-CrowdBang / F-CrowdBang · 商户发布悬赏创建接口（App Router Route Handler）
// 职责：校验商户登录 → 验证托管参数(total_slots, payout_rate) → 写入 campaigns。
// 兼容策略：装有 firebase-admin 时直连 Firestore；未装时降级本地 mock（便于本地联调，
//           装上依赖并配置 .env.local 后自动切换真实写库）。

import { NextResponse } from "next/server";
import { mockCampaigns, mockMerchants, mockMerchantTransactions } from "../../tasks/_mock-store.js";

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

// 商户归属：优先取请求体中的 ownerId（前端鉴权会话 UID），env 作服务端兜底
function currentMerchantId(bodyMerchantId) {
  return bodyMerchantId || (process.env.MERCHANT_ID ?? "mch_placeholder");
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
    const { title, video_url, caption_text, target_hashtags, geotargeting_config, escrow_summary, merchantId, target_account, target_tiktok_account, audit_strategy, audit_auto_approve_hours, brand_hashtag, content_brief, campaign_type, product_name, product_description, brand_tag, comment_link_required, platform_fee, platform, retention_days } = body || {};

    // 保留期（防"拿钱删视频"）：视频需保持公开的核验天数，默认 30 天；期间 10% 佣金冻结不可提现
    const retentionDays = Number(retention_days) > 0 ? Number(retention_days) : 30;

    // 人工核验超时自动放行窗口（小时）：商户可设，未设则默认 48h
    const autoApproveHours = Number(audit_strategy?.auto_approve_after_hours ?? audit_auto_approve_hours);
    const auditStrategy = {
      mode: "manual", // 零绑定人工核验
      auto_approve_after_hours: autoApproveHours > 0 ? autoApproveHours : 48,
    };

    if (!title) {
      return NextResponse.json({ error: "TITLE_REQUIRED" }, { status: 400 });
    }

    const escrowCheck = validateEscrow(escrow_summary);
    if (!escrowCheck.ok) {
      return NextResponse.json({ error: escrowCheck.error }, { status: 400 });
    }

    const ownerId = currentMerchantId(merchantId);
    // 平台服务费：支持前端显式传入（默认 $2/单），覆盖寄样/视频任务的托管抽成
    const platformFee = Number(platform_fee) >= 0 ? Number(platform_fee) : (Number(escrow_summary?.platform_fee) >= 0 ? Number(escrow_summary.platform_fee) : 2.0);
    // 本次发布需从商家可用余额冻结的托管总额 = 名额 × (单条佣金 + 单条平台服务费)
    const requiredFunds = escrowCheck.escrow.total_slots * (escrowCheck.escrow.payout_rate + platformFee);
    const campaign = {
      campaign_id: null,
      owner_merchant_id: ownerId,
      title,
      campaign_type: campaign_type || "video_post", // video_post=视频代发 / product_sample=寄样带货 / product_no_sample=无样带货
      platform: (["tiktok","youtube","instagram","facebook","x"].includes(platform) ? platform : "tiktok"), // 目标发布平台（多平台 UGC）
      video_url: video_url ?? "",
      caption_text: caption_text ?? "",
      target_account: target_tiktok_account || target_account || "", // 目标发布号（可选；UGC 模式不再作为核心必填）
      brand_hashtag: brand_hashtag || "", // 品牌话题（UGC 模式核心：老外创作时带上品牌话题/链接）
      content_brief: content_brief || "", // 内容要求/创作指引（UGC 模式核心）
      // ---- 寄样带货任务字段（campaign_type=product_sample 时使用）----
      product: {
        name: product_name || "",
        description: product_description || "",
      },
      brand_tag: brand_tag || "", // 标题@的品牌账号（寄样任务要求老外标题@该账号）
      comment_link_required: !!comment_link_required, // 是否要求老外在评论区挂商品链接
      audit_strategy: auditStrategy, // 人工核验 + 超时自动放行窗口（默认 48h）
      target_hashtags: Array.isArray(target_hashtags) ? target_hashtags : [],
      geotargeting_config: {
        enabled: !!geotargeting_config?.enabled,
        target_city: geotargeting_config?.target_city ?? "",
        target_state: geotargeting_config?.target_state ?? "",
        target_lat: geotargeting_config?.target_lat ?? null,
        target_lng: geotargeting_config?.target_lng ?? null,
        radius_km: geotargeting_config?.radius_km ?? 0,
      },
      escrow_summary: { ...escrowCheck.escrow, platform_fee: platformFee },
      // 保留期天数：佣金需保持视频公开 N 天后才释放剩余 10%，防"拿钱删视频"（默认 30 天）
      retention_days: retentionDays,
      // 托管冻结池：发布瞬间把"名额×每单总成本"从商家可用余额全额锁定，
      // 放行时递减、拒付时退回商家。escrow_locked_usd 反映该任务当前仍冻住的资金。
      escrow_locked_usd: requiredFunds,
      slots_used: 0,
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let campaignId;

    if (firebaseAvailable) {
      // 事务原子：校验商户余额 → 扣减 → 建单 → 写流水
      await db.runTransaction(async (tx) => {
        const merchantRef = db.collection("merchants").doc(ownerId);
        const mSnap = await tx.get(merchantRef);
        if (!mSnap.exists) throw new Error("MERCHANT_NOT_FOUND");
        const balance = mSnap.data()?.balance_usd || 0;
        if (balance < requiredFunds) throw new Error("INSUFFICIENT_MERCHANT_BALANCE");

        tx.update(merchantRef, { balance_usd: FieldValue.increment(-requiredFunds) });

        const ref = db.collection("campaigns").doc();
        campaign.campaign_id = ref.id;
        campaignId = ref.id;
        tx.set(ref, campaign);

        const txnRef = db.collection("merchant_transactions").doc();
        tx.set(txnRef, {
          merchant_id: ownerId,
          type: "debit",
          amount_usd: requiredFunds,
          payment_reference: ref.id,
          verified: true,
          created_at: new Date().toISOString(),
        });
      });
    } else {
      // 本地 mock：无钱包播种默认余额（代表已充值商户），校验/扣减 + 写大厅 + 流水
      if (!mockMerchants.has(ownerId)) {
        mockMerchants.set(ownerId, { balance_usd: 500, currency: "USD" });
      }
      const balance = mockMerchants.get(ownerId)?.balance_usd || 0;
      if (balance < requiredFunds) {
        return NextResponse.json(
          { error: "INSUFFICIENT_MERCHANT_BALANCE", balance_usd: balance, required: requiredFunds },
          { status: 402 }
        );
      }
      mockMerchants.set(ownerId, { balance_usd: balance - requiredFunds, currency: "USD" });

      // 本地 mock：生成假 id，并写入共享 mockCampaigns 账本（list-shaped），
      // 使任务大厅 /api/campaigns/list 能立刻读到这条新建任务，实现 mock 全链路闭环。
      campaignId = `cmp_local_${Date.now()}`;
      campaign.campaign_id = campaignId;

      const geo = campaign.geotargeting_config || {};
      const escrow = campaign.escrow_summary || {};
      mockCampaigns.set(campaignId, {
        id: campaignId,
        merchantId: ownerId,
        title: campaign.title,
        targetAccount: campaign.target_account,
        brandHashtag: campaign.brand_hashtag,
        contentBrief: campaign.content_brief,
        campaignType: campaign.campaign_type,
        productName: campaign.product?.name,
        productDescription: campaign.product?.description,
        brandTag: campaign.brand_tag,
        commentLinkRequired: campaign.comment_link_required,
        platformFee: escrow.platform_fee ?? 2.0,
        retentionDays: campaign.retention_days ?? 30,
        audit_strategy: campaign.audit_strategy,
        video_url: campaign.video_url,
        caption_text: campaign.caption_text,
        city: geo.enabled ? geo.target_city : "Anywhere",
        state: geo.enabled ? geo.target_state : "US",
        payout: escrow.payout_rate ?? 10.0,
        slotsRemaining: Math.max(0, (escrow.total_slots || 0) - (escrow.slots_used || 0)),
        boundary: {
          enabled: !!geo.enabled,
          center: { latitude: geo.target_lat ?? 0, longitude: geo.target_lng ?? 0 },
          radiusKm: geo.radius_km ?? 0,
          maxAcceptableAccuracyMeters: 200,
        },
      });
      mockMerchantTransactions.set(`mt_local_${Date.now()}`, {
        merchant_id: ownerId,
        type: "debit",
        amount_usd: requiredFunds,
        payment_reference: campaignId,
        verified: true,
        created_at: new Date().toISOString(),
      });
    }

    // [response contract] funds_held_usd + merchant_balance_after_usd
    return NextResponse.json(
      {
        campaignId,
        status: "open",
        funds_held_usd: requiredFunds,
        merchant_balance_after_usd: firebaseAvailable
          ? undefined
          : (mockMerchants.get(ownerId)?.balance_usd ?? 0),
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
    console.error("[campaigns/create]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
