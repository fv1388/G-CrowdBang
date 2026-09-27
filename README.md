# G-CrowdBang · 多租户众包流量平台

众包流量分发平台：**A 端国内商户**发布悬赏（招商 / 充值 / 发单 / 审计），**B 端海外接单人**接单（任务大厅 / GPS 硬件校验 / 结算 / 提现），全程走标准透明的多租户记账与分账。

- GitHub 核心主仓库：**G-CrowdBang**
- Firebase 数据库登记名：**F-CrowdBang**
- Vercel 托管登记名：**V-CrowdBang**

> 仅涉及标准多租户路由分流、合规支付校验与公开 API 反查；不含任何伪装指纹 / 规避反爬 / 伪造特征码逻辑。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16.x（App Router，src 目录） |
| 样式 | Tailwind CSS |
| 数据 | Firebase Firestore（F-CrowdBang）+ firebase-admin |
| 鉴权 | Firebase Auth（客户端）+ 服务端 Bearer 校验双栈 |
| 支付 | PayPal Orders API v2（服务端校验捕获状态） |

本地无真实凭证时全部 API 走**确定性 mock**，可离线全链路联调；填入真实凭证自动切 Firestore / PayPal / 平台公开 API，无需改代码。

---

## 快速启动

```bash
npm install
cp .env.local.example .env.local   # 填测试占位即可本地跑；真实凭证见后
npm run dev                         # http://localhost:3000
```

### 路由分流（src/proxy.ts）

| 访问路径 | 行为 | 目标 |
|---|---|---|
| `/admin`, `/admin/*` | 原生 pass-through，保留子路径 | `src/app/admin/**`（商户控制台） |
| `/tasks`, `/tasks/*` | 隐式重写，保留子路径 | `src/app/shop/tasks/**`（任务大厅别名） |
| `/shop/tasks`, `/shop/tasks/*` | 原生 pass-through | `src/app/shop/tasks/**`（任务大厅） |
| `/`（根路径） | `next()` 绿灯放行，绝不重写 | 主零售商城不受污染 |

---

## 前台页面

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | 主零售商城 | 纯净放行，不参与多租户重写 |
| `/admin` | 招商首页 | 全英文 Landing：功能 / 价格 / Escrow 说明 |
| `/admin/campaigns` | 商户看板 | 任务审计 + **Merchant Wallet 充值卡** |
| `/admin/campaigns/new` | 建单表单 | 内容 / 区域(GPS 边界) / 托管参数 |
| `/admin/campaigns/[campaignId]` | 审计明细 | GPS 经纬度 / 核验状态 / 佣金 |
| `/shop/tasks` | 任务大厅 | 视频卡矩阵 + `TaskButton` GPS 校验 |
| `/workers` | 收益工作台 | 收益卡 + **Withdraw to PayPal** 提现卡 |

---

## API 清单（均 mock + firestore 双模式）

| 端点 | 方法 | 职责 | 返回 |
|---|---|---|---|
| `/api/campaigns/list` | GET | 任务大厅拉未满员任务（空则播种演示） | `{campaigns[], source}` |
| `/api/campaigns/create` | POST | 商户建单（余额闸门，不足 402） | `{campaignId, funds_held_usd, merchant_balance_after_usd}` |
| `/api/admin/campaigns` | GET | 看板：本商户任务 + `balance_usd` | `{campaigns[], balance_usd}` |
| `/api/admin/campaigns` | POST | 建单（余额闸门 + debit 流水） | `{campaignId, status, funds_held_usd}` |
| `/api/admin/submissions` | GET | 某任务核验进度 | `{submissions[]}` |
| `/api/tasks/verify-and-publish` | POST | GPS 校验 + 地理围栏 + 写 submissions(PENDING_AUDIT) | `{submissionId, status, is_authentic_match}` |
| `/api/tasks/publish-video` | POST | 回填已发布视频 ID | `{submissionId}` |
| `/api/tasks/verify-and-payout` | POST | 公开状态反查 → 结算 $3 工人 + $1 平台 / 拒付 | `{result, payout}` |
| `/api/workers/my-submissions` | GET | 我的接单 + `balance_usd` | `{submissions[], balance_usd}` |
| `/api/payouts/request` | POST | 提现申请（原子扣减余额 → PENDING_TRANSFER） | `{payoutRequestId, status, remaining_balance_usd}` |
| `/api/merchant/deposit` | POST | 充值（PayPal 校验 → 余额自增 → deposit_history 对账） | `{depositId, status, balance_usd}` |
| `/api/auth/login` | POST | 邮箱登录（真实走 Identity Toolkit / 本地发 mock 令牌） | `{idToken, uid, role, tokenType}` |
| `/api/auth/me` | GET | 校验 Bearer 令牌 | `{uid, role, email}` |

---

## Firestore 数据集合（8 集合）

| 集合 | 用途 | 关键字段 |
|---|---|---|
| `campaigns` | 商户悬赏任务 | `owner_merchant_id`, `geotargeting_config`, `escrow_summary` |
| `submissions` | 接单与设备对账 | `hardware_geoloc{lat,lng}`, `audit_metadata{verification_status}` |
| `users` | 接单人余额 | `role`, `balance_usd` |
| `platform_accounts` | 官方利润账户 | `service_fee_balance_usd` |
| `payout_requests` | 提现对账单 | `status: PENDING_TRANSFER|processed` |
| `merchants` | 商户钱包 | `balance_usd` |
| `merchant_transactions` | 商户资金流水 | `type: deposit|debit` |
| `deposit_history` | 充值对账流水 | `payment_order_id`, `status: COMPLETED` |

安全规则（`firestore.rules`）：多租户隔离 —— 商户只读写自己的任务；接单人只读自己的对账；**余额 / 核验终态 / 提现打款仅服务端 admin 可写**，前端严禁篡改防刷金。

---

## 资金闭环（端到端）

```
商户充值(PayPal 校验 → merchants.balance_usd↑ → deposit_history)
   │
   ▼
商户发单(余额闸门：名额×(佣金+平台费) → 冻结扣款 → campaigns + debit 流水；余额不足 402)
   │
   ▼
老外接单(前端 GPS 硬件校验 → verify-and-publish 地理围栏 → submissions PENDING_AUDIT + held)
   │
   ▼
发布视频回填(publish-video)
   │
   ▼
结算(verify-and-payout：公开状态反查 → verified → 工人+$3 / 平台+$1 记入 official_profit；失败 → rejected 拒付)
   │
   ▼
提现(payouts/request：原子扣减 workers.balance_usd → payout_requests PENDING_TRANSFER)
```

全部资金变更在 Firestore 下走 `runTransaction` 原子操作，防并发超发 / 超提。

---

## 本地自检清单

```bash
npm run dev
```

1. `http://localhost:3000/` → 主商城纯净放行
2. `http://localhost:3000/admin` → 招商首页
3. `http://localhost:3000/admin/campaigns` → 看板 + 钱包（Top Up Wallet 充值 $100 → 余额上涨）
4. `http://localhost:3000/admin/campaigns/new` → 建单（余额不足发单返回 402）
5. `http://localhost:3000/shop/tasks` 与 `/tasks` → 任务大厅视频卡 + GPS 校验按钮
6. `http://localhost:3000/workers` → 收益 + Withdraw to PayPal 提现

---

## 接入真实环境

在 `.env.local` 填入（服务端凭证，严禁提交 GitHub，`.gitignore` 已保护）：

| 变量 | 用途 |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | F-CrowdBang 公共句柄 |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | 服务端 admin 凭证 |
| `PAYPAL_PRODUCTION_CLIENT_ID` / `PAYPAL_PRODUCTION_SECRET` | PayPal Live 校验 |
| `SOCIAL_PLATFORM_APP_ID` / `SOCIAL_PLATFORM_API_TOKEN` | 公开 API 反查 |

凭证守卫：`FIREBASE_PRIVATE_KEY` 含 `TEST_ONLY_PLACEHOLDER` 或 project id 为占位时，自动降级 mock。
