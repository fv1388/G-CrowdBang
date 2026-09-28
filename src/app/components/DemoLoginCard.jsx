// src/app/components/DemoLoginCard.jsx
// G-CrowdBang · 本地开发者演示登录卡片（Client Component）
// 职责：在鉴权卡点的 403 拦截卡片中，为【本地开发者】提供"一键 demo 解锁"入口。
// 安全红线：该演示登录【仅本地 localhost 渲染】——生产线上(Vercel)一律不显示，
//           防止任何外部客户通过 demo 旁路自注册进入商户/接单控制台。
//           （真实客户登录必须走后续接入的真实 Firebase Auth，未配置前线上仅显示提示。）
"use client";

import { useState } from "react";
import Link from "next/link";
import { signUpWithEmail, signInWithEmail, signInWithGoogle } from "@/database/auth";

// 本地 mock 模式密码不参与真实校验（firebaseConfigReady() 为 false），
// 一键登录直接以开发者测试邮箱建立确定性会话（uid_<邮箱前缀>），无需手输。
// 该按钮仅 localhost 渲染；生产走真实 Firebase 密码校验，此路径完全失效。
const DEV_EMAIL = "suan147@qq.com";
const DEV_MOCK_PASSWORD = "dev-mock-only-not-real";

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

  // 先尝试登录，账号不存在(未注册)时自动转注册——避免"已存在账号再注册"导致 email-already-in-use
  const signInOrSignUp = async (email, pwd, role) => {
    try {
      const s = await signInWithEmail(email, pwd);
      return { kind: "signin", session: s };
    } catch (e) {
      if (e?.code === "auth/user-not-found") {
        const s = await signUpWithEmail(email, pwd, role);
        return { kind: "signup", session: s };
      }
      throw e;
    }
  };

  // 一键开发者登录：免手输，先登录后注册（本地 mock 专用）
  const quickLogin = async () => {
    try {
      const r = await signInOrSignUp(DEV_EMAIL, DEV_MOCK_PASSWORD, role);
      setMsg(`Signed in as ${role} (${r.session.uid}) — one-click dev session.`);
    } catch (e) {
      console.error("[DemoLoginCard] quick login failed", e);
      setMsg(
        e?.code === "auth/wrong-password"
          ? "Sign-in failed: the dev account password changed. / 演示账号密码已变更，登录失败。"
          : "Quick sign-in failed."
      );
    }
  };

  const unlock = async () => {
    if (!email || !pwd) {
      setMsg("Enter an email and password.");
      return;
    }
    try {
      const r = await signInOrSignUp(email, pwd, role);
      setMsg(
        r.kind === "signup"
          ? `New ${role} account created (${r.session.uid}). / 新${role === "merchant" ? "商户" : "接单人"}账号已注册。`
          : `Signed in as ${role} (${r.session.uid}). / 已登录。`
      );
    } catch (e) {
      console.error("[DemoLoginCard] sign-in failed", e);
      const map = {
        "auth/email-already-in-use": "Email already registered — please sign in. / 邮箱已注册，请直接登录。",
        "auth/wrong-password": "Incorrect password. / 密码错误。",
        "auth/invalid-email": "Invalid email. / 邮箱格式无效。",
      };
      setMsg(map[e?.code] || "Sign-in failed. Please try again. / 登录失败，请重试。");
    }
  };

  // 一键谷歌登录（本地 mock 走确定性测试 UID；真实配置后走官方弹窗）
  const googleLogin = async () => {
    try {
      const s = await signInWithGoogle(role);
      setMsg(`Google signed in as ${s.role} (${s.uid}) — demo session.`);
    } catch (e) {
      console.error("[DemoLoginCard] google sign-in failed", e);
      setMsg("Google sign-in failed.");
    }
  };

  // 生产环境：不暴露 demo 旁路，提供统一登录入口 + 说明
  if (!isLocal) {
    return (
      <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left text-sm">
        <p className="font-medium text-slate-700">Production gate / 登录入口</p>
        <p className="mt-1 text-xs text-slate-500">
          Demo sign-in is disabled outside localhost. Merchant/worker consoles open once real
          Firebase Auth is configured. Continue testing at <strong>http://localhost:3000</strong>.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          线上禁用演示登录；接入真实 Firebase 认证后商家/接单控制台即可打开。当前请在本地 localhost:3000 测试。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            href="/login"
            className="block rounded-lg bg-indigo-600 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Sign In · 登录
          </Link>
          <Link
            href="/login?mode=register"
            className="block rounded-lg border border-indigo-300 bg-white px-4 py-2 text-center text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            Sign Up · 注册
          </Link>
        </div>
        <Link
          href="/auth"
          className="mt-2 block rounded-lg bg-purple-600 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-purple-500"
        >
          Create Account · 统一注册门户（选 Worker 一键谷歌/邮箱注册）
        </Link>
        <Link href={backHref} className="mt-2 block text-xs text-indigo-500 hover:underline">
          ← {backHref === "/" ? "Back to landing / 返回首页" : "Back"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
      <p className="text-xs font-medium text-slate-500">
        Local demo — sign in as {role} ({introLabel || "developer only"})
      </p>
      <p className="mt-1 text-xs text-slate-500">
        本地演示 —— 以{role === "merchant" ? "商户" : "接单人"}身份登录（仅开发人员可用）
      </p>

      {/* 一键开发者登录（免手输；仅本地 mock） */}
      <button
        onClick={quickLogin}
        className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        One-click dev sign-in ({DEV_EMAIL})
      </button>
      <p className="mt-1 text-xs text-emerald-700">一键开发者登录（无需输入，自动以 suan147@qq.com 进入）</p>

      <button
        onClick={googleLogin}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <span className="text-sm">🌐</span> One-click Google sign-in / 一键谷歌登录
      </button>
      <p className="mt-1 text-xs text-slate-500">以 {role === "merchant" ? "商户" : "接单人"} 身份一键谷歌登录（本地演示）</p>

      <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-300" />
        or type manually
        <span className="text-slate-400">或手动输入</span>
        <span className="h-px flex-1 bg-slate-300" />
      </div>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={role === "merchant" ? "merchant@example.com" : "worker@example.com"}
        autoComplete="off"
        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 caret-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <input
        type="password"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        placeholder="password"
        autoComplete="new-password"
        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 caret-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        onClick={unlock}
        className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Unlock {role === "merchant" ? "Merchant Console" : "Task Hall"} (demo)
      </button>
      <p className="mt-1 text-xs text-indigo-600">解锁{role === "merchant" ? "商户控制台" : "任务大厅"}（演示）</p>
      {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
      <Link
        href="/auth"
        className="mt-3 block text-center text-xs font-semibold text-purple-600 hover:underline"
      >
        New {role === "merchant" ? "Merchant" : "Worker"}? Create real account at /auth · 到 /auth 注册真实账号 →
      </Link>
      <Link href={backHref} className="mt-2 block text-center text-xs text-indigo-500 hover:underline">
        ← Back
      </Link>
    </div>
  );
}
