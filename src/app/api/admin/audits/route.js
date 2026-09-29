// src/app/api/admin/audits/route.js
// G-CrowdBang / F-CrowdBang · 商家核验面板列表接口（App Router Route Handler）
// --------------------------------------------------------------------------
// 职责：一次性返回当前商户名下【全部 PENDING_AUDIT 待人工核验对账单】，
//       并附上核验所需信息：目标账号、完工链接、截图、worker、submitted_at、
//       自动放行窗口与剩余倒计时（供前台显示"X 小时后自动放行"）。
// 归属：服务端校验每条对账归属当前商户（campaign.owner_merchant_id），他人不可见。
// 合规：纯读账本，不触发任何第三方反查；零绑定模式下不依赖 TikTok 令牌。
// --------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { mockSubmissions, mockCampaigns } from "../../tasks/_mock-store";

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
  console.warn("[admin/audits] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

const DEFAULT_WINDOW_HOURS = 48;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    // 归属由服务端当前商户决定；可选 merchantId 覆盖（本地 mock 调试用）
    const merchantId = searchParams.get("merchantId") || process.env.MERCHANT_ID || "mch_placeholder";

    const rows = [];

    if (!firebaseAvailable) {
      for (const [id, s] of mockSubmissions) {
        if (s.audit_metadata?.verification_status !== "PENDING_AUDIT") continue;
        const camp = mockCampaigns.get(s.campaign_id);
        if (!camp || camp.merchantId !== merchantId) continue;
        rows.push(buildRow(id, s, camp));
      }
      return NextResponse.json({ audits: rows, count: rows.length, source: "mock" }, { status: 200 });
    }

    // Firestore：逐笔 resolve campaign 归属
    const snap = await db
      .collection("submissions")
      .where("audit_metadata.verification_status", "==", "PENDING_AUDIT")
      .limit(200)
      .get();

    for (const doc of snap.docs) {
      const s = doc.data();
      const campSnap = await db.collection("campaigns").doc(s.campaign_id).get();
      if (!campSnap.exists) continue;
      const camp = campSnap.data();
      if (camp.owner_merchant_id !== merchantId) continue;
      rows.push(buildRow(doc.id, s, camp));
    }

    // 按 claim 时间倒序
    rows.sort((a, b) => (b.claimTimestamp || "").localeCompare(a.claimTimestamp || ""));

    return NextResponse.json({ audits: rows, count: rows.length, source: "firestore" }, { status: 200 });
  } catch (err) {
    console.error("[admin/audits] GET", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

// 组装一条核验行（含倒计时计算）
function buildRow(submissionId, s, camp) {
  const autoApproveHours =
    Number(camp.audit_strategy?.auto_approve_after_hours) > 0
      ? Number(camp.audit_strategy?.auto_approve_after_hours)
      : DEFAULT_WINDOW_HOURS;

  const submittedAt = s.submitted_at || s.claim_timestamp || null;
  let remainingHours = null;
  if (submittedAt) {
    const elapsed = (Date.now() - new Date(submittedAt).getTime()) / 3600000;
    remainingHours = +((autoApproveHours - elapsed).toFixed(2));
  }

  return {
    submissionId,
    campaignId: s.campaign_id,
    campaignTitle: camp.title || camp.caption_text || null,
    campaignType: camp.campaign_type || camp.campaignType || null, // video_post | product_sample
    targetAccount: camp.target_account || camp.targetAccount || null,
    videoUrl: camp.video_url || null,
    captionText: s.caption_text || camp.caption_text || null,
    // 寄样带货信息
    productName: camp.product?.name || camp.productName || null,
    productDescription: camp.product?.description || camp.productDescription || null,
    brandTag: camp.brand_tag || camp.brandTag || null,
    commentLinkRequired: camp.comment_link_required ?? camp.commentLinkRequired ?? false,
    shippingAddress: s.shipping_address || null,
    sampleRequested: !!s.sample_requested,
    // 分账数值（前端展示放行后老外/平台各得多少）
    payout: camp.escrow_summary?.payout_rate ?? camp.payout ?? 3.0,
    platformFee: camp.escrow_summary?.platform_fee ?? camp.platformFee ?? 4.0,
    workerId: s.worker_id,
    latitude: s.hardware_geoloc?.latitude,
    longitude: s.hardware_geoloc?.longitude,
    publishedVideoUrl: s.audit_metadata?.published_video_url || null,
    screenshotFilename: s.audit_metadata?.screenshot_filename || null,
    verificationStatus: s.audit_metadata?.verification_status,
    payoutStatus: s.payout_status,
    claimTimestamp: s.claim_timestamp || null,
    submittedAt,
    autoApproveHours,
    remainingHours,
  };
}
