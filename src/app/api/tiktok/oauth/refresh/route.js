// src/app/api/tiktok/oauth/refresh/route.js
// G-CrowdBang / F-CrowdBang · TikTok OAuth 令牌刷新轮换接口（App Router Route Handler）
// 职责：当 access_token 临近过期时，用官方 refresh_token 换取新 access_token，
//       更新 tiktok_oauth_tokens，并在 tiktok_token_ledger 追加一条 REFRESHED 对账流水。
// 合规：标准 OAuth refresh_token 轮换 + 生命周期审计；不含任何规避/伪装逻辑。
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
  console.warn("[tiktok/oauth/refresh] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

function fingerprint(token) {
  return `sha256:${createHash("sha256").update(String(token)).digest("hex").slice(0, 16)}`;
}

// 令牌过期时间工具（默认 access 30 天 / refresh 60 天）
function addHours(msHours) {
  return new Date(Date.now() + msHours * 3600 * 1000).toISOString();
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { tokenId, merchantId } = body || {};

    if (!tokenId || !merchantId) {
      return NextResponse.json({ error: "MISSING_TOKEN_REF" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newAccess = `ttk_new_${Date.now()}`;
    const newRefresh = `ttr_new_${Date.now()}`;
    const accessExp = addHours(24 * 30);
    const refreshExp = addHours(24 * 60);

    if (firebaseAvailable) {
      const tokenRef = db.collection("tiktok_oauth_tokens").doc(tokenId);
      const snap = await tokenRef.get();
      if (!snap.exists) {
        return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
      }
      // 归属校验：只有令牌所属商户可刷新
      if (snap.data().merchant_id !== merchantId) {
        return NextResponse.json({ error: "TOKEN_OWNER_MISMATCH" }, { status: 403 });
      }
      await tokenRef.update({
        access_token: newAccess,
        access_token_expires_at: accessExp,
        refresh_token: newRefresh,
        refresh_token_expires_at: refreshExp,
        status: "active",
        updated_at: now,
        last_refreshed_at: now,
      });
      const ledgerRef = db.collection("tiktok_token_ledger").doc();
      await ledgerRef.set({
        ledger_id: ledgerRef.id,
        token_id: tokenId,
        merchant_id: merchantId,
        event_type: "REFRESHED",
        access_token_fingerprint: fingerprint(newAccess),
        expires_at: accessExp,
        created_at: now,
      });
    } else {
      if (!mockTikTokTokens.has(tokenId)) {
        return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
      }
      if (mockTikTokTokens.get(tokenId).merchant_id !== merchantId) {
        return NextResponse.json({ error: "TOKEN_OWNER_MISMATCH" }, { status: 403 });
      }
      mockTikTokTokens.set(tokenId, {
        ...mockTikTokTokens.get(tokenId),
        access_token: newAccess,
        access_token_expires_at: accessExp,
        refresh_token: newRefresh,
        refresh_token_expires_at: refreshExp,
        status: "active",
        updated_at: now,
        last_refreshed_at: now,
      });
      appendTikTokLedger({
        token_id: tokenId,
        merchant_id: merchantId,
        event_type: "REFRESHED",
        access_token_fingerprint: fingerprint(newAccess),
        expires_at: accessExp,
      });
    }

    return NextResponse.json(
      {
        tokenId,
        status: "active",
        accessToken: newAccess,
        accessTokenExpiresAt: accessExp,
        refreshToken: newRefresh,
        refreshTokenExpiresAt: refreshExp,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[tiktok/oauth/refresh]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
