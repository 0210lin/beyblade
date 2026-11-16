'use strict';
/**
 * 查詢引擎：觸發判斷 / 別名解析 / 模式 A（配置）/ 模式 B（解釋）/ 排版
 * 純函式、無外部相依，可直接在本機 `npm test` 驗證。
 */
const dict = require('../data/dictionary.json');
const wiki = require('../data/parts_wiki.json');
const { handleEvents } = require('./events');

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
const defaultNotes = new Map(Object.entries(dict.default_aliases || {}).map(([k, v]) => [norm(k), v.note]).filter(([, n]) => n));
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
      if (defaultNotes.has(c)) res.notes.push(defaultNotes.get(c));
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
      if (defaultNotes.has(best)) res.notes.push(defaultNotes.get(best));
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
  if (dims.includes('blade')) bits.push(c.blade ? bladeEn(c.blade) : (c.cx_label || '?'));
  const rb = (dims.includes('ratchet') ? c.ratchet : '') + (dims.includes('bit') ? c.bit : '');
  if (rb) bits.push(rb);
  return bits.join(' ');
}

const MEDAL = ['🥇', '🥈', '🥉'];
const RANK_ZH = { 1: '冠軍', 2: '亞軍', 3: '季軍', 4: '殿軍' };
const NAVY = '#1F3A5F';
const BLUE = '#1D7BD9';
const GRAY = '#7A8699';
const shortDate = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
const placeText = (c) => `${c.division || ''}${RANK_ZH[c.rank] || '上位'}`;
const eventKey = (c) => `${c.url || ''}|${c.event}`;

const fx = {
  title: (text, color = NAVY) => ({ type: 'text', text, weight: 'bold', size: 'sm', color, margin: 'md' }),
  note: (text) => ({ type: 'text', text, size: 'xs', color: GRAY, wrap: true, margin: 'sm' }),
};

function comboHeader(title, sub) {
  return {
    type: 'box', layout: 'vertical', backgroundColor: NAVY, paddingAll: '16px',
    contents: [
      { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: sub, color: '#B8C7DD', size: 'xs', margin: 'sm', wrap: true },
    ],
  };
}

/** 社群推薦配置（beybladehub.app/combos 的「社群攻略 / 玩家常用配置」） */
function recommendFor(data, filters) {
  if (!data.recommended || !filters.blade || filters.blade.size !== 1) return null;
  const id = [...filters.blade][0];
  const r = data.recommended[id];
  return r && (r.tips.length || r.common_ratchets.length || r.common_bits.length) ? r : null;
}

function recText(r) {
  const out = ['💡 社群推薦'];
  r.tips.slice(0, 3).forEach((t) => out.push(`・${t.ratchet} ${t.bit}（${t.style}）${t.desc ? `
　${t.desc}` : ''}`));
  if (r.common_ratchets.length) out.push(`常用固鎖：${r.common_ratchets.slice(0, 6).join(' ')}`);
  if (r.common_bits.length) out.push(`常用軸心：${r.common_bits.slice(0, 8).join(' ')}`);
  return out;
}

function recFlex(r) {
  const out = [{ type: 'separator', margin: 'lg' }, fx.title('💡 社群推薦')];
  r.tips.slice(0, 3).forEach((t) => {
    out.push({ type: 'text', text: `${t.ratchet} ${t.bit}　${t.style}`, size: 'sm', weight: 'bold', margin: 'md', wrap: true });
    if (t.desc) out.push({ type: 'text', text: t.desc, size: 'xs', color: GRAY, wrap: true, margin: 'xs' });
  });
  if (r.common_ratchets.length) out.push({ type: 'text', text: `常用固鎖：${r.common_ratchets.slice(0, 6).join('　')}`, size: 'xs', color: '#333B48', wrap: true, margin: 'md' });
  if (r.common_bits.length) out.push({ type: 'text', text: `常用軸心：${r.common_bits.slice(0, 8).join('　')}`, size: 'xs', color: '#333B48', wrap: true, margin: 'xs' });
  return out;
}

function formatCombo(parts, data, opts = {}) {
  const windowDays = opts.windowDays || 180;
  const now = opts.now ? new Date(opts.now) : new Date();
  const filters = {};
  parts.forEach((p) => (filters[p.kind] = new Set(p.ids)));
  const match = (c) =>
    (!filters.cx || filters.cx.has(c.cx)) &&
    (!filters.blade || filters.blade.has(c.blade)) &&
    (!filters.bit || filters.bit.has(c.bit)) &&
    (!filters.ratchet || filters.ratchet.has(c.ratchet));

  const all = (data.combos || []).filter(match);
  const recent = all.filter((c) => (now - dateOf(c)) / MS_DAY <= windowDays);
  const list = recent.length ? recent : all;
  const title = partsTitle(parts);

  if (!list.length && recommendFor(data, filters)) {
    const rec0 = recommendFor(data, filters);
    return {
      text: [LINE, `🔹 ${title}`, '近期賽事資料沒有這個零件的上位紀錄，以下是社群推薦', LINE, ...recText(rec0)].join('\n'),
      flex: { type: 'bubble', size: 'mega', header: comboHeader(title, '近期沒有上位紀錄・社群推薦'), body: { type: 'box', layout: 'vertical', contents: recFlex(rec0) } },
    };
  }
  if (!list.length) {
    const msg = '近期賽事資料中沒有找到這個配置的上位紀錄。\n可能還沒被收錄，或該零件近期較少上位。';
    return {
      text: [LINE, `【${title}】`, LINE, msg].join('\n'),
      flex: { type: 'bubble', header: comboHeader(title, '近期上位配置'), body: { type: 'box', layout: 'vertical', contents: [fx.note(msg)] } },
    };
  }

  const dims = ['blade', 'ratchet', 'bit'].filter((d) => !filters[d] && !(d === 'blade' && filters.cx));
  const gdims = dims.length ? dims : ['blade', 'ratchet', 'bit'];
  const groups = new Map();
  for (const c of list) {
    const key = comboLabel(c, gdims);
    const g = groups.get(key) || { key, n: 0, best: 9, latest: '' };
    g.n += c.n || 1;
    g.best = Math.min(g.best, c.rank || 9);
    if (c.date > g.latest) g.latest = c.date;
    groups.set(key, g);
  }
  const top = [...groups.values()].sort((a, b) => b.n - a.n || a.best - b.best || (a.latest < b.latest ? 1 : -1)).slice(0, 5);

  // 依賽事分組，列出最近 4 場（每場列出這個零件拿到的名次）
  const events = new Map();
  for (const c of list) {
    const k = eventKey(c);
    const e = events.get(k) || { date: c.date, event: c.event, url: c.url, items: [] };
    e.items.push(c);
    events.set(k, e);
  }
  const latest = [...events.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  latest.forEach((e) => e.items.sort((a, b) => (a.rank || 9) - (b.rank || 9)));
  const seedOnly = list.every((c) => c.seed);
  const sampleN = list.reduce((a, c) => a + (c.n || 1), 0);
  const sub = `近期上位配置・樣本 ${sampleN} 筆${recent.length ? '' : '（無近期資料，列出全部）'}`;

  const rec = recommendFor(data, filters);
  // ── 純文字（備援 / 測試用）──
  const out = [LINE, `🔹 ${title}`, sub, LINE];
  top.forEach((g, i) => out.push(`${MEDAL[i] || `${i + 1}.`} ${g.key}　×${g.n}${g.best === 1 ? '（含冠軍）' : ''}`));
  if (rec) out.push(THIN, ...recText(rec));
  out.push(THIN, '📅 最新得名賽事');
  latest.forEach((e) => {
    out.push(`${shortDate(e.date)} ${e.event}`);
    e.items.slice(0, 3).forEach((c) => out.push(`　${placeText(c)}　${comboLabel(c, gdims)}${c.player ? `　選手：${c.player}` : ''}${c.n > 1 ? `　（${c.n} 場）` : ''}`));
    if (e.url) out.push(`　🔗 ${e.url}`);
  });
  if (data.updated_at) out.push(THIN, `資料更新：${String(data.updated_at).slice(0, 10)}`);
  if (seedOnly) out.push('※ 目前為示範資料');

  // ── Flex 卡片 ──
  const rows = top.map((g, i) => ({
    type: 'box', layout: 'horizontal', margin: 'sm', contents: [
      { type: 'text', text: MEDAL[i] || `${i + 1}`, flex: 1, size: 'sm', color: GRAY, gravity: 'center' },
      { type: 'text', text: g.key, flex: 6, size: 'md', weight: 'bold', wrap: true, gravity: 'center' },
      { type: 'text', text: `×${g.n}${g.best === 1 ? ' 🏆' : ''}`, flex: 2, size: 'sm', color: GRAY, align: 'end', gravity: 'center' },
    ],
  }));
  const evBoxes = latest.map((e) => {
    const box = {
      type: 'box', layout: 'vertical', margin: 'md', paddingAll: '10px', backgroundColor: '#F3F6FA', cornerRadius: '8px',
      contents: [
        { type: 'text', text: `${shortDate(e.date)}　${e.event}`, size: 'sm', weight: 'bold', wrap: true },
        ...e.items.slice(0, 3).map((c) => ({
          type: 'text', size: 'xs', color: '#333B48', wrap: true, margin: 'xs',
          text: `${placeText(c)}　${comboLabel(c, gdims)}${c.player ? `　選手：${c.player}` : ''}${c.n > 1 ? `　（${c.n} 場）` : ''}`,
        })),
      ],
    };
    if (e.url) {
      box.contents.push({ type: 'text', text: '查看賽事頁 ›', size: 'xs', color: BLUE, margin: 'sm' });
      box.action = { type: 'uri', label: '賽事頁', uri: e.url };
    }
    return box;
  });
  const bodyContents = [fx.title('🔥 熱門配置'), ...rows, ...(rec ? recFlex(rec) : []), { type: 'separator', margin: 'lg' }, fx.title('📅 最新得名賽事'), ...evBoxes];
  const foot = [data.updated_at ? `資料更新 ${String(data.updated_at).slice(0, 10)}` : '', seedOnly ? '目前為示範資料' : ''].filter(Boolean).join('　');
  if (foot) bodyContents.push(fx.note(foot));
  return { text: out.join('\n'), flex: { type: 'bubble', size: 'mega', header: comboHeader(title, sub), body: { type: 'box', layout: 'vertical', contents: bodyContents } } };
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

function wikiBubble(e, spec) {
  const sec = (label, color, text) => ({
    type: 'box', layout: 'vertical', margin: 'lg', contents: [
      { type: 'text', text: label, size: 'xs', weight: 'bold', color },
      { type: 'text', text, size: 'sm', wrap: true, margin: 'xs', color: '#222B38' },
    ],
  });
  const bullets = (a) => (a && a.length ? a.map((x) => `・${x}`).join('\n') : '・（無資料）');
  const [title, ...tags] = e.name.split(' / ');
  const body = [
    sec('核心功能', NAVY, e.core),
    sec('優點', '#1E8E4E', bullets(e.pros)),
    sec('缺點', '#C0392B', bullets(e.cons)),
    sec('常見搭配', '#B7791F', e.pairs || '—'),
  ];
  if (spec) body.push({ type: 'separator', margin: 'lg' }, fx.note(`📋 ${spec}`));
  return {
    type: 'bubble', size: 'mega',
    header: comboHeader(title, tags.join('　')),
    body: { type: 'box', layout: 'vertical', contents: body },
  };
}

function formatWiki(parts) {
  const items = [];
  for (const p of parts) for (const id of p.ids) {
    const e = wikiEntry(p.kind, id);
    if (e) items.push({ e, spec: specOf(p.kind, id) });
  }
  if (!items.length) return null;
  const shown = items.slice(0, 5);
  let text = shown.map((x) => formatWikiEntry(x.e, x.spec)).join(`\n${THIN}\n`);
  if (items.length > shown.length) text += `\n${THIN}\n（另有 ${items.length - shown.length} 筆，請輸入更精確的名稱）`;
  const bubbles = shown.map((x) => wikiBubble(x.e, x.spec));
  return { text, flex: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles } };
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
  '▍看 T 表（高手評級圖）',
  '　@機器人 T表',
  '',
  '▍查雙北賽事',
  '　@機器人 本週賽事',
  '　@機器人 板橋 賽事 週六',
  '　@機器人 夾子園 賽事',
  '',
  '▍查零件解釋',
  '　@機器人 R軸解釋',
  '　@機器人 3-60解釋',
  '　@機器人 鯊魚解釋',
  '',
  '俗稱、簡稱、英文名都可以，打錯字也會盡量猜。',
].join('\n');

// ───────────────────────── 主入口 ─────────────────────────
/** 回傳 { text, flex? }；flex 有值時 webhook 優先送 Flex 卡片，失敗再退回 text */
const TIER_RE = /^\s*(t\s*表|tier(\s*list)?|強度(排行|表)?|排行(榜)?|最強(陀螺|配置)?)\s*$/i;

function tierText(tier) {
  if (!tier || !(tier.blades || []).length) return 'T 表還沒有資料。';
  const out = [LINE, `📊 戰鬥陀螺 T 表（${tier.experts || '?'} 位高手・${tier.updated || ''}）`, LINE];
  for (const [k, label] of [['blades', '上蓋'], ['ratchets', '固鎖'], ['bits', '軸心']]) {
    const items = tier[k] || [];
    if (!items.length) continue;
    out.push(`▍${label}`);
    const order = ['X', 'SS', 'S', 'T1', 'T2', 'A', 'B', 'C', 'D'];
    for (const t of [...new Set(items.map((i) => i.tier))].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      out.push(`${t}：${items.filter((i) => i.tier === t).map((i) => i.name + (i.votes > 1 ? `×${i.votes}` : '')).join('、')}`);
    }
  }
  out.push(THIN, '×N = N 位高手同時評選', '資料：beybladehub.app（社群整理，非官方）');
  return out.join('\n');
}

function handleRich(raw, data, opts = {}) {
  if (TIER_RE.test(String(raw || '').normalize('NFKC'))) return { text: tierText(data.tier), image: 'tier', tier: data.tier };
  const evr = opts.events ? handleEvents(raw, opts.events, opts) : null;
  if (evr) return evr;
  const q = parseQuery(raw);
  if (q.kind === 'help') return { text: HELP, flex: helpFlex() };

  if (!q.parts.length) {
    const t = q.unknown.join(' ') || String(raw).trim();
    const hint = q.suggestions.length ? `\n你是不是要查：${q.suggestions.join('、')}` : '';
    return { text: `找不到「${t}」對應的零件。${hint}\n輸入「指令」查看用法。` };
  }

  let mode = q.mode;
  if (!mode) mode = q.parts.length === 1 ? 'wiki' : 'combo';

  const cxHasCombos = (x) => x.kind === 'cx' && x.ids.some((id) => (data.combos || []).some((c) => c.cx === id));
  if (mode === 'combo' && q.parts.every((x) => x.kind === 'cx') && !q.parts.some(cxHasCombos)) {
    return { text: `${partsTitle(q.parts)}\nCX 系列零件目前沒有賽事配置統計，可以用「解釋」查詢，例如「${dict.cx[q.parts[0].ids[0]].zh}解釋」。` };
  }
  if (mode === 'combo') q.parts = q.parts.filter((x) => x.kind !== 'cx' || cxHasCombos(x));

  let res;
  if (mode === 'wiki') res = formatWiki(q.parts) || { text: '這個查詢沒有收錄解釋。' };
  else res = formatCombo(q.parts, data, opts);

  const extra = [];
  if (q.notes.length) extra.push(q.notes.join('；'));
  if (q.unknown.length) extra.push(`未辨識：${q.unknown.join('、')}（已略過）`);
  if (!extra.length) return res;
  const note = extra.join('\n');
  const out = { text: `${res.text}\n${THIN}\n${note}` };
  if (res.flex) {
    const last = res.flex.type === 'carousel' ? res.flex.contents[res.flex.contents.length - 1] : res.flex;
    last.body.contents.push(fx.note(`ℹ️ ${note}`));
    out.flex = res.flex;
  }
  return out;
}

function handleQuery(raw, data, opts = {}) {
  return handleRich(raw, data, opts).text;
}

function helpFlex() {
  const line = (t, c = '#222B38', b = false) => ({ type: 'text', text: t, size: 'sm', wrap: true, color: c, weight: b ? 'bold' : 'regular', margin: 'xs' });
  return {
    type: 'bubble', size: 'mega',
    header: comboHeader('戰鬥陀螺查詢機器人', '群組內請 @機器人，或用「!查詢」開頭'),
    body: {
      type: 'box', layout: 'vertical', contents: [
        fx.title('🔥 查近期上位配置'),
        line('鯊魚配置'), line('魔導神杖 配置'), line('9-60 配置'), line('鯊魚 LF 配置'),
        fx.title('📊 T 表'),
        line('T表（回傳高手評級圖）'),
        fx.title('📅 查雙北賽事'),
        line('本週賽事'), line('板橋 賽事 週六'), line('夾子園 賽事'),
        fx.title('📖 查零件解釋'),
        line('R軸解釋'), line('3-60解釋'), line('BX-14 解釋'), line('J輔助解釋'),
        { type: 'separator', margin: 'lg' },
        fx.note('俗稱、簡稱、英文名、產品編號都可以，打錯字也會盡量猜。「鯊魚」預設指鮫鯊狂鱗。'),
      ],
    },
  };
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

module.exports = { handleQuery, handleRich, tierText, parseQuery, extractQuery, resolveText, formatCombo, formatWiki, HELP, dict, wiki };
