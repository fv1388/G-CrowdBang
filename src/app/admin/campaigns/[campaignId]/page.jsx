// src/app/admin/campaigns/[campaignId]/page.jsx
// G-CrowdBang · A端商户任务核验审计明细页（React + Tailwind）
// 通过 ?campaignId 展示该任务下的 submissions：接单人、GPS坐标、核验状态、佣金。
// 数据来自 GET /api/admin/submissions?campaignId=...
"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

export default function AuditPage({ params }) {
  const { campaignId } = use(params);
  const [subs, setSubs] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/submissions?campaignId=${encodeURIComponent(campaignId)}`);
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSubs(data.submissions ?? []);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[admin/audit] load failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

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
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/admin/campaigns" className="text-sm text-slate-500 hover:text-slate-700">
          ← Back to campaigns
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Audit · {campaignId}</h1>
        <p className="mt-2 text-slate-600">
          Review each claim's GPS telemetry and verification status before releasing payout.
        </p>

        {loadState === "loading" && <p className="mt-6 text-slate-500">Loading submissions...</p>}
        {loadState === "error" && (
          <p className="mt-6 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
            Submissions are temporarily unavailable.
          </p>
        )}
        {loadState === "ok" && subs.length === 0 && (
          <p className="mt-6 text-slate-500">No claims yet for this campaign.</p>
        )}

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3">GPS (lat, lng)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payout</th>
                <th className="px-4 py-3">Claimed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subs.map((s) => (
                <tr key={s.submissionId}>
                  <td className="px-4 py-3 font-medium">{s.workerId}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {typeof s.latitude === "number" ? `${s.latitude.toFixed(4)}, ${s.longitude?.toFixed(4)}` : "—"}
                    <span className="ml-1 text-xs text-slate-400">(±{s.accuracy ?? "?"}m)</span>
                  </td>
                  <td className="px-4 py-3">{statusBadge(s.status)}</td>
                  <td className="px-4 py-3 text-slate-600">{s.payout}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.claimedAt ? new Date(s.claimedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
