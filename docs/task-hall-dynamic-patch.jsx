// ============================================================================
// 任务大厅动态数据源补丁（可选，未提交）
// 依赖 firebase-admin —— 在可正常 npm install 的环境执行下面命令后应用：
//   npm install firebase-admin
//   cp .env.local.example .env.local  # 填 FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY
// 应用方式：用本文件替换 src/app/shop/tasks/page.jsx 的"示例任务卡"部分，
//          并把页面改为服务端组件（去掉顶部 "use client"）。
// ============================================================================

// ---- 在文件顶部加入 ----
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

// ---- 用 async 服务端组件 + 动态读取取代静态 sampleTasks ----
export default async function TaskHallPage() {
  let campaigns = [];
  let loadError = null;
  try {
    const snap = await db
      .collection("campaigns")
      .where("status", "==", "open")
      .limit(50)
      .get();
    campaigns = snap.docs.map((doc) => {
      const d = doc.data();
      const geo = d.geotargeting_config || {};
      const escrow = d.escrow_summary || {};
      const used = escrow.slots_used || 0;
      const total = escrow.total_slots || 0;
      return {
        id: doc.id,
        title: d.title || "Untitled Campaign",
        city: geo.enabled ? geo.target_city : "Anywhere",
        state: geo.enabled ? geo.target_state : "US",
        payout: escrow.payout_rate ?? 3.0,
        slots: Math.max(0, total - used),
        boundary: {
          enabled: !!geo.enabled,
          center: { latitude: geo.target_lat ?? 0, longitude: geo.target_lng ?? 0 },
          radiusKm: geo.radius_km ?? 0,
          maxAcceptableAccuracyMeters: 200,
        },
      };
    });
  } catch (err) {
    console.error("[task-hall] load campaigns failed", err);
    loadError = "Campaigns are temporarily unavailable. Please try again shortly.";
  }

  // 渲染区把 sampleTasks 替换为 campaigns；任务卡字段用 t.city + t.state；
  // 无数据/加载失败时给出友好降级提示。boundary 已从真实 campaign 带出，
  // TaskButton 传入 t.boundary 即按该任务区域校验。
}
