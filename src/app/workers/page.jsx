// src/app/workers/page.jsx
// G-CrowdBang · B端 Worker 个人接单与收益工作台（React + Tailwind）
// 展示当前接单人自己的任务记录：核验状态、佣金结算、累计收益。
// 数据来自 GET /api/workers/my-submissions（服务端按 worker 归属过滤）。
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function WorkerDashboard() {
  const [subs, setSubs] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  // 提现表单状态
  const [amount, setAmount] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [withdrawState, setWithdrawState] = useState("idle"); // idle | submitting | success | error
  const [withdrawMsg, setWithdrawMsg] = useState("");
  const [lastPayoutId, setLastPayoutId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/workers/my-submissions");
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSubs(data.submissions ?? []);
          setBalance(data.balance_usd ?? 0);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[workers] load submissions failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 提交提现申请 → POST /api/payouts/request
  const requestWithdrawal = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) {
      setWithdrawMsg("Enter a valid withdrawal amount.");
      setWithdrawState("error");
      return;
    }
    if (!paypalEmail || !paypalEmail.includes("@")) {
      setWithdrawMsg("Enter a valid PayPal email.");
      setWithdrawState("error");
      return;
    }

    setWithdrawState("submitting");
    setWithdrawMsg("");
    try {
      const res = await fetch("/api/payouts/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: "usr_current",
          amount: amt,
          payoutMethod: "paypal",
          destination: paypalEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWithdrawMsg(
          data?.error === "INSUFFICIENT_BALANCE"
            ? "Insufficient balance — withdraw less than or equal to your available balance."
            : data?.error === "INVALID_AMOUNT"
              ? "Amount is below the minimum withdrawal."
              : "Withdrawal request failed. Please try again."
        );
        setWithdrawState("error");
        return;
      }
      setLastPayoutId(data.payoutRequestId ?? null);
      setBalance(data.remaining_balance_usd ?? 0);
      setWithdrawMsg("");
      setAmount("");
      setWithdrawState("success");
    } catch (err) {
      console.error("[workers] withdrawal failed", err);
      setWithdrawState("error");
      setWithdrawMsg("Network error — please try again.");
    }
  };

  // 统计：已结算(verified→paid)的累计收益
  const earnings = subs
    .filter((s) => s.status === "verified")
    .reduce((acc) => acc + 3.0, 0);

  const statusBadge = (status) => {
    const map = {
      PENDING_AUDIT: ["bg-amber-100 text-amber-700", "Pending Audit"],
      verified: ["bg-emerald-100 text-emerald-700", "Verified"],
      rejected: ["bg-rose-100 text-rose-700", "Rejected"],
    };
    const [cls, label] = map[status] || ["bg-slate-100 text-slate-600", status];
    return <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>;
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* 共享导航：任务大厅 ↔ 我的任务&收益 */}
      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 flex items-center gap-6 py-3">
          <Link href="/shop/tasks" className="text-sm font-medium text-slate-500 hover:text-slate-800">Task Hall</Link>
          <Link href="/workers" className="text-sm font-medium text-indigo-600 border-b-2 border-indigo-600 pb-1">My Tasks &amp; Earnings</Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold">My Tasks &amp; Earnings</h1>
        <p className="mt-2 text-slate-600">Track the tasks you've claimed, their verification status, and your settled earnings.</p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Total settled earnings</p>
          <p className="mt-1 text-3xl font-bold text-emerald-600">${earnings.toFixed(2)}</p>
          <p className="mt-1 text-xs text-slate-400">$3.00 per verified task, paid to withdrawable balance.</p>
        </div>

        {/* 提现申请：将可用余额转入 PayPal */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Withdraw to PayPal</h2>
          <p className="mt-1 text-sm text-slate-500">
            Available balance: <strong className="text-emerald-600">${Number(balance).toFixed(2)}</strong>
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-sm text-slate-600">Amount (USD)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 3.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">PayPal email</label>
              <input
                type="email"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              onClick={requestWithdrawal}
              disabled={withdrawState === "submitting"}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {withdrawState === "submitting" ? "Requesting transfer..." : "Request Withdrawal"}
            </button>

            {withdrawState === "success" && (
              <p className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                ✅ Withdrawal requested ({lastPayoutId ? `#${lastPayoutId}` : ""}). It will be processed by the platform as PENDING_TRANSFER.
              </p>
            )}
            {withdrawState === "error" && (
              <p className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{withdrawMsg}</p>
            )}
          </div>
        </div>

        {loadState === "loading" && <p className="mt-6 text-slate-500">Loading your tasks...</p>}
        {loadState === "error" && (
          <p className="mt-6 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">Your tasks are temporarily unavailable. Please try again shortly.</p>
        )}
        {loadState === "ok" && subs.length === 0 && (
          <p className="mt-6 text-slate-500">You haven't claimed any tasks yet — head to the task hall to get started.</p>
        )}

        <div className="mt-6 space-y-3">
          {subs.map((s) => (
            <div key={s.submissionId} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <p className="font-medium">{s.campaignId}</p>
                <p className="text-xs text-slate-400">Claimed {s.claimedAt ? new Date(s.claimedAt).toLocaleString() : "—"}</p>
              </div>
              <div className="flex items-center gap-3">
                {statusBadge(s.status)}
                <span className="font-semibold text-emerald-600">{s.status === "verified" ? "$3.00" : "$0.00"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
