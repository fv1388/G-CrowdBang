// src/app/api/merchant/balance/route.js
// G-CrowdBang / F-CrowdBang · 商户可用托管余额查询接口（App Router Route Handler）
// 职责：A端商户控制台挂载时拉取 merchants 集合中的可用赏金余额(balance_usd)，用于展示
//       美元钱包余额，避免刷新后误显示 $0.00。
// 入参(GET query)：merchantId
// 返回：{ merchantId, balance_usd, source }
// 合规：仅做只读查询，不涉及任何规避/伪造逻辑。
import { NextResponse } from "next/server";
import { mockMerchants } from "../../tasks/_mock-store";

let db = null;
let firebaseAvailable = false;

try {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const fstore = await import("firebase-admin/firestore");
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
  console.warn("[merchant/balance] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get("merchantId");

    if (!merchantId) {
      return NextResponse.json({ error: "MISSING_MERCHANT_ID" }, { status: 400 });
    }

    let balance = 0;
    let source = "mock";

    if (firebaseAvailable) {
      const snap = await db.collection("merchants").doc(merchantId).get();
      if (snap.exists) {
        balance = Number(snap.data()?.balance_usd || 0);
        source = "firestore";
      }
    } else {
      balance = Number(mockMerchants.get(merchantId)?.balance_usd || 0);
    }

    return NextResponse.json({ merchantId, balance_usd: balance, source }, { status: 200 });
  } catch (err) {
    console.error("[merchant/balance]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
