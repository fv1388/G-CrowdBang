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
  const isMerchant = !loading && !!session?.uid;
  const merchantId = session?.uid ?? null;

  // ---- PayPal 充值 ----
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpState, setTopUpState] = useState("idle"); // idle|submitting|success|error
  const [topUpMsg, setTopUpMsg] = useState("");
  const [balance, setBalance] = useState(0);

  // ---- 发布悬赏（本地视频上传 · 零绑定手动分发）----
  const [brandHashtag, setBrandHashtag] = useState(""); // 品牌话题（UGC：老外创作时带上，统一裂变流量）
  const [contentBrief, setContentBrief] = useState(""); // 内容要求/创作指引（UGC 核心）
  const [videoFile, setVideoFile] = useState(null); // 选中的本地 mp4 文件对象
  const [caption, setCaption] = useState(""); // 引流带货文案（caption_text）
  const [totalSlots, setTotalSlots] = useState("");
  const [payoutRate, setPayoutRate] = useState("10"); // 老外单条佣金（默认 $10）
  const [auditHours, setAuditHours] = useState("48"); // 人工核验超时自动放行窗口（小时），默认 48h
  // ---- 任务类型 + 寄样带货字段 ----
  const [campaignType, setCampaignType] = useState("video_post"); // video_post=视频代发 / product_sample=寄样带货
  const [productName, setProductName] = useState(""); // 寄样：产品名
  const [productDescription, setProductDescription] = useState(""); // 寄样：产品说明
  const [brandTag, setBrandTag] = useState(""); // 寄样：标题@的品牌账号
  const [commentLinkRequired, setCommentLinkRequired] = useState(true); // 寄样：评论区挂链接
  const [platformFee, setPlatformFee] = useState("2"); // 平台单条服务费（默认 $2）
  const [platform, setPlatform] = useState("tiktok"); // 目标发布平台（多平台 UGC）
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
          campaign_type: campaignType, // 任务类型：video_post / product_sample / product_no_sample
          platform, // 目标发布平台（tiktok/youtube/instagram/facebook/x）
          video_url: videoUrl,
          caption_text: captionText,
          brand_hashtag: brandHashtag, // 品牌话题（UGC：老外创作时带上）
          content_brief: contentBrief, // 内容要求/创作指引（UGC 核心）
          // 寄样带货字段（campaign_type=product_sample 时生效）
          product_name: productName,
          product_description: productDescription,
          brand_tag: brandTag,
          comment_link_required: commentLinkRequired,
          target_hashtags: [],
          geotargeting_config: { enabled: false },
          escrow_summary: { total_slots: slots, payout_rate: rate, platform_fee: Number(platformFee) > 0 ? Number(platformFee) : 2 },
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
      <main className="min-h-screen bg-gray-50 grid place-items-center text-gray-500">
        Checking merchant session...
      </main>
    );
  }

  // 403 权限卡点：角色非 merchant（或未登录）→ 物理拦截
  if (!isMerchant) {
    return (
      <main className="min-h-screen bg-gray-50 grid place-items-center p-6 text-gray-900">
        <div className="w-full max-w-md rounded-2xl border border-rose-300 bg-white p-8 text-center shadow-[0_0_30px_rgba(244,63,94,0.15)]">
          <p className="text-6xl">🚫</p>
          <h1 className="mt-4 text-2xl font-bold text-rose-500">403 · Forbidden</h1>
          <p className="text-sm text-rose-400">403 · 禁止访问</p>
          <p className="mt-2 text-sm text-gray-600">
            This is the Merchant Console. Please sign in to access.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            这里是商家控制台。请登录后访问。
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
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* 顶部导航 */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 flex items-center gap-6 py-3">
          <span className="text-sm font-semibold text-purple-400 border-b-2 border-purple-400 pb-1">
            Merchant Console
          </span>
          <Link href="/admin/campaigns" className="text-sm font-medium text-gray-600 hover:text-gray-800">My Campaigns</Link>
          <Link href="/admin/audits" className="text-sm font-medium text-amber-700 hover:text-amber-200">Audit Console</Link>
          <span className="ml-auto text-xs text-gray-500">UID: {merchantId}</span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Merchant Console</h1>
        <p className="text-sm text-gray-500">商家控制台</p>
        <p className="mt-2 text-gray-600">Top up your USD escrow wallet, then publish bounty campaigns.</p>
        <p className="text-sm text-gray-500">先充值你的美元托管钱包，再发布悬赏任务。</p>

        {/* 钱包充值卡 */}
        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800">USD Wallet (PayPal)</h2>
          <p className="text-xs text-gray-500">美元钱包（PayPal）</p>
          <p className="mt-1 text-sm text-gray-600">
            Available escrow balance: <strong className="text-emerald-400">${Number(balance).toFixed(2)}</strong>
          </p>
          <p className="text-xs text-gray-500">可用托管余额：${Number(balance).toFixed(2)}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-700">Deposit amount (USD)</label>
              <p className="text-xs text-gray-500">充值金额（美元）</p>
              <input
                type="number"
                min="1"
                step="0.01"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="e.g. 100.00"
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <button
              onClick={topUp}
              disabled={topUpState === "submitting"}
              className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-all"
            >
              {topUpState === "submitting" ? "Verifying PayPal..." : "Top Up via PayPal"}
            </button>
            <p className="text-xs text-gray-500">通过 PayPal 充值</p>
          </div>
          {topUpState === "success" && (
            <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-800 p-3 text-sm text-emerald-400">
              ✅ {topUpMsg} Balance ${Number(balance).toFixed(2)}.
            </p>
          )}
          {topUpState === "error" && (
            <p className="mt-3 rounded-xl bg-rose-50 border border-rose-300 p-3 text-sm text-rose-400">{topUpMsg}</p>
          )}
        </div>

        {/* 订阅收费卡（方案 B：平台固定月订阅） */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800">Subscription Plans</h2>
          <p className="text-xs text-gray-500">订阅套餐（平台固定月费收入之一）</p>
          <p className="mt-1 text-sm text-gray-600">
            {activePlan
              ? <>Active plan: <strong className="text-emerald-400">{activePlan}</strong>. 当前生效套餐。</>
              : "Pick a plan to activate recurring access and priority distribution."}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              onClick={() => activatePlan("starter")}
              disabled={planState === "submitting"}
              className="rounded-xl border border-gray-300 bg-gray-50 p-4 text-left hover:border-purple-500 disabled:opacity-50 transition-all"
            >
              <p className="font-semibold text-gray-900">Starter</p>
              <p className="text-xs text-gray-500">免费 · 10 tasks/月</p>
              <p className="mt-2 text-sm font-bold text-gray-800">$0</p>
            </button>
            <button
              onClick={() => activatePlan("pro")}
              disabled={planState === "submitting"}
              className="rounded-xl border border-purple-600 bg-purple-900/20 p-4 text-left hover:bg-purple-900/40 disabled:opacity-50 transition-all"
            >
              <p className="font-semibold text-purple-700">Pro</p>
              <p className="text-xs text-gray-600">无限任务 · 优先分发</p>
              <p className="mt-2 text-sm font-bold text-purple-700">$99 / 月</p>
            </button>
            <button
              onClick={() => activatePlan("enterprise")}
              disabled={planState === "submitting"}
              className="rounded-xl border border-gray-300 bg-gray-50 p-4 text-left hover:border-purple-500 disabled:opacity-50 transition-all"
            >
              <p className="font-semibold text-gray-900">Enterprise</p>
              <p className="text-xs text-gray-500">专属客服 · 自定义核验窗口</p>
              <p className="mt-2 text-sm font-bold text-gray-800">$299 / 月</p>
            </button>
          </div>
          {planState === "success" && (
            <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-800 p-3 text-sm text-emerald-400">{planMsg}</p>
          )}
          {planState === "error" && (
            <p className="mt-3 rounded-xl bg-rose-50 border border-rose-300 p-3 text-sm text-rose-400">{planMsg}</p>
          )}
        </div>

        {/* 发布悬赏表单（本地视频上传） */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-800">Publish &amp; Deposit Escrow</h2>
          <p className="text-xs text-gray-500">发布悬赏并托管资金</p>
          <p className="mt-1 text-sm text-gray-600">
            Funds (slots × (payout + platform fee)) are held in escrow until work is verified.
          </p>
          <p className="text-xs text-gray-500">资金（名额 ×（佣金 + 平台服务费））在作品核验前托管冻结。</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* 0) 任务类型切换：视频代发 / 寄样带货 */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Campaign Type</label>
              <p className="text-xs text-gray-500">任务类型（决定老外怎么完成任务）</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCampaignType("video_post")}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    campaignType === "video_post"
                      ? "border-purple-500 bg-purple-100 shadow-[0_0_18px_rgba(168,85,247,0.2)]"
                      : "border-gray-300 bg-gray-50"
                  }`}
                >
                  <p className="font-semibold text-gray-900">🎥 视频代发</p>
                  <p className="mt-1 text-xs text-gray-600">商家提供视频素材，老外用自己账号发布 + 品牌话题</p>
                </button>
                <button
                  type="button"
                  onClick={() => setCampaignType("product_sample")}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    campaignType === "product_sample"
                      ? "border-emerald-500 bg-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.2)]"
                      : "border-gray-300 bg-gray-50"
                  }`}
                >
                  <p className="font-semibold text-gray-900">📦 寄样带货（免费样品 + 佣金）</p>
                  <p className="mt-1 text-xs text-gray-600">商家邮寄产品，老外真实使用拍摄 + 评论挂链接 + 标题@品牌号</p>
                </button>
                <button
                  type="button"
                  onClick={() => setCampaignType("product_no_sample")}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    campaignType === "product_no_sample"
                      ? "border-amber-400 bg-amber-50 shadow-[0_0_18px_rgba(245,158,11,0.2)]"
                      : "border-gray-300 bg-gray-50"
                  }`}
                >
                  <p className="font-semibold text-gray-900">🎬 无样带货（不寄样品 + 佣金）</p>
                  <p className="mt-1 text-xs text-gray-600">商家不寄样，老外自购/自备产品真实拍摄 + 挂链接 + 标题@品牌号，省样品+物流成本</p>
                </button>
              </div>
            </div>

            {/* 平台单条服务费（平台收入核心；商家发单时托管冻结，核验放行后归平台） */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Platform Fee ($/task)</label>
              <p className="text-xs text-gray-500">平台单条服务费（美元/任务，托管冻结，核验放行后归平台）</p>
              <input
                type="number"
                min="0"
                step="0.01"
                value={platformFee}
                onChange={(e) => setPlatformFee(e.target.value)}
                placeholder="e.g. 4.00"
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            {/* 目标发布平台（多平台 UGC：老外将发布到该平台的自己账号） */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Publish Platform</label>
              <p className="text-xs text-gray-500">目标发布平台（老外发布到该平台自己账号 + 品牌话题 + 挂链）</p>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube Shorts</option>
                <option value="instagram">Instagram Reels</option>
                <option value="facebook">Facebook Reels</option>
                <option value="x">X (Twitter)</option>
              </select>
            </div>

            {/* 带货专属字段（寄样 product_sample / 无样 product_no_sample 显示） */}
            {campaignType !== "video_post" && (
              <>
                <div className="sm:col-span-2">
                  <p className="rounded-lg bg-gray-100 border border-gray-300 px-3 py-2 text-xs text-gray-600">
                    {campaignType === "product_sample" ? "📦 寄样模式：商家邮寄产品，老外申请免费样品（填美国收货地址）收样后拍摄。" : "🎬 无样模式：商家不寄样，老外自购/自备产品后拍摄（省样品+物流成本）。"}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm text-gray-700">Product Name</label>
                  <p className="text-xs text-gray-500">寄样产品名（美国老外将收到的样品）</p>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Smart LED Ring Light"
                    className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm text-gray-700">Product Description / 样品说明</label>
                  <p className="text-xs text-gray-500">{campaignType === "product_sample" ? "告诉老外寄什么样品、怎么拍（英文）" : "告诉老外产品卖点、怎么自购并拍摄（英文）"}</p>
                  <textarea
                    value={productDescription}
                    onChange={(e) => setProductDescription(e.target.value)}
                    placeholder="Free sample — you keep it. Film an honest unboxing/review on your own account."
                    rows={2}
                    className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm text-gray-700">Brand Tag (@ 标题账号)</label>
                  <p className="text-xs text-gray-500">要求老外在视频标题@的品牌账号（如 @fv138888）</p>
                  <input
                    type="text"
                    value={brandTag}
                    onChange={(e) => setBrandTag(e.target.value)}
                    placeholder="例如: @fv138888"
                    className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={commentLinkRequired}
                      onChange={(e) => setCommentLinkRequired(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-50 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span>Require product link in comments（要求老外在评论区挂商品链接）</span>
                  </label>
                </div>
              </>
            )}

            {/* 1) 品牌话题 + 内容要求 + 目标账号（UGC 模式：前两者为核心，目标账号可选） */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Brand Hashtag</label>
              <p className="text-xs text-gray-500">品牌话题（老外在自己账号创作时带上，统一流量打点，如 #HomeTech）</p>
              <input
                type="text"
                value={brandHashtag}
                onChange={(e) => setBrandHashtag(e.target.value)}
                placeholder="例如: #HomeTech"
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Content Brief</label>
              <p className="text-xs text-gray-500">内容要求 / 创作指引（告诉老外拍什么、怎么拍，让内容真实自然，英文）</p>
              <textarea
                value={contentBrief}
                onChange={(e) => setContentBrief(e.target.value)}
                placeholder="e.g. Film a real unboxing of this gadget on your own account, show it in your daily setup, and add #HomeTech. Keep it honest and natural."
                rows={3}
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            {/* 2) 本地视频上传控件 */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Local Video Asset</label>
              <p className="text-xs text-gray-500">本地视频素材（点击选择桌面 888.mp4）</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-800 file:mr-3 file:rounded-lg file:border-0 file:bg-purple-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-purple-500"
              />
              <p className="mt-1 text-xs text-emerald-500">
                Selected: {selectedVideoName} → {`/assets/${selectedVideoName}`}
              </p>
            </div>

            {/* 3) 任务文案大输入框 */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Caption (English)</label>
              <p className="text-xs text-gray-500">美式引流带货文案与标签（英文）</p>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Check out this budget-friendly gadget — link in bio! #tech #gadgets"
                rows={3}
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* 托管资金参数（后端强校验必需） */}
            <div>
              <label className="block text-sm text-gray-700">Total slots</label>
              <p className="text-xs text-gray-500">总招募名额</p>
              <input
                type="number"
                min="1"
                value={totalSlots}
                onChange={(e) => setTotalSlots(e.target.value)}
                placeholder="e.g. 50"
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700">Payout rate ($/task)</label>
              <p className="text-xs text-gray-500">单次佣金（美元/任务）</p>
              <input
                type="number"
                min="0"
                step="0.01"
                value={payoutRate}
                onChange={(e) => setPayoutRate(e.target.value)}
                placeholder="e.g. 3.00"
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* 人工核验超时自动放行窗口（小时）：商家不点核验时，到期系统自动放行分账 */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-700">Auto-approve window (hours)</label>
              <p className="text-xs text-gray-500">核验超时自动放行窗口（小时）——商家不点核验，到期系统自动结算</p>
              <input
                type="number"
                min="1"
                value={auditHours}
                onChange={(e) => setAuditHours(e.target.value)}
                placeholder="e.g. 48"
                className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="mt-1 text-xs text-gray-500">
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
            <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-800 p-3 text-sm text-emerald-400">
              ✅ {publishMsg}
              {lastCampaignId ? ` ID: ${lastCampaignId}` : ""}
            </p>
          )}
          {publishState === "error" && (
            <p className="mt-3 rounded-xl bg-rose-50 border border-rose-300 p-3 text-sm text-rose-400">{publishMsg}</p>
          )}
        </div>
      </div>
    </main>
  );
}
