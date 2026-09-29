// src/app/api/auth/google/route.js
// ==========================================================================
// G-CrowdBang / F-CrowdBang · Google 一键登录服务端校验端点
// --------------------------------------------------------------------------
// 职责：
//   1) 接收前端 GSI(Google Identity Services) 拿到的 ID Token（body.credential）。
//   2) 调用 Google 公开校验端点 https://oauth2.googleapis.com/tokeninfo?id_token=...
//      校验签名、有效期与 email_verified（无需 Client Secret）。
//   3) 校验通过后：按邮箱在 F-CrowdBang 查找/创建 Firebase 用户，并确保
//      users 账本存在该用户的多租户角色烙印（首次登录自动建号）。
//   4) 返回 { success, uid, email, role }，前端据此用 Firebase
//      signInWithCredential 建立会话并跳转到对应角色空间。
// 合规：标准 OAuth ID Token 服务端校验 + 自动建号；不含任何规避逻辑。
// ==========================================================================
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

// ---- Firebase Admin 单例初始化（幂等；凭证缺失/占位 → mock 模式）----
function adminApp() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const realCreds =
    projectId &&
    projectId !== "f-crowdbang-test" &&
    clientEmail &&
    privateKey &&
    !String(privateKey).includes("TEST_ONLY_PLACEHOLDER");
  if (!realCreds) return null;
  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { credential, role } = body || {};

    // 1) 凭证判空
    if (!credential || typeof credential !== "string") {
      return NextResponse.json({ success: false, message: "缺少 Google 登录凭证。" }, { status: 400 });
    }

    // 2) 服务端校验 ID Token（Google 公开端点，验签名 + email_verified）
    const tokenRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!tokenRes.ok) {
      return NextResponse.json({ success: false, message: "Google 凭证校验失败，请重试。" }, { status: 401 });
    }
    const payload = await tokenRes.json();
    if (!payload.email || payload.email_verified !== "true") {
      return NextResponse.json({ success: false, message: "Google 邮箱未完成验证，无法登录。" }, { status: 401 });
    }

    const normalizedEmail = String(payload.email).trim().toLowerCase();
    const targetRole = String(role || "WORKER").toUpperCase();
    const displayName = payload.name || normalizedEmail.split("@")[0];

    const fbApp = adminApp();

    // 3) mock 环境（无真实服务账号凭证）→ 返回确定性会话，前端走本地联调
    if (!fbApp) {
      return NextResponse.json({
        success: true,
        uid: `mock_google_${Date.now().toString(36)}`,
        email: normalizedEmail,
        role: targetRole,
        message: "Google 登录成功（本地 Mock）。",
      });
    }

    // 4) 真实模式：按邮箱查找/创建 Firebase 用户 + 写入 users 多租户账本
    const auth = adminAuth(fbApp);
    const db = getFirestore(fbApp);

    let uid = null;
    try {
      const existing = await auth.getUserByEmail(normalizedEmail);
      uid = existing.uid;
    } catch (e) {
      const created = await auth.createUser({
        email: normalizedEmail,
        emailVerified: true,
        displayName,
      });
      uid = created.uid;
    }

    // 5) 确保 users 账本记录存在（含角色烙印）；老用户继承账本角色
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    let userRole = targetRole;
    if (userSnap.exists) {
      userRole = userSnap.data().role || targetRole;
    } else {
      await userRef.set({
        uid,
        email: normalizedEmail,
        role: targetRole,
        balance_usd: 0.0,
        created_at: new Date().toISOString(),
      });
      // 老外新用户：初始化零额度钱包，防止查账报红
      if (targetRole === "WORKER") {
        await db.collection("workers").doc(uid).set({ balance: 0.0 });
      }
    }

    return NextResponse.json({
      success: true,
      uid,
      email: normalizedEmail,
      role: userRole,
      message: "Google 登录成功！",
    });
  } catch (err) {
    console.error("[Google Auth Error]", err);
    return NextResponse.json({ success: false, message: "Google 登录服务异常，请稍后重试。" }, { status: 500 });
  }
}
