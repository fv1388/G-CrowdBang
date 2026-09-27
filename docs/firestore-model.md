# F-CrowdBang · Firestore 数据模型与状态流转参考

> 多租户众包账本：商户发布悬赏（campaigns）→ 用户接单并上报设备遥测（submissions）→ 服务端核验后结算。
> 透明、可审计；不含任何规避/伪装逻辑。

---

## 集合一：`campaigns`（商户悬赏任务总表）

```json
{
  "campaign_id": "cmp_7f3a9b2c",
  "owner_merchant_id": "mch_8d1e4f5a",
  "video_url": "https://cdn.example.com/merchant/cmp_7f3a9b2c/main.mp4",
  "caption_text": "Check out this budget-friendly gadget — link in bio! #gadget #homehack",
  "target_hashtags": ["gadget", "homehack", "asmr"],
  "geotargeting_config": {
    "enabled": true,
    "target_city": "Jacksonville",
    "target_state": "FL",
    "target_lat": 30.3322,
    "target_lng": -81.6557,
    "radius_km": 80
  },
  "escrow_summary": {
    "total_slots": 50,
    "slots_used": 0,
    "payout_rate": 12.5,
    "platform_fee": 1.25
  },
  "status": "open",
  "created_at": "2026-09-26T10:00:00Z",
  "updated_at": "2026-09-26T10:00:00Z"
}
```

字段说明：
- `owner_merchant_id`：租户隔离键，规则层据此收窄读写。
- `geotargeting_config`：投放区域约束；`enabled=false` 时不限区域。`target_lat/target_lng/radius_km` 为服务端边界校验中心与半径（`verify-and-publish` 接口使用）；`target_city/target_state` 供前端展示。
- `escrow_summary`：托管账目。结算：用户所得 = `payout_rate`，平台抽成 = `platform_fee`。

---

## 集合二：`submissions`（接单与设备对账总表）

```json
{
  "submission_id": "sub_a1b2c3d4",
  "campaign_id": "cmp_7f3a9b2c",
  "worker_id": "usr_5e6f7a8b",
  "hardware_geoloc": {
    "latitude": 30.3322,
    "longitude": -81.6557,
    "detected_carrier": "T-Mobile US"
  },
  "audit_metadata": {
    "published_video_id": "v_9876543210",
    "verification_status": "PENDING_AUDIT"
  },
  "claim_timestamp": "2026-09-26T14:20:00Z",
  "submitted_at": null,
  "payout_status": "held"
}
```

字段说明：
- `hardware_geoloc`：声明性遥测（lat/lng/运营商）。可被模拟，故最终判定以服务端回读为准。
- `audit_metadata.published_video_id`：已发布视频原生 ID，供服务端回读。
- `audit_metadata.verification_status`：核验状态机（见下）。

---

## 状态机（submissions）

```
pending ──(核验通过)──▶ verified   (payout: held → paid, slots_used+1)
   │
   └──(核验未通过/区域不符/未发布)──▶ rejected (payout: held → released)
```

- 仅 `pending → verified` / `pending → rejected` 合法；终态不可逆。
- 资金仅 `verified` 时放款，`rejected` 时退回托管。
- 名额仅统计 `verified`。

## 结算逻辑（服务端骨架）

```js
function settlement(submission, campaign) {
  const s = campaign.escrow_summary;
  if (submission.payout_status !== 'paid') return null;
  return {
    worker_gets: s.payout_rate,
    platform_gets: s.platform_fee,
    total_debited: s.payout_rate + s.platform_fee,
  };
}
```

事务要点：名额封顶、状态推进、名额递增、资金变更须在同一 `runTransaction` 内原子完成，防止并发超发。

---

## 建议复合索引

| 集合 | 字段组合 | 用途 |
|---|---|---|
| campaigns | `owner_merchant_id + status` | 商户按状态查自己的任务 |
| campaigns | `geotargeting_config.target_state + status` | 任务大厅按区域筛选 |
| submissions | `campaign_id + verification_status` | 商户查某任务核验进度 |
| submissions | `worker_id + submitted_at` | 用户查自己的接单历史 |

## 集合五：payout_requests（提现与打款对账单）

接单人在 workers 余额中赚到佣金后，通过提现申请将可用余额转入外部账户（如 PayPal 邮箱），
对账单写入本集合并标记为 PENDING_TRANSFER，等待官方人工或自动批量打款。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| payout_request_id | string | 对账单唯一 ID（系统生成） |
| worker_id | string | 发起提现的接单人 ID |
| amount_usd | number | 提现金额（美元） |
| payout_method | string | 提现方式，如 "paypal" |
| destination | string | 提现账户地址（如 PayPal 邮箱） |
| status | string | PENDING_TRANSFER（待打款）\| processed（已打款） |
| request_timestamp | string | 申请时间 |
| processed_at | string | 打款完成时间（null 前为待打款） |
| transfer_reference | string | 打款流水号（null 前为待打款） |

安全规则：接单人仅能创建自己的申请且 status 必须为 PENDING_TRANSFER；打款终态仅 admin 可写；删除仅 admin。
