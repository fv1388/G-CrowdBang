// src/app/components/GoogleLoginWidget.jsx
// G-CrowdBang / F-CrowdBang · 一键谷歌注册登录组件（可复用）
// 挂载方式：<GoogleLoginWidget role="WORKER" /> （MERCHANT=商户端 / WORKER=老外端）
// 说明：本地 mock 未配置真实 Firebase 时走确定性测试 UID（不弹外网窗）；
//       配置真实 NEXT_PUBLIC_FIREBASE_* 后走官方 Google OAuth 弹窗 + 多租户角色账本对账。
// 登录成功后按角色跳转到对应空间：商户 → /admin，老外 → /shop/tasks。
"use client";

import { signInWithGoogle } from "@/database/auth";

export function GoogleLoginWidget({ role = "WORKER", onDone }) {
  const handleGoogleSignIn = async () => {
    try {
      // 传入角色：若是新用户，系统在底层将角色标签锁死写入对账账本
      // （WORKER → 老外大厅 /shop/tasks；MERCHANT → 商户控制台 /admin）
      const userSession = await signInWithGoogle(role);
      console.log("[G-CrowdBang] one-click Google sign-in ok:", userSession);

      if (onDone) {
        onDone(userSession);
        return;
      }
      const target =
        String(userSession.role).toUpperCase() === "MERCHANT"
          ? "/admin"
          : "/shop/tasks";
      window.location.href = target;
    } catch (err) {
      console.error("[GoogleLoginWidget] sign-in failed", err);
      alert("登录失败，请检查浏览器连接状态 / Sign-in failed, check your connection.");
    }
  };

  return (
    <button
      onClick={handleGoogleSignIn}
      className="w-full bg-white hover:bg-gray-50 text-gray-700 font-bold border border-gray-300 rounded-xl py-3 px-4 shadow-sm transition duration-150 active:scale-[0.99] flex items-center justify-center gap-2.5"
    >
      {/* 标准谷歌四色 G 图标 */}
      <svg className="w-5 h-5" viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.4 29.4 4.5 24 4.5 13.3 4.5 4.5 13.3 4.5 24S13.3 43.5 24 43.5 43.5 34.7 43.5 24c0-1.3-.1-2.6-.4-3.9z"/>
        <path fill="#FF3D00" d="M6.4 14.7l6.6 4.8C14.8 15.9 18.5 12.8 23 12c-1-5.4-4.2-8.9-4.2-8.9-7.5 2.6-12.4 9-12.4 11.6z"/>
        <path fill="#4CAF50" d="M24 43.5c4.9 0 9.4-1.8 12.7-4.9l-6.1-5.2c-1.9 1.4-4.3 2.2-6.6 2.2-5.2 0-9.6-3.4-11.2-8.1l-6.5 5c3.3 6.2 9.7 11 18.7 11z"/>
        <path fill="#1976D2" d="M43.6 20.1h-1.6V20H24v8h11.3c-1.5 4.4-5.5 7.6-10.2 7.9v6.2c8.4 0 16.5-5.5 16.5-16.5 0-1.7-.3-3.3-.7-4.9z"/>
      </svg>
      <span className="text-sm tracking-wide">Continue with Google</span>
    </button>
  );
}
