// src/app/api/tasks/verify-and-publish/route.js
// G-CrowdBang / F-CrowdBang · 设备位置校验与对账单暂存接口（App Router Route Handler）
// 职责：接收前端上报的硬件经纬度 → 判空/类型校验 → 地理围栏(Geofencing)区间校验
//       → 写入 submissions 对账总表，初始状态 audit_metadata.verification_status="PENDING_AUDIT"。
// 兼容策略：装有 firebase-admin 且凭证真实时写 Firestore；否则写共享本地 mock 账本，便于本地联调。
// 合规：仅做标准参数校验与数学范围判定，不涉及任何伪装/规避逻辑。

import { NextResponse } from "next/server";
import { putSubmission, mockSubmissions, mockCampaigns } from "../_mock-store";

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

// 凭证守卫：依赖已装但 FIREBASE_* 为占位/缺失时，仍降级 mock（避免用假凭证连真库）
if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// ---- 基础判空与类型校验：经纬度必须为合法的双精度数值 ----
function validateCoords(latitude, longitude) {
  const ok =
    typeof latitude === "number" && Number.isFinite(latitude) &&
    typeof longitude === "number" && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180;
  return ok;
}

// ---- 球面距离（Haversine）----
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

// ---- 地理围栏区间校验 ----
// 1) 基础数学范围框检：上报经纬度必须落在任务配置的粗略地理边界方框内
//    （如美国本土 bounding box），先做粗筛；
// 2) 再校验与任务区域中心的球面距离 ≤ 半径。
function withinBoundingBox(latitude, longitude, box) {
  if (!box) return true;
  const inLat = latitude >= box.minLat && latitude <= box.maxLat;
  const inLng = longitude >= box.minLng && longitude <= box.maxLng;
  return inLat && inLng;
}

function withinGeofence(latitude, longitude, geo) {
  if (!geo.enabled) return true;
  const boxOk = withinBoundingBox(latitude, longitude, geo.bounding_box);
  const dist = haversineKm(latitude, longitude, geo.target_lat ?? 0, geo.target_lng ?? 0);
  const radiusOk = dist <= (geo.radius_km ?? 0);
  return boxOk && radiusOk;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { campaignId, workerId } = body || {};

    // 兼容两种载荷：直传 latitude/longitude，或 TaskButton 的 telemetry 包裹 { latitude, longitude, accuracy }
    const latitude = body?.latitude ?? body?.telemetry?.latitude;
    const longitude = body?.longitude ?? body?.telemetry?.longitude;
    const accuracy = body?.accuracy ?? body?.telemetry?.accuracy ?? 0;

    if (!campaignId || !workerId || latitude === undefined || longitude === undefined) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    // 硬件经纬度合法性校验：非合法双精度浮点 → 400
    if (!validateCoords(latitude, longitude)) {
      return NextResponse.json({ error: "INVALID_COORDINATES" }, { status: 400 });
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
        cmp_demo_001: {
          enabled: true, target_city: "Jacksonville", target_state: "FL",
          target_lat: 30.3322, target_lng: -81.6557, radius_km: 80,
          bounding_box: { minLat: 24.5, maxLat: 49.5, minLng: -125, maxLng: -67 }, // 美国本土粗略框
        },
        cmp_demo_002: {
          enabled: true, target_city: "Orlando", target_state: "FL",
          target_lat: 28.5383, target_lng: -81.3792, radius_km: 80,
          bounding_box: { minLat: 24.5, maxLat: 49.5, minLng: -125, maxLng: -67 },
        },
        cmp_demo_003: {
          enabled: true, target_city: "Tampa", target_state: "FL",
          target_lat: 27.9506, target_lng: -82.4572, radius_km: 80,
          bounding_box: { minLat: 24.5, maxLat: 49.5, minLng: -125, maxLng: -67 },
        },
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
    const isAuthenticMatch = withinGeofence(latitude, longitude, geo);
    if (!isAuthenticMatch) {
      return NextResponse.json(
        { error: "OUT_OF_GEOFENCE", is_authentic_match: false },
        { status: 400 }
      );
    }

    // 写入对账总表：硬件位置集合 hardware_geoloc + 初始审核状态 PENDING_AUDIT
    const submission = {
      campaign_id: campaignId,
      worker_id: workerId,
      hardware_geoloc: { latitude, longitude, accuracy },
      is_authentic_match: isAuthenticMatch,
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
      putSubmission(submissionId, submission);
      if (campaignId && !mockCampaigns.has(campaignId)) {
        mockCampaigns.set(campaignId, { geo, escrow });
      }
    }

    return NextResponse.json(
      {
        submissionId,
        status: "PENDING_AUDIT",
        is_authentic_match: true,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[verify-and-publish]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
