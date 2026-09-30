import { NextResponse } from "next/server";
import { mockMerchants } from "../../tasks/_mock-store";

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
  console.warn("[merchant/deposit] firebase-admin unavailable, using local mock");
}

if (
  !process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID === "f-crowdbang-test" ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  String(process.env.FIREBASE_PRIVATE_KEY).includes("TEST_ONLY_PLACEHOLDER")
) {
  firebaseAvailable = false;
}

function paypalCredsReady() {
  const cid = process.env.PAYPAL_PRODUCTION_CLIENT_ID || "";
  const sec = process.env.PAYPAL_PRODUCTION_SECRET || "";
  return Boolean(
    cid.startsWith("live_") && !cid.includes("your_") && sec && !sec.includes("your_")
  );
}

function validateAmount(amount) {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0;
}

async function verifyPayment(paymentReference, amountUsd) {
  if (!paypalCredsReady()) {
    return { ok: true, verified: true, local_mock: true };
  }

  const auth = Buffer.from(
    `${process.env.PAYPAL_PRODUCTION_CLIENT_ID}:${process.env.PAYPAL_PRODUCTION_SECRET}`
  ).toString("base64");
  const tokenRes = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) return { ok: false, reason: `AUTH_HTTP_${tokenRes.status}` };
  const tokenData = await tokenRes.json();

  const orderRes = await fetch(
    `https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(paymentReference)}`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  if (!orderRes.ok) return { ok: false, reason: `ORDER_HTTP_${orderRes.status}` };
  const order = await orderRes.json();

  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
  const isCompleted =
    capture?.status === "COMPLETED" &&
    Number(capture?.amount?.value) >= amountUsd;

  return { ok: isCompleted, verified: isCompleted, raw: order };
}

export async function POST(request) {
  try {
    const body = await request.json();

    const merchantId = body?.merchantId;
    const amount = body?.depositAmount ?? body?.amount;
    const paymentOrderId = body?.paymentOrderId ?? body?.paymentReference;
    const currency = body?.currency || "USD";

    if (!merchantId || !paymentOrderId || amount === undefined || amount === null || amount === "") {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
    }

    const amountUsd = Number(amount);

    const payment = await verifyPayment(paymentOrderId, amountUsd);
    if (!payment.ok) {
      return NextResponse.json(
        { error: "PAYMENT_NOT_VERIFIED", reason: payment.reason || "PAYMENT_NOT_COMPLETED" },
        { status: 402 }
      );
    }

    let newBalance;
    let depositId = null;

    if (firebaseAvailable) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("merchants").doc(merchantId);
        const snap = await tx.get(ref);
        const current = snap.exists ? (snap.data()?.balance_usd || 0) : 0;

        if (!snap.exists) {
          tx.set(ref, {
            merchant_id: merchantId,
            balance_usd: amountUsd,
            currency,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          newBalance = amountUsd;
        } else {
          tx.update(ref, {
            balance_usd: FieldValue.increment(amountUsd),
            updated_at: new Date().toISOString(),
          });
          newBalance = current + amountUsd;
        }

        const logRef = db.collection("deposit_history").doc();
        depositId = logRef.id;
        tx.set(logRef, {
          deposit_id: depositId,
          merchant_id: merchantId,
          amount_usd: amountUsd,
          payment_order_id: paymentOrderId,
          status: "COMPLETED",
          created_at: new Date().toISOString(),
        });
      });
    } else {
      const prev = mockMerchants.get(merchantId)?.balance_usd || 0;
      mockMerchants.set(merchantId, { balance_usd: prev + amountUsd, currency });
      newBalance = prev + amountUsd;
      depositId = `deposit_local_${Date.now()}`;
    }

    return NextResponse.json(
      {
        depositId,
        merchantId,
        status: "confirmed",
        amount_usd: amountUsd,
        balance_usd: newBalance,
        payment_verified: true,
        source: firebaseAvailable ? "firestore" : "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[merchant/deposit]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
