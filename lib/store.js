'use strict';
/**
 * 儲存層：Upstash Redis（REST）。Vercel → Storage → Upstash for Redis 建立後會自動帶入環境變數：
 *   KV_REST_API_URL / KV_REST_API_TOKEN（或 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN）
 * 沒有設定時退回「記憶體模式」（只在同一個熱實例內有效，後台會顯示尚未連接資料庫）。
 * 只用 fetch，零相依。
 */
const env = process.env;
const URL_ = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';

const enabled = () => Boolean(URL_ && TOKEN);

// ── 記憶體備援（只實作用到的指令）──
const mem = { kv: new Map() };
function memCmd(args) {
  const [c, key, ...a] = args;
  const C = String(c).toUpperCase();
  const get = (init) => { if (!mem.kv.has(key)) mem.kv.set(key, init()); return mem.kv.get(key); };
  switch (C) {
    case 'GET': return mem.kv.get(key) ?? null;
    case 'SET': mem.kv.set(key, String(a[0])); return 'OK';
    case 'INCR': case 'INCRBY': { const v = Number(mem.kv.get(key) || 0) + Number(a[0] ?? 1); mem.kv.set(key, String(v)); return v; }
    case 'EXPIRE': return 1;
    case 'DEL': return mem.kv.delete(key) ? 1 : 0;
    case 'HSET': { const h = get(() => new Map()); for (let i = 0; i < a.length; i += 2) h.set(a[i], String(a[i + 1])); return 1; }
    case 'HGET': return (mem.kv.get(key) || new Map()).get(a[0]) ?? null;
    case 'HDEL': return (mem.kv.get(key) || new Map()).delete(a[0]) ? 1 : 0;
    case 'HINCRBY': { const h = get(() => new Map()); const v = Number(h.get(a[0]) || 0) + Number(a[1]); h.set(a[0], String(v)); return v; }
    case 'HGETALL': { const h = mem.kv.get(key) || new Map(); return [...h.entries()].flat(); }
    case 'HLEN': return (mem.kv.get(key) || new Map()).size;
    case 'LPUSH': { const l = get(() => []); l.unshift(...a.map(String)); return l.length; }
    case 'LTRIM': { const l = get(() => []); mem.kv.set(key, l.slice(Number(a[0]), Number(a[1]) + 1)); return 'OK'; }
    case 'LRANGE': { const l = mem.kv.get(key) || []; const e = Number(a[1]); return l.slice(Number(a[0]), e === -1 ? undefined : e + 1); }
    case 'LLEN': return (mem.kv.get(key) || []).length;
    case 'ZINCRBY': { const z = get(() => new Map()); const v = Number(z.get(a[1]) || 0) + Number(a[0]); z.set(a[1], v); return String(v); }
    case 'ZREVRANGE': { const z = mem.kv.get(key) || new Map(); const arr = [...z.entries()].sort((x, y) => y[1] - x[1]).slice(Number(a[0]), Number(a[1]) + 1); return a[2] === 'WITHSCORES' ? arr.flatMap(([m, s]) => [m, String(s)]) : arr.map(([m]) => m); }
    case 'ZCARD': return (mem.kv.get(key) || new Map()).size;
    case 'SADD': { const s = get(() => new Set()); a.forEach((x) => s.add(String(x))); return 1; }
    case 'SREM': return (mem.kv.get(key) || new Set()).delete(String(a[0])) ? 1 : 0;
    case 'SISMEMBER': return (mem.kv.get(key) || new Set()).has(String(a[0])) ? 1 : 0;
    case 'SMEMBERS': return [...(mem.kv.get(key) || new Set())];
    case 'PING': return 'PONG';
    default: throw new Error('memory store: unsupported ' + C);
  }
}

async function cmd(...args) {
  if (!enabled()) return memCmd(args);
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x)))),
    signal: AbortSignal.timeout(4000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function pipeline(cmds) {
  if (!enabled()) return cmds.map(memCmd);
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    signal: AbortSignal.timeout(5000),
  });
  const j = await res.json();
  return j.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}

const pairs = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]; return o; };
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

module.exports = { enabled, cmd, pipeline, pairs, parse };
