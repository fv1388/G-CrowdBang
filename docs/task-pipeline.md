# F-CrowdBang · 任务闭环链路说明与本地测试

## 链路总览
```
TaskButton 接单上报
  → POST /api/tasks/verify-and-publish   (创建 pending submission，资金 held)
用户发布视频后回填
  → POST /api/tasks/publish-video        (回填 published_video_id)
服务端核验结算
  → POST /api/tasks/verify-and-payout    (官方API反查公开状态)
       ├ verified → worker +$3.00 / platform +$1.00
       └ rejected → 退托管(released)
```

## 前置条件（编译/运行前必须完成）
```bash
cd /Users/wang/Doubao/chats/2026-09-26/new-chat/g-crowdbang
npm install firebase-admin
cp .env.local.example .env.local        # 填入真实值
```
环境变量：
- `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`（Firebase 服务账号）
- `SOCIAL_PLATFORM_API_TOKEN`（结算接口官方 API 凭据）

## 本地顺序测试（dev 服务运行后，用 curl 验证闭环）
```bash
# 1) 接单上报
curl -X POST http://localhost:3000/api/tasks/verify-and-publish \
  -H "Content-Type: application/json" \
  -d '{"campaignId":"cmp_test","workerId":"usr_test","telemetry":{"latitude":30.3322,"longitude":-81.6557,"accuracy":30}}'
# → 期望 201，返回 submissionId 与 status=pending

# 2) 发布后回填（把 <submissionId> 换成上一步返回值）
curl -X POST http://localhost:3000/api/tasks/publish-video \
  -H "Content-Type: application/json" \
  -d '{"submissionId":"<submissionId>","workerId":"usr_test","publishedVideoId":"v_test123"}'
# → 期望 200 updated

# 3) 核验结算（此步依赖官方 API 反查，需 token 与真实平台端点）
curl -X POST http://localhost:3000/api/tasks/verify-and-payout \
  -H "Content-Type: application/json" \
  -d '{"submissionId":"<submissionId>"}'
# → 期望 verified / rejected
```

## 状态机约束（不可逆）
- 仅 `pending → verified / rejected`
- `published_video_id` 仅 pending 阶段可回填
- 资金仅 verified 放款，rejected 退托管

## 说明
- `lookupPublishedVideo` 使用 `api.platform.example` 占位端点，须替换为真实社交平台官方 API。
- 本测试脚本不连接 Firebase，仅验证接口契约；真实数据需在配置好环境变量的环境运行。
