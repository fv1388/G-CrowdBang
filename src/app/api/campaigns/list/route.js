// src/app/api/campaigns/list/route.js
// G-CrowdBang / F-CrowdBang · 开放任务动态列表接口（App Router Route Handler）
// 职责：返回未满员的 open 任务（status=="open" 且 slots_used < total_slots），供接单大厅渲染。
// 兼容策略：装有 firebase-admin 读 Firestore；未装时降级本地 mock 数据。

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
  console.warn("[campaigns/list] firebase-admin unavailable, using local mock");
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

// 本地 mock 任务（字段结构与真实 campaigns 一致）
const MOCK_CAMPAIGNS = [
  {
    id: "cmp_demo_001",
    title: "Unbox & Showcase — Home Gadget",
    video_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    caption_text: "Unbox this compact home gadget and show how it fits your daily setup. Keep it honest and natural.",
    city: "Jacksonville",
    state: "FL",
    payout: 3.0,
    slotsRemaining: 12,
    boundary: { enabled: true, center: { latitude: 30.3322, longitude: -81.6557 }, radiusKm: 80, maxAcceptableAccuracyMeters: 200 },
  },
  {
    id: "cmp_demo_002",
    title: "Budget Hack Reel — Kitchen Tool",
    video_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    caption_text: "Share a quick budget hack using this kitchen tool. Show a real result, not a scripted ad.",
    city: "Orlando",
    state: "FL",
    payout: 3.0,
    slotsRemaining: 8,
    boundary: { enabled: true, center: { latitude: 28.5383, longitude: -81.3792 }, radiusKm: 80, maxAcceptableAccuracyMeters: 200 },
  },
  {
    id: "cmp_demo_003",
    title: "ASMR Setup Tour — Desk Light",
    video_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
    caption_text: "Film a calm ASMR-style tour of your desk setup featuring this light. Natural light, no over-editing.",
    city: "Tampa",
    state: "FL",
    payout: 3.0,
    slotsRemaining: 15,
    boundary: { enabled: true, center: { latitude: 27.9506, longitude: -82.4572 }, radiusKm: 80, maxAcceptableAccuracyMeters: 200 },
  },
];

export async function GET() {
  try {
    if (!firebaseAvailable) {
      return NextResponse.json({ campaigns: MOCK_CAMPAIGNS, source: "mock" }, { status: 200 });
    }

    const snap = await db.collection("campaigns")
      .where("status", "==", "open")
      .limit(50)
      .get();

    const campaigns = snap.docs.map((doc) => {
      const d = doc.data();
      const geo = d.geotargeting_config || {};
      const escrow = d.escrow_summary || {};
      const used = escrow.slots_used || 0;
      const total = escrow.total_slots || 0;
      // 未满员才返回
      if (used >= total) return null;
      return {
        id: doc.id,
        title: d.title || "Untitled Campaign",
        video_url: d.video_url || "",
        caption_text: d.caption_text || "",
        city: geo.enabled ? geo.target_city : "Anywhere",
        state: geo.enabled ? geo.target_state : "US",
        payout: escrow.payout_rate ?? 3.0,
        slotsRemaining: Math.max(0, total - used),
        boundary: {
          enabled: !!geo.enabled,
          center: { latitude: geo.target_lat ?? 0, longitude: geo.target_lng ?? 0 },
          radiusKm: geo.radius_km ?? 0,
          maxAcceptableAccuracyMeters: 200,
        },
      };
    }).filter(Boolean);

    return NextResponse.json({ campaigns, source: "firestore" }, { status: 200 });
  } catch (err) {
    console.error("[campaigns/list]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
