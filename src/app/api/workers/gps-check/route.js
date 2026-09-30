// src/app/api/workers/gps-check/route.js
// G-CrowdBang · P0 修复：Worker GPS 现场核验接口
// 职责：Worker 在认领任务前/提交视频前，上报手机硬件 GPS 坐标 + 设备指纹 + 时间戳。
// 安全：
//   1. 必须登录（Worker 角色）；
//   2. 时间戳与服务器时间差 > 60 秒拒绝（防重放旧定位包）；
//   3. 粗判坐标是否在美国本土矩形范围内（精确边界可后续接 GeoHash/第三方）；
//   4. 设备指纹 + workerId 落库，便于风控比对同一账号多设备/异地跳变。
import { NextResponse } from "next/server";
import { requireAuthWithRole } from "../../../../database/auth-server";

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
  console.warn("[workers/gps-check] firebase-admin unavailable, using mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// 美国本土粗判矩形（不含阿拉斯加/夏威夷，够用）
function isWithinUSMainland(lat, lng) {
  return lat >= 24.0 && lat <= 49.5 && lng >= -125.5 && lng <= -66.5;
}

export async function POST(request) {
  try {
    const auth = await requireAuthWithRole(request, "WORKER");
    if (auth.error) return auth.error;

    const body = await request.json();
    const { latitude, longitude, accuracy, timestamp, deviceFingerprint } = body || {};

    const lat = Number(latitude);
    const lng = Number(longitude);
    const ts = Number(timestamp);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "INVALID_COORDINATES" }, { status: 400 });
    }
    if (!deviceFingerprint || typeof deviceFingerprint !== "string") {
      return NextResponse.json({ error: "DEVICE_FINGERPRINT_REQUIRED" }, { status: 400 });
    }

    // 时间戳防重放：60 秒窗口
    const now = Date.now();
    if (!ts || Math.abs(now - ts) > 60 * 1000) {
      return NextResponse.json({ error: "STALE_TIMESTAMP", hint: "re-request GPS within 60s" }, { status: 400 });
    }

    const inUS = isWithinUSMainland(lat, lng);
    const accuracyMeters = Number(accuracy) || 9999;

    const record = {
      worker_id: auth.uid,
      lat,
      lng,
      accuracy_meters: accuracyMeters,
      device_fingerprint: deviceFingerprint,
      timestamp_received: now,
      client_timestamp: ts,
      verified: inUS,
    };

    if (firebaseAvailable) {
      await db.collection("worker_gps_checks").doc(`${auth.uid}_${now}`).set(record);
    }

    return NextResponse.json({
      verified: inUS,
      inUS: true,
      accuracy_meters: accuracyMeters,
      server_time: now,
    }, { status: inUS ? 200 : 403 });
  } catch (err) {
    console.error("[workers/gps-check]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
