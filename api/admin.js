'use strict';
/**
 * 後台（/admin）：單一 Serverless Function 處理頁面與所有 API。
 * 需要環境變數 ADMIN_PASSWORD（自己設定的登入密碼）。資料庫（Upstash Redis）未連接時只有唯讀的系統狀態。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const A = require('../lib/analytics');
const L = require('../lib/line');
const store = require('../lib/store');
const { getCombos, getEvents } = require('../lib/data');
const engine = require('../lib/engine');
const page = require('../lib/admin_page');

const env = process.env;
const TTL = 12 * 3600; // 登入有效 12 小時
const secret = () => `${env.ADMIN_PASSWORD || ''}|${env.LINE_CHANNEL_SECRET || ''}|admin-v1`;
const sign = (p) => crypto.createHmac('sha256', secret()).update(p).digest('base64url');
const makeToken = () => { const p = String(Math.floor(Date.now() / 1000) + TTL); return `${p}.${sign(p)}`; };
function checkToken(tok) {
  if (!tok || !env.ADMIN_PASSWORD) return false;
  const [p, s] = String(tok).split('.');
  if (!p || !s || Number(p) < Date.now() / 1000) return false;
  const a = Buffer.from(sign(p)); const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookieOf = (req, name) => (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1];
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function out(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// ───────────── 系統狀態 ─────────────
async function health() {
  const repo = env.GITHUB_REPO;
  const [info, hook, quota, used, combos, events, runs, ping] = await Promise.all([
    L.botInfo().catch((e) => ({ ok: false, text: e.message })), L.webhookInfo().catch(() => null), L.quota().catch(() => null), L.consumption().catch(() => null),
    getCombos(env), getEvents(env),
    repo ? fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=5`, { headers: { 'User-Agent': 'beyx-admin' }, signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null) : null,
    store.cmd('PING').then(() => true).catch(() => false),
  ]);
  const hours = (iso) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 36e5) : null);
  const tp = combos.tier_pro || {};
  return {
    line: { ok: !!(info && info.ok), name: info && info.json && info.json.displayName, basicId: info && info.json && info.json.basicId, premiumId: info && info.json && info.json.premiumId, chatMode: info && info.json && info.json.chatMode, markAsReadMode: info && info.json && info.json.markAsReadMode,
      webhook: hook && hook.json ? { endpoint: hook.json.endpoint, active: hook.json.active } : null,
      quota: quota && quota.json ? quota.json : null, used: used && used.json ? used.json.totalUsage : null, error: info && !info.ok ? (info.text || '').slice(0, 120) : null },
    data: {
      combos: { count: (combos.combos || []).length, updatedAt: combos.updated_at, ageHours: hours(combos.updated_at), recommended: Object.keys(combos.recommended || {}).length },
      tier: { title: tp.title, author: tp.author, updated: tp.updated, cards: (tp.rows || []).reduce((a, r) => a + r.cards.length, 0) },
      events: { count: (events.events || []).length, updatedAt: events.updated_at },
      dictionary: { blades: Object.keys(engine.dict.blades).length, bits: Object.keys(engine.dict.bits).length, ratchets: Object.keys(engine.dict.ratchets || {}).length, cx: Object.keys(engine.dict.cx || {}).length },
    },
    actions: runs && runs.workflow_runs ? runs.workflow_runs.map((r) => ({ id: r.id, status: r.status, conclusion: r.conclusion, event: r.event, at: r.created_at, url: r.html_url })) : null,
    store: { enabled: store.enabled(), ok: ping },
    runtime: { node: process.version, region: env.VERCEL_REGION || '', env: env.VERCEL_ENV || 'local', repo: repo || '', adminSet: !!env.ADMIN_PASSWORD, tokenSet: !!env.LINE_CHANNEL_ACCESS_TOKEN },
  };
}

// ───────────── 圖文選單 ─────────────
const MENU_DIR = path.join(__dirname, '..', 'assets');
const menuSpec = () => JSON.parse(fs.readFileSync(path.join(MENU_DIR, 'richmenu.json'), 'utf8'));

async function createRichMenu() {
  const spec = menuSpec();
  const img = fs.readFileSync(path.join(MENU_DIR, spec.image || 'richmenu.jpg'));
  if (img.length > 1024 * 1024) throw new Error('選單圖片超過 1MB（LINE 限制）');
  const made = await L.richMenuCreate({ size: spec.size, selected: true, name: spec.name, chatBarText: spec.chatBarText, areas: spec.areas });
  if (!made.ok) throw new Error('建立選單失敗：' + made.text);
  const id = made.json.richMenuId;
  const up = await L.richMenuUpload(id, img, /png$/.test(spec.image) ? 'image/png' : 'image/jpeg');
  if (!up.ok) { await L.richMenuDelete(id); throw new Error('上傳選單圖片失敗：' + up.text); }
  const def = await L.richMenuSetDefault(id);
  if (!def.ok) throw new Error('設為預設失敗：' + def.text);
  const list = await L.richMenuList();
  for (const m of (list.json && list.json.richmenus) || []) if (m.richMenuId !== id) await L.richMenuDelete(m.richMenuId);
  return id;
}

// ───────────── 路由 ─────────────
async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const route = (u.searchParams.get('path') || u.pathname.replace(/^\/(api\/)?admin\/?/, '')).replace(/^\/+|\/+$/g, '');
  const method = req.method;

  if (method === 'GET' && (route === '' || route === 'index')) return out(res, 200, page.html(), 'text/html; charset=utf-8', { 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
  if (!env.ADMIN_PASSWORD) return out(res, 503, { error: '尚未設定 ADMIN_PASSWORD 環境變數（到 Vercel → Settings → Environment Variables 新增後 Redeploy）' });

  if (method === 'POST' && route === 'api/login') {
    const body = await readBody(req);
    const ip = ipOf(req);
    const tries = Number(await store.cmd('INCR', `rl:${ip}`).catch(() => 0));
    if (tries === 1) await store.cmd('EXPIRE', `rl:${ip}`, 600).catch(() => null);
    if (tries > 8) return out(res, 429, { error: '嘗試次數過多，請 10 分鐘後再試' });
    const a = Buffer.from(String(body.password || '')); const b = Buffer.from(env.ADMIN_PASSWORD);
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return out(res, 401, { error: '密碼錯誤' });
    const tok = makeToken();
    return out(res, 200, { ok: true, token: tok }, undefined, { 'Set-Cookie': `adm=${tok}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Strict` });
  }
  if (method === 'POST' && route === 'api/logout') return out(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'adm=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });

  if (!checkToken(req.headers['x-admin-token'] || cookieOf(req, 'adm'))) return out(res, 401, { error: 'unauthorized' });

  try {
    const body = method === 'POST' ? await readBody(req) : {};
    switch (`${method} ${route}`) {
      case 'GET api/overview': return out(res, 200, await A.overview());
      case 'GET api/users': {
        let users = await A.allUsers();
        const q = (u.searchParams.get('q') || '').toLowerCase(); const st = u.searchParams.get('status') || '';
        if (q) users = users.filter((x) => `${x.name} ${x.id} ${x.lastText || ''}`.toLowerCase().includes(q));
        if (st === 'blocked') users = users.filter((x) => x.blocked); else if (st) users = users.filter((x) => x.status === st);
        users.sort((a, b) => String(b.followedAt || b.lastSeen || b.firstSeen).localeCompare(String(a.followedAt || a.lastSeen || a.firstSeen)));
        const off = Number(u.searchParams.get('offset') || 0); const lim = Math.min(Number(u.searchParams.get('limit') || 50), 200);
        return out(res, 200, { total: users.length, users: users.slice(off, off + lim) });
      }
      case 'GET api/user': {
        const id = u.searchParams.get('id');
        const events = (await A.recentEvents(1000)).filter((e) => e.uid === id).slice(0, 40);
        return out(res, 200, { user: await A.getUser(id), events });
      }
      case 'POST api/user/block': {
        const { id, block } = body;
        if (!id) return out(res, 400, { error: 'missing id' });
        await store.cmd(block ? 'SADD' : 'SREM', 'blocked', id);
        await A.upsertUser(id, { blocked: !!block });
        await A.logEvent({ type: block ? 'admin_block' : 'admin_unblock', uid: id });
        return out(res, 200, { ok: true });
      }
      case 'POST api/user/refresh': {
        const users = (await A.allUsers()).filter((x) => x.status === 'friend').slice(0, 60);
        let n = 0;
        for (const x of users) { const p = await L.getProfile(x.id); if (p.ok && p.json) { await A.upsertUser(x.id, { name: p.json.displayName, pic: p.json.pictureUrl || '', lang: p.json.language || '', statusMessage: p.json.statusMessage || '' }); n++; } else if (p.status === 404) await A.upsertUser(x.id, { status: 'unfollowed', unfollowedAt: new Date().toISOString() }); }
        return out(res, 200, { ok: true, refreshed: n });
      }
      case 'GET api/events': return out(res, 200, { events: await A.recentEvents(Number(u.searchParams.get('limit') || 100), u.searchParams.get('type') || '') });
      case 'GET api/groups': return out(res, 200, { groups: (await A.allGroups()).sort((a, b) => String(b.lastMsg || b.joinedAt).localeCompare(String(a.lastMsg || a.joinedAt))) });
      case 'GET api/keywords': return out(res, 200, await A.keywords(40));
      case 'GET api/errors': return out(res, 200, { errors: (await store.cmd('LRANGE', 'errs', 0, 99)).map(store.parse).filter(Boolean) });
      case 'GET api/health': return out(res, 200, await health());
      case 'POST api/test': {
        const [data, events] = await Promise.all([getCombos(env), getEvents(env)]);
        const r = engine.handleRich(String(body.text || ''), data, { events, windowDays: Number(env.WINDOW_DAYS) || 180 });
        return out(res, 200, { kind: r.kind, text: r.text, hasFlex: !!r.flex, image: r.image || null, quick: (r.quick || []).map((x) => x.label) });
      }
      case 'POST api/broadcast': {
        const text = String(body.text || '').trim();
        if (!text || text.length > 4900) return out(res, 400, { error: '訊息不可為空，且需 ≤ 4900 字' });
        if (body.confirm !== true) return out(res, 400, { error: '需要確認 confirm=true' });
        const r = await L.broadcast([{ type: 'text', text }]);
        await A.logEvent({ type: 'admin_broadcast', text: text.slice(0, 120), ok: r.ok });
        return out(res, r.ok ? 200 : 502, r.ok ? { ok: true } : { error: `LINE 回應 ${r.status}：${r.text.slice(0, 200)}` });
      }
      case 'POST api/push': {
        const text = String(body.text || '').trim();
        if (!body.to || !text) return out(res, 400, { error: '缺少對象或內容' });
        const r = await L.push(body.to, [{ type: 'text', text: text.slice(0, 4900) }]);
        await A.logEvent({ type: 'admin_push', uid: body.to, text: text.slice(0, 120), ok: r.ok });
        return out(res, r.ok ? 200 : 502, r.ok ? { ok: true } : { error: `LINE 回應 ${r.status}：${r.text.slice(0, 200)}` });
      }
      case 'GET api/config': return out(res, 200, { config: await A.getConfig() });
      case 'POST api/config': {
        const allowed = ['maintenance', 'maintenance_msg', 'welcome'];
        const cmds = [];
        for (const k of allowed) if (k in body) cmds.push(String(body[k]) === '' ? ['HDEL', 'cfg', k] : ['HSET', 'cfg', k, String(body[k]).slice(0, 2000)]);
        if (cmds.length) await store.pipeline(cmds.map((c) => c.map(String)));
        return out(res, 200, { ok: true });
      }
      case 'GET api/richmenu': {
        const [list, def] = await Promise.all([L.richMenuList(), L.richMenuDefault()]);
        return out(res, 200, { menus: (list.json && list.json.richmenus) || [], defaultId: (def.json && def.json.richMenuId) || null, spec: menuSpec() });
      }
      case 'POST api/richmenu/create': return out(res, 200, { ok: true, id: await createRichMenu() });
      case 'POST api/richmenu/delete': { const r = await L.richMenuDelete(String(body.id)); return out(res, r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.text }); }
      case 'POST api/logs/clear': {
        const k = { events: 'evlog', unknown: 'unk', errors: 'errs', keywords: 'kw' }[body.what];
        if (!k) return out(res, 400, { error: 'unknown target' });
        await store.cmd('DEL', k);
        return out(res, 200, { ok: true });
      }
      case 'GET api/export/users': {
        const users = await A.allUsers();
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = ['﻿userId,名稱,狀態,加入時間,取消時間,最後互動,訊息數,語言'].concat(users.map((x) => [x.id, x.name, x.status, x.followedAt, x.unfollowedAt, x.lastSeen, x.msgs, x.lang].map(esc).join(','))).join('\n');
        return out(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="friends.csv"' });
      }
      default: return out(res, 404, { error: 'not found' });
    }
  } catch (e) {
    console.error('[admin]', e);
    return out(res, 500, { error: e.message });
  }
}

module.exports = handler;
