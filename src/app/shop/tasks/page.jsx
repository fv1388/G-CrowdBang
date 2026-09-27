// src/app/shop/tasks/page.jsx
// G-CrowdBang · B端海外用户接单大厅（React Client Component + Tailwind）
// 职责（本地合规闭环）：
//   1) Worker 角色鉴权卡点：未登录/非 worker → 403 物理拦截，杜绝陌生人未登录点任务导致 GPS 报空。
//   2) 动态任务列表（GET /api/campaigns/list）→ 视频卡矩阵渲染。
//   3) 每卡挂载硬件 GPS 校验按钮，传入真实 workerId（鉴权会话 UID，非硬编码）。
//   4) 收益余额 + PayPal 提现申请（POST /api/payouts/request）同页闭环。
"use client";

import TaskButton from "@/shop/components/TaskButton";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession, signUpWithEmail } from "@/database/auth";

export default function TaskHallPage() {
  const { session, loading } = useAuthSession();
  // 角色大小写不敏感：仅 worker 允许进入接单大厅
  const isWorker = !loading && session?.role?.toUpperCase() === "WORKER";
  const workerId = session?.uid ?? null;

  // 动态任务列表
  const [campaigns, setCampaigns] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  // 收益余额（来自 /api/workers/my-submissions）
  const [balance, setBalance] = useState(0);

  // 本地 demo 登录（解锁卡点用；生产走独立登录页）
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [authMsg, setAuthMsg] = useState("");

  // 提现表单状态
  const [amount, setAmount] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [withdrawState, setWithdrawState] = useState("idle"); // idle|submitting|success|error
  const [withdrawMsg, setWithdrawMsg] = useState("");
  const [lastPayoutId, setLastPayoutId] = useState(null);

  // 挂载完成(Mount)后拉取任务列表 + 收益余额
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [listRes, balRes] = await Promise.all([
          fetch("/api/campaigns/list"),
          fetch("/api/workers/my-submissions"),
        ]);
        const listData = listRes.ok ? await listRes.json() : { campaigns: [] };
        const balData = balRes.ok ? await balRes.json() : {};
        if (!cancelled) {
          setCampaigns(listData.campaigns ?? []);
          setBalance(balData.balance_usd ?? 0);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[task-hall] load failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 本地 demo：以 role='worker' 注册会话解锁卡点
  const demoWorkerSignUp = async () => {
    if (!email || !pwd) {
      setAuthMsg("Enter email + password.");
      return;
    }
    try {
      const s = await signUpWithEmail(email, pwd, "worker");
      setAuthMsg(`Signed in as worker (${s.uid}) — local demo session.`);
    } catch (e) {
      console.error("[task-hall] demo sign-in failed", e);
      setAuthMsg("Sign-in failed. Please try again.");
    }
  };

  // 提交提现申请 → POST /api/payouts/request（携带真实 workerId）
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
    if (!workerId) {
      setWithdrawMsg("You must be signed in to withdraw.");
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
          workerId, // 真实 UID（鉴权会话）
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
      setBalance(data.remaining_balance_usd ?? balance);
      setAmount("");
      setWithdrawState("success");
    } catch (err) {
      console.error("[task-hall] withdrawal failed", err);
      setWithdrawState("error");
      setWithdrawMsg("Network error — please try again.");
    }
  };

  const flow = [
    { step: "Browse Available Bounties", body: "Pick a task from the live board — each shows the source video, target city, and the $3.00 payout." },
    { step: "Pass the Hardware GPS Check", body: "When you claim a task, your device runs a standard GPS check (navigator.geolocation) to confirm you're submitting from the task area." },
    { step: "Publish & Get Verified", body: "Post your video, submit the link, and our server verifies it's public and the claim is consistent — then your $3.00 is released to your balance." },
  ];

  // ---- 挂载中 ----
  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center text-slate-500">
        Checking worker session...
      </main>
    );
  }

  // ---- 403 卡点：非 worker（或未登录）→ 物理拦截，避免陌生人点任务致 GPS 报空 ----
  if (!isWorker) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <p className="text-6xl">🚫</p>
          <h1 className="mt-4 text-2xl font-bold text-rose-600">403 · Forbidden</h1>
          <p className="mt-2 text-sm text-slate-600">
            This is the Worker Task Hall. Your session role is{" "}
            <strong>{session?.role ?? "none"}</strong> — a worker account is required to
            browse tasks and run the hardware GPS check.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Task claims are blocked for unauthenticated visitors.
          </p>

          {/* 本地 demo 登录（解锁卡点用） */}
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
            <p className="text-xs font-medium text-slate-500">Local demo — sign in as worker</p>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="worker@example.com"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="password"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={demoWorkerSignUp}
              className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Unlock Task Hall (demo)
            </button>
            {authMsg && <p className="mt-2 text-xs text-slate-500">{authMsg}</p>}
            <Link href="/" className="mt-3 block text-center text-xs text-indigo-500 hover:underline">
              ← Back to landing
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ---- 已鉴权 worker 的任务大厅 + 收益提现 ----
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 flex items-center gap-6 py-3">
          <Link href="/shop/tasks" className="text-sm font-medium text-indigo-600 border-b-2 border-indigo-600 pb-1">Task Hall</Link>
          <Link href="/workers" className="text-sm font-medium text-slate-500 hover:text-slate-800">My Tasks &amp; Earnings</Link>
          <span className="ml-auto text-xs text-slate-400">UID: {workerId}</span>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Your Task Dashboard — Make Money Sharing Creator Videos</h1>
        <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
          Browse available bounty tasks in your area, complete the hardware GPS check, publish your video, and get paid $3.00 once your work is verified.
        </p>
        <a href="#tasks" className="mt-6 inline-block px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700">Browse Tasks</a>
      </section>

      <section id="tasks" className="max-w-5xl mx-auto px-6 pb-10">
        <h2 className="text-2xl font-bold">Available Bounties</h2>

        {loadState === "loading" && <p className="mt-4 text-slate-500">⏳ Loading available crowdsourcing tasks...</p>}
        {loadState === "error" && (
          <p className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">Campaigns are temporarily unavailable. Please try again shortly.</p>
        )}
        {loadState === "ok" && campaigns.length === 0 && (
          <p className="mt-4 text-slate-500">No open bounties right now — check back soon.</p>
        )}

        {/* 动态任务卡片矩阵渲染（.map()） */}
        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((t) => (
            <div key={t.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              {t.video_url ? (
                <video controls preload="metadata" className="aspect-video w-full rounded-xl bg-slate-900" src={t.video_url} />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">No preview available</div>
              )}

              <h3 className="mt-3 font-semibold">{t.title}</h3>
              {t.caption_text && <p className="mt-1 text-sm leading-relaxed text-slate-600">{t.caption_text}</p>}

              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">📍 {t.city}, {t.state}</span>
                <span className="font-bold text-emerald-600">${Number(t.payout).toFixed(2)} Payout</span>
              </div>

              {/* 精确绑定硬件位置校验按钮：传入真实 workerId + 边界参数 */}
              <div className="mt-4">
                <TaskButton campaignId={t.id} workerId={workerId} boundary={t.boundary} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-center">How It Works</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {flow.map((f, i) => (
            <div key={f.step} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white font-semibold">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{f.step}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 收益余额 + PayPal 提现申请（同页闭环） */}
      <section className="max-w-4xl mx-auto px-6 pb-14">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Earnings &amp; Withdrawal</h3>
            <span className="text-sm text-slate-500">Available: <strong className="text-emerald-600">${Number(balance).toFixed(2)}</strong></span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
          </div>

          <button
            onClick={requestWithdrawal}
            disabled={withdrawState === "submitting"}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {withdrawState === "submitting" ? "Requesting transfer..." : "Request Withdrawal"}
          </button>

          {withdrawState === "success" && (
            <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
              ✅ Withdrawal requested ({lastPayoutId ? `#${lastPayoutId}` : ""}). It will be processed by the platform as PENDING_TRANSFER.
            </p>
          )}
          {withdrawState === "error" && (
            <p className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{withdrawMsg}</p>
          )}

          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li><strong className="text-slate-800">Earnings:</strong> $3.00 per verified task, paid to your withdrawable balance.</li>
            <li><strong className="text-slate-800">Verification:</strong> every task is audited for public status and location consistency.</li>
            <li><strong className="text-slate-800">Compliance:</strong> location data is used solely to confirm task eligibility and is handled per our privacy policy.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
