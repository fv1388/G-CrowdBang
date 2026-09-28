// src/app/shop/tasks/page.jsx
// G-CrowdBang · B端海外用户接单大厅（React Client Component + Tailwind · 本地真机通联闭环）
// 业务闭环（本地 mock 阶段）：
//   1) Worker 角色鉴权卡点：未登录/非 worker → 403，杜绝陌生人未登录点任务致 GPS 报空。
//   2) 顶部【指定发布账号 Banner】：明确目标品牌号 @fv138888，指引在手机 TikTok App 内登录/切换到该号。
//   3) 动态任务卡片：本地 mock 数据流死锁本地静态素材桶 http://localhost:3000/assets/888.mp4，
//      <video controls> 渲染带货素材 + 美式文案 caption_text + "$3.00 Verified Payout" 勋章。
//   4) TaskButton 硬件 GPS 校验按钮：navigator.geolocation.getCurrentPosition 抓真实 WGS84 经纬度。
//   5) 下载/复制/App 唤醒：一键复制文案到剪贴板 + snssdk1128:// 唤醒手机 TikTok App 手动发布。
//   6) 完工对账表单：回填公开分享链接 + 实拍截图 → POST /api/tasks/verify-and-publish 标记 PENDING_AUDIT。
// 合规：手动真机发布 + 官方公开链接反查；不涉及任何反爬规避、指纹伪造或自动发布逻辑。
"use client";

import TaskButton from "@/shop/components/TaskButton";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/database/auth";
import DemoLoginCard from "@/app/components/DemoLoginCard";

// 指定官方发布账号（目标品牌号）+ 本地静态素材资产桶（mock 阶段）
const TARGET_PROFILE = "@fv138888";
const LOCAL_ASSET_VIDEO = "http://localhost:3000/assets/888.mp4";

// 是否处于本地 mock（hostname 判定；线上回退真实任务视频）
function isLocalEnv() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export default function TaskHallPage() {
  const { session, loading } = useAuthSession();
  const isWorker = !loading && session?.role?.toUpperCase() === "WORKER";
  const workerId = session?.uid ?? null;

  const [campaigns, setCampaigns] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  // 收益余额（来自 /api/workers/my-submissions）
  const [balance, setBalance] = useState(0);

  // 提现表单状态
  const [amount, setAmount] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [withdrawState, setWithdrawState] = useState("idle"); // idle|submitting|success|error
  const [withdrawMsg, setWithdrawMsg] = useState("");
  const [lastPayoutId, setLastPayoutId] = useState(null);

  // 完工对账表单状态：key = campaignId → { url, shotName, state, msg }
  const [completion, setCompletion] = useState({});
  const setCompletionFor = (cid, patch) =>
    setCompletion((prev) => ({ ...prev, [cid]: { ...(prev[cid] || {}), ...patch } }));

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
          workerId,
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

  // 完工对账提交 → POST /api/tasks/verify-and-publish（携带公开链接 + 截图名）
  // 后端对 TaskButton 已建出的 PENDING_AUDIT 单做补充更新（不重复建单）。
  const submitCompletion = async (campaignId) => {
    const c = completion[campaignId] || {};
    const url = (c.url || "").trim();
    if (!url) {
      setCompletionFor(campaignId, { state: "error", msg: "Please paste your published video link first." });
      return;
    }
    if (!workerId) {
      setCompletionFor(campaignId, { state: "error", msg: "You must be signed in as a worker." });
      return;
    }
    setCompletionFor(campaignId, { state: "submitting", msg: "" });
    try {
      const res = await fetch("/api/tasks/verify-and-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          workerId,
          published_video_url: url,
          screenshot_filename: c.shotName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompletionFor(campaignId, {
          state: "error",
          msg:
            data?.error === "CLAIM_NOT_FOUND"
              ? "No claim found — run the hardware check (Publish Task) first."
              : `Submit failed (${data?.error || res.status}).`,
        });
        return;
      }
      setCompletionFor(campaignId, {
        state: "success",
        msg: `✅ Proof logged — ${data.submissionId} marked PENDING_AUDIT. Awaiting automated public-status audit.`,
      });
    } catch (err) {
      console.error("[task-hall] completion submit failed", err);
      setCompletionFor(campaignId, { state: "error", msg: "Network error — please try again." });
    }
  };

  // 一键复制文案到系统剪贴板（手动发布前使用）
  const copyCaption = async (caption) => {
    try {
      await navigator.clipboard.writeText(caption || "");
    } catch (e) {
      console.error("[task-hall] clipboard failed", e);
    }
  };

  // 唤醒手机 TikTok App（Web 原生 App URL Scheme；仅在手机端生效）
  const openTikTokApp = () => {
    try {
      window.location.href = "snssdk1128://";
    } catch (e) {
      console.error("[task-hall] tiktok scheme failed", e);
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

  // ---- 403 卡点 ----
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
          <DemoLoginCard role="worker" backHref="/" />
        </div>
      </main>
    );
  }

  // ---- 已鉴权 worker：暗黑科技感任务大厅 ----
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 bg-slate-900">
        <div className="max-w-6xl mx-auto px-6 flex items-center gap-6 py-3">
          <Link href="/shop/tasks" className="text-sm font-medium text-indigo-400 border-b-2 border-indigo-500 pb-1">Task Hall</Link>
          <Link href="/workers" className="text-sm font-medium text-slate-400 hover:text-slate-100">My Tasks &amp; Earnings</Link>
          <span className="ml-auto text-xs text-slate-500">UID: {workerId}</span>
        </div>
      </nav>

      {/* 落地 Hero：美区裂变文案（合规：硬件GPS + 公开审计 + 托管 escrow） */}
      <section className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <span className="inline-block rounded-full bg-emerald-500/15 px-4 py-1 text-xs font-medium text-emerald-300">
            Earn $3 per task · No experience needed
          </span>
          <h1 className="mt-5 text-3xl sm:text-5xl font-extrabold tracking-tight">
            Turn your free time into <span className="text-emerald-400">cash</span>
          </h1>
          <p className="mt-5 text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Browse real crowdsourcing tasks from brands, verify your location with your phone's
            hardware GPS, and get paid after a transparent audit. Work from anywhere in the US,
            whenever you have 10 free minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href="#tasks" className="px-7 py-3 rounded-xl bg-emerald-500 text-emerald-950 font-bold hover:bg-emerald-400">Browse Available Tasks →</a>
            <a href="#how" className="px-7 py-3 rounded-xl border border-slate-700 text-slate-200 font-semibold hover:border-slate-500">How It Works ↓</a>
          </div>
        </div>
      </section>

      {/* ⭐ 指定发布账号 Banner（本地真机通联核心指引） */}
      <section className="max-w-6xl mx-auto px-6 pt-8">
        <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-slate-900 via-cyan-950/40 to-slate-900 p-6 shadow-[0_0_30px_rgba(34,211,238,0.15)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/15 text-3xl">🎯</span>
              <div>
                <p className="text-xs uppercase tracking-widest text-cyan-400">Target Deployment Profile</p>
                <p className="mt-1 text-2xl font-extrabold text-white">{TARGET_PROFILE}</p>
              </div>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-slate-300">
              Please make sure your phone&apos;s TikTok app is signed in to (or switched to) this
              brand profile before publishing below. <span className="text-cyan-300">Only posts on {TARGET_PROFILE} will pass the audit.</span>
            </p>
          </div>
          <div className="mt-4 grid gap-3 text-xs text-slate-400 sm:grid-cols-3">
            <span className="rounded-lg bg-slate-800/60 px-3 py-2">1 · Sign in to <b className="text-white">{TARGET_PROFILE}</b> in TikTok App</span>
            <span className="rounded-lg bg-slate-800/60 px-3 py-2">2 · Publish the asset manually with your real device</span>
            <span className="rounded-lg bg-slate-800/60 px-3 py-2">3 · Paste the public link below to get paid</span>
          </div>
        </div>
      </section>

      {/* 钱包对账面板 + PayPal 提现 */}
      <section className="max-w-6xl mx-auto px-6 pt-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm text-slate-400">Your wallet (withdrawable balance)</p>
              <p className="mt-1 text-3xl font-bold text-emerald-400">${Number(balance).toFixed(2)}</p>
              <Link href="/workers" className="mt-3 inline-block text-sm font-medium text-indigo-400 hover:underline">View full earnings &amp; withdrawal →</Link>
            </div>
            <div className="w-full lg:max-w-md">
              <h2 className="text-sm font-semibold text-slate-200">Withdraw to PayPal</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount (USD)" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <input type="email" value={paypalEmail} onChange={(e) => setPaypalEmail(e.target.value)}
                  placeholder="PayPal email" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <button onClick={requestWithdrawal} disabled={withdrawState === "submitting"}
                className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {withdrawState === "submitting" ? "Requesting transfer..." : "Request Withdrawal"}
              </button>
              {withdrawState === "success" && (
                <p className="mt-2 rounded-lg bg-emerald-900/40 border border-emerald-600/40 p-2 text-xs text-emerald-300">
                  ✅ Withdrawal requested ({lastPayoutId ? `#${lastPayoutId}` : ""}). Processed as PENDING_TRANSFER.
                </p>
              )}
              {withdrawState === "error" && (
                <p className="mt-2 rounded-lg bg-rose-900/40 border border-rose-600/40 p-2 text-xs text-rose-300">{withdrawMsg}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 动态任务列表 */}
      <section id="tasks" className="max-w-6xl mx-auto px-6 pb-10 pt-8">
        <h2 className="text-2xl font-bold text-slate-100">Available Bounties</h2>

        {loadState === "loading" && <p className="mt-4 text-slate-500">⏳ Loading available crowdsourcing tasks...</p>}
        {loadState === "error" && (
          <p className="mt-4 rounded-xl bg-amber-950/40 border border-amber-700/40 p-4 text-sm text-amber-300">Campaigns are temporarily unavailable. Please try again shortly.</p>
        )}
        {loadState === "ok" && campaigns.length === 0 && (
          <p className="mt-4 text-slate-500">No open bounties right now — check back soon.</p>
        )}

        <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((t) => {
            const src = isLocalEnv() ? LOCAL_ASSET_VIDEO : t.video_url;
            const c = completion[t.id] || {};
            return (
              <div key={t.id} className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg">
                {/* 素材视频：mock 阶段死锁本地静态资产桶 888.mp4 */}
                <video controls preload="metadata" className="aspect-video w-full rounded-xl border border-gray-800 bg-black"
                  src={src} />

                <h3 className="mt-3 font-semibold text-slate-100">{t.title}</h3>
                {t.caption_text && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{t.caption_text}</p>
                )}

                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="rounded-full bg-indigo-900/40 px-3 py-1 text-indigo-300">📍 {t.city}, {t.state}</span>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 font-bold text-emerald-300">$3.00 USD Verified Payout</span>
                </div>

                {/* 下载/复制/App 唤醒（手动真机发布指引） */}
                <div className="mt-3 flex gap-2">
                  <a href={src} download
                    className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-center text-xs font-medium text-slate-300 hover:bg-slate-800">⬇ Download</a>
                  <button onClick={() => copyCaption(t.caption_text)}
                    className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800">📋 Copy Caption</button>
                  <button onClick={openTikTokApp}
                    className="flex-1 rounded-lg border border-cyan-600/50 bg-cyan-900/20 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-900/40">📱 Open TikTok App</button>
                </div>

                {/* 硬件 GPS 校验按钮（TaskButton 联动，传真实 workerId + 边界） */}
                <div className="mt-3">
                  <TaskButton campaignId={t.id} workerId={workerId} boundary={t.boundary} />
                </div>

                {/* 完工证明对账单上传表单（Form Gateway） */}
                <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3">
                  <p className="text-xs font-semibold text-slate-300">Proof of completion / 完工证明对账单</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Published on {TARGET_PROFILE}? Paste the public link and attach a timestamped TikTok success screenshot, then submit for audit.
                  </p>
                  <input
                    value={c.url || ""}
                    onChange={(e) => setCompletionFor(t.id, { url: e.target.value })}
                    placeholder="https://www.tiktok.com/@fv138888/video/... (public link)"
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCompletionFor(t.id, { shotName: e.target.files?.[0]?.name || "" })}
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-indigo-600 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                  />
                  <button
                    onClick={() => submitCompletion(t.id)}
                    disabled={c.state === "submitting"}
                    className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {c.state === "submitting" ? "Logging proof..." : "Submit for Audit"}
                  </button>
                  {c.state === "success" && (
                    <p className="mt-2 rounded-lg bg-emerald-900/40 border border-emerald-600/40 p-2 text-xs text-emerald-300">{c.msg}</p>
                  )}
                  {c.state === "error" && (
                    <p className="mt-2 rounded-lg bg-rose-900/40 border border-rose-600/40 p-2 text-xs text-rose-300">{c.msg}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="how" className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-center text-slate-100">How It Works</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {flow.map((f, i) => (
            <div key={f.step} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-slate-950 font-semibold">{i + 1}</span>
              <h3 className="mt-3 font-semibold text-slate-100">{f.step}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
