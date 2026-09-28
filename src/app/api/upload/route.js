// src/app/api/upload/route.js
// G-CrowdBang / F-CrowdBang · 视频资产真上传接口（App Router Route Handler）
// --------------------------------------------------------------------------
// 职责：接收商户在前端选中的本地视频文件（FormData 的 file 字段），
//       使用 Vercel Blob 对象存储（永久 CDN）上传，返回可公开访问的真实 URL。
// 生产：依赖服务端环境变量 BLOB_READ_WRITE_TOKEN（Vercel Blob Store 的读写令牌，
//       严禁暴露前端）；有 token 时经 @vercel/blob put() 上传到云端 CDN。
// 本地兜底：无 token 时（本地联调 / 未配置 Blob），把文件写入 public/uploads/，
//       返回 /uploads/{file} 相对路径，保证本地也能"真上传不同视频"可演示。
// 合规：仅接收用户主动上传的本地文件，不做任何伪装/规避；返回 URL 由上传产物生成。
// --------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// 运行时可用的文件系统根：Vercel serverless 不可写磁盘，故无 token 的本地兜底仅在自托管/本地生效。
const PUBLIC_DIR = path.join(process.cwd(), "public", "uploads");

export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
    }

    // 类型白名单：仅允许 mp4 视频
    const allowed = ["video/mp4"];
    const type = file.type || "";
    if (!allowed.includes(type)) {
      return NextResponse.json({ error: "UNSUPPORTED_TYPE", hint: "only video/mp4" }, { status: 415 });
    }

    const originalName = (file.name || `clip_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = path.extname(originalName).toLowerCase() || ".mp4";
    const safeName = `campaign_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length <= 0) {
      return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });
    }
    // 体积上限 50MB，防止恶意超大上传拖垮接口
    if (bytes.length > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "FILE_TOO_LARGE", hint: "max 50MB" }, { status: 413 });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;

    // ---- 生产路径：Vercel Blob 云端 CDN ----
    if (token) {
      const { put } = await import("@vercel/blob");
      const blob = await put(safeName, bytes, {
        access: "public",
        addRandomSuffix: false,
        contentType: type,
        token,
      });
      return NextResponse.json({ url: blob.url, source: "vercel-blob" }, { status: 200 });
    }

    // ---- 本地兜底：写入 public/uploads/，返回本地静态路径（本地联调可用） ----
    await mkdir(PUBLIC_DIR, { recursive: true });
    await writeFile(path.join(PUBLIC_DIR, safeName), bytes);
    const localUrl = `/uploads/${safeName}`;
    return NextResponse.json({ url: localUrl, source: "local-fs" }, { status: 200 });
  } catch (err) {
    console.error("[api/upload]", err);
    return NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  }
}
