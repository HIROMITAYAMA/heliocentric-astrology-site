import { createRequire } from 'node:module';
import fs from 'node:fs';
import { createCore, formatReport, fmtPos } from '../astro-core.js';
const require = createRequire('/tmp/claude-0/-home-user-align-universe-core/39443717-5d22-5699-b5db-a533f1f4a706/scratchpad/astro/');
const Astronomy = require('astronomy-engine');
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const core = createCore({ Astronomy, tables: J('../data/ephem_tables.json'), sabian: J('../data/sabian_symbols.json'), stars: J('../data/fixed_stars.json'), aspects: J('../data/aspects.json') });

const birth = new Date(Date.UTC(1969, 11, 3, 19, 50)); // 1969-12-04 04:50 JST 大分
const chart = core.natal({ date: birth, lat: 33.24, lon: 131.61 });
const exp = {
  helio: { Earth: 71.488, Mercury: 282.632, Venus: 221.901, Mars: 2.793, Jupiter: 200.575, Saturn: 36.738, Uranus: 185.279, Neptune: 238.521, Pluto: 175.413, Chiron: 5.223 },
  geo: { Sun: 251.49, Moon: 180.29, Mercury: 261.16, Venus: 239.01, Mars: 321.24, Jupiter: 207.75, Saturn: 32.92, Uranus: 188.04, Neptune: 238.92, Pluto: 177.19, TrueNode: 347.14, Chiron: 2.42, ASC: 223.31, MC: 139.15 },
  house: { Chiron: 5, Jupiter: 12, Mars: 4, Mercury: 2, Moon: 11, Neptune: 1, Pluto: 11, Saturn: 6, Sun: 1, TrueNode: 4, Uranus: 11, Venus: 1 },
};
let fails = 0;
const chk = (label, got, want, tol) => { const d = Math.abs(((got - want + 540) % 360) - 180); const ok = d <= tol; if (!ok) fails++; console.log(`${ok ? 'OK ' : 'NG '} ${label.padEnd(16)} ${fmtPos(got).padEnd(26)} 期待 ${fmtPos(want)}  差${d.toFixed(3)}`); };
console.log('== ヘリオ（astro.com と比較）'); for (const k in exp.helio) chk(k, chart.helio[k].lon, exp.helio[k], 0.02);
console.log('== ジオ'); for (const k in exp.geo) chk(k, chart.geo[k].lon, exp.geo[k], 0.02);
console.log('== ハウス（プラシーダス・astro.com の配置と一致するか）');
for (const k in exp.house) { const ok = chart.geo[k].house === exp.house[k]; if (!ok) fails++; console.log(`${ok ? 'OK ' : 'NG '} ${k.padEnd(10)} ${chart.geo[k].house}H 期待 ${exp.house[k]}H`); }
console.log('カスプ:', Object.entries(chart.houses.cusps).map(([h, l]) => `${h}H ${fmtPos(l)}`).join(' | '));
console.log('== 逆行:', Object.keys(chart.geo).filter(k => chart.geo[k].retro).join(','), '（期待: Saturn, Chiron, TrueNode は表示上R）');
console.log('== サビアン 地球:', chart.sabian.earth, '太陽:', chart.sabian.sun.sign, chart.sabian.sun.degree, chart.sabian.sun.title);
console.log('== ドラコニック太陽:', fmtPos(chart.draconic.Sun.lon), '（真ノード基準）');
console.log('== 恒星 geo:', chart.stars.geo.slice(0, 6).map(s => `${s.body}↔${s.star}(${s.distance})`).join(', '));
console.log('== 恒星 helio:', chart.stars.helio.slice(0, 6).map(s => `${s.body}↔${s.star}(${s.distance})`).join(', '));
console.log('== ヘリオ アスペクト上位:', chart.aspects.helio.slice(0, 6).map(a => `${a.a}-${a.b} ${a.angle}(${a.orb})`).join(', '));
const today = new Date(Date.UTC(2026, 10, 3));
const tr = core.transit({ natalChart: chart, date: today });
const pr = core.progression({ natalChart: chart, date: today });
console.log('== 経過 helio Earth:', fmtPos(tr.helio.Earth.lon), '(期待 牡牛座10.58) | 経過ジオ太陽:', fmtPos(tr.geo.Sun.lon));
console.log('== 進行日:', pr.progressedDate.toISOString(), '進行太陽:', fmtPos(pr.geo.Sun.lon), '進行月:', fmtPos(pr.geo.Moon.lon));
console.log('\n==== 出力テキスト（抜粋） ====');
const rep = formatReport({ name: 'ひろみ', chart, transit: tr, progression: pr });
console.log(rep.split('\n').slice(0, 24).join('\n'));
console.log('...文字数', rep.length);
console.log('\nFAILS =', fails);
process.exit(fails ? 1 : 0);
