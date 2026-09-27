// src/app/api/tasks/verify-and-publish/route.js
// G-CrowdBang / F-CrowdBang · 设备位置校验与对账单暂存接口（App Router Route Handler）
// 职责：接收前端上报的硬件经纬度 → 判空/类型校验 → 地理围栏(Geofencing)区间校验
//       → 【原子名额锁】反超卖扣减剩余名额 → 写入 submissions 对账总表 PENDING_AUDIT。
// 并发防超卖：高价值任务仅剩 1 个名额时，10 个并发接单请求必须串行化扣减，杜绝资金穿仓。
//  - Firestore：db.runTransaction 原子事务锁，读取→校验→-1 一并提交，减后 <0 熔断 "TASK_FULL"。
//  - 本地 mock：Node 单进程内 读→校验→扣减 在同一同步块完成（无 await 夹缝），天然串行。
// 合规：仅做标准参数校验、数学范围判定与名额扣减，不涉及任何伪装/规避逻辑。

import { NextResponse } from "next/server";
import { putSubmission, mockSubmissions, mockCampaigns } from "../_mock-store";

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

// mock 模式下获取/播种任务的地理围栏配置
function mockGeoFor(campaignId) {
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
  return MOCK_GEO[campaignId] || { enabled: false, target_city: "Anywhere", target_state: "US" };
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

    // 1) 载入任务配置（campaign），确定地理围栏与总名额
    let geo = { enabled: false };
    let totalSlots = 0;

    if (firebaseAvailable) {
      const snap = await db.collection("campaigns").doc(campaignId).get();
      if (!snap.exists) {
        return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
      }
      const c = snap.data();
      geo = c.geotargeting_config || {};
      totalSlots = c.escrow_summary?.total_slots || 0;
    } else {
      const campaign = mockCampaigns.get(campaignId);
      if (!campaign) {
        return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
      }
      geo = mockGeoFor(campaignId);
      // 名额取自实际任务对象（列表形 slotsRemaining，或 escrow_summary.total_slots）
      totalSlots = typeof campaign.slotsRemaining === "number"
        ? campaign.slotsRemaining
        : (campaign.escrow_summary?.total_slots || 0);
    }

    // 2) 地理围栏区间校验（服务端二次校验，不信任前端）——先验围栏再扣名额，避免越界单白占名额
    const isAuthenticMatch = withinGeofence(latitude, longitude, geo);
    if (!isAuthenticMatch) {
      return NextResponse.json(
        { error: "OUT_OF_GEOFENCE", is_authentic_match: false },
        { status: 400 }
      );
    }

    // 3) 原子名额锁（反超卖）：读取剩余名额 → 校验 → 扣减 -1，减后 < 0 则熔断 "TASK_FULL"
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
      // Firestore 原子事务：读任务 → 校验剩余名额 → 扣减 slots_used + 写 submission 一并提交
      const campaignRef = db.collection("campaigns").doc(campaignId);
      const subRef = db.collection("submissions").doc();
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(campaignRef);
        if (!snap.exists) throw new Error("CAMPAIGN_NOT_FOUND");
        const used = snap.data()?.escrow_summary?.slots_used || 0;
        const total = snap.data()?.escrow_summary?.total_slots || 0;
        if (used >= total) throw new Error("TASK_FULL");
        tx.update(campaignRef, { "escrow_summary.slots_used": FieldValue.increment(1) });
        tx.set(subRef, { ...submission, submission_id: subRef.id });
      });
      submissionId = subRef.id;
    } else {
      // 本地 mock：同步读→校验→扣减（无 await 夹缝，单进程内串行，等同原子）
      const campaign = mockCampaigns.get(campaignId);
      if (typeof campaign.slotsRemaining === "number") {
        if (campaign.slotsRemaining <= 0) {
          return NextResponse.json({ error: "TASK_FULL", slots_remaining: 0 }, { status: 409 });
        }
        campaign.slotsRemaining = campaign.slotsRemaining - 1;
      } else {
        const esc = campaign.escrow_summary || {};
        const used = esc.slots_used || 0;
        const total = esc.total_slots || 0;
        if (used >= total) {
          return NextResponse.json({ error: "TASK_FULL", slots_remaining: 0 }, { status: 409 });
        }
        campaign.escrow_summary = { ...esc, slots_used: used + 1 };
      }

      submissionId = `sub_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      putSubmission(submissionId, submission);
    }

    const remaining = firebaseAvailable
      ? undefined
      : (mockCampaigns.get(campaignId)?.slotsRemaining ?? mockCampaigns.get(campaignId)?.escrow_summary?.slots_used);

    return NextResponse.json(
      {
        submissionId,
        status: "PENDING_AUDIT",
        is_authentic_match: true,
        slots_remaining: firebaseAvailable ? undefined : remaining,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 201 }
    );
  } catch (err) {
    // 事务/熔断错误分流
    if (err?.message === "TASK_FULL") {
      return NextResponse.json({ error: "TASK_FULL", slots_remaining: 0 }, { status: 409 });
    }
    if (err?.message === "CAMPAIGN_NOT_FOUND") {
      return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    }
    console.error("[verify-and-publish]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
