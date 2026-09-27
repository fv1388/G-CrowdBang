// src/app/api/tasks/_mock-store.js
// G-CrowdBang · 本地 mock 账本（仅当 firebase-admin 未安装时生效）
// 让 verify-and-publish / publish-video / verify-and-payout 在本地无依赖时共用同一进程内账本，
// 从而本地全链路（接单→回填→结算）可闭环联调；装上 firebase-admin 后此模块不被使用。
// 注意：mock 账本存于进程内存，重启即清空，仅供本地联调。

// 便捷写入：自动补 submission_id（Map key）
export function putSubmission(id, submission) {
  mockSubmissions.set(id, { ...submission, submission_id: id });
}

export const mockSubmissions = new Map();
export const mockUsers = new Map();
export const mockPlatform = { service_fee_balance_usd: 0 };
export const mockCampaigns = new Map();
export const mockPayoutRequests = new Map();
export const mockMerchants = new Map();
export const mockMerchantTransactions = new Map();

// ---- TikTok OAuth 令牌与对账账本（本地联调） ----
// mockTikTokTokens: token_id -> { merchant_id, tiktok_open_id, access_token, access_token_expires_at,
//                                 refresh_token, refresh_token_expires_at, scopes, status, created_at, updated_at, last_refreshed_at }
export const mockTikTokTokens = new Map();
// mockTikTokLedger: ledger_id -> { token_id, merchant_id, event_type, access_token_fingerprint,
//                                 expires_at, created_at }（令牌流转对账单，event: ISSUED/REFRESHED/REVOKED/EXPIRED）
export const mockTikTokLedger = new Map();

// 追加一条令牌对账记录
export function appendTikTokLedger(entry) {
  const ledgerId = `ledger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  mockTikTokLedger.set(ledgerId, { ...entry, ledger_id: ledgerId, created_at: new Date().toISOString() });
  return mockTikTokLedger.get(ledgerId);
}

// ---- 深合并助手：把"点号键"的扁平更新安全地写进嵌套内存对象 ----
// 背景：Firestore 支持点号符号（如 "audit_metadata.verification_status"），
//       但 Object.assign 遇到这种键只会生成字面扁平键，不写入嵌套结构。
//       内存 mock 对象必须用本函数才能真正推进嵌套状态（否则 cron/审计页会误判状态）。
function deepSet(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

// 将含点号键的扁平更新对象应用到内存对象（兼容纯键，不破坏已有嵌套）
export function applyFlatUpdate(obj, flatUpdates) {
  if (!obj) return obj;
  for (const [k, v] of Object.entries(flatUpdates || {})) {
    if (k.includes(".")) deepSet(obj, k, v);
    else obj[k] = v;
  }
  return obj;
}

