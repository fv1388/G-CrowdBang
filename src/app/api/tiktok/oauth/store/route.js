// src/app/api/tiktok/oauth/store/route.js
// G-CrowdBang / F-CrowdBang · TikTok OAuth 令牌签发存储接口（App Router Route Handler）
// 职责：在标准 OAuth 授权回调完成后，将官方签发的临时 access_token 与其 refresh_token
//       规范写入 tiktok_oauth_tokens，并在 tiktok_token_ledger 追加一条 ISSUED 对账流水。
// 合规：标准 OAuth 授权流程 + 令牌生命周期审计；不含任何规避/伪装逻辑。
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { mockTikTokTokens, appendTikTokLedger } from "../../../tasks/_mock-store.js";

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
  console.warn("[tiktok/oauth/store] firebase-admin unavailable, using local mock");
}

// 凭证守卫：FIREBASE_* 为占位/缺失时降级 mock
if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

// 令牌明文非可逆指纹（仅用于对账，不落明文到账本）
function fingerprint(token) {
  return `sha256:${createHash("sha256").update(String(token)).digest("hex").slice(0, 16)}`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      merchantId,
      tiktokOpenId,
      displayName = "",
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
      scopes = [],
    } = body || {};

    // 判空校验：商户 + 官方临时 access_token + 过期时间必须齐全
    if (!merchantId || !accessToken || !accessTokenExpiresAt || !refreshToken) {
      return NextResponse.json({ error: "MISSING_OAUTH_FIELDS" }, { status: 400 });
    }

    const now = new Date().toISOString();
    let tokenId;

    if (firebaseAvailable) {
      const ref = db.collection("tiktok_oauth_tokens").doc();
      tokenId = ref.id;
      await ref.set({
        token_id: ref.id,
        merchant_id: merchantId,
        tiktok_open_id: tiktokOpenId ?? "",
        display_name: displayName,
        access_token: accessToken,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshTokenExpiresAt,
        scopes: Array.isArray(scopes) ? scopes : [],
        status: "active",
        created_at: now,
        updated_at: now,
        last_refreshed_at: now,
      });
      // 对账账本：ISSUED（仅存指纹，不落明文）
      const ledgerRef = db.collection("tiktok_token_ledger").doc();
      await ledgerRef.set({
        ledger_id: ledgerRef.id,
        token_id: tokenId,
        merchant_id: merchantId,
        event_type: "ISSUED",
        access_token_fingerprint: fingerprint(accessToken),
        expires_at: accessTokenExpiresAt,
        created_at: now,
      });
    } else {
      tokenId = `tt_local_${Date.now()}`;
      mockTikTokTokens.set(tokenId, {
        token_id: tokenId,
        merchant_id: merchantId,
        tiktok_open_id: tiktokOpenId ?? "",
        display_name: displayName,
        access_token: accessToken,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshTokenExpiresAt,
        scopes: Array.isArray(scopes) ? scopes : [],
        status: "active",
        created_at: now,
        updated_at: now,
        last_refreshed_at: now,
      });
      appendTikTokLedger({
        token_id: tokenId,
        merchant_id: merchantId,
        event_type: "ISSUED",
        access_token_fingerprint: fingerprint(accessToken),
        expires_at: accessTokenExpiresAt,
      });
    }

    return NextResponse.json(
      { tokenId, status: "active", source: firebaseAvailable ? "firestore" : "mock" },
      { status: 201 }
    );
  } catch (err) {
    console.error("[tiktok/oauth/store]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
