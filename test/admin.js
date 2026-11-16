'use strict';
// node test/admin.js —— 後台 API / 圖文選單 / 紀錄的整合測試（記憶體模式，LINE API 以假的 fetch 取代）
process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.LINE_CHANNEL_SECRET = 'sec';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const lineCalls = [];
const realFetch = global.fetch;
global.fetch = async (u, o = {}) => {
  const s = String(u);
  if (s.includes('line.me')) {
    lineCalls.push(`${o.method || 'GET'} ${s.replace(/https:\/\/api(-data)?\.line\.me/, '')}`);
    const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, text: async () => JSON.stringify(b) });
    if (s.endsWith('/v2/bot/richmenu')) return json({ richMenuId: 'richmenu-NEW' });
    if (s.includes('/richmenu/list')) return json({ richmenus: [{ richMenuId: 'richmenu-OLD' }, { richMenuId: 'richmenu-NEW' }] });
    if (s.includes('/v2/bot/info')) return json({ displayName: '陀螺助理', basicId: '@178bkxtx' });
    if (s.includes('/webhook/endpoint')) return json({ endpoint: 'https://x/api/webhook', active: true });
    if (s.includes('/quota/consumption')) return json({ totalUsage: 12 });
    if (s.includes('/quota')) return json({ type: 'limited', value: 200 });
    if (s.includes('/broadcast')) return json({});
    return json({});
  }
  if (s.includes('api.github.com')) return { ok: true, json: async () => ({ workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success', event: 'schedule', created_at: new Date().toISOString(), html_url: 'https://x' }] }) };
  return realFetch(u, o);
};

const admin = require('../api/admin');
const A = require('../lib/analytics');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓', name); };

(async () => {
  const server = http.createServer((req, res) => admin(req, res));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = '';
  const call = async (method, p, body, auth = true) => {
    const r = await realFetch(base + '/admin/' + p, { method, headers: { 'Content-Type': 'application/json', ...(auth && token ? { 'x-admin-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* csv / html */ }
    return { status: r.status, json: j, text: txt, headers: r.headers };
  };

  console.log('— 後台');
  const page = await realFetch(base + '/admin');
  ok('GET /admin 回傳頁面', page.status === 200 && /陀螺助理 後台/.test(await page.text()));
  ok('沒登入不能讀資料', (await call('GET', 'api/overview', null, false)).status === 401);
  ok('錯誤密碼 → 401', (await call('POST', 'api/login', { password: 'nope' }, false)).status === 401);
  const lg = await call('POST', 'api/login', { password: 'test-pass-123' }, false);
  token = lg.json && lg.json.token;
  ok('正確密碼登入，取得 token 與 HttpOnly cookie', lg.status === 200 && token && /HttpOnly/.test(lg.headers.get('set-cookie') || ''));
  ok('偽造 token 被拒', (await realFetch(base + '/admin/api/overview', { headers: { 'x-admin-token': '9999999999.fake' } })).status === 401);

  console.log('— 好友 / 動態 / 統計');
  await A.recordFollow('U-alice', { displayName: 'Alice', pictureUrl: 'https://x/a.png', language: 'zh-Hant' });
  await A.recordFollow('U-bob', { displayName: 'Bob' });
  await A.recordUnfollow('U-bob');
  await A.recordJoin('G-1', 'group', { groupName: '陀螺群' }, 9);
  await A.recordMessage({ uid: 'U-alice', text: '鯊魚配置', kind: 'combo', ms: 120, ok: true, replied: true });
  await A.recordMessage({ uid: 'U-alice', text: '亂打', kind: 'unknown', ms: 40, ok: true, replied: true });
  const ov = (await call('GET', 'api/overview')).json;
  ok('總覽：好友 1、封鎖 1、群組 1', ov.friends === 1 && ov.unfollowed === 1 && ov.groups === 1);
  ok('總覽：今日新增好友 / 查詢量', ov.today.follow === 2 && ov.today.msg === 2 && ov.series.length === 14);
  ok('總覽：查詢分類統計', ov.kinds.combo === 1 && ov.kinds.unknown === 1);
  const us = (await call('GET', 'api/users?status=friend')).json;
  ok('好友列表（含名稱、頭貼、加入時間）', us.total === 1 && us.users[0].name === 'Alice' && us.users[0].pic && us.users[0].followedAt);
  ok('搜尋好友', (await call('GET', 'api/users?q=bob')).json.total === 1);
  const evs = (await call('GET', 'api/events?limit=20')).json.events;
  ok('動態：follow / unfollow / join / message 都有紀錄', ['follow', 'unfollow', 'join', 'message'].every((t) => evs.some((e) => e.type === t)));
  ok('群組列表', (await call('GET', 'api/groups')).json.groups[0].name === '陀螺群');
  const kw = (await call('GET', 'api/keywords')).json;
  ok('熱門查詢與未辨識輸入', kw.top[0].text === '鯊魚配置' && kw.unknown[0].text === '亂打');
  ok('單一好友詳情', (await call('GET', 'api/user?id=U-alice')).json.user.name === 'Alice');

  console.log('— 管理動作');
  await call('POST', 'api/user/block', { id: 'U-alice', block: true });
  ok('停用使用者 → 機器人不再回覆', (await A.isBlocked('U-alice')) === true);
  await call('POST', 'api/user/block', { id: 'U-alice', block: false });
  ok('恢復使用者', (await A.isBlocked('U-alice')) === false);
  const t = (await call('POST', 'api/test', { text: 'T表' })).json;
  ok('查詢測試：T表 → 圖片', t.kind === 'tier' && t.image === 'tier');
  ok('查詢測試：配置 → 卡片', (await call('POST', 'api/test', { text: '鯊魚配置' })).json.hasFlex === true);
  await call('POST', 'api/config', { maintenance: '1', maintenance_msg: '維護中', welcome: '嗨' });
  const cfg = (await call('GET', 'api/config')).json.config;
  ok('設定：維護模式與歡迎詞', cfg.maintenance === '1' && cfg.maintenance_msg === '維護中' && cfg.welcome === '嗨');
  ok('廣播需要確認', (await call('POST', 'api/broadcast', { text: 'hi' })).status === 400);
  ok('廣播成功會呼叫 LINE', (await call('POST', 'api/broadcast', { text: 'hi', confirm: true })).status === 200 && lineCalls.some((c) => c.startsWith('POST /v2/bot/message/broadcast')));
  ok('匯出 CSV', /userId,名稱/.test((await call('GET', 'api/export/users')).text));

  console.log('— 系統狀態 / 圖文選單');
  const h = (await call('GET', 'api/health')).json;
  ok('狀態：LINE、Webhook、額度、排程、資料新鮮度', h.line.ok && h.line.webhook.active && h.line.quota.value === 200 && h.data.combos.count > 50 && h.data.dictionary.blades > 100);
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/richmenu.json'), 'utf8'));
  const img = fs.statSync(path.join(__dirname, '../assets', spec.image));
  ok('選單：6 個按鈕、尺寸 2500×1686、圖片 < 1MB', spec.areas.length === 6 && spec.size.width === 2500 && spec.size.height === 1686 && img.size < 1024 * 1024);
  const eng = require('../lib/engine');
  const data = require('../data/combos.json');
  ok('選單每個按鈕的指令機器人都看得懂', spec.areas.every((a) => { const r = eng.handleRich(a.action.text, data, { events: require('../data/events.json') }); return r.kind !== 'unknown' && r.text; }));
  const created = (await call('POST', 'api/richmenu/create', {})).json;
  ok('建立選單：建立 → 上傳圖片 → 設為預設 → 刪掉舊的', created.id === 'richmenu-NEW' && lineCalls.some((c) => c.includes('/richmenu/richmenu-NEW/content')) && lineCalls.some((c) => c.includes('/user/all/richmenu/richmenu-NEW')) && lineCalls.some((c) => c.startsWith('DELETE /v2/bot/richmenu/richmenu-OLD')));

  console.log('— 安全');
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await call('POST', 'api/login', { password: 'x' + i }, false)).status;
  ok('連續錯誤密碼會被暫時鎖定', last === 429);

  server.close();
  console.log(`\n後台測試全部通過（${pass} 項）`);
  process.exit(0);
})().catch((e) => { console.error('\n✗ 失敗：', e.message); process.exit(1); });
