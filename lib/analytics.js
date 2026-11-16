'use strict';
/** 機器人活動紀錄與後台統計（資料存在 lib/store.js；任何失敗都不能影響機器人回覆）。 */
const store = require('./store');

const taipeiDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d);
const daysAgo = (n) => taipeiDay(new Date(Date.now() - n * 86400000));
const nowIso = () => new Date().toISOString();
const safe = (fn) => (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => { console.error('[analytics]', e.message); return null; });

const EV_KEEP = 2999;
const MSG_MAX = 200;

const bump = safe(async (field, n = 1) => {
  const k = `daily:${taipeiDay()}`;
  await store.pipeline([['HINCRBY', k, field, n], ['EXPIRE', k, 60 * 86400 * 7]]);
});

const logEvent = safe(async (ev) => {
  await store.pipeline([['LPUSH', 'evlog', JSON.stringify({ t: nowIso(), ...ev })], ['LTRIM', 'evlog', 0, EV_KEEP]]);
});

const getUser = async (id) => store.parse(await store.cmd('HGET', 'users', id));
const putUser = (u) => store.cmd('HSET', 'users', u.id, JSON.stringify(u));

const upsertUser = safe(async (id, patch) => {
  const cur = (await getUser(id)) || { id, status: 'seen', firstSeen: nowIso(), msgs: 0 };
  const next = { ...cur, ...patch };
  await putUser(next);
  return next;
});

const recordFollow = safe(async (uid, profile = {}) => {
  const cur = await getUser(uid);
  const refollow = cur && cur.status === 'unfollowed';
  await upsertUser(uid, {
    status: 'friend', name: profile.displayName || (cur && cur.name) || '(未取得名稱)', pic: profile.pictureUrl || (cur && cur.pic) || '',
    lang: profile.language || (cur && cur.lang) || '', statusMessage: profile.statusMessage || '', followedAt: nowIso(), unfollowedAt: null,
  });
  await bump(refollow ? 'refollow' : 'follow');
  await logEvent({ type: refollow ? 'refollow' : 'follow', uid, name: profile.displayName || '' });
});

const recordUnfollow = safe(async (uid) => {
  await upsertUser(uid, { status: 'unfollowed', unfollowedAt: nowIso() });
  await bump('unfollow');
  await logEvent({ type: 'unfollow', uid });
});

const recordJoin = safe(async (gid, type, summary = {}, count = null) => {
  const cur = store.parse(await store.cmd('HGET', 'groups', gid)) || { id: gid, msgs: 0, joinedAt: nowIso() };
  await store.cmd('HSET', 'groups', gid, JSON.stringify({ ...cur, type, status: 'in', name: summary.groupName || cur.name || '(未取得名稱)', pic: summary.pictureUrl || cur.pic || '', members: count ?? cur.members ?? null, joinedAt: nowIso(), leftAt: null }));
  await bump('join');
  await logEvent({ type: 'join', gid, name: summary.groupName || '' });
});

const recordLeave = safe(async (gid) => {
  const cur = store.parse(await store.cmd('HGET', 'groups', gid));
  if (cur) await store.cmd('HSET', 'groups', gid, JSON.stringify({ ...cur, status: 'left', leftAt: nowIso() }));
  await bump('leave');
  await logEvent({ type: 'leave', gid });
});

const recordMessage = safe(async ({ uid, gid, text, kind, ms, ok, replied }) => {
  const cmds = [];
  await bump('msg');
  await bump(gid ? 'msg_group' : 'msg_user');
  if (replied) await bump('q_' + (kind || 'other'));
  if (ms) { await bump('lat_sum', Math.round(ms)); await bump('lat_n'); }
  if (!ok) await bump('err');
  if (uid) {
    const u = (await getUser(uid)) || { id: uid, status: 'seen', firstSeen: nowIso(), msgs: 0 };
    await putUser({ ...u, msgs: (u.msgs || 0) + 1, lastSeen: nowIso(), lastText: String(text || '').slice(0, 60) });
  }
  if (gid) {
    const g = store.parse(await store.cmd('HGET', 'groups', gid));
    if (g) await store.cmd('HSET', 'groups', gid, JSON.stringify({ ...g, msgs: (g.msgs || 0) + 1, lastMsg: nowIso() }));
  }
  const t = String(text || '').slice(0, MSG_MAX);
  cmds.push(['LPUSH', 'evlog', JSON.stringify({ t: nowIso(), type: 'message', uid, gid, text: t, kind, ms: ms ? Math.round(ms) : undefined, ok })], ['LTRIM', 'evlog', 0, EV_KEEP]);
  if (replied && ['combo', 'wiki', 'event', 'tier', 'menu'].includes(kind)) cmds.push(['ZINCRBY', 'kw', 1, t.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)]);
  if (replied && kind === 'unknown') cmds.push(['LPUSH', 'unk', JSON.stringify({ t: nowIso(), text: t })], ['LTRIM', 'unk', 0, 299]);
  await store.pipeline(cmds);
});

const recordError = safe(async (where, message) => {
  await bump('err');
  await store.pipeline([['LPUSH', 'errs', JSON.stringify({ t: nowIso(), where, message: String(message).slice(0, 300) })], ['LTRIM', 'errs', 0, 199]]);
});

const isBlocked = async (uid) => { try { return Boolean(uid) && (await store.cmd('SISMEMBER', 'blocked', uid)) === 1; } catch { return false; } };
const getConfig = async () => { try { return store.pairs(await store.cmd('HGETALL', 'cfg')); } catch { return {}; } };

// ───────────── 後台查詢 ─────────────
async function dailySeries(days = 14) {
  const keys = Array.from({ length: days }, (_, i) => daysAgo(days - 1 - i));
  const res = await store.pipeline(keys.map((k) => ['HGETALL', `daily:${k}`]));
  return keys.map((k, i) => ({ date: k, ...Object.fromEntries(Object.entries(store.pairs(res[i])).map(([a, b]) => [a, Number(b)])) }));
}

async function allUsers() {
  const flat = await store.cmd('HGETALL', 'users');
  return Object.values(store.pairs(flat)).map(store.parse).filter(Boolean);
}

async function allGroups() {
  const flat = await store.cmd('HGETALL', 'groups');
  return Object.values(store.pairs(flat)).map(store.parse).filter(Boolean);
}

async function overview() {
  const [users, groups, series] = await Promise.all([allUsers(), allGroups(), dailySeries(14)]);
  const friends = users.filter((u) => u.status === 'friend');
  const today = series[series.length - 1] || {};
  const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
  const kinds = {};
  for (const d of series.slice(-7)) for (const [k, v] of Object.entries(d)) if (k.startsWith('q_')) kinds[k.slice(2)] = (kinds[k.slice(2)] || 0) + v;
  return {
    storeEnabled: store.enabled(),
    friends: friends.length, unfollowed: users.filter((u) => u.status === 'unfollowed').length, seenOnly: users.filter((u) => u.status === 'seen').length,
    groups: groups.filter((g) => g.status !== 'left').length, groupsLeft: groups.filter((g) => g.status === 'left').length,
    today: { follow: today.follow || 0, unfollow: today.unfollow || 0, msg: today.msg || 0, err: today.err || 0 },
    week: { follow: sum(series.slice(-7), 'follow'), unfollow: sum(series.slice(-7), 'unfollow'), msg: sum(series.slice(-7), 'msg') },
    avgMs: sum(series.slice(-7), 'lat_n') ? Math.round(sum(series.slice(-7), 'lat_sum') / sum(series.slice(-7), 'lat_n')) : null,
    series, kinds,
    newest: friends.sort((a, b) => String(b.followedAt).localeCompare(String(a.followedAt))).slice(0, 8),
  };
}

const recentEvents = async (limit = 100, type = '') => {
  const rows = (await store.cmd('LRANGE', 'evlog', 0, 999)).map(store.parse).filter(Boolean);
  return rows.filter((e) => !type || e.type === type).slice(0, limit);
};

async function keywords(limit = 30) {
  const flat = await store.cmd('ZREVRANGE', 'kw', 0, limit - 1, 'WITHSCORES');
  const top = []; for (let i = 0; i < (flat || []).length; i += 2) top.push({ text: flat[i], n: Number(flat[i + 1]) });
  const unk = (await store.cmd('LRANGE', 'unk', 0, 49)).map(store.parse).filter(Boolean);
  return { top, unknown: unk };
}

module.exports = { taipeiDay, bump, logEvent, upsertUser, getUser, putUser, recordFollow, recordUnfollow, recordJoin, recordLeave, recordMessage, recordError, isBlocked, getConfig, dailySeries, allUsers, allGroups, overview, recentEvents, keywords };
