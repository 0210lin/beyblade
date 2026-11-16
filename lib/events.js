'use strict';
/**
 * 賽事查詢（只收雙北）：
 *   本週賽事 / 週六 賽事 / 板橋 賽事 / 新北 賽事 12/5 / 夾子園 賽事 / 公開組 賽事 …
 * 其他縣市一律回覆「只收錄雙北」。
 */
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const NAVY = '#1F3A5F';
const BLUE = '#1D7BD9';
const GRAY = '#7A8699';
const GOLD = '#B7791F';

const INTENT_RE = /(賽事|比賽|場次|店賽|有沒有賽|有賽嗎|哪裡有賽|活動)/;
const NOT_EVENT_RE = /(配置|配方|解釋|說明|介紹|優缺點)/;
const OTHER_REGION_RE = /(桃園|中壢|龜山|鶯歌|台中|臺中|高雄|台南|臺南|新竹|竹北|竹南|基隆(?!路)|宜蘭|礁溪|苗栗|彰化|雲林|嘉義|屏東|花蓮|台東|臺東|南投|澎湖|金門|馬祖)/;
const STOP_RE = /(賽事|比賽|場次|店賽|有沒有|有嗎|哪裡|哪邊|哪|有|的|嗎|查|找|附近|活動|請問|幫我|最近|近期|雙北|組|查詢|一下)/g;

const pad = (n) => String(n).padStart(2, '0');
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => fmt(new Date(toDate(s).getTime() + n * 86400000));
const dow = (s) => toDate(s).getUTCDay();
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const dayLabel = (s) => `${md(s)}（${WD[dow(s)]}）`;

function taipeiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);
}

function weekendOf(today, next = false) {
  const d = dow(today); // 0=日
  const toSat = (6 - d + 7) % 7;
  let sat = addDays(today, toSat);
  if (d === 0) sat = addDays(today, -1); // 今天是週日 → 本週末 = 昨天六~今天日，只看今天起
  let from = sat, to = addDays(sat, 1);
  if (next) { from = addDays(sat, 7); to = addDays(sat, 8); if (d === 0) { from = addDays(today, 6); to = addDays(today, 7); } }
  if (from < today) from = today;
  return { from, to };
}

function parseRange(t, today) {
  let m;
  if (/(下週末|下周末|下禮拜末)/.test(t)) { const r = weekendOf(today, true); return { ...r, label: '下週末' }; }
  if (/(週末|周末|禮拜末)/.test(t)) { const r = weekendOf(today); return { ...r, label: '本週末' }; }
  if (/(今天|今日|今晚)/.test(t)) return { from: today, to: today, label: '今天' };
  if (/後天/.test(t)) { const d = addDays(today, 2); return { from: d, to: d, label: '後天' }; }
  if (/(明天|明日|明晚)/.test(t)) { const d = addDays(today, 1); return { from: d, to: d, label: '明天' }; }
  if (/(下週|下周|下禮拜|下星期)/.test(t)) {
    const toMon = ((8 - dow(today)) % 7) || 7;
    const from = addDays(today, toMon);
    return { from, to: addDays(from, 6), label: '下週' };
  }
  if ((m = t.match(/(\d{1,2})\s*[\/月.]\s*(\d{1,2})\s*日?/))) {
    const mo = Number(m[1]), da = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      let y = Number(today.slice(0, 4));
      let d = `${y}-${pad(mo)}-${pad(da)}`;
      if (d < today) d = `${y + 1}-${pad(mo)}-${pad(da)}`;
      return { from: d, to: d, label: dayLabel(d) };
    }
  }
  if ((m = t.match(/(?:週|周|星期|禮拜)([一二三四五六日天])/))) {
    const want = WD.indexOf(m[1] === '天' ? '日' : m[1]);
    const d = addDays(today, (want - dow(today) + 7) % 7);
    return { from: d, to: d, label: dayLabel(d) };
  }
  if (/(本週|這週|本周|這周|這禮拜|本禮拜|這星期)/.test(t)) {
    const toSun = (7 - dow(today)) % 7;
    return { from: today, to: addDays(today, toSun), label: '本週' };
  }
  return { from: today, to: addDays(today, 6), label: '近 7 天', dflt: true };
}

function parseEventQuery(raw, events, today) {
  const t = String(raw || '').normalize('NFKC').trim();
  if (!INTENT_RE.test(t) || NOT_EVENT_RE.test(t)) return null;
  if (OTHER_REGION_RE.test(t)) return { unsupported: true };

  const range = parseRange(t, today);
  const districts = [...new Set(events.map((e) => e.district).filter(Boolean))];
  const hitDistricts = districts.filter((d) => t.includes(d.replace(/區$/, '')));
  let city = null;
  if (/新北/.test(t)) city = '新北市';
  else if (/(台北|臺北|北市)/.test(t)) city = '台北市';
  const division = /公開/.test(t) ? '公開組' : /(通常|兒童|小孩|小朋友)/.test(t) ? '通常組' : null;

  // 場館關鍵字：把已辨識的詞拿掉後剩下的
  let left = t
    .replace(/(下週末|下周末|週末|周末|今天|今日|今晚|後天|明天|明日|明晚|下週|下周|下禮拜|本週|這週|本周|這周|這禮拜|本禮拜)/g, ' ')
    .replace(/(\d{1,2})\s*[\/月.]\s*(\d{1,2})\s*日?/g, ' ')
    .replace(/(?:週|周|星期|禮拜)[一二三四五六日天]/g, ' ')
    .replace(/(新北市|新北|台北市|臺北市|台北|臺北|北市|公開|通常|兒童|小孩|小朋友)/g, ' ');
  hitDistricts.forEach((d) => { left = left.replace(d, ' ').replace(d.replace(/區$/, ''), ' '); });
  left = left.replace(STOP_RE, ' ').replace(/[\s,，。!！?？]+/g, ' ').trim();
  const venueText = left.length >= 2 ? left : '';
  return { range, city, districts: hitDistricts, division, venueText };
}

const norm = (s) => String(s).toLowerCase().replace(/[\s\-－·・_.]/g, '');

function runQuery(q, events) {
  let list = events.filter((e) => e.date >= q.range.from && e.date <= q.range.to);
  if (q.city) list = list.filter((e) => e.city === q.city);
  if (q.districts.length) list = list.filter((e) => q.districts.includes(e.district));
  if (q.division) list = list.filter((e) => (e.divisions || []).includes(q.division));
  let venueNote = '';
  if (q.venueText) {
    const v = norm(q.venueText);
    const byVenue = list.filter((e) => norm(e.venue).includes(v) || norm(e.name).includes(v) || v.includes(norm(e.venue)));
    if (byVenue.length) list = byVenue;
    else venueNote = `找不到符合「${q.venueText}」的場館，已忽略這個條件`;
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
  return { list, venueNote };
}

function scopeLabel(q) {
  const p = [];
  if (q.city && !q.districts.length) p.push(q.city);
  if (q.districts.length) p.push(q.districts.join('/'));
  if (q.division) p.push(q.division);
  if (q.venueText) p.push(q.venueText);
  p.push(q.range.label);
  return p.join('・');
}

const detail = (e) => [
  e.district || e.city,
  (e.divisions || []).join('/'),
  e.cap ? `上限${e.cap}人` : '',
  e.fee ? `費用 ${e.fee}` : '',
].filter(Boolean).join('・');

function eventText(e) {
  const out = [`・${e.time}　${e.name}${e.kind === 'tournament' && e.name !== e.venue ? `（${e.venue}）` : ''}`, `　${detail(e)}`];
  if (e.reg) out.push(`　報名：${e.reg}`);
  if (e.link) out.push(`　🔗 ${e.link}`);
  if (e.note) out.push(`　${e.note}`);
  return out.join('\n');
}

const note = (text) => ({ type: 'text', text, size: 'xs', color: GRAY, wrap: true, margin: 'sm' });

function eventBox(e) {
  const tour = e.kind === 'tournament';
  const regUri = e.link || e.source_url;
  const lines = [
    { type: 'text', text: `${e.time}　${e.name}`, size: 'sm', weight: 'bold', wrap: true, color: tour ? GOLD : '#222B38' },
    { type: 'text', text: detail(e), size: 'xs', color: '#333B48', wrap: true, margin: 'xs' },
  ];
  if (e.reg) lines.push({ type: 'text', text: `報名：${e.reg}`, size: 'xs', color: GRAY, wrap: true, margin: 'xs' });
  if (e.note) lines.push({ type: 'text', text: e.note, size: 'xs', color: GRAY, wrap: true, margin: 'xs' });
  const links = [];
  if (e.map) links.push({ type: 'text', text: '📍 地圖', size: 'xs', color: BLUE, flex: 0, action: { type: 'uri', label: '地圖', uri: e.map } });
  if (regUri) links.push({ type: 'text', text: e.link ? '📝 報名／貼文' : '🔗 來源', size: 'xs', color: BLUE, flex: 0, margin: 'lg', action: { type: 'uri', label: '來源', uri: regUri } });
  if (links.length) lines.push({ type: 'box', layout: 'horizontal', margin: 'sm', contents: links });
  return { type: 'box', layout: 'vertical', margin: 'md', paddingAll: '10px', backgroundColor: tour ? '#FFF8E6' : '#F3F6FA', cornerRadius: '8px', contents: lines };
}

function format(q, res, events) {
  const MAX = 8;
  const label = scopeLabel(q);
  const total = res.list.length;
  const shown = res.list.slice(0, MAX);
  const updated = events.updated_at ? `資料更新 ${events.updated_at}` : '';
  const foot = '資料為人工整理，實際請以主辦公告為準';
  const hint = '縮小範圍可以加地區或日期，例如「新莊 賽事 週六」「夾子園 賽事」';

  if (!total) {
    const msg = `${label}沒有找到雙北賽事。\n${hint}`;
    return {
      text: `━━━━━━━━━━━━━━\n📅 雙北賽事｜${label}\n━━━━━━━━━━━━━━\n${msg}${res.venueNote ? `\n${res.venueNote}` : ''}`,
      flex: { type: 'bubble', size: 'mega', header: head(label, '共 0 場'), body: { type: 'box', layout: 'vertical', contents: [note(msg)] } },
    };
  }

  // 純文字
  const out = ['━━━━━━━━━━━━━━', `📅 雙北賽事｜${label}`, `共 ${total} 場${total > MAX ? `（顯示前 ${MAX} 場）` : ''}`, '━━━━━━━━━━━━━━'];
  let last = '';
  shown.forEach((e) => {
    if (e.date !== last) { out.push(`【${dayLabel(e.date)}】`); last = e.date; }
    out.push(eventText(e));
  });
  if (total > MAX) out.push('──────────────', hint);
  out.push('──────────────', foot);
  if (res.venueNote) out.push(res.venueNote);

  // Flex
  const body = [];
  last = '';
  shown.forEach((e) => {
    if (e.date !== last) { body.push({ type: 'text', text: `📅 ${dayLabel(e.date)}`, weight: 'bold', size: 'sm', color: NAVY, margin: body.length ? 'lg' : 'none' }); last = e.date; }
    body.push(eventBox(e));
  });
  if (total > MAX) body.push(note(`還有 ${total - MAX} 場。${hint}`));
  body.push({ type: 'separator', margin: 'lg' }, note([foot, updated].filter(Boolean).join('　')));
  if (res.venueNote) body.push(note(`ℹ️ ${res.venueNote}`));
  return { text: out.join('\n'), flex: { type: 'bubble', size: 'mega', header: head(label, `共 ${total} 場・只收雙北`), body: { type: 'box', layout: 'vertical', contents: body } } };
}

function head(title, sub) {
  return {
    type: 'box', layout: 'vertical', backgroundColor: NAVY, paddingAll: '16px',
    contents: [
      { type: 'text', text: `📅 雙北賽事｜${title}`, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: sub, color: '#B8C7DD', size: 'xs', margin: 'sm' },
    ],
  };
}

/** 不是賽事查詢 → 回傳 null */
function handleEvents(raw, doc, opts = {}) {
  const events = (doc && doc.events) || [];
  const today = opts.today || taipeiToday();
  const q = parseEventQuery(raw, events, today);
  if (!q) return null;
  if (q.unsupported) {
    const text = '賽事查詢目前只收錄雙北（台北市、新北市）。\n例如：「本週賽事」「板橋 賽事」「新莊 賽事 週六」';
    return { text };
  }
  return format(q, runQuery(q, events), doc);
}

module.exports = { handleEvents, parseEventQuery, runQuery, taipeiToday };
