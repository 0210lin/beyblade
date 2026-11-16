'use strict';
/**
 * 健康檢查／保暖：GET /api/health
 *  - 給 Vercel Cron（每天）與 GitHub Actions（每 6 小時）定時呼叫，讓函式保持熱啟動（冷啟動只是第一次要幾百毫秒，本來就不會「休眠」）
 *  - 檢查：資料是否太久沒更新、LINE token 是否有效；有異常時寫進後台錯誤紀錄
 */
const { getCombos, getEvents } = require('../lib/data');
const L = require('../lib/line');
const A = require('../lib/analytics');

module.exports = async function health(req, res) {
  const env = process.env;
  const t0 = Date.now();
  const out = { ok: true, at: new Date().toISOString(), checks: {} };
  try {
    const [combos, events] = await Promise.all([getCombos(env), getEvents(env)]);
    const ageH = combos.updated_at ? Math.round((Date.now() - new Date(combos.updated_at).getTime()) / 36e5) : null;
    out.checks.data = { combos: (combos.combos || []).length, events: (events.events || []).length, combosAgeHours: ageH };
    if (ageH != null && ageH > 48) { out.ok = false; out.checks.data.warn = '配置資料超過 48 小時沒更新（檢查 GitHub Actions）'; }
  } catch (e) { out.ok = false; out.checks.data = { error: e.message }; }
  if (env.LINE_CHANNEL_ACCESS_TOKEN) {
    try { const r = await L.botInfo(); out.checks.line = { ok: r.ok, status: r.status }; if (!r.ok) out.ok = false; } catch (e) { out.ok = false; out.checks.line = { error: e.message }; }
  }
  out.ms = Date.now() - t0;
  if (!out.ok) await A.recordError('health', JSON.stringify(out.checks).slice(0, 280));
  res.statusCode = out.ok ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out));
};
