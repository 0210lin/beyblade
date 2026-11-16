'use strict';
/**
 * 查詢引擎：觸發判斷 / 別名解析 / 模式 A（配置）/ 模式 B（解釋）/ 排版
 * 純函式、無外部相依，可直接在本機 `npm test` 驗證。
 */
const dict = require('../data/dictionary.json');
const wiki = require('../data/parts_wiki.json');

const LINE = '━━━━━━━━━━━━━━';
const THIN = '──────────────';
const KIND_KEY = { blade: 'blades', bit: 'bits', ratchet: 'ratchets', cx: 'cx' };
const CX_ROLE = { assist: '輔助戰刃', over: '超越戰刃', main: '鋼鐵戰刃', metal: '金屬戰刃', chip: '鎖定紋章', product: 'CX 整組商品' };

// ───────────────────────── 文字正規化 ─────────────────────────
const norm = (s) =>
  String(s).normalize('NFKC').toLowerCase().replace(/[\s\-_.,，。、!！?？:：;；「」"'’`·・()（）]/g, '');
const SUFFIX = /(固鎖輪|戰刃|ratchet|blade|bit|軸心|軸|輪)$/;

function candidates(term) {
  const n = norm(term);
  const out = [n, n.replace(SUFFIX, '')].filter(Boolean);
  return [...new Set(out)];
}

// ───────────────────────── 別名索引 ─────────────────────────
/** key(正規化別名) → [{kind,id}] */
const index = new Map();
function addAlias(key, kind, id) {
  const k = norm(key);
  if (!k) return;
  if (!index.has(k)) index.set(k, []);
  const arr = index.get(k);
  if (!arr.some((x) => x.kind === kind && x.id === id)) arr.push({ kind, id });
}
for (const [id, b] of Object.entries(dict.blades)) {
  [b.zh, b.en, id, ...(b.aliases || [])].forEach((a) => addAlias(a, 'blade', id));
}
for (const [id, b] of Object.entries(dict.bits)) {
  [b.zh, b.en, id, ...(b.aliases || [])].forEach((a) => addAlias(a, 'bit', id));
}
for (const [id, c] of Object.entries(dict.cx || {})) {
  [c.zh, c.en, id, ...(c.aliases || [])].forEach((a) => addAlias(a, 'cx', id));
}
const indexKeys = [...index.keys()];

function displayName(kind, id) {
  if (kind === 'blade') return `${dict.blades[id].zh} ${dict.blades[id].en}`;
  if (kind === 'bit') return `${dict.bits[id].zh}（${dict.bits[id].en}）`;
  if (kind === 'cx') return `${dict.cx[id].zh} ${dict.cx[id].en}（${CX_ROLE[dict.cx[id].role]}）`;
  return `固鎖輪 ${id}`;
}
const bladeEn = (id) => (dict.blades[id] ? dict.blades[id].en : id);

// ───────────────────────── 模糊比對 ─────────────────────────
function lev(a, b) {
  const A = [...a], B = [...b];
  const dp = Array.from({ length: A.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= B.length; j++) dp[0][j] = j;
  for (let i = 1; i <= A.length; i++)
    for (let j = 1; j <= B.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
  return dp[A.length][B.length];
}

const uniqHits = (hits) => {
  const seen = new Set();
  return hits.filter((h) => !seen.has(h.kind + ':' + h.id) && seen.add(h.kind + ':' + h.id));
};

/** 解析一段文字 → {hits, notes[], suggestions[]}；可處理黏在一起的「鯊魚lf」 */
function resolveText(text, depth = 0) {
  const res = { hits: [], notes: [], suggestions: [] };
  for (const c of candidates(text)) {
    // 1) 完全命中
    if (index.has(c)) {
      res.hits = uniqHits(index.get(c));
      return res;
    }
  }
  const cs = candidates(text);
  // 2) 字串中含有別名（取最長），剩餘部分遞迴解析（鯊魚lf → 鯊魚 + LF）
  for (const c of cs) {
    let best = null;
    for (const k of indexKeys) if (k.length >= 2 && c.includes(k) && (!best || k.length > best.length)) best = k;
    if (best) {
      res.hits = uniqHits(index.get(best));
      const rest = c.replace(best, '');
      if (rest && depth < 3) {
        const sub = resolveText(rest, depth + 1);
        res.hits = uniqHits([...res.hits, ...sub.hits]);
      }
      return res;
    }
  }
  // 3) 模糊（編輯距離）
  for (const c of cs) {
    const len = [...c].length;
    if (len < 2) continue;
    const limit = len >= 5 ? 2 : 1;
    let bestD = Infinity, bestKeys = [];
    for (const k of indexKeys) {
      const kl = [...k].length;
      if (kl < 2 || Math.abs(kl - len) > limit) continue;
      const d = lev(c, k);
      if (d < bestD) { bestD = d; bestKeys = [k]; } else if (d === bestD) bestKeys.push(k);
    }
    if (bestD <= limit && !(len === 2 && bestD > 1)) {
      const hits = uniqHits(bestKeys.flatMap((k) => index.get(k)));
      const ids = new Set(hits.map((h) => h.kind + ':' + h.id));
      if (ids.size === 1 || hits.every((h) => h.kind === hits[0].kind && bestKeys.length <= 3)) {
        res.hits = hits;
        res.notes.push(`「${text}」視為「${displayName(hits[0].kind, hits[0].id)}」`);
        return res;
      }
    }
  }
  // 4) 提供建議
  const c0 = cs[cs.length - 1] || '';
  const scored = indexKeys
    .filter((k) => [...k].length >= 2)
    .map((k) => ({ k, d: lev(c0, k) }))
    .filter((x) => x.d <= Math.max(2, Math.ceil([...c0].length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12);
  const sug = [];
  for (const s of scored) for (const h of index.get(s.k)) {
    const n = displayName(h.kind, h.id);
    if (!sug.includes(n)) sug.push(n);
  }
  res.suggestions = sug.slice(0, 3);
  return res;
}

// ───────────────────────── 指令解析 ─────────────────────────
const HELP_RE = /^(help|幫助|指令|使用說明|說明書|選單|menu|\?)$/i;
const COMBO_RE = /(配置|配方|組合|上位)/g;
const WIKI_RE = /(解釋|說明|介紹|優缺點|是什麼|怎麼樣|詳解)/g;

/**
 * @returns {{kind:'help'}|{kind:'query',mode:'combo'|'wiki'|null,parts:object[],ratchets:string[],unknown:string[],notes:string[],suggestions:string[]}}
 */
function parseQuery(raw) {
  let t = String(raw || '').normalize('NFKC').trim();
  if (!t || HELP_RE.test(t)) return { kind: 'help' };

  let mode = null;
  if (COMBO_RE.test(t)) mode = 'combo';
  else if (WIKI_RE.test(t)) mode = 'wiki';
  COMBO_RE.lastIndex = 0;
  t = t.replace(COMBO_RE, ' ').replace(WIKI_RE, ' ');
  WIKI_RE.lastIndex = 0;

  // 固鎖輪代號（3-60 / 9_60 / 5 - 70）
  const ratchets = [];
  t = t.replace(/(\d|m)\s*[-_]\s*(50|55|60|65|70|80|85)(?!\d)/gi, (m, a, b) => {
    ratchets.push(`${a.toUpperCase()}-${b}`);
    return ' ';
  });
  let tokens = t.split(/[\s+,、，和跟&]+/).filter(Boolean);
  tokens = tokens.filter((tok) => {
    const m = tok.match(/^(\d)(60|70|80)$/);
    if (m) { ratchets.push(`${m[1]}-${m[2]}`); return false; }
    return true;
  });

  const hits = [];
  const unknown = [];
  const notes = [];
  let suggestions = [];
  const joined = tokens.join('');
  const tryTokens = tokens.length > 1;
  let resolvedAll = false;
  if (tryTokens) {
    const sub = tokens.map((tok) => resolveText(tok));
    if (sub.every((r) => r.hits.length)) {
      sub.forEach((r) => { hits.push(...r.hits); notes.push(...r.notes); });
      resolvedAll = true;
    }
  }
  if (!resolvedAll && joined) {
    const r = resolveText(joined);
    if (r.hits.length) { hits.push(...r.hits); notes.push(...r.notes); }
    else if (tryTokens) {
      // 逐個解析，剩下的列為未知
      tokens.forEach((tok) => {
        const rr = resolveText(tok);
        if (rr.hits.length) { hits.push(...rr.hits); notes.push(...rr.notes); }
        else { unknown.push(tok); suggestions = suggestions.concat(rr.suggestions); }
      });
    } else { unknown.push(joined); suggestions = r.suggestions; }
  }

  // 依類型合併（同類型取聯集）
  const parts = [];
  for (const h of uniqHits(hits)) {
    let p = parts.find((x) => x.kind === h.kind);
    if (!p) parts.push((p = { kind: h.kind, ids: [] }));
    if (!p.ids.includes(h.id)) p.ids.push(h.id);
  }
  [...new Set(ratchets)].forEach((r) => parts.push({ kind: 'ratchet', ids: [r] }));
  const mergedRatchets = parts.filter((p) => p.kind === 'ratchet');
  if (mergedRatchets.length > 1) {
    const ids = mergedRatchets.flatMap((p) => p.ids);
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].kind === 'ratchet') parts.splice(i, 1);
    parts.push({ kind: 'ratchet', ids });
  }
  return { kind: 'query', mode, parts, ratchets: [...new Set(ratchets)], unknown, notes, suggestions: [...new Set(suggestions)].slice(0, 3) };
}

// ───────────────────────── 模式 A：配置 ─────────────────────────
const MS_DAY = 86400000;
const dateOf = (c) => new Date(c.date + 'T00:00:00Z');
const fmtDate = (d) => d;

function partsTitle(parts) {
  return parts
    .map((p) => {
      if (p.kind === 'ratchet') return `固鎖輪 ${p.ids.join('/')}`;
      return p.ids.slice(0, 3).map((id) => displayName(p.kind, id)).join('／');
    })
    .join(' + ');
}

function comboLabel(c, dims) {
  const bits = [];
  if (dims.includes('blade')) bits.push(bladeEn(c.blade));
  const rb = (dims.includes('ratchet') ? c.ratchet : '') + (dims.includes('bit') ? c.bit : '');
  if (rb) bits.push(rb);
  return bits.join(' ');
}

function formatCombo(parts, data, opts = {}) {
  const windowDays = opts.windowDays || 90;
  const now = opts.now ? new Date(opts.now) : new Date();
  const filters = {};
  parts.forEach((p) => (filters[p.kind] = new Set(p.ids)));
  const match = (c) =>
    (!filters.blade || filters.blade.has(c.blade)) &&
    (!filters.bit || filters.bit.has(c.bit)) &&
    (!filters.ratchet || filters.ratchet.has(c.ratchet));

  const all = (data.combos || []).filter(match);
  const recent = all.filter((c) => (now - dateOf(c)) / MS_DAY <= windowDays);
  const list = recent.length ? recent : all;
  const title = partsTitle(parts);

  if (!list.length) {
    return [LINE, `【${title}】`, LINE, '近期賽事資料中沒有找到這個配置的上位紀錄。', '可能還沒被爬到，或該零件近期較少上位。'].join('\n');
  }

  const dims = ['blade', 'ratchet', 'bit'].filter((d) => !filters[d]);
  const gdims = dims.length ? dims : ['blade', 'ratchet', 'bit'];
  const groups = new Map();
  for (const c of list) {
    const key = comboLabel(c, gdims);
    const g = groups.get(key) || { key, n: 0, best: 9, latest: '' };
    g.n++;
    g.best = Math.min(g.best, c.rank || 9);
    if (c.date > g.latest) g.latest = c.date;
    groups.set(key, g);
  }
  const top = [...groups.values()].sort((a, b) => b.n - a.n || a.best - b.best || (a.latest < b.latest ? 1 : -1)).slice(0, 5);
  const latest = [...list].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
  const seedOnly = list.every((c) => c.seed);

  const out = [LINE, `【${title}】近期上位配置`, LINE];
  top.forEach((g, i) => out.push(`${i + 1}. ${g.key}　×${g.n}${g.best === 1 ? '（含冠軍）' : ''}`));
  out.push(THIN, '最新賽事');
  latest.forEach((c) => {
    const rk = c.rank ? `${c.rank}位` : '上位';
    out.push(`・${fmtDate(c.date)} ${c.event}｜${rk}｜${c.combo}`);
  });
  out.push(THIN, `樣本 ${list.length} 筆${recent.length ? `（近 ${windowDays} 天）` : '（無近期資料，列出全部）'}`);
  if (data.updated_at) out.push(`資料更新：${String(data.updated_at).slice(0, 10)}`);
  if (seedOnly) out.push('※ 目前為示範資料，爬蟲抓到真實賽事後會自動取代');
  return out.join('\n');
}

// ───────────────────────── 模式 B：解釋 ─────────────────────────
const TYPE_ZH = { Attack: '攻擊型', Defense: '防禦型', Stamina: '持久型', Balance: '平衡型' };

/** 社群站的規格資料（編號/旋向/重量/高度…），組成一行 */
function specOf(kind, id) {
  if (kind === 'blade') {
    const b = dict.blades[id];
    if (!b) return '';
    const p = [];
    if (b.code) p.push(`編號 ${b.code}`);
    if (b.spin) p.push(`${b.spin === 'L' ? '左旋' : '右旋'}${b.spin_unconfirmed ? '（待確認）' : ''}`);
    if (b.weight) p.push(`重量約 ${b.weight}`);
    return p.join('・');
  }
  if (kind === 'cx') {
    const c = dict.cx[id];
    if (!c) return '';
    const p = [CX_ROLE[c.role]];
    if (c.code) p.push(`編號 ${c.code}`);
    if (c.weight) p.push(`重量約 ${c.weight}`);
    if (c.packs && c.packs.length) p.push(`收錄 ${c.packs.join('、')}`);
    return p.join('・');
  }
  if (kind === 'bit') {
    const b = dict.bits[id];
    if (!b) return '';
    const p = [];
    if (b.shape) p.push(`形狀 ${b.shape}`);
    if (b.height) p.push(`高度 ${b.height}`);
    if (b.weight) p.push(`重量級 ${b.weight}`);
    return p.join('・');
  }
  const r = (dict.ratchets || {})[id];
  if (!r) return '';
  const p = [`類型 ${TYPE_ZH[r.type] || r.type}`, `凸刃 ${r.pegs}`, `高度 ${r.height}`];
  if (r.weight) p.push(`重量級 ${r.weight}`);
  return p.join('・');
}

function genericRatchet(id) {
  const [n, h] = id.split('-');
  const spec = (dict.ratchets || {})[id];
  const hh = spec ? spec.height : `${(Number(h) / 10).toFixed(1)}mm`;
  return {
    name: `固鎖輪 ${id} / ${n === 'M' ? '金屬一體' : n + ' 凸刃'}・高度 ${hh}`,
    core: `代號 ${id}：前碼 ${n === 'M' ? 'M 為金屬一體' : n + ' 為凸刃數（咬合點數量）'}，後碼 ${h} 為高度（${hh}）。凸刃越多抗爆裂越強但質量略增；高度越高重心越高、越易被撞飛，但持久組可利用。`,
    pros: ['依凸刃數與高度可調整重心與抗爆裂'],
    cons: ['此代號尚未收錄詳細實戰評價'],
    pairs: '可參考相近代號（3-60 / 9-60 / 5-60 / 4-80）的搭配',
  };
}

function wikiEntry(kind, id) {
  const e = wiki[KIND_KEY[kind]] && wiki[KIND_KEY[kind]][id];
  if (e) return e;
  if (kind === 'ratchet') return genericRatchet(id);
  if (kind === 'blade') {
    const b = dict.blades[id];
    return {
      name: `${b.zh} / ${b.en}`,
      core: '這顆戰刃的詳細解析還沒收錄，可以先用「配置」查近期賽事用法。',
      pros: [], cons: [], pairs: '—',
    };
  }
  return null;
}

function formatWikiEntry(e, spec) {
  const list = (a) => (a && a.length ? a.map((x) => `・${x}`).join('\n') : '・（無資料）');
  const out = [`【${e.name}】`, `【核心功能】${e.core}`, '【優點】', list(e.pros), '【缺點】', list(e.cons), `【常見搭配】${e.pairs || '—'}`];
  if (spec) out.push(`【資料】${spec}`);
  return out.join('\n');
}

function formatWiki(parts) {
  const entries = [];
  for (const p of parts) for (const id of p.ids) {
    const e = wikiEntry(p.kind, id);
    if (e) entries.push(formatWikiEntry(e, specOf(p.kind, id)));
  }
  if (!entries.length) return null;
  const shown = entries.slice(0, 3);
  let out = shown.join(`\n${THIN}\n`);
  if (entries.length > shown.length) out += `\n${THIN}\n（另有 ${entries.length - shown.length} 筆，請輸入更精確的名稱）`;
  return out;
}

// ───────────────────────── 說明 ─────────────────────────
const HELP = [
  LINE,
  '戰鬥陀螺查詢機器人',
  LINE,
  '群組內請 @機器人 或用「!查詢」開頭',
  '',
  '▍查近期上位配置',
  '　@機器人 鯊魚配置',
  '　@機器人 魔導神杖 配置',
  '　@機器人 9-60 配置',
  '　@機器人 鯊魚 LF 配置',
  '',
  '▍查零件解釋',
  '　@機器人 R軸解釋',
  '　@機器人 3-60解釋',
  '　@機器人 鯊魚解釋',
  '',
  '俗稱、簡稱、英文名都可以，打錯字也會盡量猜。',
].join('\n');

// ───────────────────────── 主入口 ─────────────────────────
function handleQuery(raw, data, opts = {}) {
  const q = parseQuery(raw);
  if (q.kind === 'help') return HELP;

  if (!q.parts.length) {
    const t = q.unknown.join(' ') || String(raw).trim();
    const hint = q.suggestions.length ? `\n你是不是要查：${q.suggestions.join('、')}` : '';
    return `找不到「${t}」對應的零件。${hint}\n輸入「指令」查看用法。`;
  }

  let mode = q.mode;
  if (!mode) mode = q.parts.length === 1 && q.parts[0].kind !== 'ratchet' ? 'wiki' : q.parts.length === 1 ? 'wiki' : 'combo';

  let body;
  if (mode === 'combo' && q.parts.every((x) => x.kind === 'cx')) {
    return `${partsTitle(q.parts)}
CX 系列零件目前沒有賽事配置統計，可以用「解釋」查詢，例如「${dict.cx[q.parts[0].ids[0]].zh}解釋」。`;
  }
  if (mode === 'combo') q.parts = q.parts.filter((x) => x.kind !== 'cx');
  if (mode === 'wiki') {
    body = formatWiki(q.parts);
    if (!body) body = '這個查詢沒有收錄解釋。';
  } else body = formatCombo(q.parts, data, opts);

  const extra = [];
  if (q.notes.length) extra.push(q.notes.join('；'));
  if (q.unknown.length) extra.push(`未辨識：${q.unknown.join('、')}（已略過）`);
  return extra.length ? `${body}\n${THIN}\n${extra.join('\n')}` : body;
}

// ───────────────────────── 群組觸發判斷 ─────────────────────────
/**
 * 判斷這則 LINE 文字訊息是否該回應，並去掉 @機器人 / !查詢 前綴。
 * 群組/多人聊天室：需 @機器人（mention.isSelf）、`!查詢` 前綴、或以 `@BOT_NAME` 開頭。
 * 一對一聊天：一律回應。
 */
function extractQuery(event, env = process.env) {
  const msg = event.message || {};
  let text = String(msg.text || '');
  const srcType = event.source && event.source.type;
  let triggered = srcType === 'user';

  const mentionees = (msg.mention && msg.mention.mentionees) || [];
  const selfs = mentionees.filter((m) => m.isSelf).sort((a, b) => b.index - a.index);
  for (const m of selfs) {
    triggered = true;
    const seg = text.slice(m.index, m.index + m.length);
    if (seg.startsWith('@')) text = text.slice(0, m.index) + ' ' + text.slice(m.index + m.length);
    else text = text.replace(/@\S+\s*/, ' ');
  }

  const botName = (env.BOT_NAME || '').trim();
  if (botName) {
    const re = new RegExp('^\\s*[@＠]' + botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i');
    if (re.test(text)) { triggered = true; text = text.replace(re, ''); }
  }
  const prefix = /^\s*[!！](查詢|查询|bey|beyblade|陀螺)\s*/i;
  if (prefix.test(text)) { triggered = true; text = text.replace(prefix, ''); }

  return { triggered, text: text.trim() };
}

module.exports = { handleQuery, parseQuery, extractQuery, resolveText, formatCombo, formatWiki, HELP, dict, wiki };
