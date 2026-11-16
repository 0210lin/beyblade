'use strict';
/**
 * LINE Webhook（Vercel Serverless Function；用純 Node http API 寫，Render / 本機也能跑）
 * 無第三方相依 → 冷啟動最快。
 */
const crypto = require('crypto');
const { handleRich, extractQuery, HELP } = require('../lib/engine');
const { getCombos, getEvents } = require('../lib/data');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) return resolve(Buffer.from(req.rawBody));
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validSignature(raw, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  let given;
  try { given = Buffer.from(signature, 'base64'); } catch { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function pushReply(replyToken, messages, token) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error('[reply] LINE API 錯誤', res.status, await res.text());
  return res.ok;
}

/** T 表圖片網址：預設用 GitHub Raw 上由排程產生的 data/tier.png */
function tierImageUrl(env, tier) {
  const base = env.TIER_IMAGE_URL
    || (env.GITHUB_REPO ? `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_BRANCH || 'main'}/data/tier.png` : '');
  return base ? `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent((tier && tier.updated) || '')}` : '';
}

/** 優先送 Flex 卡片（好讀、賽事連結可點）；T 表送圖片；LINE 拒絕時退回純文字 */
async function reply(replyToken, content, token, env = {}) {
  const { text, flex, image, tier } = typeof content === 'string' ? { text: content } : content;
  const plain = [{ type: 'text', text: text.slice(0, 4900) }];
  if (image === 'tier') {
    const url = tierImageUrl(env, tier);
    if (url) {
      const caption = `📊 戰鬥陀螺 T 表（${(tier && tier.experts) || '?'} 位高手評級・${(tier && tier.updated) || ''}）
資料：beybladehub.app（社群整理，非官方）`;
      const ok = await pushReply(replyToken, [{ type: 'image', originalContentUrl: url, previewImageUrl: url }, { type: 'text', text: caption }], token);
      if (ok) return;
      console.error('[reply] 圖片失敗，改送文字版 T 表');
    }
    return pushReply(replyToken, plain, token);
  }
  if (flex) {
    const altText = text.replace(/[━─]/g, '').replace(/\s+/g, ' ').trim().slice(0, 380) || '查詢結果';
    const ok = await pushReply(replyToken, [{ type: 'flex', altText, contents: flex }], token);
    if (ok) return;
    console.error('[reply] Flex 失敗，改送純文字');
  }
  return pushReply(replyToken, plain, token);
}

async function handleEvent(ev, env) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (ev.type === 'join') return reply(ev.replyToken, `大家好，我是陀螺配置查詢機器人。\n\n${HELP}`, token);
  if (ev.type === 'follow') return reply(ev.replyToken, HELP, token);
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;

  const q = extractQuery(ev, env);
  if (!q.triggered) return; // 群組沒有 @ / 前綴 → 保持安靜
  const [data, events] = await Promise.all([getCombos(env), getEvents(env)]);
  const out = q.text ? handleRich(q.text, data, { windowDays: Number(env.WINDOW_DAYS) || 180, events }) : { text: HELP };
  return reply(ev.replyToken, out, token, env);
}

async function handler(req, res) {
  const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(body); };
  if (req.method === 'GET') return send(200, 'beyblade-line-bot ok');
  if (req.method !== 'POST') return send(405, 'method not allowed');

  const env = process.env;
  const raw = await readRaw(req);
  if (!validSignature(raw, req.headers['x-line-signature'], env.LINE_CHANNEL_SECRET)) return send(401, 'bad signature');

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return send(400, 'bad json'); }
  const events = Array.isArray(body.events) ? body.events : [];
  await Promise.all(events.map((ev) => handleEvent(ev, env).catch((e) => console.error('[event]', e))));
  return send(200, 'OK');
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.validSignature = validSignature;
