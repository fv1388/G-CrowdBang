// src/app/api/admin/submissions/route.js
// G-CrowdBang / F-CrowdBang · 商户核验审计列表接口（App Router Route Handler）
// 职责：按 campaign_id 返回该任务下的 submissions 审计明细（worker、GPS、状态、佣金）。
// 归属：仅能查当前商户自己任务（服务端校验 campaigns.owner == 当前商户）。
// 兼容策略：装有 firebase-admin 读 Firestore；未装时降级本地 mock，保证本地联调。

import { NextResponse } from "next/server";
import { mockSubmissions } from "../../tasks/_mock-store";

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
  console.warn("[admin/submissions] firebase-admin unavailable, using local mock");
}

function currentMerchantId() {
  return process.env.MERCHANT_ID ?? "mch_placeholder";
}

const MOCK_AUDITS = [
  { submissionId: "sub_audit_001", campaignId: "cmp_demo_001", workerId: "usr_w1", latitude: 30.3351, longitude: -81.6612, accuracy: 25, status: "PENDING_AUDIT", payout: "held", claimedAt: new Date().toISOString() },
  { submissionId: "sub_audit_002", campaignId: "cmp_demo_001", workerId: "usr_w2", latitude: 30.3288, longitude: -81.6501, accuracy: 30, status: "verified", payout: "paid", claimedAt: new Date(Date.now() - 86400000).toISOString() },
];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaignId");
    if (!campaignId) {
      return NextResponse.json({ error: "CAMPAIGN_ID_REQUIRED" }, { status: 400 });
    }
    const merchantId = currentMerchantId();

    if (!firebaseAvailable) {
      // 从共享 mock 账本取，若无则返回演示审计
      const fromStore = [...mockSubmissions.values()].filter((s) => s.campaign_id === campaignId);
      const list = fromStore.length
        ? fromStore.map((s) => ({
            submissionId: s.submission_id,
            campaignId: s.campaign_id,
            workerId: s.worker_id,
            latitude: s.hardware_telemetry?.latitude,
            longitude: s.hardware_telemetry?.longitude,
            accuracy: s.hardware_telemetry?.accuracy,
            status: s.audit_metadata?.verification_status,
            payout: s.payout_status,
            claimedAt: s.claim_timestamp,
          }))
        : MOCK_AUDITS.filter((a) => a.campaignId === campaignId);
      return NextResponse.json({ submissions: list, source: "mock" }, { status: 200 });
    }

    // 归属校验：该 campaign 必须属于当前商户
    const campSnap = await db.collection("campaigns").doc(campaignId).get();
    if (!campSnap.exists) {
      return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    }
    if (campSnap.data().owner_merchant_id !== merchantId) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const snap = await db.collection("submissions")
      .where("campaign_id", "==", campaignId)
      .orderBy("claim_timestamp", "desc")
      .limit(100)
      .get();

    const list = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        submissionId: doc.id,
        campaignId: d.campaign_id,
        workerId: d.worker_id,
        latitude: d.hardware_telemetry?.latitude,
        longitude: d.hardware_telemetry?.longitude,
        accuracy: d.hardware_telemetry?.accuracy,
        status: d.audit_metadata?.verification_status,
        payout: d.payout_status,
        claimedAt: d.claim_timestamp,
      };
    });

    return NextResponse.json({ submissions: list, source: "firestore" }, { status: 200 });
  } catch (err) {
    console.error("[admin/submissions] GET", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
