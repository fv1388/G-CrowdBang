// src/app/admin/audits/page.jsx
// G-CrowdBang / F-CrowdBang · 商家核验面板（App Router Client Component）
// --------------------------------------------------------------------------
// 职责：列出当前商户名下所有 PENDING_AUDIT 待人工核验对账单，
//       显示目标账号、老外回填的完工链接、截图、worker、以及"超时自动放行"倒计时；
//       商家肉眼核验后，一键【放行 / 拒付】（调 POST /api/tasks/manual-verify）。
// 鉴权：仅 MERCHANT 可进入，否则 403 卡点拦截。
// 暗黑科技风：与商家控制台 /admin 保持一致。
// --------------------------------------------------------------------------
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthSession } from "@/database/auth";

// 目标发布平台显示标签（多平台 UGC）
const PLATFORM_LABEL = { tiktok: "TikTok", youtube: "YouTube Shorts", instagram: "Instagram Reels", facebook: "Facebook Reels", x: "X (Twitter)" };

export default function AdminAuditsPage() {
  const { session, loading } = useAuthSession();

  const [audits, setAudits] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [noteBySub, setNoteBySub] = useState({});

  // 鉴权卡点：仅 MERCHANT 可访问（render 派生，避免 effect 内同步 setState）
  const denied = !loading && session?.role?.toUpperCase() !== "MERCHANT";

  // 拉取待核验对账列表
  const load = async () => {
    setFetching(true);
    try {
      const res = await fetch(`/api/admin/audits?merchantId=${encodeURIComponent(session?.uid || "")}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      setAudits(j.audits || []);
      setMsg(null);
    } catch (e) {
      setMsg({ type: "error", text: `加载失败：${e.message}` });
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    // 首次挂载且角色就绪后拉取待核验列表；setState 均在异步回调内
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    load();
  }, [session?.uid]);

  // 放行 / 拒付
  const decide = async (submissionId, decision) => {
    if (decision === "rework" && !(noteBySub[submissionId] || "").trim()) {
      setMsg({ type: "error", text: "返工需要填写退回原因，请先在下方输入原因。" });
      return;
    }
    setBusyId(submissionId);
    setMsg(null);
    try {
      const res = await fetch("/api/tasks/manual-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          merchantId: session?.uid || process.env.NEXT_PUBLIC_MERCHANT_ID || "mch_placeholder",
          decision,
          note: (noteBySub[submissionId] || "").trim() || (decision === "approve" ? "Merchant manual approve" : "Merchant manual reject"),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      const row = audits.find((x) => x.submissionId === submissionId);
      const payout = Number(row?.payout ?? 3).toFixed(2);
      const fee = Number(row?.platformFee ?? 4).toFixed(2);
      setMsg({
        type: "success",
        text:
          decision === "approve"
            ? `已放行：老外 +$${payout}、平台 +$${fee}`
            : decision === "rework"
              ? `已退回返工：等待老外重新提交`
              : `已拒付：状态置为 rejected`,
      });
      load();
    } catch (e) {
      setMsg({ type: "error", text: `操作失败：${e.message}` });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-700">
        ⏳ Loading merchant audit console...
      </div>
    );
  }

  if (denied) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center text-center px-6">
        <div className="text-7xl font-black text-slate-700 mb-4">403</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Access Denied · 商户专属权限越界</h1>
        <p className="text-gray-600 mb-6">此核验面板仅限商户（MERCHANT）身份访问。</p>
        <Link
          href="/admin"
          className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2 text-white font-semibold transition"
        >
          ← Back to Console
        </Link>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="text-sm font-medium text-gray-500 hover:text-gray-800">← Home · 返回首页</Link>
        {/* 顶部栏 */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Audit Console · 人工核验面板</h1>
            <p className="text-sm text-gray-600">
              肉眼核验老外回填的完工链接是否已发布到目标账号，再一键放行 / 拒付。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              disabled={fetching}
              className="rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-300 px-4 py-2 text-sm font-semibold transition disabled:opacity-50"
            >
              {fetching ? "⏳ 刷新中..." : "↻ 刷新"}
            </button>
            <Link
              href="/admin"
              className="rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold transition"
            >
              ← Console
            </Link>
          </div>
        </div>

        {msg && (
          <div
            className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${
              msg.type === "success"
                ? "bg-emerald-900/40 border border-emerald-700 text-emerald-200"
                : "bg-red-900/40 border border-red-700 text-red-200"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* 待核验列表 */}
        {fetching ? (
          <div className="rounded-xl bg-white border border-gray-200 p-10 text-center text-gray-600">
            ⏳ Loading pending audits...
          </div>
        ) : audits.length === 0 ? (
          <div className="rounded-xl bg-white border border-gray-200 p-10 text-center">
            <p className="text-gray-700 font-semibold">暂无待核验对账</p>
            <p className="text-gray-500 text-sm mt-1">
              老外提交完工链接后，会出现在这里等你核验。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {audits.map((a) => (
              <div
                key={a.submissionId}
                className="rounded-2xl bg-white border border-gray-300 p-5 shadow-lg"
              >
                {/* 头部：目标账号 + 倒计时 */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-blue-900/50 border border-blue-700 text-blue-200 text-xs font-bold">
                      Target Account
                    </span>
                    <span className="font-mono text-sm text-blue-700">{a.targetAccount || "—"}</span>
                  </div>
                  <div className="text-right">
                    {a.remainingHours !== null ? (
                      a.remainingHours > 0 ? (
                        <span className="text-xs text-amber-700">
                          ⏱ {a.remainingHours}h 后自动放行 · 窗口内可拒付
                        </span>
                      ) : (
                        <span className="text-xs text-emerald-700">✓ 已超窗口，等待系统自动放行</span>
                      )
                    ) : (
                      <span className="text-xs text-gray-500">待提交完工链接</span>
                    )}
                  </div>
                </div>

                {/* 任务信息 */}
                <div className="text-xs text-gray-600 space-y-1 mb-3">
                  <div>任务：{a.campaignTitle || a.campaignId}</div>
                  {a.campaignType !== "video_post" && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-300 px-3 py-2 mt-1 space-y-0.5">
                      <div className="text-emerald-700 font-semibold">{a.campaignType === "product_sample" ? "📦 寄样带货任务" : "🎬 无样带货任务"}</div>
                      <div>平台：{PLATFORM_LABEL[a.platform] || a.platform || "TikTok"}</div>
                      {a.productName && <div>产品：{a.productName}</div>}
                      {a.brandTag && <div>标题@：{a.brandTag}</div>}
                      {a.commentLinkRequired && <div>要求：评论区挂商品链接</div>}
                      {a.shippingAddress && (
                        <div>📮 收货地址：{a.shippingAddress}</div>
                      )}
                    </div>
                  )}
                  {a.contentBrief && (
                    <div className="rounded-lg bg-gray-100 border border-gray-300 px-3 py-2 mt-1">
                      <div className="text-cyan-700 font-semibold">🎬 商家视频拍摄要求（验收清单）</div>
                      <div className="mt-1 whitespace-pre-wrap text-gray-700">{a.contentBrief}</div>
                    </div>
                  )}
                  <div>Worker：<span className="font-mono text-gray-700">{a.workerId}</span></div>
                  {a.latitude != null && (
                    <div>
                      GPS：{a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}
                    </div>
                  )}
                </div>

                {/* 完工证明：链接 + 截图 */}
                <div className="rounded-xl bg-gray-100 border border-gray-200 p-3 mb-3 space-y-2">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">完工证明 · Proof of work</div>
                  {a.publishedVideoUrl ? (
                    <a
                      href={a.publishedVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-cyan-700 hover:underline break-all"
                    >
                      🔗 {a.publishedVideoUrl}
                    </a>
                  ) : (
                    <div className="text-sm text-gray-500">⚠ 老外尚未回填发布链接</div>
                  )}
                  {a.screenshotFilename ? (
                    <div className="text-xs text-gray-600">📸 截图：{a.screenshotFilename}</div>
                  ) : null}
                </div>

                {/* 返工原因输入（需返工时必填） */}
                <div className="mb-2">
                  <input
                    type="text"
                    value={noteBySub[a.submissionId] || ""}
                    onChange={(e) => setNoteBySub((m) => ({ ...m, [a.submissionId]: e.target.value }))}
                    placeholder={`返工原因（例如：画质太糊 / 没按拍摄要求 / 未拍产品）· 已返工 ${Number(a.revisionCount ?? 0)} 次 / 上限 2 次`}
                    className="w-full rounded-lg bg-gray-50 border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                {/* 放行 / 需返工 / 拒付 */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => decide(a.submissionId, "approve")}
                    disabled={busyId === a.submissionId || !a.publishedVideoUrl}
                    className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed py-2.5 font-semibold transition"
                  >
                    {busyId === a.submissionId ? "⏳ 结算中..." : `✅ 放行（老外 +$${Number(a.payout ?? 10).toFixed(2)} / 平台 +$${Number(a.platformFee ?? 2).toFixed(2)}）`}
                  </button>
                  <button
                    onClick={() => decide(a.submissionId, "rework")}
                    disabled={busyId === a.submissionId}
                    className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 py-2.5 font-semibold transition"
                  >
                    {busyId === a.submissionId ? "⏳ 处理中..." : "🔁 需返工（重拍）"}
                  </button>
                  <button
                    onClick={() => decide(a.submissionId, "reject")}
                    disabled={busyId === a.submissionId}
                    className="flex-1 rounded-xl bg-red-700 hover:bg-red-600 disabled:opacity-40 py-2.5 font-semibold transition"
                  >
                    {busyId === a.submissionId ? "⏳ 处理中..." : "⛔ 拒付（保全托管）"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
