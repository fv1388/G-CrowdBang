// src/app/workers/page.jsx
// G-CrowdBang · B端 Worker 个人接单与收益工作台（React + Tailwind）
// 展示当前接单人自己的任务记录：核验状态、佣金结算、累计收益。
// 数据来自 GET /api/workers/my-submissions（服务端按 worker 归属过滤）。
"use client";

import { useEffect, useState } from "react";

export default function WorkerDashboard() {
  const [subs, setSubs] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/workers/my-submissions");
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSubs(data.submissions ?? []);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[workers] load submissions failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold">My Tasks &amp; Earnings</h1>
        <p className="mt-2 text-slate-600">
          Track the tasks you've claimed, their verification status, and your settled earnings.
        </p>

        {/* 收益卡片 */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Total settled earnings</p>
          <p className="mt-1 text-3xl font-bold text-emerald-600">${earnings.toFixed(2)}</p>
          <p className="mt-1 text-xs text-slate-400">$3.00 per verified task, paid to withdrawable balance.</p>
        </div>

        {loadState === "loading" && <p className="mt-6 text-slate-500">Loading your tasks...</p>}
        {loadState === "error" && (
          <p className="mt-6 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
            Your tasks are temporarily unavailable. Please try again shortly.
          </p>
        )}
        {loadState === "ok" && subs.length === 0 && (
          <p className="mt-6 text-slate-500">
            You haven't claimed any tasks yet — head to the task hall to get started.
          </p>
        )}

        <div className="mt-6 space-y-3">
          {subs.map((s) => (
            <div
              key={s.submissionId}
              className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="font-medium">{s.campaignId}</p>
                <p className="text-xs text-slate-400">
                  Claimed {s.claimedAt ? new Date(s.claimedAt).toLocaleString() : "—"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {statusBadge(s.status)}
                <span className="font-semibold text-emerald-600">
                  {s.status === "verified" ? "$3.00" : "$0.00"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
