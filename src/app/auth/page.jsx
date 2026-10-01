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

import { useState, useEffect } from "react";
import Script from "next/script";
import { GoogleAuthProvider, signInWithCredential, signInWithCustomToken } from "firebase/auth";
import {
  auth as fbAuth,
  signUpWithEmail,
  signInWithEmail,
  firebaseConfigReady,
  persistGoogleSession,
} from "@/database/auth";

// Google 一键登录 Client ID（官方 GSI SDK）
const GOOGLE_CLIENT_ID = "400478069219-4l61k0fn1t3omci145dma3aoflfar3tc.apps.googleusercontent.com";

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

      // P0 对接修复：客户端 SDK 登录不经过后端，gb_session cookie 不会被写入，
      // middleware 会把 /admin、/shop/tasks 的跳转 307 弹回本页。
      // 因此跳转前先调登录网关（真实模式走 Identity Toolkit 换 idToken 落 cookie；
      // mock 模式落 mock 占位 cookie），保证页面守卫放行。
      try {
        await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, role: String(s?.role || role).toLowerCase() }),
        });
      } catch (cookieErr) {
        console.warn("[auth] session cookie bootstrap failed", cookieErr);
      }

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

  // ---- Google 一键登录（官方 GSI SDK：按钮弹出授权 → 回调凭证）----
  const handleGoogleCredential = async (response) => {
    const credential = response?.credential;
    setServerError("");
    setInfoNote("");
    if (submitLocked) {
      setFieldError("Please accept the Terms of Service & Privacy Policy first. / 请先勾选服务条款。");
      return;
    }
    if (!credential) {
      setServerError("Google sign-in did not return a credential. / 未获取到谷歌登录凭证。");
      return;
    }
    setLoading(true);
    try {
      // 1) 先走后端 /api/auth/google 做服务端校验 + 自动建号
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, role }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setServerError(data?.message || "Google 登录失败，请重试。");
        setLoading(false);
        return;
      }
      // 2) 建立 Firebase 会话：优先用后端签发的 customToken（不依赖 Google provider 启用），
      //    否则回退 GSI 凭证直连（需在 Firebase 控制台启用 Google 登录 provider）
      try {
        if (data?.customToken) {
          await signInWithCustomToken(fbAuth, data.customToken);
        } else {
          const cred = GoogleAuthProvider.credential(credential);
          await signInWithCredential(fbAuth, cred);
        }
      } catch (fbErr) {
        console.warn("[auth] firebase session link skipped", fbErr?.code);
      }
      // 2.5) P0 对接修复：把 Firebase idToken 交给后端落 gb_session cookie，
      //      否则 middleware 会把角色空间的跳转 307 弹回登录页
      try {
        const currentUser = fbAuth?.currentUser;
        if (currentUser) {
          const idToken = await currentUser.getIdToken();
          await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          });
        }
      } catch (sessionErr) {
        console.warn("[auth] session cookie bootstrap failed", sessionErr);
      }
      // 3) 持久化 Google 后端会话到本地（供 useAuthSession 读取，保证跳转后页面放行）
      if (data?.uid) {
        try {
          persistGoogleSession(data.uid, data.email, data.role);
        } catch {
          /* ignore */
        }
      }
      // 4) 按后端返回的角色跳转到对应空间
      window.location.href = routeByRole(data.role);
    } catch (err) {
      console.error("[Google Auth]", err);
      setServerError("Google 登录服务异常，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  // GSI SDK 初始化 + 官方按钮渲染（随角色选择重挂载，回调携带最新 role）
  useEffect(() => {
    window.handleCredentialResponse = handleGoogleCredential;
    const initGsi = () => {
      const gsi = window.google?.accounts?.id;
      if (!gsi) return;
      try {
        gsi.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        const container = document.querySelector(".g_id_signin");
        if (container) {
          gsi.renderButton(container, {
            type: "standard",
            shape: "pill",
            theme: "outline",
            text: "signin_with",
            size: "large",
            logo_alignment: "left",
            width: 400,
          });
        }
      } catch (e) {
        console.warn("[GSI init]", e);
      }
    };
    if (window.google?.accounts?.id) {
      initGsi();
    } else {
      const checkInterval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(checkInterval);
          initGsi();
        }
      }, 500);
      return () => clearInterval(checkInterval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

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

        {/* Google 登录暂时隐藏（需在 Firebase/Google Cloud 授权域名后再开启） */}

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
          <button type="button" onClick={() => window.history.back()} className="block text-xs text-gray-500 hover:text-gray-700">
            ← Back to previous page / 返回上一页
          </button>
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
