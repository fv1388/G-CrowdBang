// src/lib/paypal.js
// ==========================================================================
// G-CrowdBang / F-CrowdBang · PayPal 服务端接入共用库（标准合规实现）
// --------------------------------------------------------------------------
// 职责：统一封装 PayPal REST API 的服务端调用，供商户充值（收款）与
//       老外提现（打款）两大业务使用，绝不向前端浏览器暴露任何密钥。
//   1) getAccessToken()      OAuth 客户端凭证换 access_token（Basic Auth）
//   2) createOrder()         PayPal Orders API v2 —— 创建收款订单，返回授权链接
//   3) captureOrder()        PayPal Orders API v2 —— 捕获（确认到账）一笔订单
//   4) getOrder()            PayPal Orders API v2 —— 查询订单状态
//   5) createPayout()        PayPal Payouts API —— 平台向老外 PayPal 邮箱打款
//   6) getPayout()           查询批量打款批次状态
//   7) verifyWebhook()       PayPal Webhook 签名验签（可选严格校验）
//
// 合规：仅使用 PayPal 官方公开端点与标准 OAuth / Orders / Payouts 协议，
//       不涉及任何规避、伪造或反爬逻辑。
// ==========================================================================

const PAYPAL_MODE = process.env.PAYPAL_MODE === "sandbox" ? "sandbox" : "production";

// 官方端点（沙盒 / 生产自动切换）
const API_BASE =
  PAYPAL_MODE === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

// ---- 凭证守卫：必须是真实凭证才走真钱；否则由调用方降级 mock ----
// PayPal 新版应用凭证为长字符串（不带 live_ 前缀，约 80-100 字符），
// 旧版生产凭证以 live_ 开头。判定只排除占位/空值，再以长度作基本门限。
export function paypalCredsReady() {
  const cid = process.env.PAYPAL_CLIENT_ID || process.env.PAYPAL_PRODUCTION_CLIENT_ID || "";
  const sec = process.env.PAYPAL_SECRET || process.env.PAYPAL_PRODUCTION_SECRET || "";
  if (!cid || !sec) return false;
  if (cid.includes("your_") || sec.includes("your_")) return false;
  if (cid.includes("never_expose") || sec.includes("never_expose")) return false;
  if (cid.trim().length < 40 || sec.trim().length < 40) return false;
  return true;
}

// 从环境读取当前模式的凭证（兼容两种命名：旧 PAYPAL_PRODUCTION_* 与新 PAYPAL_*）
function clientId() {
  return process.env.PAYPAL_CLIENT_ID || process.env.PAYPAL_PRODUCTION_CLIENT_ID || "";
}
function clientSecret() {
  return process.env.PAYPAL_SECRET || process.env.PAYPAL_PRODUCTION_SECRET || "";
}

// ---- 1) 获取 PayPal 访问令牌（客户端凭证授权）----
export async function getAccessToken() {
  const auth = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`PAYPAL_AUTH_HTTP_${res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ---- 2) 创建收款订单（商户向平台充值）----
// 返回 { order_id, approve_url, status }
export async function createOrder({ amountUsd, merchantId, returnUrl, cancelUrl }) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: merchantId, // 用商户 UID 作订单关联，便于后续归账
          amount: { currency_code: "USD", value: Number(amountUsd).toFixed(2) },
        },
      ],
      application_context: {
        brand_name: "G-CrowdBang",
        user_action: "PAY_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`PAYPAL_CREATE_ORDER_${res.status}:${err?.name || ""}`);
  }
  const order = await res.json();
  const approveLink = order?.links?.find((l) => l.rel === "approve")?.href || null;
  return { order_id: order.id, approve_url: approveLink, status: order.status };
}

// ---- 3) 捕获订单（确认款项真实到账）----
// 返回 PayPal 捕获明细；调用方需校验 status === "COMPLETED"。
export async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`PAYPAL_CAPTURE_HTTP_${res.status}`);
  }
  return await res.json();
}

// ---- 4) 查询订单状态 ----
export async function getOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PAYPAL_GET_ORDER_HTTP_${res.status}`);
  return await res.json();
}

// ---- 5) 平台向老外 PayPal 邮箱打款（PayPal Payouts API）----
// sender_batch_id 用于幂等防重；返回 batch_id 供查询。
// 注意：PayPal 生产环境需在开发者后台开通 Payouts（Batch Payouts）权限。
export async function createPayout({ recipientEmail, amountUsd, payoutBatchId }) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: payoutBatchId,
        email_subject: "G-CrowdBang payout",
        email_message: "You have received a payout for your completed tasks.",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: recipientEmail, // 老外的 PayPal 邮箱
          amount: { value: Number(amountUsd).toFixed(2), currency: "USD" },
          note: "Task completion payout",
          sender_item_id: payoutBatchId,
        },
      ],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`PAYPAL_PAYOUT_HTTP_${res.status}:${err?.name || ""}`);
  }
  const batch = await res.json();
  return { batch_id: batch?.batch_header?.payout_batch_id, status: batch?.batch_header?.batch_status };
}

// ---- 6) 查询打款批次状态 ----
export async function getPayout(batchId) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PAYPAL_GET_PAYOUT_HTTP_${res.status}`);
  return await res.json();
}

// ---- 7) PayPal Webhook 签名验签（严格校验可选）----
// 需要在 PayPal 开发者后台配置 Webhook URL 并拿到 PAYPAL_WEBHOOK_ID；
// 未配置时返回 true 跳过验签（生产强烈建议开启）。
export async function verifyWebhook({ headers, body }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return true; // 未配置 → 跳过验签（联调阶段）

  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const authAlgo = headers["paypal-auth-algo"];
  const transmissionSig = headers["paypal-transmission-sig"];

  if (!transmissionId || !transmissionSig || !certUrl || !authAlgo) return false;

  // 调用官方验签接口（verify-webhook-signature）
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: body,
    }),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data?.verification_status === "SUCCESS";
}
