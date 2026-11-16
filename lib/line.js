'use strict';
/** LINE Messaging API 小工具（只用 fetch）。token 一律取自環境變數，不寫進程式或紀錄。 */
const API = 'https://api.line.me';
const DATA_API = 'https://api-data.line.me';

async function call(method, path, body, { token = process.env.LINE_CHANNEL_ACCESS_TOKEN, base = API, raw = false, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

const getProfile = (userId) => call('GET', `/v2/bot/profile/${userId}`);
const getGroupMemberProfile = (gid, uid) => call('GET', `/v2/bot/group/${gid}/member/${uid}`);
const getGroupSummary = (gid) => call('GET', `/v2/bot/group/${gid}/summary`);
const getGroupCount = (gid) => call('GET', `/v2/bot/group/${gid}/members/count`);
const botInfo = () => call('GET', '/v2/bot/info');
const webhookInfo = () => call('GET', '/v2/bot/channel/webhook/endpoint');
const quota = () => call('GET', '/v2/bot/message/quota');
const consumption = () => call('GET', '/v2/bot/message/quota/consumption');
const broadcast = (messages) => call('POST', '/v2/bot/message/broadcast', { messages });
const push = (to, messages) => call('POST', '/v2/bot/message/push', { to, messages });
const followers = (date) => call('GET', `/v2/bot/insight/followers?date=${date}`);

// ── Rich Menu ──
const richMenuList = () => call('GET', '/v2/bot/richmenu/list');
const richMenuDefault = () => call('GET', '/v2/bot/user/all/richmenu');
const richMenuCreate = (menu) => call('POST', '/v2/bot/richmenu', menu);
const richMenuUpload = (id, bytes, type) => call('POST', `/v2/bot/richmenu/${id}/content`, bytes, { base: DATA_API, raw: true, headers: { 'Content-Type': type } });
const richMenuSetDefault = (id) => call('POST', `/v2/bot/user/all/richmenu/${id}`);
const richMenuDelete = (id) => call('DELETE', `/v2/bot/richmenu/${id}`);

module.exports = { call, getProfile, getGroupMemberProfile, getGroupSummary, getGroupCount, botInfo, webhookInfo, quota, consumption, broadcast, push, followers, richMenuList, richMenuDefault, richMenuCreate, richMenuUpload, richMenuSetDefault, richMenuDelete };
