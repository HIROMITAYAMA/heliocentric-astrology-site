/*
 * astro-core.js
 * ヘリオ／ジオ／ドラコニックの出生図・経過図・進行図を1本で計算する共通コア。
 * ブラウザ（ESM）と Node の両方で動く。天体計算は astronomy-engine、
 * キロンと真ノードは Swiss Ephemeris から生成した表（ephem_tables.json）を線形補間。
 *
 * 使い方:
 *   import { createCore } from './astro-core.js';
 *   const core = createCore({ Astronomy, tables, sabian, stars, aspects });
 *   const chart = core.natal({ date: new Date(Date.UTC(1969,11,3,19,50)), lat: 33.24, lon: 131.61 });
 *
 * 検算の正本: astro.com（Swiss Ephemeris）。ひろみの出生データで全項目一致を確認してから配布する。
 */

const SIGNS = ['牡羊座', '牡牛座', '双子座', '蟹座', '獅子座', '乙女座', '天秤座', '蠍座', '射手座', '山羊座', '水瓶座', '魚座'];
const SIGN_GLYPH = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
const SENSES = { '牡羊座': '自我意識', '牡牛座': '思考感覚', '双子座': '言語感覚', '蟹座': '聴覚', '獅子座': '熱感覚', '乙女座': '視覚', '天秤座': '触覚', '蠍座': '生命感覚', '射手座': '運動感覚', '山羊座': '均衡感覚', '水瓶座': '嗅覚', '魚座': '味覚' };

const HELIO_BODIES = [
  ['Earth', '地球'], ['Mercury', '水星'], ['Venus', '金星'], ['Mars', '火星'], ['Jupiter', '木星'],
  ['Saturn', '土星'], ['Uranus', '天王星'], ['Neptune', '海王星'], ['Pluto', '冥王星'],
];
const GEO_BODIES = [
  ['Sun', '太陽'], ['Moon', '月'], ['Mercury', '水星'], ['Venus', '金星'], ['Mars', '火星'], ['Jupiter', '木星'],
  ['Saturn', '土星'], ['Uranus', '天王星'], ['Neptune', '海王星'], ['Pluto', '冥王星'],
];

const ASPECT_DEFS = [
  { angle: 0, name: 'コンジャンクション', short: '0°', kind: 'major' },
  { angle: 180, name: 'オポジション', short: '180°', kind: 'major' },
  { angle: 120, name: 'トライン', short: '120°', kind: 'major' },
  { angle: 90, name: 'スクエア', short: '90°', kind: 'major' },
  { angle: 60, name: 'セクスタイル', short: '60°', kind: 'major' },
  { angle: 30, name: 'セミセクスタイル', short: '30°', kind: 'minor' },
  { angle: 45, name: 'セミスクエア', short: '45°', kind: 'minor' },
  { angle: 72, name: 'クインタイル', short: '72°', kind: 'minor' },
  { angle: 135, name: 'セスキコードレート', short: '135°', kind: 'minor' },
  { angle: 144, name: 'バイクインタイル', short: '144°', kind: 'minor' },
  { angle: 150, name: 'クインカンクス', short: '150°', kind: 'minor' },
];

// オーブ（度）。ひろみの確認で調整する前提の初期値。
const ORBS = {
  geo: { 0: 8, 180: 8, 120: 5, 90: 5, 60: 4, 30: 2, 45: 2, 72: 2, 135: 2, 144: 2, 150: 2 },
  helio: { 0: 5, 180: 5, 120: 5, 90: 5, 60: 4, 30: 2, 45: 2, 72: 2, 135: 2, 144: 2, 150: 2 },
  transit: { 0: 2, 180: 2, 120: 2, 90: 2, 60: 1.5, 30: 1, 45: 1, 72: 1, 135: 1, 144: 1, 150: 1 },
};

const DEG = Math.PI / 180;
const norm = (x) => ((x % 360) + 360) % 360;
const J2000 = 2451545.0;

export function jdFromDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}
export function dateFromJd(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

export function signOf(lon) {
  const l = norm(lon);
  const i = Math.floor(l / 30);
  return { index: i, sign: SIGNS[i], glyph: SIGN_GLYPH[i], degree: l - i * 30, sense: SENSES[SIGNS[i]] };
}

// 12.63 → "12.63° / 12°38′"
export function fmtDeg(degInSign) {
  const d = Math.floor(degInSign);
  const m = Math.round((degInSign - d) * 60);
  const dd = m === 60 ? d + 1 : d;
  const mm = m === 60 ? 0 : m;
  return `${degInSign.toFixed(2)}° / ${dd}°${String(mm).padStart(2, '0')}′`;
}
export function fmtPos(lon) {
  const s = signOf(lon);
  return `${s.sign} ${fmtDeg(s.degree)}`;
}

// サビアン度 = 整数部分 + 1（0.00〜0.99 → 1度 … 29.00〜29.99 → 30度）
export function sabianDegree(lon) {
  const s = signOf(lon);
  return { sign: s.sign, degree: Math.floor(s.degree) + 1, global: s.index * 30 + Math.floor(s.degree) + 1 };
}

function lerpAngle(a, b, t) {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return norm(a + d * t);
}

export function createCore({ Astronomy, tables, sabian, stars, aspects }) {
  if (!Astronomy) throw new Error('Astronomy (astronomy-engine) が必要');
  const A = Astronomy;

  // ---------- 表（キロン・真ノード） ----------
  function tableAt(jd) {
    if (!tables) return null;
    const { jd0 } = tables.meta;
    const n = tables.node, cl = tables.chiron_lon, cb = tables.chiron_lat, cr = tables.chiron_r;
    const x = jd - jd0;
    if (x < 0 || x > n.length - 2) return { outOfRange: true };
    const i = Math.floor(x), f = x - i;
    const node = lerpAngle(n[i] / 1000, n[i + 1] / 1000, f);
    const s = tables.meta.step_chiron_days || 2;
    const k = Math.floor(x / s), fk = x / s - k;
    const kk = Math.min(k, cl.length - 2);
    const chiron = {
      lon: lerpAngle(cl[kk] / 1000, cl[kk + 1] / 1000, fk),
      lat: (cb[kk] + (cb[kk + 1] - cb[kk]) * fk) / 1000,
      r: (cr[kk] + (cr[kk + 1] - cr[kk]) * fk) / 100000,
    };
    return { node, chiron };
  }

  // ---------- 天体位置 ----------
  function helioLon(body, date) {
    return norm(A.Ecliptic(A.HelioVector(A.Body[body], date)).elon);
  }
  function geoLon(body, date) {
    return norm(A.Ecliptic(A.GeoVector(A.Body[body], date, true)).elon);
  }
  function earthHelioVecEcl(date) {
    return A.Ecliptic(A.HelioVector(A.Body.Earth, date)).vec; // 黄道（その日）座標・AU
  }

  function helioPositions(date) {
    const jd = jdFromDate(date);
    const out = {};
    for (const [key, name] of HELIO_BODIES) {
      const lon = helioLon(key, date);
      out[key] = { key, name, lon, ...signOf(lon) };
    }
    const t = tableAt(jd);
    if (t && !t.outOfRange) {
      out.Chiron = { key: 'Chiron', name: 'キロン', lon: t.chiron.lon, ...signOf(t.chiron.lon) };
    }
    return out;
  }

  function geoPositions(date) {
    const jd = jdFromDate(date);
    const out = {};
    for (const [key, name] of GEO_BODIES) {
      const lon = geoLon(key, date);
      out[key] = { key, name, lon, ...signOf(lon) };
    }
    const t = tableAt(jd);
    if (t && !t.outOfRange) {
      out.TrueNode = { key: 'TrueNode', name: 'ドラゴンヘッド', lon: t.node, ...signOf(t.node) };
      // 地心キロン = 日心キロン − 日心地球（どちらも黄道座標・その日）
      const c = t.chiron;
      const cx = c.r * Math.cos(c.lat * DEG) * Math.cos(c.lon * DEG);
      const cy = c.r * Math.cos(c.lat * DEG) * Math.sin(c.lon * DEG);
      const cz = c.r * Math.sin(c.lat * DEG);
      const e = earthHelioVecEcl(date);
      const lon = norm(Math.atan2(cy - e.y, cx - e.x) / DEG);
      out.Chiron = { key: 'Chiron', name: 'キロン', lon, ...signOf(lon) };
    }
    return out;
  }

  // ---------- 逆行判定（ジオ） ----------
  function retrogradeFlags(date) {
    const d2 = new Date(date.getTime() + 86400000);
    const flags = {};
    for (const [key] of GEO_BODIES) {
      if (key === 'Sun' || key === 'Moon') continue;
      let d = geoLon(key, d2) - geoLon(key, date);
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      flags[key] = d < 0;
    }
    return flags;
  }

  // ---------- ASC・MC・プラシーダス ----------
  function obliquity(jd) {
    const T = (jd - J2000) / 36525;
    return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T; // 平均黄道傾斜角
  }
  function angles(date, lat, lon) {
    const jd = jdFromDate(date);
    const gast = A.SiderealTime(date); // 時
    const ramc = norm((gast + lon / 15) * 15);
    const eps = obliquity(jd);
    const mc = norm(Math.atan2(Math.sin(ramc * DEG), Math.cos(ramc * DEG) * Math.cos(eps * DEG)) / DEG);
    const asc = norm(Math.atan2(Math.cos(ramc * DEG), -(Math.sin(ramc * DEG) * Math.cos(eps * DEG) + Math.tan(lat * DEG) * Math.sin(eps * DEG))) / DEG);
    return { asc, mc, ramc, eps };
  }
  // 赤経（黄道上の点）→ 黄経
  function lonFromRA(ra, eps) {
    return norm(Math.atan2(Math.sin(ra * DEG), Math.cos(ra * DEG) * Math.cos(eps * DEG)) / DEG);
  }
  function placidusCusp(ramc, lat, eps, f, houseNo) {
    // 11,12: 時角 H = f·昼半弧 / 2,3: H = 180 − f·夜半弧
    let ra = norm(ramc + 30 * (houseNo === 11 ? 1 : houseNo === 12 ? 2 : houseNo === 2 ? 4 : 5));
    for (let i = 0; i < 30; i++) {
      const dec = Math.atan(Math.tan(eps * DEG) * Math.sin(ra * DEG));
      const x = -Math.tan(lat * DEG) * Math.tan(dec);
      if (Math.abs(x) > 1) return null; // 高緯度で定義できない
      const sa = Math.acos(x) / DEG; // 昼半弧
      let next;
      if (houseNo === 11 || houseNo === 12) next = norm(ramc + f * sa);
      else next = norm(ramc + 180 - f * (180 - sa));
      if (Math.abs(lerpAngle(ra, next, 1) - ra) < 1e-7) { ra = next; break; }
      ra = next;
    }
    return lonFromRA(ra, eps);
  }
  function houses(date, lat, lon) {
    const ang = angles(date, lat, lon);
    const c = {};
    c[1] = ang.asc; c[10] = ang.mc; c[4] = norm(ang.mc + 180); c[7] = norm(ang.asc + 180);
    c[11] = placidusCusp(ang.ramc, lat, ang.eps, 1 / 3, 11);
    c[12] = placidusCusp(ang.ramc, lat, ang.eps, 2 / 3, 12);
    c[2] = placidusCusp(ang.ramc, lat, ang.eps, 2 / 3, 2);
    c[3] = placidusCusp(ang.ramc, lat, ang.eps, 1 / 3, 3);
    const ok = [11, 12, 2, 3].every((h) => c[h] !== null);
    if (ok) {
      c[5] = norm(c[11] + 180); c[6] = norm(c[12] + 180); c[8] = norm(c[2] + 180); c[9] = norm(c[3] + 180);
    }
    return { system: ok ? 'プラシーダス' : 'ASC/MCのみ（高緯度のためプラシーダス不可）', cusps: ok ? c : { 1: c[1], 10: c[10], 4: c[4], 7: c[7] }, ...ang };
  }
  function houseOf(lon, cusps) {
    if (!cusps || !cusps[2]) return null;
    for (let h = 1; h <= 12; h++) {
      const a = cusps[h], b = cusps[h === 12 ? 1 : h + 1];
      const span = norm(b - a), off = norm(lon - a);
      if (off < span) return h;
    }
    return null;
  }

  // ---------- アスペクト ----------
  function aspectsWithin(positions, orbs, { includeMinor = true } = {}) {
    const keys = Object.keys(positions);
    const out = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = positions[keys[i]], b = positions[keys[j]];
      const hit = matchAspect(a.lon, b.lon, orbs, includeMinor);
      if (hit) out.push({ a: a.name, b: b.name, ...hit });
    }
    return out.sort((x, y) => x.orb - y.orb);
  }
  function aspectsBetween(posA, posB, orbs, { includeMinor = true } = {}) {
    const out = [];
    for (const ka of Object.keys(posA)) for (const kb of Object.keys(posB)) {
      const hit = matchAspect(posA[ka].lon, posB[kb].lon, orbs, includeMinor);
      if (hit) out.push({ a: posA[ka].name, b: posB[kb].name, ...hit });
    }
    return out.sort((x, y) => x.orb - y.orb);
  }
  function matchAspect(l1, l2, orbs, includeMinor) {
    let d = Math.abs(norm(l1) - norm(l2));
    if (d > 180) d = 360 - d;
    let best = null;
    for (const def of ASPECT_DEFS) {
      if (!includeMinor && def.kind === 'minor') continue;
      const orb = Math.abs(d - def.angle);
      const allow = orbs[def.angle] ?? 0;
      if (orb <= allow && (!best || orb < best.orb)) best = { angle: def.angle, name: def.name, kind: def.kind, orb: +orb.toFixed(2), exact: +d.toFixed(2) };
    }
    return best;
  }

  // ---------- 恒星 ----------
  const STAR_EPOCH = 2018; // 占いラボ fixed_stars.json の度数は2018年前後の値（レグルス 乙女座0°05・シリウス 蟹座14°22 から逆算）
  function parseStar(st) {
    const si = SIGNS.indexOf(st.sign);
    const m = /(\d+)°(\d+)?/.exec(st.degree_in_sign || '');
    if (si < 0 || !m) return null;
    return { name: st.name, name_en: st.name_en, constellation: st.constellation, meaning: st.meaning, lon2020: si * 30 + (+m[1]) + (+(m[2] || 0)) / 60 };
  }
  const STAR_LIST = (stars && stars.stars ? stars.stars : []).map(parseStar).filter(Boolean);
  function starHits(positions, date, orb = 1.5) {
    const year = date.getUTCFullYear() + (date.getUTCMonth()) / 12;
    const shift = 0.013969 * (year - STAR_EPOCH); // 歳差 約50.3″/年
    const out = [];
    for (const key of Object.keys(positions)) {
      const p = positions[key];
      for (const st of STAR_LIST) {
        const slon = norm(st.lon2020 + shift);
        let d = Math.abs(p.lon - slon); if (d > 180) d = 360 - d;
        if (d <= orb) out.push({ body: p.name, star: st.name, star_en: st.name_en, constellation: st.constellation, distance: +d.toFixed(2), meaning: st.meaning });
      }
    }
    return out.sort((x, y) => x.distance - y.distance);
  }

  // ---------- サビアン ----------
  const SABIAN = sabian && sabian.symbols ? sabian.symbols : [];
  function sabianOf(lon) {
    const sd = sabianDegree(lon);
    const hit = SABIAN.find((s) => s.degree_global === sd.global);
    return { ...sd, title: hit ? hit.title : null };
  }

  // ---------- ドラコニック ----------
  function draconic(geo) {
    if (!geo.TrueNode) return null;
    const node = geo.TrueNode.lon;
    const out = {};
    for (const key of Object.keys(geo)) {
      if (key === 'TrueNode') continue;
      const lon = norm(geo[key].lon - node);
      out[key] = { key, name: geo[key].name, lon, ...signOf(lon) };
    }
    return out;
  }

  // ---------- 進行（二次進行: 1日 = 1年） ----------
  function progressedDate(birth, target) {
    const years = (jdFromDate(target) - jdFromDate(birth)) / 365.2425;
    return dateFromJd(jdFromDate(birth) + years);
  }

  // ---------- 出生図 ----------
  function natal({ date, lat, lon, hasTime = true }) {
    const helio = helioPositions(date);
    const geo = geoPositions(date);
    const retro = retrogradeFlags(date);
    const hs = (hasTime && typeof lat === 'number' && typeof lon === 'number') ? houses(date, lat, lon) : null;
    if (hs) {
      for (const k of Object.keys(geo)) geo[k].house = houseOf(geo[k].lon, hs.cusps);
      geo.ASC = { key: 'ASC', name: 'ASC', lon: hs.asc, ...signOf(hs.asc) };
      geo.MC = { key: 'MC', name: 'MC', lon: hs.mc, ...signOf(hs.mc) };
    }
    for (const k of Object.keys(geo)) if (retro[k] !== undefined) geo[k].retro = retro[k];
    const drac = draconic(geo);
    return {
      input: { date, lat, lon, hasTime },
      helio, geo, draconic: drac, houses: hs,
      aspects: {
        helio: aspectsWithin(helio, ORBS.helio),
        geo: aspectsWithin(geo, ORBS.geo),
      },
      stars: { helio: starHits(helio, date), geo: starHits(geo, date) },
      sabian: {
        earth: sabianOf(helio.Earth.lon),
        sun: sabianOf(geo.Sun.lon),
        moon: sabianOf(geo.Moon.lon),
        asc: hs ? sabianOf(hs.asc) : null,
      },
    };
  }

  // ---------- 経過図（トランジット） ----------
  function transit({ natalChart, date }) {
    const geo = geoPositions(date);
    const helio = helioPositions(date);
    const retro = retrogradeFlags(date);
    for (const k of Object.keys(geo)) if (retro[k] !== undefined) geo[k].retro = retro[k];
    if (natalChart.houses) for (const k of Object.keys(geo)) geo[k].house = houseOf(geo[k].lon, natalChart.houses.cusps);
    return {
      date, geo, helio,
      toNatal: {
        geo: aspectsBetween(geo, natalChart.geo, ORBS.transit),
        helio: aspectsBetween(helio, natalChart.helio, ORBS.transit),
      },
    };
  }

  // ---------- 進行図（二次進行） ----------
  function progression({ natalChart, date }) {
    const pdate = progressedDate(natalChart.input.date, date);
    const geo = geoPositions(pdate);
    const helio = helioPositions(pdate);
    if (natalChart.houses) for (const k of Object.keys(geo)) geo[k].house = houseOf(geo[k].lon, natalChart.houses.cusps);
    return {
      date, progressedDate: pdate, geo, helio,
      toNatal: {
        geo: aspectsBetween(geo, natalChart.geo, ORBS.transit),
        helio: aspectsBetween(helio, natalChart.helio, ORBS.transit),
      },
    };
  }

  return { natal, transit, progression, helioPositions, geoPositions, houses, angles, draconic, starHits, sabianOf, aspectsWithin, aspectsBetween, progressedDate, ORBS, SIGNS, SENSES, fmtPos, fmtDeg };
}

// ---------- テキスト出力（AIに貼る1枚） ----------
function line(p) {
  const r = p.retro ? ' R' : '';
  const h = p.house ? `（${p.house}ハウス）` : '';
  return `${p.name}: ${p.sign} ${fmtDeg(p.degree)}${r}${h}`;
}
function aspectLines(list, max = 20) {
  return list.slice(0, max).map((x) => `${x.a}-${x.b} ${x.short || x.angle + '°'} ${x.name}（オーブ${x.orb}）`);
}
export function formatReport({ name, chart, transit, progression, mode = 'all', targetDate }) {
  const L = [];
  const d = chart.input.date;
  const ymd = (dt) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  L.push(`【星読みデータ】${name ? name + ' ' : ''}生年月日（UTC換算）${ymd(d)} ${chart.input.hasTime ? '' : '（出生時間なし・正午で計算・ハウス非表示）'}`);
  L.push('度数は「10進 / 度分」の併記。サビアン度は整数+1。');
  if (mode === 'all' || mode === 'helio') {
    L.push('');
    L.push('【出生図・ヘリオ（魂の本来の資質）】');
    for (const k of Object.keys(chart.helio)) L.push(line(chart.helio[k]) + (k === 'Earth' ? `（${chart.helio[k].sense}）` : ''));
    L.push(`地球のサビアン: ${chart.sabian.earth.sign}${chart.sabian.earth.degree}度 ${chart.sabian.earth.title || ''}`);
    if (chart.aspects.helio.length) L.push('ヘリオのアスペクト: ' + aspectLines(chart.aspects.helio).join(' ／ '));
    if (chart.stars.helio.length) L.push('ヘリオの恒星: ' + chart.stars.helio.slice(0, 8).map((s) => `${s.body}↔${s.star}（${s.distance}°）`).join(' ／ '));
  }
  if (mode === 'all' || mode === 'geo') {
    L.push('');
    L.push('【出生図・ジオ（肉体の資質・今の自分）】');
    for (const k of Object.keys(chart.geo)) L.push(line(chart.geo[k]));
    if (chart.houses) L.push(`ハウス: ${chart.houses.system} ／ カスプ: ` + Object.keys(chart.houses.cusps).sort((a, b) => a - b).map((h) => `${h}H ${fmtPos(chart.houses.cusps[h])}`).join('、'));
    L.push(`太陽のサビアン: ${chart.sabian.sun.sign}${chart.sabian.sun.degree}度 ${chart.sabian.sun.title || ''} ／ 月のサビアン: ${chart.sabian.moon.sign}${chart.sabian.moon.degree}度 ${chart.sabian.moon.title || ''}` + (chart.sabian.asc ? ` ／ ASCのサビアン: ${chart.sabian.asc.sign}${chart.sabian.asc.degree}度 ${chart.sabian.asc.title || ''}` : ''));
    if (chart.aspects.geo.length) L.push('ジオのアスペクト（タイト順）: ' + aspectLines(chart.aspects.geo).join(' ／ '));
    if (chart.stars.geo.length) L.push('ジオの恒星: ' + chart.stars.geo.slice(0, 8).map((s) => `${s.body}↔${s.star}（${s.distance}°）`).join(' ／ '));
  }
  if ((mode === 'all' || mode === 'draconic') && chart.draconic) {
    L.push('');
    L.push('【出生図・ドラコニック（過去生で培ったもの）】ドラゴンヘッドを牡羊座0度に置き直した位置');
    for (const k of Object.keys(chart.draconic)) L.push(line(chart.draconic[k]));
  }
  if (transit) {
    L.push('');
    L.push(`【経過図（トランジット）${ymd(transit.date)}】`);
    L.push('ジオ: ' + Object.keys(transit.geo).map((k) => line(transit.geo[k])).join(' ／ '));
    if (transit.toNatal.geo.length) L.push('出生図へのアスペクト（経過天体-出生天体）: ' + aspectLines(transit.toNatal.geo, 25).join(' ／ '));
    L.push('ヘリオ: ' + Object.keys(transit.helio).map((k) => line(transit.helio[k])).join(' ／ '));
    if (transit.toNatal.helio.length) L.push('ヘリオ出生図へのアスペクト: ' + aspectLines(transit.toNatal.helio, 15).join(' ／ '));
  }
  if (progression) {
    L.push('');
    L.push(`【進行図（二次進行・1日=1年）${ymd(progression.date)} 時点】`);
    L.push('ジオ: ' + Object.keys(progression.geo).map((k) => line(progression.geo[k])).join(' ／ '));
    if (progression.toNatal.geo.length) L.push('出生図へのアスペクト（進行天体-出生天体）: ' + aspectLines(progression.toNatal.geo, 25).join(' ／ '));
    L.push('ヘリオ進行: ' + Object.keys(progression.helio).map((k) => line(progression.helio[k])).join(' ／ '));
  }
  return L.join('\n');
}

export { SIGNS, SIGN_GLYPH, SENSES, ASPECT_DEFS, ORBS };
