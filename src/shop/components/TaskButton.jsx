// src/shop/components/TaskButton.jsx
// G-CrowdBang / F-CrowdBang · 任务提交按钮组件（React + Tailwind）
// 职责：触发 HTML5 硬件定位 → 区域边界校验 → 打包遥测与任务元数据 → 异步上报服务端核验。
// 说明：本组件只做“采集 + 上报 + 前端边界拦截”；位置真伪的最终判定在服务端。

import { useState, useCallback } from "react";

// 任务地理边界配置（应与 campaign.geotargeting_config 一致，示例值）
const GEO_BOUNDARY = {
  enabled: true,
  // 目标区域中心（Jacksonville, FL）
  center: { latitude: 30.3322, longitude: -81.6557 },
  // 允许半径（公里）
  radiusKm: 80,
  // 定位精度要求（米）
  maxAcceptableAccuracyMeters: 200,
};

// ---- 纯工具：球面距离（Haversine） ----
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- 纯工具：是否落在任务地理边界内 ----
function isWithinBoundary(latitude, longitude) {
  if (!GEO_BOUNDARY.enabled) return true;
  const dist = haversineKm(
    latitude,
    longitude,
    GEO_BOUNDARY.center.latitude,
    GEO_BOUNDARY.center.longitude
  );
  return dist <= GEO_BOUNDARY.radiusKm;
}

export default function TaskButton({ campaignId, workerId }) {
  const [phase, setPhase] = useState("idle"); // idle | locating | submitting | success | error
  const [message, setMessage] = useState("");

  // 状态机：仅允许 idle → locating → submitting → success/error
  const setPhaseOnly = useCallback((from, to) => {
    setPhase((current) => {
      if (from.includes(current)) return to;
      return current; // 非法跳转直接拒绝（防并发点击）
    });
  }, []);

  const handlePublish = useCallback(async () => {
    if (phase !== "idle") return; // 防重复触发
    setPhaseOnly(["idle"], "locating");
    setMessage("🛰️ Locating Device Hardware GPS Node...");

    // ① 强制抓取手机底层 GPS 芯片经纬度（HTML5 原生接口）
    let position;
    try {
      position = await new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) {
          reject(new Error("GEOLOCATION_UNSUPPORTED"));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true, // 请求最精确的硬件读数
            timeout: 8000,            // 8s 内未拿到即熔断
            maximumAge: 0,            // 禁止使用缓存坐标，强制实时读取
          }
        );
      });
    } catch (err) {
      // 用户拒绝授权 / 超时 / 无权限：熔断，拒绝接单
      setPhaseOnly(["locating"], "error");
      setMessage(
        err.code === 1
          ? "❌ Location access denied. Task blocked."
          : "❌ GPS unavailable or timed out. Task blocked."
      );
      return;
    }

    const { latitude, longitude, accuracy } = position.coords;

    // ② 边界校验：经纬度越界 / 精度不合格 → 熔断拦截
    if (!isWithinBoundary(latitude, longitude)) {
      setPhaseOnly(["locating"], "error");
      setMessage("❌ Coordinates outside task boundary. Task blocked.");
      return;
    }
    if (accuracy > GEO_BOUNDARY.maxAcceptableAccuracyMeters) {
      setPhaseOnly(["locating"], "error");
      setMessage("❌ GPS accuracy too low. Please move to a clearer area.");
      return;
    }

    // ③ 校验通过 → 进入上报态
    setPhaseOnly(["locating"], "submitting");

    // ④ 双向数据安全通信：打包遥测 + 任务/用户元数据，POST 给服务端核验接口
    try {
      const res = await fetch("/api/tasks/verify-and-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          workerId,
          telemetry: { latitude, longitude, accuracy },
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `SERVER_ERROR_${res.status}`);
      }

      // ⑤ 发射成功 → 状态更新
      setPhaseOnly(["submitting"], "success");
      setMessage(
        "✨ Task submitted and localized hardware coordinates successfully verified!"
      );
    } catch (err) {
      setPhaseOnly(["submitting"], "error");
      setMessage(`❌ Submission failed: ${err.message}`);
    }
  }, [phase, campaignId, workerId, setPhaseOnly]);

  // 高级暗黑风 UI：微光紫色渐变按钮
  return (
    <div className="w-full max-w-md mx-auto p-6 bg-[#0d1117] rounded-2xl border border-[#30363d] shadow-xl">
      <button
        onClick={handlePublish}
        disabled={phase === "locating" || phase === "submitting"}
        className={[
          "w-full py-3.5 px-6 rounded-xl font-semibold text-white",
          "bg-gradient-to-r from-purple-600 via-fuchsia-600 to-purple-600",
          "shadow-[0_0_18px_rgba(168,85,247,0.45)]",
          "hover:shadow-[0_0_28px_rgba(168,85,247,0.65)]",
          "transition-all duration-300",
          "disabled:opacity-60 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {phase === "idle" && "通过我的网络发射任务（Publish Task）"}
        {phase === "locating" && "🛰️ Locating Device Hardware GPS Node..."}
        {phase === "submitting" && "📡 Publishing Task..."}
        {phase === "success" && "✅ Task Published"}
        {phase === "error" && "↻ Retry Publish"}
      </button>

      {message && (
        <p
          className={[
            "mt-3 text-sm text-center",
            phase === "success" ? "text-emerald-400" : "text-rose-400",
          ].join(" ")}
        >
          {message}
        </p>
      )}
    </div>
  );
}
