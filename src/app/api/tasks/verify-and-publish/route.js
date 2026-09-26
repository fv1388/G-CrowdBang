// src/app/api/tasks/verify-and-publish/route.js
// G-CrowdBang / F-CrowdBang · 设备位置校验后暂存对账单接口（App Router Route Handler）
// 职责：接收前端上报 latitude/longitude/campaignId → 地理围栏(Geofencing)区间校验 → 写 submissions 为 PENDING_AUDIT。
// 兼容策略：装有 firebase-admin 时写真实 Firestore；未装时降级本地 mock，便于本地联调。

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
  console.warn("[verify-and-publish] firebase-admin unavailable, using local mock");
}

// ---- 球面距离（Haversine） ----
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

// ---- 地理围栏校验：与任务区域中心的距离 ≤ 半径 ----
function withinGeofence(latitude, longitude, geo) {
  if (!geo.enabled) return true;
  const dist = haversineKm(latitude, longitude, geo.target_lat ?? 0, geo.target_lng ?? 0);
  return dist <= (geo.radius_km ?? 0);
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

    let geo = { enabled: false };
    let escrow = { slots_used: 0, total_slots: 0 };
    let campaignFound = false;

    if (firebaseAvailable) {
      const snap = await db.collection("campaigns").doc(campaignId).get();
      if (snap.exists) {
        campaignFound = true;
        const c = snap.data();
        geo = c.geotargeting_config || {};
        escrow = c.escrow_summary || {};
      }
    } else {
      // 本地 mock：演示任务映射到与列表一致的区域围栏，便于本地联调验证 Geofencing
      const MOCK_GEO = {
        cmp_demo_001: { enabled: true, target_city: "Jacksonville", target_state: "FL", target_lat: 30.3322, target_lng: -81.6557, radius_km: 80 },
        cmp_demo_002: { enabled: true, target_city: "Orlando", target_state: "FL", target_lat: 28.5383, target_lng: -81.3792, radius_km: 80 },
        cmp_demo_003: { enabled: true, target_city: "Tampa", target_state: "FL", target_lat: 27.9506, target_lng: -82.4572, radius_km: 80 },
      };
      if (MOCK_GEO[campaignId]) {
        campaignFound = true;
        geo = MOCK_GEO[campaignId];
        escrow = { slots_used: 0, total_slots: 1000 };
      } else {
        campaignFound = true;
        geo = { enabled: false };
        escrow = { slots_used: 0, total_slots: 1000 };
      }
    }

    if (!campaignFound) {
      return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    }

    // 名额封顶预检
    if ((escrow.slots_used || 0) >= (escrow.total_slots || 0)) {
      return NextResponse.json({ error: "TASK_FULL" }, { status: 409 });
    }

    // 地理围栏区间校验（服务端二次校验，不信任前端）
    if (!withinGeofence(latitude, longitude, geo)) {
      return NextResponse.json({ error: "OUT_OF_GEOFENCE" }, { status: 400 });
    }

    // 写入对账总表，初始状态 PENDING_AUDIT（等待核验）
    const submission = {
      campaign_id: campaignId,
      worker_id: workerId,
      hardware_telemetry: { latitude, longitude, accuracy },
      audit_metadata: {
        published_video_id: null,
        verification_status: "PENDING_AUDIT",
      },
      claim_timestamp: new Date().toISOString(),
      submitted_at: null,
      payout_status: "held",
    };

    let submissionId;
    if (firebaseAvailable) {
      const ref = db.collection("submissions").doc();
      await ref.set(submission);
      submissionId = ref.id;
    } else {
      submissionId = `sub_local_${Date.now()}`;
    }

    return NextResponse.json(
      { submissionId, status: "PENDING_AUDIT", source: firebaseAvailable ? "firestore" : "mock" },
      { status: 201 }
    );
  } catch (err) {
    console.error("[verify-and-publish]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
