// src/app/admin/page.jsx
// ==========================================================================
// G-CrowdBang / F-CrowdBang · A端商户控制台（React + Tailwind, Client Component）
// --------------------------------------------------------------------------
// 职责：
//   1) 双角色鉴权卡点：挂载时经 useAuthSession 校验角色，非 'merchant' 物理拦截(403)。
//   2) 商户美元账户充值（PayPal 服务端订单创建/校验后入账）。
//   3) 本地选择视频上传发布悬赏（Publish & Deposit Escrow · 零绑定手动分发模式）：
//       - 目标账号手动输入框（target_tiktok_account，如 @fv138888，无 OAuth 绑定）
//       - 本地视频上传 <input type="file" accept="video/mp4">
//       - 任务文案大输入框（caption_text）
//       - 通过标准 fetch 提交 /api/campaigns/create，载荷含 merchantId + 手动目标账号 + 视频文件名 + 文案
// 合规：标准鉴权 + PayPal 支付校验 + 托管入账；不含任何规避逻辑。
// ==========================================================================
"use client";

import { useState, useRef, useEffect } from "react";
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

  // ---- 发布悬赏（本地视频上传 · 零绑定手动分发）----
  const [targetAccount, setTargetAccount] = useState(""); // 可选：目标发布账号（如 @fv138888；UGC 模式不再强制）
  const [brandHashtag, setBrandHashtag] = useState(""); // 品牌话题（UGC：老外创作时带上，统一裂变流量）
  const [contentBrief, setContentBrief] = useState(""); // 内容要求/创作指引（UGC 核心）
  const [videoFile, setVideoFile] = useState(null); // 选中的本地 mp4 文件对象
  const [caption, setCaption] = useState(""); // 引流带货文案（caption_text）
  const [totalSlots, setTotalSlots] = useState("");
  const [payoutRate, setPayoutRate] = useState("");
  const [auditHours, setAuditHours] = useState("48"); // 人工核验超时自动放行窗口（小时），默认 48h
  const [publishState, setPublishState] = useState("idle");
  const [publishMsg, setPublishMsg] = useState("");
  const [lastCampaignId, setLastCampaignId] = useState(null);
  const fileInputRef = useRef(null);

  // ---- 订阅收费（方案 B：固定月订阅）----
  const [planState, setPlanState] = useState("idle"); // idle|submitting|success|error
  const [planMsg, setPlanMsg] = useState("");
  const [activePlan, setActivePlan] = useState(null);

  // ---- 挂载时加载商户可用托管余额（GET /api/merchant/balance）----
  // 修复：充值后的余额存在 merchants/<merchantId>.balance_usd，页面初始加载需主动拉取，
  //       避免刷新后误显示 $0.00。
  useEffect(() => {
    if (!merchantId) return;
    let cancelled = false;
    fetch(`/api/merchant/balance?merchantId=${encodeURIComponent(merchantId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setBalance(Number(d.balance_usd ?? 0));
      })
      .catch((err) => console.error("[admin] load balance failed", err));
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  // ---- 商户美元账户充值 → POST /api/merchant/deposit ----
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
          data?.error === "PAYMENT_NOT_VERIFIED" ? "Payment not verified by provider." : "Top-up failed."
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

  // 本地选中的视频文件名（默认锁定 888.mp4，便于本地 /assets 直接播放）
  const selectedVideoName = videoFile?.name || "888.mp4";

  // ---- 激活订阅套餐 → POST /api/subscription/create（方案 B 平台收入来源之一）----
  const activatePlan = async (plan) => {
    if (!merchantId) {
      setPlanMsg("You must be signed in as a merchant.");
      setPlanState("error");
      return;
    }
    setPlanState("submitting");
    setPlanMsg("");
    try {
      const res = await fetch("/api/subscription/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId,
          plan,
          paymentOrderId: plan === "pro" || plan === "enterprise" ? `paypal_order_${Date.now()}` : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlanMsg(`Subscription failed (${data?.error || res.status}).`);
        setPlanState("error");
        return;
      }
      setActivePlan(data.plan_name);
      setPlanMsg(`✅ ${data.plan_name} active — renews ${data.renews_at.slice(0, 10)}. 订阅已生效。`);
      setPlanState("success");
    } catch (err) {
      console.error("[admin] subscription failed", err);
      setPlanState("error");
      setPlanMsg("Network error.");
    }
  };

  // 发布悬赏并托管资金 → POST /api/campaigns/create（携带商户真实 UID）
  const publishCampaign = async () => {
    const slots = Number(totalSlots);
    const rate = Number(payoutRate);
    if (!merchantId) {
      setPublishMsg("You must be signed in as a merchant.");
      setPublishState("error");
      return;
    }
    if (!(slots > 0) || !(rate >= 0)) {
      setPublishMsg("Complete slots and payout rate.");
      setPublishState("error");
      return;
    }
    if (!caption.trim()) {
      setPublishMsg("Enter a caption text.");
      setPublishState("error");
      return;
    }
    // UGC 模式：目标发布账号为可选（不再强制）；老外发到自己的账号，按品牌话题/内容要求创作。
    // 建议填写品牌话题，以统一流量打点与对账。

    setPublishState("submitting");
    setPublishMsg("Uploading video asset... 正在上传视频素材...");
    try {
      // 真上传：把商户本地选中的视频文件 POST 到 /api/upload（生产=Vercel Blob 永久 CDN，
      // 本地=public/uploads），拿回真实可访问 URL 作为 campaign.video_url，
      // 这样老外端播放的就是商户真正上传的视频，而不是固定 demo。
      let videoUrl;
      if (videoFile) {
        const fd = new FormData();
        fd.append("file", videoFile);
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        const upData = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
          throw new Error(upData?.error || "UPLOAD_FAILED");
        }
        videoUrl = upData.url;
      } else {
        // 未选文件时回退到固定 demo（仅占位；商户实际应选择本地视频上传）
        videoUrl = `/assets/${selectedVideoName}`;
      }
      const captionText = caption.trim();
      // title 由文案首行截断自动生成（后端必填）
      const title = caption.trim().split("\n")[0].slice(0, 40) || `${selectedVideoName} Bounty`;

      const res = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId, // 商户真实 UID（鉴权会话）
          title,
          video_url: videoUrl,
          caption_text: captionText,
          target_account: targetAccount, // 可选目标发布号（UGC 模式非核心锚点）
          brand_hashtag: brandHashtag, // 品牌话题（UGC：老外创作时带上）
          content_brief: contentBrief, // 内容要求/创作指引（UGC 核心）
          target_hashtags: [],
          geotargeting_config: { enabled: false },
          escrow_summary: { total_slots: slots, payout_rate: rate, platform_fee: 1 },
          audit_strategy: { mode: "manual", auto_approve_after_hours: Number(auditHours) > 0 ? Number(auditHours) : 48 },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPublishMsg(
          data?.error === "INSUFFICIENT_MERCHANT_BALANCE"
            ? "Insufficient escrow balance — top up your wallet first. / 托管余额不足，请先充值。"
            : `Publish failed (${data?.error || res.status}).`
        );
        setPublishState("error");
        return;
      }
      setLastCampaignId(data.campaignId ?? null);
      setBalance(data.merchant_balance_after_usd ?? balance);
      setVideoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setCaption("");
      setTotalSlots("");
      setPayoutRate("");
      setPublishMsg(
        `✅ Campaign created — ${data.funds_held_usd ?? ""} held in escrow. 老外端刷新 /shop/tasks 即可看到该任务。`
      );
      setPublishState("success");
    } catch (err) {
      console.error("[admin] publish failed", err);
      setPublishState("error");
      setPublishMsg(err?.message ? `Publish failed: ${err.message}.` : "Network error.");
    }
  };

  // ===================== 渲染 =====================
  // 挂载中
  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 grid place-items-center text-slate-500">
        Checking merchant session...
      </main>
    );
  }

  // 403 权限卡点：角色非 merchant（或未登录）→ 物理拦截
  if (!isMerchant) {
    return (
      <main className="min-h-screen bg-gray-950 grid place-items-center p-6 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-rose-800 bg-gray-900 p-8 text-center shadow-[0_0_30px_rgba(244,63,94,0.15)]">
          <p className="text-6xl">🚫</p>
          <h1 className="mt-4 text-2xl font-bold text-rose-500">403 · Forbidden</h1>
          <p className="text-sm text-rose-400">403 · 禁止访问</p>
          <p className="mt-2 text-sm text-slate-400">
            This is the Merchant Console. Your session role is{" "}
            <strong>{session?.role ?? "none"}</strong> — merchant access is required.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            这里是商家控制台。当前会话角色为 <strong>{session?.role ?? "无"}</strong>，需要商家身份才能访问。
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Data channels are physically blocked for non-merchant roles.
          </p>
          <DemoLoginCard role="merchant" backHref="/" />
        </div>
      </main>
    );
  }

  // 已通过鉴权的商户控制台仪表盘（暗黑微光科技感）
  return (
    <main className="min-h-screen bg-gray-950 text-slate-100">
      {/* 顶部导航 */}
      <nav className="border-b border-gray-800 bg-gray-900/70 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 flex items-center gap-6 py-3">
          <span className="text-sm font-semibold text-purple-400 border-b-2 border-purple-400 pb-1">
            Merchant Console
          </span>
          <Link href="/admin/campaigns" className="text-sm font-medium text-slate-400 hover:text-slate-200">My Campaigns</Link>
          <Link href="/admin/audits" className="text-sm font-medium text-amber-300 hover:text-amber-200">Audit Console</Link>
          <Link href="/shop/tasks" className="text-sm font-medium text-slate-400 hover:text-slate-200">Task Hall</Link>
          <span className="ml-auto text-xs text-slate-500">UID: {merchantId}</span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Merchant Console</h1>
        <p className="text-sm text-slate-500">商家控制台</p>
        <p className="mt-2 text-slate-400">Top up your USD escrow wallet, then publish bounty campaigns.</p>
        <p className="text-sm text-slate-500">先充值你的美元托管钱包，再发布悬赏任务。</p>

        {/* 钱包充值卡 */}
        <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm">
          <h2 className="font-semibold text-slate-200">USD Wallet (PayPal)</h2>
          <p className="text-xs text-slate-500">美元钱包（PayPal）</p>
          <p className="mt-1 text-sm text-slate-400">
            Available escrow balance: <strong className="text-emerald-400">${Number(balance).toFixed(2)}</strong>
          </p>
          <p className="text-xs text-slate-500">可用托管余额：${Number(balance).toFixed(2)}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-sm text-slate-300">Deposit amount (USD)</label>
              <p className="text-xs text-slate-500">充值金额（美元）</p>
              <input
                type="number"
                min="1"
                step="0.01"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="e.g. 100.00"
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <button
              onClick={topUp}
              disabled={topUpState === "submitting"}
              className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-all"
            >
              {topUpState === "submitting" ? "Verifying PayPal..." : "Top Up via PayPal"}
            </button>
            <p className="text-xs text-slate-500">通过 PayPal 充值</p>
          </div>
          {topUpState === "success" && (
            <p className="mt-3 rounded-xl bg-emerald-950 border border-emerald-800 p-3 text-sm text-emerald-400">
              ✅ {topUpMsg} Balance ${Number(balance).toFixed(2)}.
            </p>
          )}
          {topUpState === "error" && (
            <p className="mt-3 rounded-xl bg-rose-950 border border-rose-800 p-3 text-sm text-rose-400">{topUpMsg}</p>
          )}
        </div>

        {/* 订阅收费卡（方案 B：平台固定月订阅） */}
        <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm">
          <h2 className="font-semibold text-slate-200">Subscription Plans</h2>
          <p className="text-xs text-slate-500">订阅套餐（平台固定月费收入之一）</p>
          <p className="mt-1 text-sm text-slate-400">
            {activePlan
              ? <>Active plan: <strong className="text-emerald-400">{activePlan}</strong>. 当前生效套餐。</>
              : "Pick a plan to activate recurring access and priority distribution."}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              onClick={() => activatePlan("starter")}
              disabled={planState === "submitting"}
              className="rounded-xl border border-gray-700 bg-slate-800 p-4 text-left hover:border-purple-500 disabled:opacity-50 transition-all"
            >
              <p className="font-semibold text-slate-100">Starter</p>
              <p className="text-xs text-slate-500">免费 · 10 tasks/月</p>
              <p className="mt-2 text-sm font-bold text-slate-200">$0</p>
            </button>
            <button
              onClick={() => activatePlan("pro")}
              disabled={planState === "submitting"}
              className="rounded-xl border border-purple-600 bg-purple-900/20 p-4 text-left hover:bg-purple-900/40 disabled:opacity-50 transition-all"
            >
              <p className="font-semibold text-purple-300">Pro</p>
              <p className="text-xs text-slate-400">无限任务 · 优先分发</p>
              <p className="mt-2 text-sm font-bold text-purple-300">$99 / 月</p>
            </button>
            <button
              onClick={() => activatePlan("enterprise")}
              disabled={planState === "submitting"}
              className="rounded-xl border border-gray-700 bg-slate-800 p-4 text-left hover:border-purple-500 disabled:opacity-50 transition-all"
            >
              <p className="font-semibold text-slate-100">Enterprise</p>
              <p className="text-xs text-slate-500">专属客服 · 自定义核验窗口</p>
              <p className="mt-2 text-sm font-bold text-slate-200">$299 / 月</p>
            </button>
          </div>
          {planState === "success" && (
            <p className="mt-3 rounded-xl bg-emerald-950 border border-emerald-800 p-3 text-sm text-emerald-400">{planMsg}</p>
          )}
          {planState === "error" && (
            <p className="mt-3 rounded-xl bg-rose-950 border border-rose-800 p-3 text-sm text-rose-400">{planMsg}</p>
          )}
        </div>

        {/* 发布悬赏表单（本地视频上传） */}
        <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm">
          <h2 className="font-semibold text-slate-200">Publish &amp; Deposit Escrow</h2>
          <p className="text-xs text-slate-500">发布悬赏并托管资金</p>
          <p className="mt-1 text-sm text-slate-400">
            Funds (slots × (payout + platform fee)) are held in escrow until work is verified.
          </p>
          <p className="text-xs text-slate-500">资金（名额 ×（佣金 + 平台服务费））在作品核验前托管冻结。</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* 1) 品牌话题 + 内容要求 + 目标账号（UGC 模式：前两者为核心，目标账号可选） */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-300">Brand Hashtag</label>
              <p className="text-xs text-slate-500">品牌话题（老外在自己账号创作时带上，统一流量打点，如 #HomeTech）</p>
              <input
                type="text"
                value={brandHashtag}
                onChange={(e) => setBrandHashtag(e.target.value)}
                placeholder="例如: #HomeTech"
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-300">Content Brief</label>
              <p className="text-xs text-slate-500">内容要求 / 创作指引（告诉老外拍什么、怎么拍，让内容真实自然，英文）</p>
              <textarea
                value={contentBrief}
                onChange={(e) => setContentBrief(e.target.value)}
                placeholder="e.g. Film a real unboxing of this gadget on your own account, show it in your daily setup, and add #HomeTech. Keep it honest and natural."
                rows={3}
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-300">Target TikTok Account（可选）</label>
              <p className="text-xs text-slate-500">可选：目标发布账号（如 @fv138888）。不填时老外直接发布到自己的账号即可。</p>
              <input
                type="text"
                value={targetAccount}
                onChange={(e) => setTargetAccount(e.target.value)}
                placeholder="可选: @fv138888"
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* 2) 本地视频上传控件 */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-300">Local Video Asset</label>
              <p className="text-xs text-slate-500">本地视频素材（点击选择桌面 888.mp4）</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-purple-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-purple-500"
              />
              <p className="mt-1 text-xs text-emerald-500">
                Selected: {selectedVideoName} → {`/assets/${selectedVideoName}`}
              </p>
            </div>

            {/* 3) 任务文案大输入框 */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-300">Caption (English)</label>
              <p className="text-xs text-slate-500">美式引流带货文案与标签（英文）</p>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Check out this budget-friendly gadget — link in bio! #tech #gadgets"
                rows={3}
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* 托管资金参数（后端强校验必需） */}
            <div>
              <label className="block text-sm text-slate-300">Total slots</label>
              <p className="text-xs text-slate-500">总招募名额</p>
              <input
                type="number"
                min="1"
                value={totalSlots}
                onChange={(e) => setTotalSlots(e.target.value)}
                placeholder="e.g. 50"
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300">Payout rate ($/task)</label>
              <p className="text-xs text-slate-500">单次佣金（美元/任务）</p>
              <input
                type="number"
                min="0"
                step="0.01"
                value={payoutRate}
                onChange={(e) => setPayoutRate(e.target.value)}
                placeholder="e.g. 3.00"
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* 人工核验超时自动放行窗口（小时）：商家不点核验时，到期系统自动放行分账 */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-300">Auto-approve window (hours)</label>
              <p className="text-xs text-slate-500">核验超时自动放行窗口（小时）——商家不点核验，到期系统自动结算</p>
              <input
                type="number"
                min="1"
                value={auditHours}
                onChange={(e) => setAuditHours(e.target.value)}
                placeholder="e.g. 48"
                className="mt-1 w-full rounded-xl bg-slate-800 border border-gray-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                老外提交完工链接后，此窗口内你可手动拒付；超时未操作 → 系统自动放行分账（按任务设定的佣金与服务费）。
              </p>
            </div>
          </div>

          <button
            onClick={publishCampaign}
            disabled={publishState === "submitting"}
            className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-bold text-white transition-all duration-200 active:scale-[0.99] ${
              publishState === "submitting"
                ? "bg-purple-800 cursor-wait"
                : "bg-purple-600 hover:bg-purple-500 shadow-[0_0_18px_rgba(168,85,247,0.35)]"
            }`}
          >
            {publishState === "submitting" ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Holding escrow &amp; creating campaign...
              </span>
            ) : (
              "Publish & Deposit Escrow"
            )}
          </button>
          <p className="mt-1 text-xs text-purple-400">发布并托管资金（提交后老外端刷新 /shop/tasks 立即可见）</p>

          {publishState === "success" && (
            <p className="mt-3 rounded-xl bg-emerald-950 border border-emerald-800 p-3 text-sm text-emerald-400">
              ✅ {publishMsg}
              {lastCampaignId ? ` ID: ${lastCampaignId}` : ""}
            </p>
          )}
          {publishState === "error" && (
            <p className="mt-3 rounded-xl bg-rose-950 border border-rose-800 p-3 text-sm text-rose-400">{publishMsg}</p>
          )}
        </div>
      </div>
    </main>
  );
}
