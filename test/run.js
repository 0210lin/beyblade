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
ok('鯊魚配置 → blade+combo', p('鯊魚配置').mode === 'combo' && p('鯊魚配置').parts[0].ids[0] === 'shark_scale');
ok('魔導神杖 配置（有空白）', p('魔導神杖 配置').parts[0].ids[0] === 'wizard_rod');
ok('9-60 配置 → ratchet', p('9-60 配置').parts[0].kind === 'ratchet');
ok('H軸 解釋 → bit H', p('H軸 解釋').parts[0].ids[0] === 'H' && p('H軸 解釋').mode === 'wiki');

ok('黏字 鯊魚lf配置', (() => { const q = p('鯊魚lf配置'); return q.parts.some((x) => x.kind === 'bit' && x.ids[0] === 'LF') && q.parts.some((x) => x.kind === 'blade'); })());
ok('錯字 鯊玉配置 → 模糊比對', p('鯊玉配置').parts[0]?.ids[0] === 'shark_scale');
ok('英文 wizard rod', p('wizard rod 配置').parts[0].ids[0] === 'wizard_rod');
ok('全形 ９－６０', p('９－６０配置').ratchets[0] === '9-60');
ok('指令 → help', p('指令').kind === 'help');

console.log('— 模式 A 輸出');
const a = run('鯊魚配置');
console.log(a);
ok('鯊魚 = 鮫鯊狂鱗，含熱門 3-60 J', /Shark Scale|鮫鯊狂鱗/.test(a) && /3-60 ?J/.test(a));
ok('含最新賽事', /最新得名賽事/.test(a));
ok('含賽事連結', /https:\/\/beybladehub\.app\//.test(a));
ok('含得名名次', /成人組冠軍/.test(a));
ok('鯊魚預設說明', /鯊魚」目前多指鮫鯊狂鱗/.test(a));
const a2 = run('9-60 配置');
ok('固鎖輪查詢列出戰刃+軸心', /Cobalt Dragoon 9-60E|Cobalt Dragoon E/.test(a2));
ok('沒資料的零件有說明', /沒有找到/.test(run('獅冠 配置')));

console.log('— 模式 B 輸出');
const b = run('R軸解釋');
console.log(b);
ok('固定五段結構', ['【核心功能】', '【優點】', '【缺點】', '【常見搭配】'].every((s) => b.includes(s)));
ok('鯊魚解釋 → 狂鱗', /Shark Scale/.test(run('鯊魚解釋')));
ok('鋒鰭解釋 → Shark Edge', /Shark Edge/.test(run('鋒鰭解釋')));
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

console.log('— Flex 卡片');
const { handleRich } = require('../lib/engine');
const walk = (n, f) => { f(n); if (n && typeof n === 'object') Object.values(n).forEach((v) => walk(v, f)); };
for (const q of ['鯊魚配置', '魔導神杖 配置', 'R軸解釋', '龍劍解釋', '指令', 'CX-14 解釋']) {
  const out = handleRich(q, data, { now: NOW });
  ok(`${q}：flex 結構合法`, (() => {
    if (!out.flex) return q === 'CX-14 解釋' ? true : false;
    const f = JSON.stringify(out.flex);
    let bad = false;
    walk(out.flex, (n) => { if (n && n.type === 'text' && (typeof n.text !== 'string' || !n.text)) bad = true; if (n && n.action && !/^https:\/\//.test(n.action.uri)) bad = true; });
    return !bad && f.length < 30000 && !/undefined|null/.test(f);
  })());
}
const lk = handleRich('鯊魚配置', data, { now: NOW });
ok('Flex 賽事區塊可點連結', JSON.stringify(lk.flex).includes('"type":"uri"'));

console.log('— 雙北賽事查詢');
const evDoc = require('../data/events.json');
const evq = (t, today = '2026-11-17') => handleRich(t, data, { events: evDoc, today });
ok('資料只含雙北', evDoc.events.every((e) => e.city === '台北市' || e.city === '新北市'));
ok('本週賽事有結果', /雙北賽事｜本週/.test(evq('本週賽事').text) && /夾子園-汐止/.test(evq('本週賽事').text));
ok('板橋 賽事 週六 → 東fun', /東fun/.test(evq('板橋 賽事 週六').text) && !/中和/.test(evq('板橋 賽事 週六').text));
ok('台北 賽事 只含台北市', (() => { const r = evq('台北 賽事 11/21').text; return /CardMaster/.test(r) && !/新莊/.test(r); })());
ok('新北 公開組 週末', /新北市・公開組・本週末/.test(evq('週末 新北 賽事 公開組').text));
ok('場館名 夾子園', /夾子園/.test(evq('夾子園 賽事').text));
ok('其他縣市 → 只收錄雙北', /只收錄雙北/.test(evq('台中賽事').text) && /只收錄雙北/.test(evq('桃園 比賽').text));
ok('基隆路是台北，不是基隆市', !/只收錄雙北/.test(evq('基隆路 賽事').text));
ok('FB 賽事（北投智仁里）', /智仁里/.test(evq('北投 賽事 11/21').text));
ok('賽事查詢不影響配置查詢', /近期上位配置/.test(run('鯊魚配置')));
ok('賽事 Flex 合法', (() => {
  const out = evq('本週賽事');
  let bad = false;
  walk(out.flex, (n) => { if (n && n.type === 'text' && (typeof n.text !== 'string' || !n.text)) bad = true; if (n && n.action && !/^https:\/\//.test(n.action.uri)) bad = true; });
  return !bad && JSON.stringify(out.flex).includes('"type":"uri"') && !/undefined|null/.test(JSON.stringify(out.flex));
})());

console.log('— T 表 / 社群推薦 / beybladehub 賽場配置');
const tr = handleRich('T表', data, {});
ok('T表 → 圖片回覆', tr.image === 'tier' && /T0/.test(tr.text) && /榮耀武神/.test(tr.text));
ok('大小寫與別名：tier / t 表 / 強度排行', ['tier', 't 表', '強度排行', 'Ｔ表'].every((q) => handleRich(q, data, {}).image === 'tier'));
ok('T表資料含上蓋 + 固鎖 + 軸心', data.tier_pro && data.tier_pro.rows.length >= 5 && data.tier_pro.rows[0].cards.some((c) => c.ratchets.length && c.bits.length));
ok('T表文字備援含推薦固鎖/軸心', /\(.*\/.*\)/.test(tr.text));
ok('T表圖片檔存在且 < 1MB', (() => { const f = require('fs').statSync(require('path').join(__dirname, '../data/tier.jpg')); return f.size > 50000 && f.size < 1000000; })());
const sh = run('鯊魚配置');
ok('配置含社群推薦', /社群推薦/.test(sh) && /常用固鎖/.test(sh));
ok('配置含 beybladehub 賽場來源', data.combos.some((c) => c.source === 'beybladehub.app/combos'));
ok('殿軍（第 4 名）可顯示', data.combos.some((c) => c.rank === 4) && /殿軍/.test(run('鯊魚配置') + run('蒼穹龍騎士配置')));
ok('只有推薦沒有賽果的零件也能回覆', /社群推薦/.test(run('鋒鰭配置')) && !/找不到/.test(run('鋒鰭配置')));
ok('G3／民間賽事有選手欄位', data.combos.some((c) => c.player));
ok('同一場賽事不重複列兩次', (() => { const t = run('鯊魚配置'); return (t.match(/高雄夢時代/g) || []).length === 1; })());

console.log('— CX 系列');
const cxIds = (t) => p(t).parts.filter((x) => x.kind === 'cx').flatMap((x) => x.ids);
ok('J輔助 → assist_j', cxIds('J輔助解釋')[0] === 'assist_j');
ok('輔助W → assist_w', cxIds('輔助W解釋')[0] === 'assist_w');
ok('斜切輔助戰刃', cxIds('斜切輔助戰刃解釋')[0] === 'assist_j');
ok('蒼龍紋章', cxIds('蒼龍紋章解釋')[0] === 'chip_dran');
ok('CX-14 → 騎士堡壘', cxIds('CX-14 解釋')[0] === 'cx_14');
ok('龍劍 含 蒼龍神劍/蒼龍爆刃', p('龍劍解釋').parts[0].ids.includes('dran_sword') && p('龍劍解釋').parts[0].ids.includes('dran_buster'));
ok('勇氣龍 → CX-01', cxIds('勇氣龍解釋')[0] === 'cx_01');
ok('CX 配置不爆錯', /沒有賽事配置統計/.test(run('J輔助配置')));
const cxo = run('CX-13 解釋');
console.log(cxo);
ok('CX 整組解釋含組成', /組成：龍王紋章/.test(cxo));
ok('BX-01 仍是蒼龍神劍', p('BX-01 解釋').parts[0].ids[0] === 'dran_sword');

console.log('— 簽名驗證');
const { validSignature } = require('../api/webhook');
const body = Buffer.from('{"events":[]}');
const sig = crypto.createHmac('sha256', 'secret').update(body).digest('base64');
ok('正確簽名通過', validSignature(body, sig, 'secret'));
ok('錯誤簽名拒絕', !validSignature(body, sig, 'other'));

console.log(`\n全部通過（${pass} 項）`);
