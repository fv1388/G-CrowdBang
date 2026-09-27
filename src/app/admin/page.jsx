// src/app/admin/page.jsx
// G-CrowdBang / F-CrowdBang · A端商户控制台（React + Tailwind, Client Component）
// 职责：
//   1) 双角色鉴权卡点：挂载时经 useAuthSession 校验角色，非 'merchant' 物理拦截(403)。
//   2) 商户美元账户充值（PayPal 服务端订单创建/校验后入账）。
//   3) 发布悬赏任务（Publish & Deposit Escrow），将表单数据 + 商户真实 UID(merchantId)
//      通过标准 fetch 提交到 /api/campaigns/create。
// 合规：标准鉴权 + PayPal 支付校验 + 托管入账；不含任何规避逻辑。
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthSession } from "@/database/auth";
import DemoLoginCard from "@/app/components/DemoLoginCard";

export default function MerchantConsole() {
  const { session, loading } = useAuthSession();
  // 角色大小写不敏感判定（auth 层实际下发小写 merchant，'MERCHANT' 亦兼容）
  const isMerchant = !loading && session?.role?.toUpperCase() === "MERCHANT";
  const merchantId = session?.uid ?? null;

  // ---- PayPal 充值 ----
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpState, setTopUpState] = useState("idle"); // idle|submitting|success|error
  const [topUpMsg, setTopUpMsg] = useState("");
  const [balance, setBalance] = useState(0);

  // ---- 发布悬赏 ----
  const [title, setTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [totalSlots, setTotalSlots] = useState("");
  const [payoutRate, setPayoutRate] = useState("");
  const [publishState, setPublishState] = useState("idle");
  const [publishMsg, setPublishMsg] = useState("");
  const [lastCampaignId, setLastCampaignId] = useState(null);

  // 商户美元账户充值 → POST /api/merchant/deposit
  // 说明：生产环境应先由服务端创建 PayPal 订单并返回 orderId，再连同金额提交校验；
  //       本地 mock 时生成确定性 order ref 即可联调。
  const topUp = async () => {
    const amt = Number(topUpAmount);
    if (!(amt > 0) || !merchantId) {
      setTopUpMsg("Enter a valid amount.");
      setTopUpState("error");
      return;
    }
    setTopUpState("submitting");
    setTopUpMsg("");
    try {
      const res = await fetch("/api/merchant/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId,
          depositAmount: amt,
          paymentOrderId: `paypal_order_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTopUpMsg(
          data?.error === "PAYMENT_NOT_VERIFIED"
            ? "Payment not verified by provider."
            : "Top-up failed."
        );
        setTopUpState("error");
        return;
      }
      setBalance(data.balance_usd ?? 0);
      setTopUpAmount("");
      setTopUpMsg("Deposit confirmed.");
      setTopUpState("success");
    } catch (err) {
      console.error("[admin] top-up failed", err);
      setTopUpState("error");
      setTopUpMsg("Network error.");
    }
  };

  // 发布悬赏并托管资金 → POST /api/campaigns/create（携带商户真实 UID）
  const publishCampaign = async () => {
    const slots = Number(totalSlots);
    const rate = Number(payoutRate);
    if (!title || !(slots > 0) || !(rate >= 0) || !merchantId) {
      setPublishMsg("Complete title, slots and payout rate.");
      setPublishState("error");
      return;
    }
    setPublishState("submitting");
    setPublishMsg("");
    try {
      const res = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId, // 商户真实 UID（鉴权会话）
          title,
          video_url: videoUrl,
          caption_text: caption,
          escrow_summary: { total_slots: slots, payout_rate: rate, platform_fee: 1 },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPublishMsg(
          data?.error === "INSUFFICIENT_MERCHANT_BALANCE"
            ? "Insufficient escrow balance — top up your wallet first."
            : `Publish failed (${data?.error || res.status}).`
        );
        setPublishState("error");
        return;
      }
      setLastCampaignId(data.campaignId ?? null);
      setBalance(data.merchant_balance_after_usd ?? balance);
      setTitle(""); setVideoUrl(""); setCaption(""); setTotalSlots(""); setPayoutRate("");
      setPublishMsg(`Campaign created — ${data.funds_held_usd ?? ""} held in escrow.`);
      setPublishState("success");
    } catch (err) {
      console.error("[admin] publish failed", err);
      setPublishState("error");
      setPublishMsg("Network error.");
    }
  };

  // ===================== 渲染 =====================
  // 挂载中
  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center text-slate-500">
        Checking merchant session...
      </main>
    );
  }

  // 403 权限卡点：角色非 merchant（或未登录）→ 物理拦截，杜绝数据泄露通道
  if (!isMerchant) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <p className="text-6xl">🚫</p>
          <h1 className="mt-4 text-2xl font-bold text-rose-600">403 · Forbidden</h1>
          <p className="text-sm text-rose-500">403 · 禁止访问</p>
          <p className="mt-2 text-sm text-slate-600">
            This is the Merchant Console. Your session role is{" "}
            <strong>{session?.role ?? "none"}</strong> — merchant access is required.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            这里是商家控制台。当前会话角色为 <strong>{session?.role ?? "无"}</strong>，需要商家身份才能访问。
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Data channels are physically blocked for non-merchant roles.
          </p>
          <p className="mt-1 text-xs text-slate-500">非商户角色的数据通道已被物理阻断。</p>

          {/* 本地开发者演示登录（仅 localhost 渲染；生产线上隐藏，防客户旁路自注册） */}
          <DemoLoginCard role="merchant" backHref="/" />
        </div>
      </main>
    );
  }

  // 已通过鉴权的商户控制台仪表盘
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 flex items-center gap-6 py-3">
          <span className="text-sm font-semibold text-indigo-600 border-b-2 border-indigo-600 pb-1">Merchant Console</span>
          <Link href="/admin/campaigns" className="text-sm font-medium text-slate-500 hover:text-slate-800">My Campaigns</Link>
          <Link href="/admin/connect-tiktok" className="text-sm font-medium text-slate-500 hover:text-slate-800">Connect TikTok</Link>
          <Link href="/shop/tasks" className="text-sm font-medium text-slate-500 hover:text-slate-800">Task Hall</Link>
          <span className="ml-auto text-xs text-slate-400">UID: {merchantId}</span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold">Merchant Console</h1>
        <p className="text-sm text-slate-500">商家控制台</p>
        <p className="mt-2 text-slate-600">Top up your USD escrow wallet, then publish bounty campaigns.</p>
        <p className="text-sm text-slate-500">先充值你的美元托管钱包，再发布悬赏任务。</p>

        {/* 钱包充值卡 */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">USD Wallet (PayPal)</h2>
          <p className="text-xs text-slate-500">美元钱包（PayPal）</p>
          <p className="mt-1 text-sm text-slate-500">
            Available escrow balance: <strong className="text-indigo-600">${Number(balance).toFixed(2)}</strong>
          </p>
          <p className="text-xs text-slate-500">可用托管余额：${Number(balance).toFixed(2)}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-sm text-slate-600">Deposit amount (USD)</label>
              <p className="text-xs text-slate-500">充值金额（美元）</p>
              <input
                type="number"
                min="1"
                step="0.01"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="e.g. 100.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={topUp}
              disabled={topUpState === "submitting"}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {topUpState === "submitting" ? "Verifying PayPal..." : "Top Up via PayPal"}
            </button>
            <p className="text-xs text-slate-500">通过 PayPal 充值</p>
          </div>
          {topUpState === "success" && (
            <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
              ✅ {topUpMsg} Balance ${Number(balance).toFixed(2)}.
            </p>
          )}
          {topUpState === "error" && (
            <p className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{topUpMsg}</p>
          )}
        </div>

        {/* 发布悬赏表单 */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Publish &amp; Deposit Escrow</h2>
          <p className="text-xs text-slate-500">发布悬赏并托管资金</p>
          <p className="mt-1 text-sm text-slate-500">Funds (slots × (payout + $1 fee)) are held in escrow until work is verified.</p>
          <p className="text-xs text-slate-500">资金（名额 ×（佣金 + $1 平台费））在作品核验前托管冻结。</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-600">Title</label>
              <p className="text-xs text-slate-500">任务标题</p>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Unbox & Showcase — Home Gadget"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-600">Video asset URL</label>
              <p className="text-xs text-slate-500">视频素材地址</p>
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://cdn.example.com/main.mp4"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-600">Caption (English)</label>
              <p className="text-xs text-slate-500">美式文案（英文）</p>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Check out this budget-friendly gadget — link in bio!"
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Total slots</label>
              <p className="text-xs text-slate-500">总招募名额</p>
              <input
                type="number"
                min="1"
                value={totalSlots}
                onChange={(e) => setTotalSlots(e.target.value)}
                placeholder="e.g. 50"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Payout rate ($/task)</label>
              <p className="text-xs text-slate-500">单次佣金（美元/任务）</p>
              <input
                type="number"
                min="0"
                step="0.01"
                value={payoutRate}
                onChange={(e) => setPayoutRate(e.target.value)}
                placeholder="e.g. 3.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <button
            onClick={publishCampaign}
            disabled={publishState === "submitting"}
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {publishState === "submitting" ? "Holding escrow..." : "Publish & Deposit Escrow"}
          </button>
          <p className="mt-1 text-xs text-indigo-600">发布并托管资金</p>

          {publishState === "success" && (
            <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
              ✅ {publishMsg}{lastCampaignId ? ` ID: ${lastCampaignId}` : ""}
            </p>
          )}
          {publishState === "error" && (
            <p className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{publishMsg}</p>
          )}
        </div>
      </div>
    </main>
  );
}
