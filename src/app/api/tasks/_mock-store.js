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

