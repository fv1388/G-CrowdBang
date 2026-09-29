// src/app/api/merchant/deposit/create-order/route.js
// ==========================================================================
// G-CrowdBang / F-CrowdBang · 商户充值第一步：创建 PayPal 收款订单
// --------------------------------------------------------------------------
// 职责：A端商户点击"充值"时，由本接口在服务端创建一笔 PayPal Order，
//       返回官方授权链接 approve_url，前端跳转 PayPal 让商家完成美金付款。
// 入参：{ merchantId, amountUsd }
// 返回：{ orderId, approveUrl, status }
// 真实凭证 → 调 PayPal Orders API v2；无真实凭证 → 返回 mock 订单（联调用）。
// ==========================================================================

import { NextResponse } from "next/server";
import { createOrder, paypalCredsReady } from "@/lib/paypal";

export async function POST(request) {
  try {
    const body = await request.json();
    const merchantId = body?.merchantId;
    const amount = Number(body?.amountUsd ?? body?.amount);

    if (!merchantId) {
      return NextResponse.json({ error: "MISSING_MERCHANT_ID" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
    }

    // 无真实凭证：返回 mock 订单，便于本地联调（线上配置真实凭证后自动切换）
    if (!paypalCredsReady()) {
      return NextResponse.json(
        {
          orderId: `mock_order_${Date.now()}`,
          approveUrl: null,
          status: "MOCK",
          local_mock: true,
          message: "PayPal Live credentials not configured — local mock order.",
        },
        { status: 200 }
      );
    }

    const origin = new URL(request.url).origin;
    const returnUrl = `${origin}/admin/campaigns`; // 支付完成回跳商户任务看板
    const cancelUrl = `${origin}/admin`;

    const order = await createOrder({
      amountUsd: amount,
      merchantId,
      returnUrl,
      cancelUrl,
    });

    if (!order.approve_url) {
      return NextResponse.json({ error: "NO_APPROVE_LINK" }, { status: 500 });
    }

    return NextResponse.json(
      { orderId: order.order_id, approveUrl: order.approve_url, status: order.status },
      { status: 201 }
    );
  } catch (err) {
    console.error("[merchant/deposit/create-order]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR", reason: err.message }, { status: 500 });
  }
}
