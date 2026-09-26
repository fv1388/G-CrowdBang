// src/app/admin/campaigns/page.jsx
// G-CrowdBang · A端商户任务对账看板（React + Tailwind）
// 展示当前商户自己发布的悬赏任务：托管名额消耗、佣金、核验进度。
// 数据来自 GET /api/admin/campaigns（服务端归属过滤，仅返回本商户任务）。
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function MerchantCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/campaigns");
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setCampaigns(data.campaigns ?? []);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[admin/campaigns] load failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">My Campaigns</h1>
            <p className="mt-2 text-slate-600">
              Audit your bounty tasks — slots consumed, payout rate, and verification progress.
            </p>
          </div>
          <Link
            href="/admin/campaigns/new"
            className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
          >
            + New Campaign
          </Link>
        </div>

        {loadState === "loading" && <p className="mt-8 text-slate-500">Loading campaigns...</p>}
        {loadState === "error" && (
          <p className="mt-8 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
            Campaigns are temporarily unavailable. Please try again shortly.
          </p>
        )}
        {loadState === "ok" && campaigns.length === 0 && (
          <p className="mt-8 text-slate-500">No campaigns yet — create your first bounty.</p>
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
                    <h2 className="font-semibold">{c.title}</h2>
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
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
