// src/app/api/tasks/verify-and-publish/route.js
// G-CrowdBang / F-CrowdBang · 任务接单上报接口（App Router Route Handler）
// 职责：接收 TaskButton 上报的遥测 → 边界校验 → 创建 pending submission（资金进托管）。
// 说明：仅做合规的采集入库与前端边界复核；真伪最终判定在服务端核验/结算链路。

import { NextResponse } from "next/server";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ---- Firebase Admin 单例（F-CrowdBang）----
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { campaignId, workerId, telemetry } = body || {};

    if (!campaignId || !workerId || !telemetry) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    const { latitude, longitude, accuracy } = telemetry;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      typeof accuracy !== "number"
    ) {
      return NextResponse.json({ error: "INVALID_TELEMETRY" }, { status: 400 });
    }

    // 读任务，取其区域约束
    const campaignSnap = await db.collection("campaigns").doc(campaignId).get();
    if (!campaignSnap.exists) {
      return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    }
    const campaign = campaignSnap.data();
    const geo = campaign.geotargeting_config || {};
    const escrow = campaign.escrow_summary || {};

    // 名额封顶预检
    const slotsUsed = escrow.slots_used || 0;
    const totalSlots = escrow.total_slots || 0;
    if (slotsUsed >= totalSlots) {
      return NextResponse.json({ error: "TASK_FULL" }, { status: 409 });
    }

    // 边界复核（服务端二次校验，不信任前端）
    if (geo.enabled) {
      const dist = haversineKm(
        latitude,
        longitude,
        geo.target_lat ?? 0,
        geo.target_lng ?? 0
      );
      const within = dist <= (geo.radius_km ?? 0);
      if (!within) {
        return NextResponse.json({ error: "OUT_OF_BOUNDARY" }, { status: 400 });
      }
    }

    // 创建 pending 接单记录（资金进托管）
    const submission = {
      campaign_id: campaignId,
      worker_id: workerId,
      hardware_telemetry: { latitude, longitude, accuracy },
      audit_metadata: {
        published_video_id: null, // 由用户后续发布后回填
        verification_status: "pending",
      },
      claim_timestamp: new Date().toISOString(),
      submitted_at: null,
      payout_status: "held",
    };
    const ref = db.collection("submissions").doc();
    await ref.set(submission);

    return NextResponse.json(
      { submissionId: ref.id, status: "pending" },
      { status: 201 }
    );
  } catch (err) {
    console.error("[verify-and-publish]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
