// src/app/login/page.jsx
// G-CrowdBang · 统一登录入口页（中英双语：英文在上、中文在下）
// 职责：
//   1) 提供一个明确的登录入口（/login），线上线下都可访问。
//   2) 本地(localhost)或已配置真实 Firebase Auth 时展示登录表单；
//      线上未接入真实认证前，展示"登录待接入认证"说明并引导本地测试 —— 杜绝旁路自注册。
//   3) 登录成功后按角色跳转：商户 → /admin，接单人 → /shop/tasks，其他 → /。
"use client";

import { useState } from "react";
import Link from "next/link";
import { signUpWithEmail, firebaseConfigReady } from "@/database/auth";

function isLocalhost() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export default function LoginPage() {
  const [isLocal] = useState(() => isLocalhost());
  const configReady = firebaseConfigReady(); // 客户端在挂载后可读，需在浏览器执行
  const allowLogin = isLocal || configReady;

  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [role, setRole] = useState("worker"); // merchant | worker（mock 下生效；真实登录以 token claims 为准）
  const [msg, setMsg] = useState("");

  // 支持 ?mode=register 进入注册模式（mock 下注册即建立会话）
  const [mode] = useState(() => {
    if (typeof window === "undefined") return "signin";
    const m = new URLSearchParams(window.location.search).get("mode");
    return m === "register" ? "register" : "signin";
  });

  const doLogin = async () => {
    if (!email || !pwd) {
      setMsg("Enter email and password. / 请输入邮箱和密码。");
      return;
    }
    try {
      const s = await signUpWithEmail(email, pwd, role);
      const target = s.role?.toUpperCase() === "MERCHANT"
        ? "/admin"
        : s.role?.toUpperCase() === "WORKER"
          ? "/shop/tasks"
          : "/";
      window.location.href = target;
    } catch (e) {
      console.error("[login] sign-in failed", e);
      setMsg("Sign-in failed. / 登录失败，请重试。");
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-4xl">🔐</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">
          {mode === "register" ? "Create Account" : "Sign In"}
        </h1>
        <p className="text-sm text-slate-500">{mode === "register" ? "注册" : "登录"}</p>
        <p className="mt-1 text-xs text-slate-400">G-CrowdBang · unified account entry / 统一账户入口</p>

        {allowLogin ? (
          <>
            {/* 身份选择 */}
            <div className="mt-5 flex gap-2">
              {[
                ["merchant", "Merchant / 商户"],
                ["worker", "Worker / 接单人"],
              ].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setRole(val)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                    role === val
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              autoComplete="off"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 caret-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              onClick={doLogin}
              className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              {mode === "register" ? "Sign Up / 注册" : "Sign In / 登录"}
            </button>
            {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}

            <div className="mt-3 flex items-center justify-center gap-1 text-xs">
              {mode === "register" ? (
                <>
                  <span className="text-slate-500">Already have an account?</span>
                  <span className="text-slate-400">已有账号？</span>
                  <Link href="/login" className="font-medium text-indigo-600 hover:underline">Sign In · 登录</Link>
                </>
              ) : (
                <>
                  <span className="text-slate-500">No account yet?</span>
                  <span className="text-slate-400">还没有账号？</span>
                  <Link href="/login?mode=register" className="font-medium text-indigo-600 hover:underline">Sign Up · 注册</Link>
                </>
              )}
            </div>

            {!configReady && (
              <p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-left text-xs text-amber-700">
                Local demo mode — any email/password works here for development.
                <br />
                本地演示模式 —— 开发环境下任意邮箱/密码均可登录。
              </p>
            )}
          </>
        ) : (
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-left">
            <p className="text-sm font-medium text-slate-700">Production gate / 生产登录待接入</p>
            <p className="mt-2 text-xs text-slate-500">
              Real sign-in unlocks once Firebase Auth credentials are configured for this site.
              Continue testing on your local machine.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              该站点接入真实 Firebase 认证后即可开放正式登录；当前请在本地
              <strong> localhost:3000 </strong> 使用演示账号测试。
            </p>
            <Link href="http://localhost:3000/login" className="mt-3 block text-center text-sm font-medium text-indigo-600 hover:underline">
              Open local demo login / 打开本地演示登录 →
            </Link>
          </div>
        )}

        <Link href="/" className="mt-5 block text-xs text-indigo-500 hover:underline">
          ← Back to landing / 返回首页
        </Link>
      </div>
    </main>
  );
}
