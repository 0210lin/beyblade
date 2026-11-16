'use strict';
/**
 * 讀取最新 combos.json：
 *  1. 優先抓 GitHub Raw（COMBOS_URL，或 GITHUB_REPO + GITHUB_BRANCH 組成）
 *  2. 失敗 / 逾時 → 用部署時一起打包的 data/combos.json
 * 記憶體快取 5 分鐘（serverless 熱實例內有效）。
 */
const bundled = require('../data/combos.json');

const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

function sourceUrl(env = process.env) {
  if (env.COMBOS_URL) return env.COMBOS_URL;
  if (env.GITHUB_REPO) return `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_BRANCH || 'main'}/data/combos.json`;
  return null;
}

async function getCombos(env = process.env) {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  const url = sourceUrl(env);
  if (!url) return bundled;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json || !Array.isArray(json.combos)) throw new Error('bad schema');
    cache = { at: Date.now(), data: json };
    return json;
  } catch (e) {
    console.error('[data] 抓取遠端 combos.json 失敗，改用內建資料：', e.message);
    return cache.data || bundled;
  }
}

module.exports = { getCombos, sourceUrl };
