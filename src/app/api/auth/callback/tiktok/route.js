// src/app/api/auth/callback/tiktok/route.js
// G-CrowdBang / F-CrowdBang · TikTok OAuth 服务端换码回调（Server-side Code Exchange）
// 职责：商家在 TikTok 官方授信大厅"同意授权"后，官方携带 ?code=..&state=.. 回跳到本路由。
//       本路由用 Client Key + Client Secret（仅服务端持有）向 TikTok 官方换取
//       access_token / refresh_token，并将令牌规范写入 tiktok_oauth_tokens + 对账账本，
//       然后 302 跳回商户控制台的 Connect TikTok 页。
// 合规：标准 OAuth2 authorization_code 换码 + 令牌生命周期审计；明文 secret 不出服务端。
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { mockTikTokTokens, appendTikTokLedger } from "../../../tasks/_mock-store.js";

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
  console.warn("[auth/callback/tiktok] firebase-admin unavailable, using local mock");
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

// 是否已配置真实 TikTok 应用凭证（非占位）
function tiktokConfigured() {
  const k = process.env.TIKTOK_CLIENT_KEY;
  const s = process.env.TIKTOK_CLIENT_SECRET;
  return Boolean(
    k && !k.includes("your_") &&
    s && !s.includes("your_")
  );
}

// 令牌明文非可逆指纹（仅对账，不落明文）
function fingerprint(token) {
  return `sha256:${createHash("sha256").update(String(token)).digest("hex").slice(0, 16)}`;
}

// 登录授权 scope：仅需 user.info.basic（与 connect-tiktok 页一致，不请求 video.publish）
const SCOPES = ["user.info.basic"];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") || "";
  const merchantId = state.split("_")[1] || null;
  // 动态取当前请求域名（线上回调→线上控制台，本地回调→本地控制台），不再写死 localhost
  const base = new URL(request.url).origin;

  // 跳回商户控制台 Connect 页
  const backOk = `${base}/admin/connect-tiktok?connected=1`;
  const backErr = `${base}/admin/connect-tiktok?error=1`;

  if (!code || !merchantId) {
    return NextResponse.redirect(backErr, 302);
  }

  // 若未配置真实凭证，跳回并提示未配置（不应发生：前端仅在配置后走官方授权）
  if (!tiktokConfigured()) {
    return NextResponse.redirect(backErr, 302);
  }

  try {
    // ---- 服务端换码：标准 OAuth2 authorization_code → token ----
    const redirectUri =
      process.env.TIKTOK_OAUTH_REDIRECT_URI ||
      `${base}/api/auth/callback/tiktok`;

    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      console.error("[auth/callback/tiktok] token exchange failed", tokenRes.status, await tokenRes.text());
      return NextResponse.redirect(backErr, 302);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 86400;
    const refreshExpiresIn = tokenData.refresh_expires_in || 15552000;
    const openId = tokenData.open_id || "";

    if (!accessToken || !refreshToken) {
      console.error("[auth/callback/tiktok] token exchange missing fields", tokenData);
      return NextResponse.redirect(backErr, 302);
    }

    const now = new Date().toISOString();
    const accessExpires = new Date(Date.now() + expiresIn * 1000).toISOString();
    const refreshExpires = new Date(Date.now() + refreshExpiresIn * 1000).toISOString();
    let tokenId;

    // ---- 写库：真库 → tiktok_oauth_tokens + 账本；mock → 内存 Map + 账本 ----
    if (firebaseAvailable) {
      const ref = db.collection("tiktok_oauth_tokens").doc();
      tokenId = ref.id;
      await ref.set({
        token_id: ref.id,
        merchant_id: merchantId,
        tiktok_open_id: openId,
        display_name: "",
        access_token: accessToken,
        access_token_expires_at: accessExpires,
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshExpires,
        scopes: SCOPES,
        status: "active",
        created_at: now,
        updated_at: now,
        last_refreshed_at: now,
      });
      const ledgerRef = db.collection("tiktok_token_ledger").doc();
      await ledgerRef.set({
        ledger_id: ledgerRef.id,
        token_id: tokenId,
        merchant_id: merchantId,
        event_type: "ISSUED",
        access_token_fingerprint: fingerprint(accessToken),
        expires_at: accessExpires,
        created_at: now,
      });
    } else {
      tokenId = `tt_local_${Date.now()}`;
      mockTikTokTokens.set(tokenId, {
        token_id: tokenId,
        merchant_id: merchantId,
        tiktok_open_id: openId,
        display_name: "",
        access_token: accessToken,
        access_token_expires_at: accessExpires,
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshExpires,
        scopes: SCOPES,
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
        expires_at: accessExpires,
      });
    }

    return NextResponse.redirect(backOk, 302);
  } catch (err) {
    console.error("[auth/callback/tiktok]", err);
    return NextResponse.redirect(backErr, 302);
  }
}
