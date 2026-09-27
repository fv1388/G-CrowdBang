# G-CrowdBang · 真库接线保姆级操作手册

> 目标：把本地 **Mock（测试占位）** 切换成 **真实 F-CrowdBang（Firebase Firestore）+ 真实官方 API（TikTok / PayPal / 社交平台）** 的线上可结算闭环。
> 红线：所有真实密钥只写入本地 `.env.local`（已被 `.gitignore` 的 `.env*` 覆盖，绝不推仓）；替换真实凭证时禁止把密钥提交进任何代码或提交信息。

---

## 0. 原理：凭证守卫自动切换（零代码改动）

所有后端接口内置判定，满足以下**任一条件**即走本地 Mock：

| 条件 | 判定 |
|---|---|
| `FIREBASE_PROJECT_ID` 为空 或 = `f-crowdbang-test` | → Mock |
| `FIREBASE_PRIVATE_KEY` 为空 或 含 `TEST_ONLY_PLACEHOLDER` | → Mock |
| `PAYPAL_PRODUCTION_CLIENT_ID` 为空 / 不含 `live_` / 无 SECRET | → Mock（充值） |
| TikTok / 社交平台无有效 Bearer | → 结算 409 拦截 |

**当你把真实值填入 `.env.local` 后，接口自动返回 `source:"firestore"` / 真实 API，代码无需改动。** 下面是逐项接线。

---

## 1. 🔥 Firebase（F-CrowdBang）真库接线

### 1.1 网页端创建/选择项目
1. 打开 https://console.firebase.google.com → 登录 → **添加项目** → 项目名填 `f-crowdbang` → 创建。
2. 左侧 **Build → Firestore Database** → **创建数据库** → 选生产模式 → 区域建议 `nam5 (us-central)`（美区老外读写延迟最优）。
3. 在 **Firestore Database → 规则** 标签页，把仓库 `firestore.rules` 全文粘进去 → **发布**。

### 1.2 生成服务账号私钥
1. 左侧齿轮 **项目设置 → 服务账号** 标签页。
2. 点 **生成新的私钥** → 下载一个 JSON 文件（如 `f-crowdbang-adminsdk.json`）。
3. 该 JSON 里三字段，对应 `.env.local`：

```dotenv
FIREBASE_PROJECT_ID=<json 的 project_id>
FIREBASE_CLIENT_EMAIL=<json 的 client_email>
FIREBASE_PRIVATE_KEY="<json 的 private_key 整段，含 BEGIN/END，代码会还原 \n>"
```

> 注意：`FIREBASE_PRIVATE_KEY` 若用一行粘贴，请保留 `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` 的 `\n` 字面量（代码 `replace(/\\n/g,"\n")` 已处理）。建议用 `.env.local` 多行引号包裹。

### 1.3 部署规则与索引
本地终端（项目根目录）：
```bash
npx firebase login
npx firebase use --add   # 选择项目 f-crowdbang
npx firebase deploy --only firestore:rules,firestore:indexes
```
> `firestore.indexes.json` 已含 6 条复合索引（campaigns/submissions/tiktok_oauth_tokens/tiktok_token_ledger），不部署索引，真库复合查询会报错。

### 1.4 真库生效验证
本地重启 dev 后：
```bash
curl -s http://localhost:3000/api/campaigns/list | python3 -m json.tool | grep source
# 期望：source: "firestore"
```

---

## 2. 🎵 TikTok 官方 OAuth 接线（发布/反查结算）

### 2.1 创建开发者应用
1. https://developers.tiktok.com → **Create App** → 填应用名、用途。
2. 在 **App Detail** 拿到 `Client Key` 与 `Client Secret`。
3. 配置 **OAuth Redirect URI**：填线上回调地址，例如：
   `https://g-crowdbang.vercel.app/admin/connect-tiktok`
4. 申请 `user.info.basic`、`video.publish` 权限（结算反查与发布所需）。

### 2.2 写入 .env.local
```dotenv
# 前端（NEXT_PUBLIC_ 用于拼接授权 URL 与回调换码）
NEXT_PUBLIC_TIKTOK_CLIENT_KEY=<Client Key>
NEXT_PUBLIC_TIKTOK_REDIRECT_URI=https://g-crowdbang.vercel.app/admin/connect-tiktok
# 服务端（令牌签发/刷新/换码，绝不下发浏览器）
TIKTOK_CLIENT_KEY=<Client Key>
TIKTOK_CLIENT_SECRET=<Client Secret>
TIKTOK_OAUTH_REDIRECT_URI=https://g-crowdbang.vercel.app/admin/connect-tiktok
```

### 2.3 真库验证
1. 登录商户端 → 连接 TikTok（授权弹窗）→ 回调自动换码 POST `/api/tiktok/oauth/store` → 返回 201。
2. 管理端审计页对 PENDING_AUDIT 行点 **Settle & Payout** → 返回 `verified`（官方公开 API 反查通过）。
3. 未连接/令牌过期 → 返回 `409 TIKTOK_TOKEN_REQUIRED`（正确拦截）。

---

## 3. 💳 PayPal 真金充值接线

### 3.1 创建 PayPal 开发者应用
1. https://developer.paypal.com → **Dashboard → Apps & Credentials**。
2. 创建 **Live** App → 拿到 `Client ID` 与 `Secret`（**必须带 `live_` 前缀**，代码据此判定走真 API）。
3. 配置 Webhooks / Redirect 回调指向你的线上地址。

### 3.2 写入 .env.local
```dotenv
PAYPAL_PRODUCTION_CLIENT_ID=live_xxxxxxxxxxxx
PAYPAL_PRODUCTION_SECRET=xxxxxxxxxxxx
```
> 只有 Client ID 以 `live_` 开头且 Secret 非空，`/api/merchant/deposit` 才会走真实 PayPal Orders API v2；否则仍 mock。

### 3.3 真库验证
1. 商户端充值 $100 → 后端校验 PayPal 订单成功 → `deposit_history` 写 `COMPLETED`、余额 `FieldValue.increment` 累加。
2. 返回 `{status:"COMPLETED", balance_usd: ...}`。

---

## 4. 📡 社交平台公开 API 反查（结算回退 Bearer）

`verify-and-payout` 优先用商户已连接的 TikTok access_token 作 Bearer；无有效令牌时回退到：
```dotenv
SOCIAL_PLATFORM_APP_ID=<官方开发者 App ID>
SOCIAL_PLATFORM_API_TOKEN=<官方 server-to-server OAuth Token>
```
仅当平台开放 API 需要独立凭证时才必须填；TikTok Bearer 已接管时此项可留空。

---

## 5. 🚀 Vercel 线上变量同步

1. https://vercel.com/fv2/g-crowdbang → **Settings → Environment Variables**。
2. 把 `.env.local` 中的**真实值**逐条添加（`NEXT_PUBLIC_*` 勾选所有环境，高敏项仅 Production）。
3. 重新部署：
```bash
vercel --prod --yes
```
4. 线上核验：
```bash
for p in admin admin/connect-tiktok admin/campaigns shop/tasks workers "" ; do
  echo "/$p -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 30 https://g-crowdbang.vercel.app/$p)"
done
```

---

## 6. 端到端真库验收清单

| 步骤 | 操作 | 期望 |
|---|---|---|
| 1 | 商户充值（PayPal Live） | `COMPLETED`，余额累加 |
| 2 | 建单发布悬赏 | `campaignId` 返回，托管资金锁定 |
| 3 | 连接 TikTok | 令牌入 `tiktok_oauth_tokens`，状态 active |
| 4 | 老外接单（GPS） | `PENDING_AUDIT` 入 `submissions` |
| 5 | 发布视频（TikTok Bearer） | `published_video_id` 回填 |
| 6 | 审计结算 | `verified`，$3→worker、$1→官方利润 |
| 7 | 提现（PayPal） | `PENDING_TRANSFER` |

任一环节返回 Mock 的 `source`/`409`，即该线凭证未切真，回查上面对应章节。

---

## 7. 安全纪律（必读）
1. `.env.local` 永不推仓；换密钥后同步更新 Vercel。
2. 任何带 `NEXT_PUBLIC_` 的项会进浏览器，只能放公开句柄。
3. 服务账号私钥、PayPal Secret、TikTok Client Secret 属高敏，仅服务端读取。
4. 若 GitHub 历史误提交过真实密钥，立即轮换该密钥并 `git filter-repo` 清历史。
