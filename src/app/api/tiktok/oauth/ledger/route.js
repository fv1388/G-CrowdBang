// src/app/api/tiktok/oauth/ledger/route.js
// G-CrowdBang / F-CrowdBang · TikTok OAuth 令牌对账账本查询接口（App Router Route Handler）
// 职责：返回某商户旗下 TikTok OAuth 令牌的元数据列表 + 完整令牌流转对账单（供审计对账）。
//       对账响应只回传令牌指纹与有效期，绝不回传 access_token/refresh_token 明文。
// 合规：标准令牌生命周期审计；不含任何规避/伪装逻辑。
import { NextResponse } from "next/server";
import { mockTikTokTokens, mockTikTokLedger } from "../../../tasks/_mock-store.js";

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
  console.warn("[tiktok/oauth/ledger] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// 去除令牌明文，仅暴露可审计元数据
function publicToken(t) {
  return {
    token_id: t.token_id,
    merchant_id: t.merchant_id,
    tiktok_open_id: t.tiktok_open_id,
    display_name: t.display_name,
    status: t.status,
    access_token_expires_at: t.access_token_expires_at,
    refresh_token_expires_at: t.refresh_token_expires_at,
    scopes: t.scopes,
    last_refreshed_at: t.last_refreshed_at,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get("merchantId") || (process.env.MERCHANT_ID ?? "mch_placeholder");
    const includeTokens = searchParams.get("includeTokens") !== "false";

    if (firebaseAvailable) {
      const tokenSnap = await db
        .collection("tiktok_oauth_tokens")
        .where("merchant_id", "==", merchantId)
        .get();
      const tokens = tokenSnap.docs.map((d) => publicToken(d.data()));

      const ledgerSnap = await db
        .collection("tiktok_token_ledger")
        .where("merchant_id", "==", merchantId)
        .orderBy("created_at", "desc")
        .get();
      const ledger = ledgerSnap.docs.map((d) => d.data());

      return NextResponse.json({ merchantId, tokens: includeTokens ? tokens : [], ledger, source: "firestore" });
    }

    // mock：遍历共享账本，按 merchant 归属过滤
    const tokens = [];
    for (const t of mockTikTokTokens.values()) {
      if (t.merchant_id === merchantId) tokens.push(publicToken(t));
    }
    const ledger = [];
    for (const l of mockTikTokLedger.values()) {
      if (l.merchant_id === merchantId) ledger.push(l);
    }
    ledger.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    return NextResponse.json({ merchantId, tokens: includeTokens ? tokens : [], ledger, source: "mock" });
  } catch (err) {
    console.error("[tiktok/oauth/ledger]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
