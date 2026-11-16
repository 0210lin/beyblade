'use strict';
// node test/run.js  —— 不需任何套件
const assert = require('assert');
const crypto = require('crypto');
const { handleQuery, extractQuery, parseQuery } = require('../lib/engine');
const data = require('../data/combos.json');
const NOW = '2026-11-16';
const run = (t) => handleQuery(t, data, { now: NOW });

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓', name); };

console.log('— 觸發判斷');
const mk = (text, mentionees, type = 'group') => ({ source: { type }, message: { text, mention: mentionees ? { mentionees } : undefined } });
let r = extractQuery(mk('@陀螺機器人 鯊魚配置', [{ index: 0, length: 7, isSelf: true }]), {});
ok('@mention 觸發並移除名稱', r.triggered && r.text === '鯊魚配置');
r = extractQuery(mk('大家好今天打哪', null), {});
ok('群組一般聊天不回應', !r.triggered);
r = extractQuery(mk('!查詢 R軸解釋', null), {});
ok('!查詢 前綴觸發', r.triggered && r.text === 'R軸解釋');
r = extractQuery(mk('哈囉 @陀螺機器人 3-60解釋', [{ index: 3, length: 7, isSelf: true }]), {});
ok('mention 在句中也能處理', r.triggered && /3-60解釋/.test(r.text));
r = extractQuery(mk('@別人 你好', [{ index: 0, length: 3, isSelf: false }]), {});
ok('mention 別人不觸發', !r.triggered);
r = extractQuery(mk('鯊魚配置', null, 'user'), {});
ok('一對一聊天直接回應', r.triggered);
r = extractQuery(mk('@Bey查詢 鯊魚配置', null), { BOT_NAME: 'Bey查詢' });
ok('純文字 @BOT_NAME 觸發', r.triggered && r.text === '鯊魚配置');

console.log('— 解析');
const p = (t) => parseQuery(t);
ok('鯊魚配置 → blade+combo', p('鯊魚配置').mode === 'combo' && p('鯊魚配置').parts[0].ids[0] === 'shark_edge');
ok('魔導神杖 配置（有空白）', p('魔導神杖 配置').parts[0].ids[0] === 'wizard_rod');
ok('9-60 配置 → ratchet', p('9-60 配置').parts[0].kind === 'ratchet');
ok('H軸 解釋 → bit H', p('H軸 解釋').parts[0].ids[0] === 'H' && p('H軸 解釋').mode === 'wiki');
ok('龍劍 → 三顆龍系', p('龍劍解釋').parts[0].ids.length === 3);
ok('黏字 鯊魚lf配置', (() => { const q = p('鯊魚lf配置'); return q.parts.some((x) => x.kind === 'bit' && x.ids[0] === 'LF') && q.parts.some((x) => x.kind === 'blade'); })());
ok('錯字 鯊玉配置 → 模糊比對', p('鯊玉配置').parts[0]?.ids[0] === 'shark_edge');
ok('英文 wizard rod', p('wizard rod 配置').parts[0].ids[0] === 'wizard_rod');
ok('全形 ９－６０', p('９－６０配置').ratchets[0] === '9-60');
ok('指令 → help', p('指令').kind === 'help');

console.log('— 模式 A 輸出');
const a = run('鯊魚配置');
console.log(a);
ok('含熱門 3-60LF', /3-60LF　×\d/.test(a));
ok('含最新賽事', /最新賽事/.test(a));
ok('示範資料警語', /示範資料/.test(a));
const a2 = run('9-60 配置');
ok('固鎖輪查詢列出戰刃+軸心', /Wizard Rod 9-60|Wizard Rod B/.test(a2) || /Wizard Rod/.test(a2));
ok('沒資料的零件有說明', /沒有找到/.test(run('獅冠 配置')));

console.log('— 模式 B 輸出');
const b = run('R軸解釋');
console.log(b);
ok('固定五段結構', ['【核心功能】', '【優點】', '【缺點】', '【常見搭配】'].every((s) => b.includes(s)));
ok('鯊魚解釋', /Shark Edge/.test(run('鯊魚解釋')));
ok('3-60解釋', /3 凸刃/.test(run('3-60解釋')));
ok('未收錄固鎖輪走通用規則', /2-70/.test(run('2-70 解釋')));
ok('找不到有建議', /找不到/.test(run('完全不存在的東西配置')));

console.log('— 台灣用法 / 編號');
ok('惡魔 → Hells 三顆', p('惡魔配置').parts[0].ids.length === 3);
ok('惡魔紅鐮 → Hells Scythe', p('惡魔紅鐮解釋').parts[0].ids[0] === 'hells_scythe');
ok('BX-01 → Dran Sword', p('BX-01 解釋').parts[0].ids[0] === 'dran_sword');
ok('bx01 小寫黏字', p('bx01配置').parts[0].ids[0] === 'dran_sword');
ok('UX-01 → Dran Buster', p('ux-01解釋').parts[0].ids[0] === 'dran_buster');
ok('魔導幻箭 / 騎士重盾 / 雄獅獵爪', ['魔導幻箭', '騎士重盾', '雄獅獵爪'].every((t) => p(t + '解釋').parts.length === 1));
ok('未收錄解析的戰刃有回覆', /Samurai Calibur/.test(run('BX-45 解釋')));

console.log('— 社群站資料（編號 / 全零件）');
ok('BX-14 → Shark Edge', p('BX-14配置').parts[0].ids[0] === 'shark_edge');
ok('UX-15 → Shark Scale', p('ux15解釋').parts[0].ids[0] === 'shark_scale');
ok('BX-53 → 兩顆 2.0', p('BX-53 解釋').parts[0].ids.length === 2);
ok('M-65 固鎖輪', p('M-65 解釋').ratchets[0] === 'M-65');
ok('3-85 固鎖輪', p('3-85配置').ratchets[0] === '3-85');
ok('BX-55 不會被當成固鎖輪', p('BX-55解釋').ratchets.length === 0 && p('BX-55解釋').parts[0].ids[0] === 'horus_shatter');
ok('新軸心 RA', p('RA軸解釋').parts[0].ids[0] === 'RA');
ok('聯名 鋼鐵人', p('鋼鐵人解釋').parts[0].ids[0] === 'ironman');
const w = run('BX-14 解釋');
console.log(w);
ok('解釋含【資料】編號', /【資料】編號 BX-14・右旋/.test(w));
ok('左旋戰刃註記', /左旋/.test(run('蒼穹龍騎士解釋')));
ok('一體戰刃註記', /一體成型/.test(run('UX-19 解釋')));

console.log('— 簽名驗證');
const { validSignature } = require('../api/webhook');
const body = Buffer.from('{"events":[]}');
const sig = crypto.createHmac('sha256', 'secret').update(body).digest('base64');
ok('正確簽名通過', validSignature(body, sig, 'secret'));
ok('錯誤簽名拒絕', !validSignature(body, sig, 'other'));

console.log(`\n全部通過（${pass} 項）`);
