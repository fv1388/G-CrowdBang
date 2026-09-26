// src/app/admin/campaigns/new/page.jsx
// G-CrowdBang · A端商户创建悬赏任务表单（React + Tailwind）
// 面向出海电商卖家：设置任务内容、目标区域、托管名额与佣金。
// 纯前端表单，提交后 POST 到 /api/admin/campaigns 由服务端写 Firestore。
"use client";

import { useState } from "react";

export default function NewCampaignPage() {
  const [form, setForm] = useState({
    title: "",
    video_url: "",
    caption_text: "",
    target_hashtags: "",
    enabled: true,
    target_city: "",
    target_state: "",
    target_lat: "",
    target_lng: "",
    radius_km: "80",
    total_slots: "50",
    payout_rate: "3.0",
    platform_fee: "1.0",
  });
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [message, setMessage] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          video_url: form.video_url,
          caption_text: form.caption_text,
          target_hashtags: form.target_hashtags
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean),
          geotargeting_config: {
            enabled: form.enabled,
            target_city: form.target_city,
            target_state: form.target_state,
            target_lat: Number(form.target_lat) || null,
            target_lng: Number(form.target_lng) || null,
            radius_km: Number(form.radius_km) || 0,
          },
          escrow_summary: {
            total_slots: Number(form.total_slots) || 0,
            slots_used: 0,
            payout_rate: Number(form.payout_rate) || 0,
            platform_fee: Number(form.platform_fee) || 0,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `SERVER_ERROR_${res.status}`);
      setStatus("success");
      setMessage(`Campaign created: ${data.campaignId}`);
    } catch (err) {
      setStatus("error");
      setMessage(`Failed: ${err.message}`);
    }
  }

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const label = "block text-sm font-medium text-slate-700 mb-1";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold">Create a Bounty Campaign</h1>
        <p className="mt-2 text-slate-600">
          Set task content, target region, and escrow terms. Funds are held until work is verified.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* 任务内容 */}
          <div>
            <h2 className="font-semibold text-slate-800">Task Content</h2>
            <div className="mt-3 space-y-3">
              <div>
                <label className={label}>Title</label>
                <input className={field} value={form.title} onChange={set("title")} required />
              </div>
              <div>
                <label className={label}>Video URL</label>
                <input className={field} value={form.video_url} onChange={set("video_url")} placeholder="https://cdn..." />
              </div>
              <div>
                <label className={label}>Caption (English)</label>
                <textarea className={field} rows={2} value={form.caption_text} onChange={set("caption_text")} />
              </div>
              <div>
                <label className={label}>Target Hashtags (comma separated)</label>
                <input className={field} value={form.target_hashtags} onChange={set("target_hashtags")} placeholder="gadget, homehack" />
              </div>
            </div>
          </div>

          {/* 目标区域 */}
          <div>
            <h2 className="font-semibold text-slate-800">Geotargeting</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={label}>City</label>
                <input className={field} value={form.target_city} onChange={set("target_city")} />
              </div>
              <div>
                <label className={label}>State</label>
                <input className={field} value={form.target_state} onChange={set("target_state")} />
              </div>
              <div>
                <label className={label}>Center Lat</label>
                <input className={field} value={form.target_lat} onChange={set("target_lat")} />
              </div>
              <div>
                <label className={label}>Center Lng</label>
                <input className={field} value={form.target_lng} onChange={set("target_lng")} />
              </div>
              <div>
                <label className={label}>Radius (km)</label>
                <input className={field} value={form.radius_km} onChange={set("radius_km")} />
              </div>
            </div>
          </div>

          {/* 托管账目 */}
          <div>
            <h2 className="font-semibold text-slate-800">Escrow &amp; Payout</h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <label className={label}>Total Slots</label>
                <input className={field} type="number" value={form.total_slots} onChange={set("total_slots")} />
              </div>
              <div>
                <label className={label}>Payout Rate ($)</label>
                <input className={field} type="number" step="0.1" value={form.payout_rate} onChange={set("payout_rate")} />
              </div>
              <div>
                <label className={label}>Platform Fee ($)</label>
                <input className={field} type="number" step="0.1" value={form.platform_fee} onChange={set("platform_fee")} />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Total per slot = payout + platform fee (deposited into escrow upfront).
            </p>
          </div>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {status === "submitting" ? "Creating..." : "Create Campaign"}
          </button>

          {message && (
            <p className={status === "success" ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{message}</p>
          )}
        </form>
      </div>
    </main>
  );
}
