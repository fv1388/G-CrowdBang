// src/app/admin/campaigns/page.jsx
// G-CrowdBang · A端商户任务对账看板（React + Tailwind）
// 展示当前商户自己发布的悬赏任务：托管名额消耗、佣金、核验进度。
// 数据来自 GET /api/admin/campaigns（服务端归属过滤，仅返回本商户任务）。
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthSession } from "@/database/auth";

export default function MerchantCampaigns() {
  const { session } = useAuthSession();
  const [campaigns, setCampaigns] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  // 充值表单状态
  const [depositAmount, setDepositAmount] = useState("");
  const [paymentOrderId, setPaymentOrderId] = useState("");
  const [depositState, setDepositState] = useState("idle"); // idle | submitting | success | error
  const [depositMsg, setDepositMsg] = useState("");
  const [lastDepositId, setLastDepositId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 归属：用当前登录商户的真实 UID 查询，而非服务端占位 id
        const merchantId = session?.uid || "";
        const suffix = merchantId ? `?merchantId=${encodeURIComponent(merchantId)}` : "";
        const res = await fetch(`/api/admin/campaigns${suffix}`);
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setCampaigns(data.campaigns ?? []);
          setBalance(data.balance_usd ?? 0);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[admin/campaigns] load failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [session?.uid]);

  // 充值到钱包 → POST /api/merchant/deposit
  const topUp = async () => {
    const amt = Number(depositAmount);
    if (!(amt > 0)) {
      setDepositMsg("Enter a valid deposit amount.");
      setDepositState("error");
      return;
    }
    if (!paymentOrderId) {
      setDepositMsg("Enter the payment order ID from your payment provider.");
      setDepositState("error");
      return;
    }

    setDepositState("submitting");
    setDepositMsg("");
    try {
      const res = await fetch("/api/merchant/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: session?.uid || "", depositAmount: amt, paymentOrderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDepositMsg(
          data?.error === "PAYMENT_NOT_VERIFIED"
            ? "Payment not verified — check the order ID."
            : "Deposit failed. Please try again."
        );
        setDepositState("error");
        return;
      }
      setLastDepositId(data.depositId ?? null);
      setBalance(data.balance_usd ?? 0);
      setDepositAmount("");
      setPaymentOrderId("");
      setDepositState("success");
    } catch (err) {
      console.error("[admin/campaigns] deposit failed", err);
      setDepositState("error");
      setDepositMsg("Network error — please try again.");
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-medium text-gray-500 hover:text-gray-800">← Home · 返回首页</Link>
          <button type="button" onClick={() => window.history.back()} className="text-sm font-medium text-gray-500 hover:text-gray-800">← Back · 返回上一页</button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">My Campaigns</h1>
            <p className="text-sm text-slate-500">我的悬赏任务</p>
            <p className="mt-2 text-slate-600">
              Audit your bounty tasks — slots consumed, payout rate, and verification progress.
            </p>
            <p className="text-sm text-slate-500">审计你的悬赏任务 —— 名额消耗、单次佣金与核验进度。</p>
          </div>
          <Link
            href="/admin/campaigns/new"
            className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
          >
            + New Campaign
          </Link>
        </div>

        {/* 商户钱包：余额 + 充值 */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Merchant Wallet</h2>
          <p className="text-xs text-slate-500">商户钱包</p>
          <p className="mt-1 text-sm text-slate-500">
            Available escrow balance: <strong className="text-indigo-600">${Number(balance).toFixed(2)}</strong>
          </p>
          <p className="text-xs text-slate-500">可用托管余额：${Number(balance).toFixed(2)}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-slate-600">Deposit amount (USD)</label>
              <p className="text-xs text-slate-500">充值金额（美元）</p>
              <input
                type="number"
                min="1"
                step="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 100.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Payment order ID</label>
              <p className="text-xs text-slate-500">支付订单号</p>
              <input
                type="text"
                value={paymentOrderId}
                onChange={(e) => setPaymentOrderId(e.target.value)}
                placeholder="paypal_order_xxx"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <button
            onClick={topUp}
            disabled={depositState === "submitting"}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {depositState === "submitting" ? "Verifying payment..." : "Top Up Wallet"}
          </button>
          <p className="mt-1 text-xs text-indigo-600">充值钱包</p>

          {depositState === "success" && (
            <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
              ✅ Deposit confirmed ({(lastDepositId ? `#${lastDepositId}` : "")}). Balance updated to $
              {Number(balance).toFixed(2)}.
            </p>
          )}
          {depositState === "error" && (
            <p className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{depositMsg}</p>
          )}
        </div>

        {loadState === "loading" && <p className="mt-8 text-slate-500">Loading campaigns...</p>}
        {loadState === "error" && (
          <p className="mt-8 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
            Campaigns are temporarily unavailable. Please try again shortly.
            <span className="block text-xs text-amber-600">任务列表暂时不可用，请稍后重试。</span>
          </p>
        )}
        {loadState === "ok" && campaigns.length === 0 && (
          <p className="mt-8 text-slate-500">
            No campaigns yet — create your first bounty.
            <span className="block text-xs text-slate-500">还没有任务 —— 创建你的第一个悬赏吧。</span>
          </p>
        )}

        <div className="mt-6 space-y-4">
          {campaigns.map((c) => {
            const used = c.slots_used ?? 0;
            const total = c.slots || 0;
            const pct = total > 0 ? Math.round((used / total) * 100) : 0;
            const audits = c.audits || {};
            return (
              <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <Link href={`/admin/campaigns/${encodeURIComponent(c.id)}`} className="font-semibold hover:text-indigo-600">
                      {c.title} →
                    </Link>
                    <p className="text-sm text-slate-500">
                      {c.city}, {c.state} · {c.status} · ${Number(c.payout).toFixed(2)}/task
                    </p>
                  </div>
                  <span className="text-sm text-slate-500">{used}/{total} slots filled</span>
                </div>

                {/* 托管名额进度条 */}
                <div className="mt-3 h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>

                {/* 核验进度 */}
                <div className="mt-4 flex flex-wrap gap-3 text-xs">
                  <span className="rounded-full bg-amber-100 text-amber-700 px-3 py-1">
                    {audits.PENDING_AUDIT ?? 0} pending audit
                  </span>
                  <span className="rounded-full bg-emerald-100 text-emerald-700 px-3 py-1">
                    {audits.verified ?? 0} verified
                  </span>
                  <span className="rounded-full bg-slate-100 text-slate-600 px-3 py-1">
                    {c.id}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">待核验 {audits.PENDING_AUDIT ?? 0} · 已核验 {audits.verified ?? 0}</p>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
