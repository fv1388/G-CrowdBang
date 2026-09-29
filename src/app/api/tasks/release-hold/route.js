// src/app/api/tasks/release-hold/route.js
// G-CrowdBang / F-CrowdBang · 保留期届满结算接口（App Router Route Handler）
// --------------------------------------------------------------------------
// 职责：两段式结算的第二段。人工核验放行时只释放 70% 佣金，30% 冻结到保留期。
//       本接口在保留期届满后执行【公开状态复核】：
//         - 视频仍公开（链接可达） → 释放冻结的 30% 佣金进老外可提现余额。
//         - 视频已被删除/404/410     → 冻结佣金扣除（拉黑违约老外），并把该笔退回商家。
//         - 无法判断（403/网络错）  → 保守保留冻结，标记 NEEDS_REVIEW，等待人工判定，不误伤。
// 合规：仅做标准 URL 可达性复核与账本原子结算，不涉及任何反爬/指纹规避。
// --------------------------------------------------------------------------

import { NextResponse } from "next/server";
import {
  mockSubmissions,
  mockUsers,
  mockMerchants,
  applyFlatUpdate,
} from "../_mock-store";

// ---- Firebase Admin 单例（F-CrowdBang）；缺依赖时降级本地 mock ----
let db = null;
let firebaseAvailable = false;
let FieldValue = null;

try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const fstore = await import("firebase-admin/firestore");
  FieldValue = fstore.FieldValue;
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
  db = fstore.getFirestore();
  firebaseAvailable = true;
} catch (e) {
  console.warn("[release-hold] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

/**
 * 公开状态复核：诚实地做一次 URL 可达性检查。
 *   - 200/2xx          → 判定"可能仍公开"
 *   - 404 / 410        → 判定"已被删除"
 *   - 403 / 5xx / 网络错 → 无法可靠判断（反爬拦截不等于删除），保守保留
 */
async function checkPublicStatus(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { state: "unknown", reason: "NO_URL" };
  }
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    const s = res.status;
    if (s >= 200 && s < 400) return { state: "alive", status: s };
    if (s === 404 || s === 410) return { state: "deleted", status: s };
    return { state: "unknown", status: s };
  } catch (e) {
    return { state: "unknown", reason: "NETWORK_ERROR" };
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const onlySubmissionId = body?.submissionId || null;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    let holding = []; // [{ id, ref, data }]
    if (firebaseAvailable) {
      const q = await db
        .collection("submissions")
        .where("retention_status", "==", "HOLDING")
        .limit(50)
        .get();
      for (const d of q.docs) {
        holding.push({ id: d.id, ref: d.ref, data: d.data() });
      }
    } else {
      for (const [id, m] of mockSubmissions.entries()) {
        if (m?.retention_status === "HOLDING") holding.push({ id, ref: null, data: m });
      }
    }

    // 可选：只处理指定单
    if (onlySubmissionId) {
      holding = holding.filter((h) => h.id === onlySubmissionId);
    }

    const results = [];

    for (const { id, ref, data } of holding) {
      const releaseAt = new Date(data.retention_release_at || 0).getTime();
      // 未到期：跳过（除非调用方 force）
      if (!body?.force && releaseAt > nowMs) {
        results.push({ submissionId: id, action: "not_yet_due", release_at: data.retention_release_at });
        continue;
      }

      const holdUsd = Number(data.hold_worker_usd || 0);
      const workerId = data.worker_id;
      const campaignId = data.campaign_id;
      const url = data.published_video_url || data.published_video_id || "";

      const check = await checkPublicStatus(url);

      if (check.state === "alive") {
        // ✅ 仍公开 → 释放冻结的 30% 进可提现余额
        if (firebaseAvailable) {
          await db.runTransaction(async (tx) => {
            tx.update(ref, {
              retention_status: "RELEASED",
              payout_status: "paid_full",
              released_at: nowIso,
              updated_at: nowIso,
            });
            if (workerId) {
              tx.set(
                db.collection("users").doc(workerId),
                {
                  balance_usd: FieldValue.increment(holdUsd),
                  hold_balance_usd: FieldValue.increment(-holdUsd),
                },
                { merge: true }
              );
            }
          });
        } else {
          applyFlatUpdate(data, {
            retention_status: "RELEASED",
            payout_status: "paid_full",
            released_at: nowIso,
            updated_at: nowIso,
          });
          const w = mockUsers.get(workerId) || {};
          mockUsers.set(workerId, {
            balance_usd: (w.balance_usd || 0) + holdUsd,
            hold_balance_usd: Math.max(0, (w.hold_balance_usd || 0) - holdUsd),
          });
        }
        results.push({ submissionId: id, action: "released", released_usd: holdUsd });
      } else if (check.state === "deleted") {
        // 🚨 已删 → 冻结佣金扣除（拉黑），退回商家，保全商家资金
        if (firebaseAvailable) {
          await db.runTransaction(async (tx) => {
            tx.update(ref, {
              retention_status: "FUNDS_RECLAIMED",
              payout_status: "reclaimed",
              reclaim_reason: "VIDEO_DELETED",
              reclaimed_at: nowIso,
              updated_at: nowIso,
            });
            if (workerId) {
              tx.update(db.collection("users").doc(workerId), {
                hold_balance_usd: FieldValue.increment(-holdUsd),
                blacklisted: true,
                blacklist_reason: "DELETED_VIDEO_AFTER_PAYOUT",
                blacklisted_at: nowIso,
              });
            }
            if (campaignId) {
              const snap = await tx.get(db.collection("campaigns").doc(campaignId));
              if (snap.exists) {
                const owner = snap.data()?.owner_merchant_id;
                if (owner) {
                  // 被扣的冻结佣金退回商家可用余额（商家没买到持续曝光，钱退回）
                  tx.update(db.collection("merchants").doc(owner), {
                    balance_usd: FieldValue.increment(holdUsd),
                    updated_at: nowIso,
                  });
                }
              }
            }
          });
        } else {
          applyFlatUpdate(data, {
            retention_status: "FUNDS_RECLAIMED",
            payout_status: "reclaimed",
            reclaim_reason: "VIDEO_DELETED",
            reclaimed_at: nowIso,
            updated_at: nowIso,
          });
          const w = mockUsers.get(workerId) || {};
          mockUsers.set(workerId, {
            hold_balance_usd: Math.max(0, (w.hold_balance_usd || 0) - holdUsd),
            blacklisted: true,
            blacklist_reason: "DELETED_VIDEO_AFTER_PAYOUT",
            blacklisted_at: nowIso,
          });
          const owner = data.owner_merchant_id;
          if (owner && mockMerchants.has(owner)) {
            mockMerchants.set(owner, {
              balance_usd: (mockMerchants.get(owner)?.balance_usd || 0) + holdUsd,
              currency: "USD",
            });
          }
        }
        results.push({ submissionId: id, action: "reclaimed", reclaimed_usd: holdUsd });
      } else {
        // ⚠️ 无法可靠判断（403/网络错）→ 保守保留冻结，标记人工复核，不误伤
        if (firebaseAvailable) {
          await ref.update({ retention_status: "NEEDS_REVIEW", updated_at: nowIso });
        } else {
          applyFlatUpdate(data, { retention_status: "NEEDS_REVIEW", updated_at: nowIso });
        }
        results.push({ submissionId: id, action: "needs_review", reason: check.reason || check.status });
      }
    }

    return NextResponse.json(
      {
        processed: results.length,
        results,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[release-hold]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
