// src/app/components/DemoLoginCard.jsx
// G-CrowdBang · 本地开发者演示登录卡片（Client Component）
// 职责：在鉴权卡点的 403 拦截卡片中，为【本地开发者】提供"一键 demo 解锁"入口。
// 安全红线：该演示登录【仅本地 localhost 渲染】——生产线上(Vercel)一律不显示，
//           防止任何外部客户通过 demo 旁路自注册进入商户/接单控制台。
//           （真实客户登录必须走后续接入的真实 Firebase Auth，未配置前线上仅显示提示。）
"use client";

import { useState } from "react";
import Link from "next/link";
import { signUpWithEmail } from "@/database/auth";

export default function DemoLoginCard({ role, backHref, introLabel }) {
  // 仅本地(localhost / 127.0.0.1)才显示演示登录；生产环境隐藏
  const [isLocal] = useState(() => {
    if (typeof window === "undefined") return false;
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  });

  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [msg, setMsg] = useState("");

  const unlock = async () => {
    if (!email || !pwd) {
      setMsg("Enter an email and password.");
      return;
    }
    try {
      const s = await signUpWithEmail(email, pwd, role);
      setMsg(`Signed in as ${role} (${s.uid}) — local demo session.`);
    } catch (e) {
      console.error("[DemoLoginCard] sign-in failed", e);
      setMsg("Sign-in failed. Please try again.");
    }
  };

  // 生产环境：不暴露 demo 旁路，提示需接入真实账号体系
  if (!isLocal) {
    return (
      <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left text-sm">
        <p className="font-medium text-slate-700">Production gate</p>
        <p className="mt-1 text-xs text-slate-500">
          Demo sign-in is disabled outside localhost. Merchant/worker consoles open once real
          Firebase Auth is configured. Continue testing at <strong>http://localhost:3000</strong>.
        </p>
        <Link href={backHref} className="mt-3 block text-xs text-indigo-500 hover:underline">
          ← {backHref === "/" ? "Back to landing" : "Back"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
      <p className="text-xs font-medium text-slate-500">
        Local demo — sign in as {role} ({introLabel || "developer only"})
      </p>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={role === "merchant" ? "merchant@example.com" : "worker@example.com"}
        autoComplete="off"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <input
        type="password"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        placeholder="password"
        autoComplete="new-password"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        onClick={unlock}
        className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Unlock {role === "merchant" ? "Merchant Console" : "Task Hall"} (demo)
      </button>
      {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
      <Link href={backHref} className="mt-3 block text-center text-xs text-indigo-500 hover:underline">
        ← Back
      </Link>
    </div>
  );
}
