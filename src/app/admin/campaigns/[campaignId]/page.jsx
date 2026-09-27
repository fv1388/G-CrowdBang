// src/app/admin/campaigns/[campaignId]/page.jsx
// G-CrowdBang · A端商户任务核验审计明细页（React + Tailwind）
// 通过 /admin/campaigns/[campaignId] 展示该任务下的 submissions：接单人、GPS坐标、核验状态、佣金。
// 数据来自 GET /api/admin/submissions?campaignId=...
// 结算动作：每行 PENDING_AUDIT 提供 "Settle & Payout" 按钮 → POST /api/tasks/verify-and-payout
//           （携带商户真实 UID）；结算需商户已连接 TikTok 有效令牌，缺失时提示跳转对接页。
"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useAuthSession, signUpWithEmail } from "@/database/auth";

export default function AuditPage({ params }) {
  const { campaignId } = use(params);
  const { session, loading } = useAuthSession();
  const isMerchant = !loading && session?.role?.toUpperCase() === "MERCHANT";
  const merchantId = session?.uid ?? null;

  const [subs, setSubs] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  // demo 登录（解锁卡点用）
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [authMsg, setAuthMsg] = useState("");

  // 结算反馈
  const [settleMsg, setSettleMsg] = useState("");
  const [settlingId, setSettlingId] = useState(null);
  const [tiktokNeeded, setTiktokNeeded] = useState(false);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/submissions?campaignId=${encodeURIComponent(campaignId)}`);
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSubs(data.submissions ?? []);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[admin/audit] load failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  // 结算某条接单：POST /api/tasks/verify-and-payout（携带商户 UID）
  const settle = async (submissionId) => {
    if (!merchantId) { setSettleMsg("You must be a signed-in merchant."); return; }
    setSettlingId(submissionId);
    setSettleMsg("");
    setTiktokNeeded(false);
    try {
      const res = await fetch("/api/tasks/verify-and-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, merchantId }),
      });
      const data = await res.json();
      if (data?.error === "TIKTOK_TOKEN_REQUIRED") {
        setTiktokNeeded(true);
        setSettleMsg("Settlement blocked — connect a TikTok account first (required for official status audit).");
      } else if (data?.result === "verified") {
        setSettleMsg(`✅ ${submissionId} verified — $3.00 paid, $1.00 platform fee.`);
      } else if (data?.result === "rejected") {
        setSettleMsg(`✋ ${submissionId} rejected (${data?.reason ?? "video not public"}).`);
      } else {
        setSettleMsg(`Settlement failed (${data?.error || res.status}).`);
      }
    } catch (err) {
      console.error("[admin/audit] settle failed", err);
      setSettleMsg("Network error during settlement.");
    }
    setSettlingId(null);
    // 刷新列表以反映最新状态
    try {
      const res = await fetch(`/api/admin/submissions?campaignId=${encodeURIComponent(campaignId)}`);
      if (res.ok) {
        const data = await res.json();
        setSubs(data.submissions ?? []);
      }
    } catch { /* ignore */ }
  };

  const statusBadge = (status) => {
    const map = {
      PENDING_AUDIT: ["bg-amber-100 text-amber-700", "Pending Audit"],
      verified: ["bg-emerald-100 text-emerald-700", "Verified"],
      rejected: ["bg-rose-100 text-rose-700", "Rejected"],
    };
    const [cls, label] = map[status] || ["bg-slate-100 text-slate-600", status];
    return <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>;
  };

  const demoMerchantSignUp = async () => {
    if (!email || !pwd) { setAuthMsg("Enter email + password."); return; }
    try {
      const s = await signUpWithEmail(email, pwd, "merchant");
      setAuthMsg(`Signed in as merchant (${s.uid}) — local demo session.`);
    } catch (e) { setAuthMsg("Sign-in failed."); }
  };

  if (loading) {
    return <main className="min-h-screen bg-slate-50 grid place-items-center text-slate-500">Checking merchant session...</main>;
  }

  // 403 卡点
  if (!isMerchant) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <p className="text-6xl">🚫</p>
          <h1 className="mt-4 text-2xl font-bold text-rose-600">403 · Forbidden</h1>
          <p className="mt-2 text-sm text-slate-600">
            This is the Merchant Console. Your session role is <strong>{session?.role ?? "none"}</strong> — merchant access is required.
          </p>
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
            <p className="text-xs font-medium text-slate-500">Local demo — sign in as merchant</p>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="merchant@example.com"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="password"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button onClick={demoMerchantSignUp}
              className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Unlock Merchant Console (demo)</button>
            {authMsg && <p className="mt-2 text-xs text-slate-500">{authMsg}</p>}
            <Link href="/admin" className="mt-3 block text-center text-xs text-indigo-500 hover:underline">← Back to console</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/admin/campaigns" className="text-sm text-slate-500 hover:text-slate-700">← Back to campaigns</Link>
        <h1 className="mt-2 text-3xl font-bold">Audit · {campaignId}</h1>
        <p className="mt-2 text-slate-600">
          Review each claim's GPS telemetry and verification status before releasing payout.
        </p>
        <Link href="/admin/connect-tiktok" className="mt-1 inline-block text-sm text-indigo-600 hover:underline">
          Manage TikTok connection →
        </Link>

        {/* 结算被 TikTok 令牌拦截时的 merchant 侧引导横幅 */}
        {tiktokNeeded && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-amber-800">⚠️ Connect a TikTok account to settle claims</p>
                <p className="mt-1 text-sm text-amber-700">
                  Settlement calls the official status audit, which requires a valid TikTok access token
                  for this merchant. Complete these steps to unlock payout:
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-amber-700">
                  <li>Open <strong>Connect TikTok</strong> and authorize your creator account.</li>
                  <li>Confirm the token status shows <strong>active</strong> in the token ledger.</li>
                  <li>Return here and press <strong>Settle &amp; Payout</strong> again.</li>
                </ol>
              </div>
              <Link
                href="/admin/connect-tiktok"
                className="shrink-0 rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800"
              >
                Connect TikTok now →
              </Link>
            </div>
          </div>
        )}

        {settleMsg && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">{settleMsg}</div>
        )}

        {loadState === "loading" && <p className="mt-6 text-slate-500">Loading submissions...</p>}
        {loadState === "error" && (
          <p className="mt-6 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">Submissions are temporarily unavailable.</p>
        )}
        {loadState === "ok" && subs.length === 0 && (
          <p className="mt-6 text-slate-500">No claims yet for this campaign.</p>
        )}

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3">GPS (lat, lng)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payout</th>
                <th className="px-4 py-3">Claimed</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subs.map((s) => (
                <tr key={s.submissionId}>
                  <td className="px-4 py-3 font-medium">{s.workerId}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {typeof s.latitude === "number" ? `${s.latitude.toFixed(4)}, ${s.longitude?.toFixed(4)}` : "—"}
                    <span className="ml-1 text-xs text-slate-400">(±{s.accuracy ?? "?"}m)</span>
                  </td>
                  <td className="px-4 py-3">{statusBadge(s.status)}</td>
                  <td className="px-4 py-3 text-slate-600">{s.payout}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.claimedAt ? new Date(s.claimedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {s.status === "PENDING_AUDIT" ? (
                      <button
                        onClick={() => settle(s.submissionId)}
                        disabled={settlingId === s.submissionId}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {settlingId === s.submissionId ? "Settling..." : "Settle & Payout"}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
