// src/app/api/tasks/publish-video/route.js
// G-CrowdBang / F-CrowdBang · 用户发布视频后回填 published_video_id（App Router Route Handler）
// 职责：worker 在发布视频后，将官方视频 ID 回填到自己的 pending submission。
// 约束：仅 pending 可回填；已进入 verified/rejected 终态则拒绝，防止结算后篡改。

import { NextResponse } from "next/server";
import { mockSubmissions } from "../_mock-store";

// ---- Firebase Admin 单例（F-CrowdBang）；缺依赖时降级本地 mock，保证本地联调可运行 ----
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
  console.warn("[publish-video] firebase-admin unavailable, using local mock");
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

export async function POST(request) {
  try {
    const { submissionId, workerId, publishedVideoId } = await request.json();
    if (!submissionId || !workerId || !publishedVideoId) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    let submission;
    if (firebaseAvailable) {
      const subRef = db.collection("submissions").doc(submissionId);
      const snap = await subRef.get();
      if (!snap.exists) {
        return NextResponse.json({ error: "SUBMISSION_NOT_FOUND" }, { status: 404 });
      }
      submission = snap.data();
    } else {
      const m = mockSubmissions.get(submissionId);
      if (!m) {
        return NextResponse.json({ error: "SUBMISSION_NOT_FOUND" }, { status: 404 });
      }
      submission = m;
    }

    // 归属校验：只有接单本人可回填
    if (submission.worker_id !== workerId) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // 状态约束：仅 PENDING_AUDIT 可回填，终态不可逆
    if (submission.audit_metadata?.verification_status !== "PENDING_AUDIT") {
      return NextResponse.json(
        { error: "NOT_PENDING", status: submission.audit_metadata?.verification_status },
        { status: 409 }
      );
    }

    // 回填视频 ID
    const update = {
      "audit_metadata.published_video_id": publishedVideoId,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (firebaseAvailable) {
      await db.collection("submissions").doc(submissionId).update(update);
    } else {
      Object.assign(mockSubmissions.get(submissionId), update);
    }

    return NextResponse.json({ result: "updated", submissionId }, { status: 200 });
  } catch (err) {
    console.error("[publish-video]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
