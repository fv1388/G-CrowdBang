// src/app/api/workers/my-submissions/route.js
// G-CrowdBang / F-CrowdBang · Worker 个人接单与收益接口（App Router Route Handler）
// 职责：返回当前接单人自己的 submissions 列表（含核验状态、佣金、金额）。
// 归属：workerId 生产环境来自认证会话；此处以 query/env 兜底示意。
// 兼容策略：装有 firebase-admin 读 Firestore；未装时降级本地 mock，保证本地联调。

import { NextResponse } from "next/server";
import { mockSubmissions, mockUsers } from "../../tasks/_mock-store";

let db = null;
let firebaseAvailable = false;
try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
  db = getFirestore();
  firebaseAvailable = true;
} catch (e) {
  console.warn("[workers/my-submissions] firebase-admin unavailable, using local mock");
}

// 凭证守卫：依赖已装但 FIREBASE_* 为占位/缺失时，仍降级 mock（避免用假凭证连真库）
if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

function currentWorkerId() {
  return process.env.WORKER_ID ?? "usr_current";
}

export async function GET(request) {
  try {
    const workerId = currentWorkerId();

    if (!firebaseAvailable) {
      // 本地 mock：从共享 mock 账本中筛出该 worker 的记录；为空则返回演示记录
      const rows = [...mockSubmissions.values()].filter((s) => s.worker_id === workerId);
      const list = rows.length
        ? rows.map((s) => ({
            submissionId: s.submission_id,
            campaignId: s.campaign_id,
            status: s.audit_metadata?.verification_status,
            payout: s.payout_status,
            claimedAt: s.claim_timestamp,
            revisionCount: s.audit_metadata?.revision_count ?? 0,
            revisionReason: s.audit_metadata?.revision_reason ?? null,
          }))
        : [
            {
              submissionId: "sub_demo_001",
              campaignId: "cmp_demo_001",
              status: "PENDING_AUDIT",
              payout: "held",
              claimedAt: new Date().toISOString(),
            },
            {
              submissionId: "sub_demo_002",
              campaignId: "cmp_demo_002",
              status: "verified",
              payout: "paid",
              claimedAt: new Date(Date.now() - 86400000).toISOString(),
            },
          ];
      // 当前可用提现余额（结算入账后由 verify-and-payout 写入 mockUsers）
      const balanceUsd = mockUsers.get(workerId)?.balance_usd ?? 0;
      return NextResponse.json({ submissions: list, balance_usd: balanceUsd, source: "mock" }, { status: 200 });
    }

    const snap = await db.collection("submissions")
      .where("worker_id", "==", workerId)
      .orderBy("claim_timestamp", "desc")
      .limit(50)
      .get();

    const list = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        submissionId: doc.id,
        campaignId: d.campaign_id,
        status: d.audit_metadata?.verification_status,
        payout: d.payout_status,
        claimedAt: d.claim_timestamp,
        revisionCount: d.audit_metadata?.revision_count ?? 0,
        revisionReason: d.audit_metadata?.revision_reason ?? null,
      };
    });

    // 当前可用提现余额（users 集合 balance_usd）
    let balanceUsd = 0;
    const userSnap = await db.collection("users").doc(workerId).get();
    if (userSnap.exists) balanceUsd = userSnap.data()?.balance_usd || 0;

    return NextResponse.json({ submissions: list, balance_usd: balanceUsd, source: "firestore" }, { status: 200 });
  } catch (err) {
    console.error("[workers/my-submissions] GET", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
