// src/app/auth/page.jsx
// ==========================================================================
// G-CrowdBang / F-CrowdBang · 统一多功能登录/注册核心门户（全面账户加固系统）
// --------------------------------------------------------------------------
// 架构职责：
//   1) 双端角色卡片式物理切换：商户 MERCHANT / 老外 WORKER（强制先选身份）。
//   2) 企业级合规法律协议勾选锁：未勾选 Terms & Privacy → 所有提交按钮物理禁用。
//   3) 完备邮箱/密码表单：实时格式正则 + 密码强度 + loading / error 状态挂载。
//   4) 高级暗黑微光科技感 UI + 一键 Google 登录按钮（官方四色 G 图标）。
//
// 【防爆错拦截 · 邮箱已占用智能降级】
//   注册时若 Firebase 返回 auth/email-already-in-use（该邮箱已被另一角色/身份占用），
//   系统不再让用户卡死，而是：自动切换到"登录"模式并保留已填邮箱，引导直接登录。
//   彻底规避"一个邮箱一个账号"规则导致的注册无响应。
//
// 鉴权调用契约（与 src/database/auth.js 对齐）：
//   - signInWithGoogle(role)      一键谷歌（盲测占位环境自动 mock，不弹窗防报错）
//   - signUpWithEmail(email,pwd,role) 邮箱注册（role 小写入库，与 firestore.rules 一致）
//   - signInWithEmail(email,pwd)  邮箱登录
//   - firebaseConfigReady()       真实 Firebase 就绪哨兵（未配置走本地 mock）
// ==========================================================================
"use client";

import { useState } from "react";
import {
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  firebaseConfigReady,
} from "@/database/auth";

// ---- 标准邮箱格式正则（阻挡乱填垃圾邮箱）----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- 邮箱已占用 → 引导一键切登录 ----
const EMAIL_ALREADY_IN_USE_MSG =
  "This email is already registered — we switched you to Sign In to continue. / 该邮箱已被注册，已为你切换为登录模式，请直接输入密码登录。";

export default function AuthPage() {
  // 双端角色：强制用户先选择身份（展示用大写标签）
  const [role, setRole] = useState("MERCHANT"); // 'MERCHANT' | 'WORKER'
  // 企业级合规法律协议勾选锁
  const [legalAgreed, setLegalAgreed] = useState(false);
  // 模式：'register'（注册）| 'signin'（登录）
  const [mode, setMode] = useState("register");
  // 表单字段
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // 实时校验错误（内联）
  const [fieldError, setFieldError] = useState("");
  // 提交状态（loading / 服务端错误）
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const [infoNote, setInfoNote] = useState(""); // 友好提示（如切到登录）

  // 实时前端校验：邮箱格式 + 密码强度（>6 位）
  const emailValid = EMAIL_RE.test(email);
  const passwordValid = password.length >= 6;
  const formValid = emailValid && passwordValid;

  // 法律勾选未通过 → 物理禁用所有提交按钮（包括一键谷歌）
  const submitLocked = !legalAgreed;

  // 按当前会话角色跳转到对应空间
  const routeByRole = (sessionRole) =>
    String(sessionRole).toUpperCase() === "MERCHANT" ? "/admin" : "/shop/tasks";

  // ---- 邮箱密码提交（注册 / 登录）----
  const handleEmailSubmit = async (ev) => {
    ev.preventDefault();
    setServerError("");
    setInfoNote("");

    if (submitLocked) {
      setFieldError("Please accept the Terms of Service & Privacy Policy first. / 请先勾选服务条款。");
      return;
    }
    if (!emailValid) {
      setFieldError("Please enter a valid email address / 请输入有效邮箱。");
      return;
    }
    if (!passwordValid) {
      setFieldError("Password must be at least 6 characters / 密码长度至少 6 位。");
      return;
    }

    setLoading(true);
    setFieldError("");
    try {
      let s;
      if (mode === "register") {
        // 角色以小写入库，与 firestore.rules 的 roleOf() 判断保持一致
        s = await signUpWithEmail(email, password, role.toLowerCase());
      } else {
        s = await signInWithEmail(email, password);
      }
      console.log("[auth] ok", s);
      window.location.href = routeByRole(s?.role);
    } catch (err) {
      const code = err?.code || "";

      // 【核心防爆 · 邮箱已占用】→ 自动切到登录模式并保留邮箱，不再卡死
      if (code === "auth/email-already-in-use") {
        setMode("signin");
        setInfoNote(EMAIL_ALREADY_IN_USE_MSG);
        setServerError("");
        setLoading(false);
        return;
      }

      const map = {
        "auth/invalid-email": "Invalid email format. / 邮箱格式无效。",
        "auth/weak-password": "Password too weak. / 密码强度不足。",
        "auth/user-not-found":
          "No account with this email. Please sign up first. / 该邮箱未注册，请先注册。",
        "auth/wrong-password": "Incorrect password. / 密码错误，请重试。",
        "auth/invalid-credential": "Incorrect email or password. / 邮箱或密码不正确。",
        "auth/too-many-requests":
          "Too many attempts. Please try again later. / 尝试次数过多，请稍后再试。",
      };
      setServerError(
        map[code] ||
          (err?.message || "Sign-in failed. Please try again. / 登录失败，请重试。")
      );
    } finally {
      setLoading(false);
    }
  };

  // ---- 一键谷歌登录（受法律勾选锁保护）----
  const handleGoogle = async () => {
    setServerError("");
    setInfoNote("");
    if (submitLocked) {
      setFieldError("Please accept the Terms of Service & Privacy Policy first.");
      return;
    }
    setLoading(true);
    try {
      const s = await signInWithGoogle(role);
      console.log("[auth] google ok", s);
      window.location.href = routeByRole(s?.role);
    } catch (err) {
      // 按 Firebase Auth 错误码给出具体原因
      const map = {
        "auth/operation-not-allowed":
          "Google sign-in is not enabled yet in Firebase Auth. 谷歌登录尚未在 Firebase 启用。",
        "auth/unauthorized-domain":
          "This domain is not authorized for Google sign-in. 当前域名未授权谷歌登录。",
        "auth/network-request-failed": "Network issue reaching Google. 网络无法连接谷歌。",
        "auth/popup-closed-by-user": "Popup closed before sign-in completed. 授权弹窗已关闭。",
        "auth/popup-blocked": "Popup blocked by browser. 浏览器拦截了授权弹窗。",
      };
      setServerError(
        map[err?.code] ||
          err?.message ||
          "Google sign-in failed. Please check your connection. / 谷歌登录失败，请检查连接。"
      );
    } finally {
      setLoading(false);
    }
  };

  // ---- 双端角色大卡片 ----
  const ROLE_CARDS = [
    {
      key: "MERCHANT",
      title: "I am a Merchant",
      zh: "国内跨境商户",
      desc: "Publish bounty campaigns & manage escrow",
      emoji: "🏪",
    },
    {
      key: "WORKER",
      title: "I am a Worker",
      zh: "海外住宅雇佣兵",
      desc: "Take bounties, verify GPS & earn $3/task",
      emoji: "🛰️",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* 品牌徽标 */}
        <div className="text-center mb-8">
          <div className="text-4xl">🔐</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            {mode === "register" ? "Create Account" : "Sign In"}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            注册 / 登录 · G-CrowdBang unified portal
          </p>
        </div>

        {/* 1) 双端角色卡片式物理切换 */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {ROLE_CARDS.map((card) => {
            const active = role === card.key;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => setRole(card.key)}
                className={`text-left rounded-xl border-2 p-4 transition-all duration-200 active:scale-[0.98] ${
                  active
                    ? "border-purple-400 bg-purple-50/40 shadow-[0_0_18px_rgba(168,85,247,0.25)]"
                    : "border-gray-300 bg-white hover:border-gray-400"
                }`}
              >
                <div className="text-2xl">{card.emoji}</div>
                <div className="mt-1 font-bold text-sm">{card.title}</div>
                <div className="text-xs text-purple-700">{card.zh}</div>
                <div className="mt-1 text-[11px] text-gray-600">{card.desc}</div>
              </button>
            );
          })}
        </div>

        {/* 2) 邮箱密码表单（实时校验 + loading / error） */}
        <form
          onSubmit={handleEmailSubmit}
          className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4"
        >
          {/* 邮箱 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Email / 邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldError("");
                setInfoNote("");
              }}
              placeholder="email@example.com"
              className="w-full rounded-xl bg-white text-gray-900 px-4 py-3 text-sm outline-none ring-1 ring-transparent transition-all focus:ring-purple-400 focus:bg-white placeholder:text-gray-500"
            />
            {email && !emailValid && (
              <p className="mt-1 text-xs text-rose-400">Invalid email format / 邮箱格式无效。</p>
            )}
          </div>

          {/* 密码 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Password / 密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldError("");
                setInfoNote("");
              }}
              placeholder="••••••••"
              className="w-full rounded-xl bg-white text-gray-900 px-4 py-3 text-sm outline-none ring-1 ring-transparent transition-all focus:ring-purple-400 focus:bg-white placeholder:text-gray-500"
            />
            {password && !passwordValid && (
              <p className="mt-1 text-xs text-rose-400">
                Min 6 characters / 密码至少 6 位。
              </p>
            )}
          </div>

          {/* 实时/服务端错误反馈 */}
          {(fieldError || serverError) && (
            <div className="rounded-xl border border-rose-300 bg-rose-50/40 px-4 py-3 text-xs text-rose-700">
              {fieldError || serverError}
            </div>
          )}
          {/* 友好提示（如邮箱已占用 → 已切登录） */}
          {infoNote && (
            <div className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-xs text-amber-700">
              💡 {infoNote}
            </div>
          )}

          {/* 3) 企业级合规法律协议勾选锁 */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={legalAgreed}
              onChange={(e) => {
                setLegalAgreed(e.target.checked);
                setFieldError("");
              }}
              className="mt-0.5 h-4 w-4 rounded accent-purple-500"
            />
            <span className="text-xs text-gray-600">
              I agree to the{" "}
              <span className="text-purple-700 underline">Terms of Service</span> and{" "}
              <span className="text-purple-700 underline">Privacy Policy</span>
              <span className="block text-gray-500">
                我已阅读并同意服务条款与隐私政策（未勾选无法提交）
              </span>
            </span>
          </label>

          {/* 邮箱密码提交按钮（法律锁 → disabled） */}
          <button
            type="submit"
            disabled={submitLocked || loading}
            className={`w-full rounded-xl py-3 px-4 font-bold text-sm transition-all duration-200 active:scale-[0.99] ${
              submitLocked
                ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_16px_rgba(168,85,247,0.35)]"
            }`}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ⚡ Securing Auth Connection...
              </span>
            ) : mode === "register" ? (
              "Create Account · 注册"
            ) : (
              "Sign In · 登录"
            )}
          </button>
        </form>

        {/* 4) 一键谷歌登录按钮（同样受法律勾选锁保护） */}
        <div className="mt-4">
          <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-3">
            <span className="flex-1 h-px bg-gray-800" />
            or · 或
            <span className="flex-1 h-px bg-gray-800" />
          </div>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={submitLocked || loading}
            className={`w-full rounded-xl py-3 px-4 font-bold flex items-center justify-center gap-2.5 transition-all duration-200 active:scale-[0.99] ${
              submitLocked
                ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                : "bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm"
            }`}
          >
            {/* 官方 Google 四色 G 图标 */}
            <svg className="w-5 h-5" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.4 29.4 4.5 24 4.5 13.3 4.5 4.5 13.3 4.5 24S13.3 43.5 24 43.5 34.7 43.5 24c0-1.3-.1-2.6-.4-3.9z"/>
              <path fill="#FF3D00" d="M6.4 14.7l6.6 4.8C14.8 15.9 18.5 12.8 23 12c-1-5.4-4.2-8.9-4.2-8.9-7.5 2.6-12.4 9-12.4 11.6z"/>
              <path fill="#4CAF50" d="M24 43.5c4.9 0 9.4-1.8 12.7-4.9l-6.1-5.2c-1.9 1.4-4.3 2.2-6.6 2.2-5.2 0-9.6-3.4-11.2-8.1l-6.5 5c3.3 6.2 9.7 11 18.7 11z"/>
              <path fill="#1976D2" d="M43.6 20.1h-1.6V20H24v8h11.3c-1.5 4.4-5.5 7.6-10.2 7.9v6.2c8.4 0 16.5-5.5 16.5-16.5 0-1.7-.3-3.3-.7-4.9z"/>
            </svg>
            <span className="text-sm tracking-wide">Continue with Google</span>
          </button>
          <p className="mt-1 text-center text-[11px] text-gray-500">
            Continue with Google / 用谷歌一键登录
          </p>
        </div>

        {/* 模式切换：登录 ⇄ 注册 */}
        <div className="mt-5 text-center text-sm text-gray-600">
          {mode === "register" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setServerError("");
                  setFieldError("");
                  setInfoNote("");
                }}
                className="text-purple-700 underline font-medium"
              >
                Sign In · 登录
              </button>
            </>
          ) : (
            <>
              No account yet?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setServerError("");
                  setFieldError("");
                  setInfoNote("");
                }}
                className="text-purple-700 underline font-medium"
              >
                Create Account · 注册
              </button>
            </>
          )}
        </div>

        {/* 返回首页 + 经典登录页互通 */}
        <div className="mt-4 text-center space-y-2">
          <a href="/login" className="block text-xs font-medium text-indigo-400 hover:text-indigo-700">
            Classic: quick login portal / 经典快捷登录页 →
          </a>
          <a href="/" className="block text-xs text-gray-500 hover:text-gray-700">
            ← Back to landing / 返回首页
          </a>
        </div>

        {/* 底部能力徽章 */}
        <div className="mt-6 text-center text-[10px] text-slate-600">
          Powered by G-CrowdBang · F-CrowdBang ·{" "}
          {firebaseConfigReady() ? "Real Firebase" : "Local Mock Mode"}
        </div>
      </div>
    </main>
  );
}
