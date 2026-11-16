'use strict';
/**
 * 圖文選單／快速按鈕對應的指令：熱門配置、配置查詢、零件解釋、新品發售、主選單。
 * 由 lib/engine.js 呼叫（helpers 由 engine 傳入，避免循環相依）。
 */
const MS_DAY = 86400000;

const MAIN_QUICK = [
  { label: '🔥 熱門配置', text: '熱門配置' },
  { label: '📊 T表', text: 'T表' },
  { label: '📅 本週賽事', text: '本週賽事' },
  { label: '🆕 新品發售', text: '新品發售' },
  { label: '📖 零件解釋', text: '零件解釋' },
  { label: '❓ 使用說明', text: '指令' },
];

const RE = {
  hot: /^\s*(熱門|熱門配置|最熱|熱門陀螺|meta)\s*$/i,
  combo: /^\s*(配置查詢|查配置|配置)\s*$/,
  wiki: /^\s*(零件解釋|查解釋|解釋|零件|零件查詢)\s*$/,
  fresh: /^\s*(新品|新品發售|新品資訊|發售|發售日|新零件)\s*$/,
  menu: /^\s*(主選單|選單|menu|功能)\s*$/i,
};

const addDays = (s, n) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

function hotBlades(data, today, windowDays = 180) {
  const from = addDays(today, -windowDays);
  const score = new Map();
  for (const c of data.combos || []) {
    if (!c.blade || c.date < from) continue;
    const s = score.get(c.blade) || { n: 0, best: 9, combos: new Map() };
    s.n += c.n || 1;
    s.best = Math.min(s.best, c.rank || 9);
    const k = `${c.ratchet || ''}${c.bit || ''}`;
    s.combos.set(k, (s.combos.get(k) || 0) + (c.n || 1));
    score.set(c.blade, s);
  }
  return [...score.entries()].sort((a, b) => b[1].n - a[1].n || a[1].best - b[1].best).slice(0, 6).map(([id, s]) => ({
    id, n: s.n, top: [...s.combos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}×${v}`),
  }));
}

function releases(dict, today) {
  const items = [];
  for (const b of Object.values(dict.blades)) if (b.release) items.push({ date: b.release, name: `${b.zh} ${b.en}`, code: b.code || '' });
  for (const c of Object.values(dict.cx || {})) if (c.release && c.role === 'product') items.push({ date: c.release, name: `${c.zh}`, code: c.code || '' });
  const seen = new Set();
  const uniq = items.filter((i) => { const k = i.code + i.name; if (seen.has(k)) return false; seen.add(k); return true; });
  const upcoming = uniq.filter((i) => i.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const recent = uniq.filter((i) => i.date < today && i.date >= addDays(today, -45)).sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, recent };
}

const quick = (arr) => arr.map((t) => ({ label: t.slice(0, 20), text: t }));

function menuCommand(raw, ctx) {
  const t = String(raw || '').normalize('NFKC');
  const { dict, data, today, LINE, THIN, comboHeader, fx } = ctx;

  if (RE.menu.test(t)) {
    return { text: '想查什麼？點下面的按鈕，或直接輸入零件名稱（例如「鯊魚配置」「R軸解釋」「BX-14」）。', quick: MAIN_QUICK, kind: 'menu' };
  }

  if (RE.hot.test(t)) {
    const hot = hotBlades(data, today);
    if (!hot.length) return { text: '目前沒有足夠的近期賽事資料。', kind: 'menu' };
    const lines = hot.map((h, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${dict.blades[h.id].zh} ${dict.blades[h.id].en}　×${h.n}\n　常見：${h.top.join('、')}`);
    const text = [LINE, '🔥 近期熱門上蓋（上位出現次數）', LINE, ...lines, THIN, '點下面的按鈕看完整配置'].join('\n');
    const rows = hot.map((h, i) => ({
      type: 'box', layout: 'vertical', margin: 'md', contents: [
        { type: 'text', text: `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${dict.blades[h.id].zh}　×${h.n}`, weight: 'bold', size: 'sm', wrap: true },
        { type: 'text', text: `${dict.blades[h.id].en}　常見：${h.top.join('、')}`, size: 'xs', color: '#7A8699', wrap: true },
      ],
    }));
    const flex = { type: 'bubble', size: 'mega', header: comboHeader('🔥 近期熱門上蓋', '依賽事上位出現次數'), body: { type: 'box', layout: 'vertical', contents: [...rows, fx.note('點下面的按鈕看完整配置與賽事連結')] } };
    return { text, flex, quick: [...hot.slice(0, 8).map((h) => ({ label: `${dict.blades[h.id].zh}`.slice(0, 20), text: `${dict.blades[h.id].zh}配置` })), ...MAIN_QUICK.slice(1, 4)], kind: 'menu' };
  }

  if (RE.combo.test(t)) {
    const hot = hotBlades(data, today);
    return {
      text: '輸入「零件名稱＋配置」就能查近期上位配置與賽事連結。\n例如：鯊魚配置、魔導神杖 配置、9-60 配置、鯊魚 LF 配置。\n也可以直接點下面的熱門零件：',
      quick: [...hot.slice(0, 9).map((h) => ({ label: dict.blades[h.id].zh.slice(0, 20), text: `${dict.blades[h.id].zh}配置` })), ...MAIN_QUICK.slice(1, 4)], kind: 'menu',
    };
  }

  if (RE.wiki.test(t)) {
    return {
      text: '輸入「零件名稱＋解釋」查功能、優缺點、常見搭配。\n零件可以是上蓋、固鎖輪、軸心、產品編號，俗稱和簡稱也可以。\n點下面的範例試試：',
      quick: quick(['R軸解釋', 'H軸解釋', 'LF軸解釋', '3-60解釋', '9-60解釋', '鯊魚解釋', '魔導神杖解釋', 'BX-14解釋', 'J輔助解釋']), kind: 'menu',
    };
  }

  if (RE.fresh.test(t)) {
    const { upcoming, recent } = releases(dict, today);
    const fmt = (i) => `・${i.date.slice(5).replace('-', '/')}　${i.code ? `${i.code} ` : ''}${i.name}`;
    const parts = [LINE, '🆕 新品與發售日', LINE];
    if (upcoming.length) parts.push('【即將發售】', ...upcoming.slice(0, 10).map(fmt));
    else parts.push('目前站上沒有列出即將發售的商品。');
    if (recent.length) parts.push('', '【近 45 天已發售】', ...recent.slice(0, 8).map(fmt));
    parts.push(THIN, '資料：beybladehub.app（社群整理，以官方公告為準）');
    const sec = (title, list) => [fx.title(title), ...list.map((i) => ({ type: 'text', text: fmt(i), size: 'sm', wrap: true, margin: 'xs' }))];
    const body = [...(upcoming.length ? sec('📦 即將發售', upcoming.slice(0, 10)) : [fx.note('目前站上沒有列出即將發售的商品。')]), ...(recent.length ? sec('✅ 近 45 天已發售', recent.slice(0, 8)) : []), fx.note('資料：beybladehub.app（社群整理，以官方公告為準）')];
    return { text: parts.join('\n'), flex: { type: 'bubble', size: 'mega', header: comboHeader('🆕 新品與發售日', '點零件名稱可查解釋'), body: { type: 'box', layout: 'vertical', contents: body } }, quick: MAIN_QUICK, kind: 'menu' };
  }
  return null;
}

module.exports = { menuCommand, MAIN_QUICK, hotBlades, releases };
