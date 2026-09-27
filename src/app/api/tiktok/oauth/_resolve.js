// src/app/api/tiktok/oauth/_resolve.js
// G-CrowdBang / F-CrowdBang · TikTok OAuth 令牌解析助手（服务端，仅供路由内部使用）
// 职责：按 merchant_id 解析当前"有效(active)"的 TikTok access_token，供发布视频/状态反查
//       以标准 Bearer 方式合规调用官方公开 API。
// 合规：仅返回有效令牌；不含任何规避/伪装逻辑。绝不把令牌明文写入对账账本。
import { mockTikTokTokens } from "../../tasks/_mock-store.js";

let db = null;
let firebaseAvailable = false;

try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const fstore = await import("firebase-admin/firestore");
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
  /* 本地无依赖时降级 mock */
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

/**
 * resolveTikTokBearer(merchantId)
 * 返回 { ok:true, accessToken, tokenId } 或 { ok:false, reason }。
 * reason: 'TOKEN_NOT_FOUND'（未连接）| 'NO_ACTIVE_TOKEN'（无有效令牌）
 */
export async function resolveTikTokBearer(merchantId) {
  if (!merchantId) return { ok: false, reason: "TOKEN_NOT_FOUND" };

  if (firebaseAvailable) {
    const snap = await db
      .collection("tiktok_oauth_tokens")
      .where("merchant_id", "==", merchantId)
      .where("status", "==", "active")
      .orderBy("last_refreshed_at", "desc")
      .limit(1)
      .get();
    if (snap.empty) return { ok: false, reason: "NO_ACTIVE_TOKEN" };
    const doc = snap.docs[0].data();
    return { ok: true, accessToken: doc.access_token, tokenId: doc.token_id };
  }

  // mock：扫描共享账本，找该商户最新的 active 令牌
  let best = null;
  for (const t of mockTikTokTokens.values()) {
    if (t.merchant_id === merchantId && t.status === "active") {
      if (!best || (t.last_refreshed_at || "") > (best.last_refreshed_at || "")) best = t;
    }
  }
  if (!best) return { ok: false, reason: "NO_ACTIVE_TOKEN" };
  return { ok: true, accessToken: best.access_token, tokenId: best.token_id };
}
