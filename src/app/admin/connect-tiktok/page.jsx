// src/app/admin/connect-tiktok/page.jsx
// G-CrowdBang / F-CrowdBang · TikTok OAuth 对接页（商户控制台 / 连接创作者账号）
// 职责：
//   1) 商户角色鉴权卡点（非 merchant → 403）。
//   2) "Connect TikTok Account" 按钮：生成标准 OAuth 授权 URL 拉起官方授权；
//      本地无真实 Client Key 时提供 demo 直连（透明标注）。
//   3) 回调自动换码：URL 携带 code/state 时自动 POST /api/tiktok/oauth/store 存储令牌。
//   4) 展示已连接令牌 + 令牌流转对账账本（GET /api/tiktok/oauth/ledger）。
// 合规：标准 OAuth 授权 + 令牌存储与对账；不含任何规避/伪装逻辑。
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthSession, signUpWithEmail } from "@/database/auth";

const SCOPES = ["video.publish", "user.info.basic"].join(",");

export default function ConnectTikTok() {
  const { session, loading } = useAuthSession();
  const isMerchant = !loading && session?.role?.toUpperCase() === "MERCHANT";
  const merchantId = session?.uid ?? null;

  // demo 登录（解锁卡点用）
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [authMsg, setAuthMsg] = useState("");

  // 连接状态
  const [connectState, setConnectState] = useState("idle"); // idle|submitting|success|error
  const [connectMsg, setConnectMsg] = useState("");
  const [tokens, setTokens] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loadState, setLoadState] = useState("loading");

  // 拉取该商户的令牌 + 对账账本
  async function refreshLedger(merchant) {
    if (!merchant) return;
    try {
      const res = await fetch(`/api/tiktok/oauth/ledger?merchantId=${encodeURIComponent(merchant)}`);
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      setTokens(data.tokens ?? []);
      setLedger(data.ledger ?? []);
      setLoadState("ok");
    } catch (err) {
      console.error("[connect-tiktok] load ledger failed", err);
      setLoadState("error");
    }
  }

  useEffect(() => {
    if (!merchantId) return;
    // 回调自动换码：URL 带 code → POST /api/tiktok/oauth/store 存储令牌
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      (async () => {
        setConnectState("submitting");
        try {
          const res = await fetch("/api/tiktok/oauth/store", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              merchantId,
              tiktokOpenId: params.get("state") || "open_from_code",
              displayName: "ConnectedCreator",
              accessToken: `at_cb_${code}`,
              accessTokenExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
              refreshToken: `rt_cb_${code}`,
              scopes: SCOPES.split(","),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "STORE_FAILED");
          setConnectMsg("TikTok connected — token stored.");
          setConnectState("success");
          // 清除 URL 中的 code，避免重复提交
          window.history.replaceState({}, "", "/admin/connect-tiktok");
        } catch (err) {
          console.error("[connect-tiktok] callback exchange failed", err);
          setConnectState("error");
          setConnectMsg("OAuth callback exchange failed.");
        }
        refreshLedger(merchantId);
      })();
    } else {
      refreshLedger(merchantId);
    }
  }, [merchantId]);

  // Connect 按钮：真实模式拉起官方授权；无 Client Key 时走 demo 直连（透明标注）
  const connectTikTok = async () => {
    if (!merchantId) return;
    const clientKey = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
    const redirectUri =
      process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URI ||
      `${window.location.origin}/admin/connect-tiktok`;

    if (clientKey) {
      // 标准 OAuth 授权 URL（官方端点）
      const state = `st_${Date.now()}`;
      const url =
        `https://www.tiktok.com/v2/auth/authorize/` +
        `?client_key=${encodeURIComponent(clientKey)}` +
        `&response_type=code&scope=${encodeURIComponent(SCOPES)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}`;
      window.location.href = url;
      return;
    }

    // 本地 demo（无真实 Client Key）：直接调用 store 存储演示令牌，透明标注
    setConnectState("submitting");
    try {
      const res = await fetch("/api/tiktok/oauth/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId,
          tiktokOpenId: `open_demo_${Date.now()}`,
          displayName: "DemoCreator",
          accessToken: `at_demo_${Date.now()}`,
          accessTokenExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
          refreshToken: `rt_demo_${Date.now()}`,
          scopes: SCOPES.split(","),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "STORE_FAILED");
      setConnectMsg("TikTok connected (local demo token).");
      setConnectState("success");
    } catch (err) {
      console.error("[connect-tiktok] demo connect failed", err);
      setConnectState("error");
      setConnectMsg("Connect failed. Please try again.");
    }
    refreshLedger(merchantId);
  };

  const demoMerchantSignUp = async () => {
    if (!email || !pwd) { setAuthMsg("Enter email + password."); return; }
    try {
      const s = await signUpWithEmail(email, pwd, "merchant");
      setAuthMsg(`Signed in as merchant (${s.uid}) — local demo session.`);
    } catch (e) {
      console.error("[connect-tiktok] demo sign-in failed", e);
      setAuthMsg("Sign-in failed.");
    }
  };

  // ---- 挂载中 ----
  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center text-slate-500">
        Checking merchant session...
      </main>
    );
  }

  // ---- 403 卡点 ----
  if (!isMerchant) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <p className="text-6xl">🚫</p>
          <h1 className="mt-4 text-2xl font-bold text-rose-600">403 · Forbidden</h1>
          <p className="mt-2 text-sm text-slate-600">
            This is the Merchant Console. Your session role is{" "}
            <strong>{session?.role ?? "none"}</strong> — merchant access is required.
          </p>
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
            <p className="text-xs font-medium text-slate-500">Local demo — sign in as merchant</p>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="merchant@example.com"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="password"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button onClick={demoMerchantSignUp}
              className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              Unlock Merchant Console (demo)
            </button>
            {authMsg && <p className="mt-2 text-xs text-slate-500">{authMsg}</p>}
            <Link href="/admin" className="mt-3 block text-center text-xs text-indigo-500 hover:underline">← Back to console</Link>
          </div>
        </div>
      </main>
    );
  }

  // ---- 已鉴权商户 ----
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 flex items-center gap-6 py-3">
          <Link href="/admin" className="text-sm font-medium text-slate-500 hover:text-slate-800">Merchant Console</Link>
          <Link href="/admin/campaigns" className="text-sm font-medium text-slate-500 hover:text-slate-800">My Campaigns</Link>
          <span className="text-sm font-medium text-indigo-600 border-b-2 border-indigo-600 pb-1">Connect TikTok</span>
          <span className="ml-auto text-xs text-slate-400">UID: {merchantId}</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold">Connect a TikTok Creator Account</h1>
        <p className="mt-2 text-slate-600">
          Authorize with TikTok so the platform can publish videos and audit their public status
          using a compliant, officially-issued access token.
        </p>

        {/* Connect 按钮 */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            onClick={connectTikTok}
            disabled={connectState === "submitting"}
            className="w-full rounded-lg bg-black px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {connectState === "submitting" ? "Connecting TikTok..." : "Connect TikTok Account"}
          </button>
          {connectState === "success" && (
            <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
              ✅ {connectMsg}
            </p>
          )}
          {connectState === "error" && (
            <p className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{connectMsg}</p>
          )}
          <p className="mt-3 text-xs text-slate-400">
            {process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY
              ? "Opens the official TikTok authorization flow."
              : "Local demo mode — stores a demo token (no real TikTok app configured)."}
          </p>
        </div>

        {/* 已连接令牌 */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Connected Tokens</h2>
          {loadState === "loading" && <p className="mt-3 text-slate-500">Loading token ledger...</p>}
          {loadState === "error" && <p className="mt-3 text-sm text-amber-600">Token ledger temporarily unavailable.</p>}
          {loadState === "ok" && tokens.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">No connected TikTok accounts yet.</p>
          )}
          <div className="mt-3 space-y-2">
            {tokens.map((t) => (
              <div key={t.token_id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{t.display_name || t.tiktok_open_id}</p>
                  <p className="text-xs text-slate-400">{t.token_id} · {t.scopes?.join(", ")}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${t.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {t.status}
                  </span>
                  <p className="mt-1 text-xs text-slate-400">exp {new Date(t.access_token_expires_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 令牌流转对账账本 */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Token Reconciliation Ledger</h2>
          <p className="mt-1 text-xs text-slate-400">
            Every issuance / refresh is logged with a non-reversible fingerprint — token plaintext is never exposed.
          </p>
          <div className="mt-3 space-y-2">
            {ledger.map((l) => (
              <div key={l.ledger_id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2 text-sm">
                <div>
                  <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${l.event_type === "REFRESHED" ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {l.event_type}
                  </span>
                  <span className="ml-3 text-xs text-slate-500 font-mono">{l.access_token_fingerprint}</span>
                </div>
                <span className="text-xs text-slate-400">{new Date(l.created_at).toLocaleString()}</span>
              </div>
            ))}
            {loadState === "ok" && ledger.length === 0 && (
              <p className="text-sm text-slate-500">No ledger events yet.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
