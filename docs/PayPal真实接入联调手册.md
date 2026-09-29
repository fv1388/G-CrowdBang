# G-CrowdBang · PayPal 真实收付接入与联调手册

> 目标：让平台真正收商家的美金、真正给老外打款，把“账本”变成“真钱”。
> 前提：一个能收美金的 **PayPal Business（商业）账户** —— 它就是平台的“总金库”。

---

## 一、整体资金闭环（先看懂再动手）

```
商家(中国)                   平台 PayPal 商业账户(你的总金库)            老外(美国)
   │                                  │                                     │
   │ ① 点充值 → 跳 PayPal 付款        │                                     │
   ├──────────────────────────────────►│                                     │
   │                                  │ ② 到账确认 → 商户托管余额 +$12       │
   │                                  │                                     │
   │                                  │ 核验通过后                           │
   │                                  │ ③ PayPal Payouts 向老外邮箱打 $10    │
   │                                  ├────────────────────────────────────►│
   │                                  │                                     │
   │                                  │ ④ 剩下 $2/单留在平台余额 = 平台利润   │
```

平台的钱**不是单独收**：商家付进来 → 打 $10 给老外 → 剩下的 $2 自然留在你账户。分账在打款那一步完成。

---

## 二、需要准备的 3 样东西

| # | 东西 | 在哪拿 |
|---|------|--------|
| 1 | PayPal **Business** 账号 | https://www.paypal.com → 注册商业账户（个人账户不开放 Payouts） |
| 2 | **API 凭证**（Client ID + Secret） | 登录 PayPal → 开发者后台 → https://developer.paypal.com → My Apps → 你的应用 → Live API credentials |
| 3 | **Payouts（批量打款）权限** | 同一后台 → Settings → 勾选/申请开通 Payouts（给老外打款必需） |

> 先跑通建议用 **Sandbox（沙盒）** 测试：开发者后台创建 Sandbox 应用即可拿到沙盒凭证，用官方沙盒买家和卖家账号演练，零成本。

---

## 三、填凭证（本地 + 线上两处都要）

复制 `.env.local.example` 为 `.env.local`，填入：

```bash
# 生产真钱：production；先测试：sandbox
PAYPAL_MODE=sandbox            # ← 先 sandbox，全测通后再改 production
PAYPAL_CLIENT_ID=你的ClientID   # 沙盒填沙盒App的，生产填 live_ 开头的
PAYPAL_SECRET=你的Secret
```

- **本地**：填进 `G-CrowdBang/.env.local`（已被 .gitignore 保护，不会泄漏）
- **线上 Vercel**：项目 → Settings → Environment Variables → 加 `PAYPAL_MODE / PAYPAL_CLIENT_ID / PAYPAL_SECRET`（Production 环境）

> 只有当 `PAYPAL_CLIENT_ID` 填的是真实值（生产以 `live_` 开头）时，代码才走“真钱”分支；否则自动走本地 mock，不会真的扣款/打款。**没配好真实凭证前，绝不可能误付出一分钱。**

---

## 四、配置 Webhook（自动对账，推荐）

1. 开发者后台 → 你的应用 → **Webhooks** → Add Webhook URL
2. 填线上回调：`https://g-crowdbang.vercel.app/api/paypal/webhook`
3. 订阅事件（至少勾选）：
   - `PAYMENT.CAPTURE.COMPLETED`（商家充值到账）
   - `PAYMENT.PAYOUTSBATCH.SUCCESS / PROCESSING / DENIED`（打款状态）
4. 保存后把返回的 **Webhook ID** 填进 `PAYPAL_WEBHOOK_ID`（本地 + Vercel）

---

## 五、联调流程（测试版全走一遍）

### A. 商家充值（收款）
1. 商户控制台 `/admin` → 输入充值金额 → 点“充值”
2. 前端跳转到 PayPal 付款页 → 用沙盒买家账号完成支付
3. 支付完成回跳 → 前端调 `/api/merchant/deposit/capture` 确认到账
4. 观察 `/admin/campaigns`：余额应增加对应金额；`deposit_history` 多一条 COMPLETED

### B. 老外提现（打款）
1. 老外赚到余额后，在工作台输入金额 + PayPal 邮箱 → 提交提现
2. 后端调用 `/api/payouts/request` → 真凭证下触发 PayPal Payouts
3. 观察：老外 PayPal 邮箱收到打款；`payout_requests` 状态从 PENDING_TRANSFER → PROCESSING → SUCCESS

---

## 六、代码文件说明（本次新增/改动）

| 文件 | 作用 |
|------|------|
| `src/lib/paypal.js` | PayPal 共用库：鉴权 / 创建订单 / 捕获 / 打款 / 验签 |
| `src/app/api/merchant/deposit/create-order/route.js` | 充值第一步：创建 PayPal 订单返回付款链接 |
| `src/app/api/merchant/deposit/capture/route.js` | 充值第二步：确认到账并入账余额 |
| `src/app/api/paypal/webhook/route.js` | PayPal 事件自动对账（幂等，防重放） |
| `src/app/api/payouts/request/route.js` | 提现申请：真实 Payouts 打款 + 状态跟踪 |
| `.env.local.example` | 补充 PayPal 环境变量模板 |

---

## 七、安全与风控（必读）

1. **凭证绝不进前端**：`PAYPAL_CLIENT_ID / SECRET` 只存在于服务端 .env，禁止加 `NEXT_PUBLIC_` 前缀。
2. **Webhook 验签**：生产务必填 `PAYPAL_WEBHOOK_ID`，代码会强制验签，防伪造回调。
3. **幂等防重放**：充值以 `capture_id`、打款以 `sender_batch_id` 去重，重复回调不会重复入账。
4. **提现起付线**：当前 `$15`（可改），防止“做一单提一单”被 PayPal 固定通道费吃光利润。
5. **打款失败处理**：余额已扣但打款失败会标记 `PAYOUT_FAILED`，需人工核对后退款/重试。

---

## 八、上线前检查清单

- [ ] 已申请到 PayPal Business 账号（能收美金）
- [ ] 已拿到 Live Client ID（`live_` 开头）与 Secret
- [ ] 已开通 Payouts 批量打款权限
- [ ] 沙盒全流程（充值→付款→到账 / 提现→打款）已跑通
- [ ] `PAYPAL_WEBHOOK_ID` 已配置并验签通过
- [ ] `.env.local` 与 Vercel 环境变量都已改为 `production` 真实凭证
- [ ] 换正式环境后做一笔小额真实验证再开放
