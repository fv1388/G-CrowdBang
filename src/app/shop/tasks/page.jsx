// src/app/shop/tasks/page.jsx
// G-CrowdBang · B端海外用户接单大厅（React Client Component + Tailwind）
// 透明合规的多租户页面交互：动态拉取未满员任务 → 视频卡矩阵渲染 → 每卡挂载硬件GPS校验按钮。
// 数据源：GET /api/campaigns/list（服务端归属过滤，仅返回 open 且未满员任务）。
"use client";

import TaskButton from "@/shop/components/TaskButton";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function TaskHallPage() {
  // 动态任务列表（来自 /api/campaigns/list）
  const [campaigns, setCampaigns] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error

  // 组件挂载(Mount)完成后，发起合规的本地 GET 异步拉取
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/campaigns/list");
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setCampaigns(data.campaigns ?? []);
          setLoadState("ok");
        }
      } catch (err) {
        console.error("[task-hall] load campaigns failed", err);
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 当前登录接单人（生产环境来自认证会话；此处以占位示意）
  const workerId = "usr_current";

  const flow = [
    { step: "Browse Available Bounties", body: "Pick a task from the live board — each shows the source video, target city, and the $3.00 payout." },
    { step: "Pass the Hardware GPS Check", body: "When you claim a task, your device runs a standard GPS check (navigator.geolocation) to confirm you're submitting from the task area." },
    { step: "Publish & Get Verified", body: "Post your video, submit the link, and our server verifies it's public and the claim is consistent — then your $3.00 is released to your balance." },
  ];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* 共享导航：任务大厅 ↔ 我的任务&收益 */}
      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 flex items-center gap-6 py-3">
          <Link href="/shop/tasks" className="text-sm font-medium text-indigo-600 border-b-2 border-indigo-600 pb-1">
            Task Hall
          </Link>
          <Link href="/workers" className="text-sm font-medium text-slate-500 hover:text-slate-800">
            My Tasks &amp; Earnings
          </Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Your Task Dashboard — Make Money Sharing Creator Videos</h1>
        <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
          Browse available bounty tasks in your area, complete the hardware GPS check, publish your video, and get paid $3.00 once your work is verified.
        </p>
        <a href="#tasks" className="mt-6 inline-block px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700">
          Browse Tasks
        </a>
      </section>

      <section id="tasks" className="max-w-5xl mx-auto px-6 pb-10">
        <h2 className="text-2xl font-bold">Available Bounties</h2>

        {loadState === "loading" && (
          <p className="mt-4 text-slate-500">⏳ Loading available crowdsourcing tasks...</p>
        )}
        {loadState === "error" && (
          <p className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
            Campaigns are temporarily unavailable. Please try again shortly.
          </p>
        )}
        {loadState === "ok" && campaigns.length === 0 && (
          <p className="mt-4 text-slate-500">No open bounties right now — check back soon.</p>
        )}

        {/* 动态任务卡片矩阵渲染（.map()） */}
        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((t) => (
            <div key={t.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              {/* 商户发布的去重素材视频（原生 video 标签） */}
              {t.video_url ? (
                <video
                  controls
                  preload="metadata"
                  className="aspect-video w-full rounded-xl bg-slate-900"
                  src={t.video_url}
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">
                  No preview available
                </div>
              )}

              <h3 className="mt-3 font-semibold">{t.title}</h3>

              {/* 美式文案字符串 caption_text */}
              {t.caption_text && (
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{t.caption_text}</p>
              )}

              {/* 区域限制标记 + 托管分账佣金 */}
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">
                  📍 {t.city}, {t.state}
                </span>
                <span className="font-bold text-emerald-600">${Number(t.payout).toFixed(2)} Payout</span>
              </div>

              {/* 精确绑定硬件位置校验按钮：每卡传入 campaignId + workerId */}
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

      <section className="max-w-4xl mx-auto px-6 pb-14">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="font-semibold">Earnings &amp; Withdrawal</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><strong className="text-slate-800">Earnings:</strong> $3.00 per verified task, paid to your withdrawable balance.</li>
            <li><strong className="text-slate-800">Verification:</strong> every task is audited for public status and location consistency.</li>
            <li><strong className="text-slate-800">Compliance:</strong> location data is used solely to confirm task eligibility and is handled per our privacy policy.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
