import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin 是服务端专用 Node 包，必须在 Serverless 函数中声明为外部包，
  // 否则 Next.js 16 的 server bundler 打包会导致所有引用它的 API 路由
  // 在运行时 500（此前 /api/auth/* 全部返回 500 空 body 的根因）。
  serverExternalPackages: ["firebase-admin", "@vercel/blob"],
};

export default nextConfig;
