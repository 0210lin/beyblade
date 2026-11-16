'use strict';
/**
 * LINE Webhook（Vercel Serverless Function；純 Node http API，Render / 本機也能跑）
 * - 群組要 @機器人 或 !查詢 才回；1 對 1 一律回
 * - 回覆：Flex 卡片 / T 表圖片（只送圖，不附文字）/ 純文字備援；每則附快速按鈕
 * - 記錄：加好友、封鎖（unfollow）、進退群、查詢與回覆時間（後台用；任何紀錄失敗都不影響回覆）
 */
const crypto = require('crypto');
const { handleRich, extractQuery, HELP } = require('../lib/engine');
const { getCombos, getEvents } = require('../lib/data');
const A = require('../lib/analytics');
const LINE = require('../lib/line');
const store = require('../lib/store');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) return resolve(Buffer.from(req.rawBody));
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validSignature(raw, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  let given;
  try { given = Buffer.from(signature, 'base64'); } catch { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// ───────── 回覆 ─────────
const withQuick = (messages, quick) => {
  if (!quick || !quick.length || !messages.length) return messages;
  const items = quick.slice(0, 13).map((q) => ({ type: 'action', action: { type: 'message', label: String(q.label).slice(0, 20), text: q.text } }));
  const last = { ...messages[messages.length - 1], quickReply: { items } };
  return [...messages.slice(0, -1), last];
};

async function pushReply(replyToken, messages, token) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[reply] LINE API 錯誤', res.status, body);
    A.recordError('reply', `${res.status} ${body}`);
  }
  return res.ok;
}

/** T 表圖片網址：預設用 GitHub Raw 上由排程產生的 data/tier.jpg */
function tierImageUrl(env, tier) {
  const base = env.TIER_IMAGE_URL
    || (env.GITHUB_REPO ? `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_BRANCH || 'main'}/data/tier.jpg` : '');
  return base ? `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent((tier && tier.updated) || '')}` : '';
}

async function reply(replyToken, content, token, env = {}) {
  const { text, flex, image, tier, quick } = typeof content === 'string' ? { text: content } : content;
  const plain = [{ type: 'text', text: text.slice(0, 4900) }];
  if (image === 'tier') {
    const url = tierImageUrl(env, tier);
    if (url && (await pushReply(replyToken, withQuick([{ type: 'image', originalContentUrl: url, previewImageUrl: url }], quick), token))) return true;
    return pushReply(replyToken, withQuick(plain, quick), token); // 圖片失敗 → 文字版 T 表
  }
  if (flex) {
    const altText = text.replace(/[━─]/g, '').replace(/\s+/g, ' ').trim().slice(0, 380) || '查詢結果';
    if (await pushReply(replyToken, withQuick([{ type: 'flex', altText, contents: flex }], quick), token)) return true;
  }
  return pushReply(replyToken, withQuick(plain, quick), token);
}

// ───────── 小工具 ─────────
let cfgCache = { at: 0, v: {} };
async function config() {
  if (Date.now() - cfgCache.at < 30000) return cfgCache.v;
  cfgCache = { at: Date.now(), v: await A.getConfig() };
  return cfgCache.v;
}

async function ensureUser(uid, gid) {
  if (!uid) return;
  try {
    if (await store.cmd('HGET', 'users', uid)) return;
    const p = gid ? await LINE.getGroupMemberProfile(gid, uid) : await LINE.getProfile(uid);
    const j = (p && p.ok && p.json) || {};
    await A.upsertUser(uid, { status: gid ? 'seen' : 'friend', name: j.displayName || '(未取得名稱)', pic: j.pictureUrl || '', lang: j.language || '', firstSeenIn: gid ? 'group' : 'chat' });
  } catch (e) { /* 紀錄失敗不影響回覆 */ }
}

const WELCOME_FLEX = (name) => ({
  type: 'bubble', size: 'mega',
  header: { type: 'box', layout: 'vertical', backgroundColor: '#1F3A5F', paddingAll: '16px', contents: [
    { type: 'text', text: '歡迎加入 陀螺助理', color: '#FFFFFF', weight: 'bold', size: 'lg' },
    { type: 'text', text: 'BEYBLADE X ASSISTANT', color: '#F5C542', size: 'xs', margin: 'sm' },
  ] },
  body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
    { type: 'text', text: `${name ? name + '，' : ''}我可以幫你：`, size: 'sm', wrap: true },
    { type: 'text', text: '🔥 查近期上位配置（含賽事連結）', size: 'sm', margin: 'md' },
    { type: 'text', text: '📊 看高手 T 表', size: 'sm' },
    { type: 'text', text: '📅 找雙北賽事', size: 'sm' },
    { type: 'text', text: '📖 查零件解釋與新品發售', size: 'sm' },
    { type: 'text', text: '點下面的按鈕或下方選單開始，也可以直接輸入「鯊魚配置」。', size: 'xs', color: '#7A8699', wrap: true, margin: 'lg' },
  ] },
});

// ───────── 事件處理 ─────────
async function handleEvent(ev, env) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const src = ev.source || {};
  const uid = src.userId;
  const gid = src.groupId || src.roomId;
  const { MAIN_QUICK } = require('../lib/menu');

  if (ev.type === 'follow') {
    const p = await LINE.getProfile(uid);
    const prof = (p && p.ok && p.json) || {};
    const cfg = await config();
    const messages = cfg.welcome
      ? [{ type: 'text', text: cfg.welcome }]
      : [{ type: 'flex', altText: '歡迎加入陀螺助理', contents: WELCOME_FLEX(prof.displayName) }];
    await Promise.allSettled([A.recordFollow(uid, prof), pushReply(ev.replyToken, withQuick(messages, MAIN_QUICK), token)]);
    return;
  }
  if (ev.type === 'unfollow') return A.recordUnfollow(uid);
  if (ev.type === 'join') {
    const [s, c] = await Promise.all([LINE.getGroupSummary(gid).catch(() => null), LINE.getGroupCount(gid).catch(() => null)]);
    await Promise.allSettled([
      A.recordJoin(gid, src.type, (s && s.json) || {}, c && c.json ? c.json.count : null),
      pushReply(ev.replyToken, withQuick([{ type: 'text', text: `大家好，我是陀螺助理 🌀\n在群組請 @我 或輸入「!查詢 鯊魚配置」；點下面的按鈕看功能。` }], MAIN_QUICK), token),
    ]);
    return;
  }
  if (ev.type === 'leave') return A.recordLeave(gid);
  if (ev.type === 'memberJoined' || ev.type === 'memberLeft') return A.logEvent({ type: ev.type, gid, n: (ev.joined || ev.left || {}).members ? (ev.joined || ev.left).members.length : undefined });
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;

  const q = extractQuery(ev, env);
  if (!q.triggered) return; // 群組沒有 @ / 前綴 → 保持安靜（也不記錄，保護隱私）
  if (await A.isBlocked(uid)) return;

  const t0 = Date.now();
  const cfg = await config();
  let out; let ok = true;
  try {
    if (cfg.maintenance === '1') {
      out = { text: cfg.maintenance_msg || '系統維護中，請稍後再試。', kind: 'maintenance' };
    } else {
      const [data, events] = await Promise.all([getCombos(env), getEvents(env)]);
      out = q.text ? handleRich(q.text, data, { windowDays: Number(env.WINDOW_DAYS) || 180, events }) : { text: HELP, kind: 'help', quick: MAIN_QUICK };
    }
    ok = await reply(ev.replyToken, out, token, env);
  } catch (e) {
    ok = false;
    console.error('[event]', e);
    await A.recordError('handle', e.message);
  }
  await Promise.allSettled([ensureUser(uid, gid)]);
  await A.recordMessage({ uid, gid, text: q.text, kind: out && out.kind, ms: Date.now() - t0, ok, replied: true });
}

async function handler(req, res) {
  const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(body); };
  if (req.method === 'GET') return send(200, 'beyblade-line-bot ok');
  if (req.method !== 'POST') return send(405, 'method not allowed');

  const env = process.env;
  const raw = await readRaw(req);
  if (!validSignature(raw, req.headers['x-line-signature'], env.LINE_CHANNEL_SECRET)) return send(401, 'bad signature');

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return send(400, 'bad json'); }
  const events = Array.isArray(body.events) ? body.events : [];
  await Promise.all(events.map((ev) => handleEvent(ev, env).catch((e) => { console.error('[event]', e); return A.recordError('event', e.message); })));
  return send(200, 'OK');
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.validSignature = validSignature;
