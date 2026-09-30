// /login 统一跳转到 /auth，全站只保留一套登录/注册入口
"use client";
import { useEffect } from "react";
export default function LoginRedirect() {
  useEffect(() => {
    window.location.href = "/auth";
  }, []);
  return <div style={{padding:24,textAlign:"center"}}>Redirecting…</div>;
}
