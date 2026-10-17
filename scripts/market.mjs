// 청약 공고 주변 아파트 매매 실거래가 → data/market.json (공고 id → 요약)
// 실행: DATA_GO_KR_KEY=... node scripts/market.mjs  (fetch.mjs 다음에 실행)
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.DATA_GO_KR_KEY || process.env.ODCLOUD_KEY;
if (!KEY) { console.error('DATA_GO_KR_KEY 가 없어요'); process.exit(1); }
const API = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

const SIDO = { 서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원도', 충북: '충청북도', 충남: '충청남도', 전북: '전라북도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도' };
const SIDO_ALIAS = { 강원특별자치도: '강원도', 전북특별자치도: '전라북도', 서울시: '서울특별시', 부산시: '부산광역시' };
// 코드표 이후 바뀐 시군구 코드 (특별자치도 전환·편입)
const PREFIX_SWAP = { 42: '51', 45: '52' };
const OVERRIDE = { '대구광역시 군위군': '27720' };

const sgg = JSON.parse(readFileSync(new URL('./sgg.json', import.meta.url)));

function lawdCode(address) {
  const t = address.replace(/\s+/g, ' ').trim().split(' ');
  if (t.length < 2) return null;
  let sido = SIDO_ALIAS[t[0]] ?? SIDO[t[0]] ?? t[0];
  if (sido === '세종특별자치시') return { code: '36110', dong: t.find((x) => /[동읍면]$/.test(x)) ?? null };
  const tryNames = [`${sido} ${t[1]} ${t[2] ?? ''}`.trim(), `${sido} ${t[1]}`];
  if (t[0].startsWith('대구') && t[1] === '군위군') return { code: OVERRIDE['대구광역시 군위군'], dong: t[2] ?? null };
  for (const name of tryNames) {
    let c = sgg[name];
    if (!c && sido === '대구광역시') c = sgg[name.replace('대구광역시', '경상북도')];
    if (c) {
      const swapped = PREFIX_SWAP[c.slice(0, 2)];
      const code = swapped && (t[0].includes('특별자치도')) ? swapped + c.slice(2) : (swapped ? swapped + c.slice(2) : c);
      const rest = name === tryNames[0] ? t.slice(3) : t.slice(2);
      return { code, dong: rest.find((x) => /[동읍면리가]$/.test(x)) ?? null };
    }
  }
  return null;
}

const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return m ? m[1].trim() : ''; };

async function trades(code, ym) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const url = `${API}?serviceKey=${KEY}&LAWD_CD=${code}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
    let xml = '';
    for (let a = 0; a < 3; a++) { const r = await fetch(url); if (r.ok) { xml = await r.text(); break; } await new Promise((s) => setTimeout(s, 1500)); }
    const items = xml.split('<item>').slice(1);
    for (const it of items) {
      if (tag(it, 'cdealType') === 'O') continue; // 해제된 거래 제외
      out.push({
        apt: tag(it, 'aptNm'), dong: tag(it, 'umdNm'), area: Number(tag(it, 'excluUseAr')),
        floor: Number(tag(it, 'floor')), price: Number(tag(it, 'dealAmount').replace(/,/g, '')), // 만원
        date: `${tag(it, 'dealYear')}-${tag(it, 'dealMonth').padStart(2, '0')}-${tag(it, 'dealDay').padStart(2, '0')}`,
        built: Number(tag(it, 'buildYear')),
      });
    }
    const total = Number(tag(xml, 'totalCount') || 0);
    if (out.length >= total || items.length === 0) break;
  }
  return out;
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const list = JSON.parse(readFileSync('data/list.json'));
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const months = [0, 1, 2].map((i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; });

// 아직 접수 전·접수 중·발표 전 공고만 (호출량 절약)
const targets = list.filter((n) => (n.receipt[1] ?? n.winner ?? n.notice ?? '') >= today && n.address);
const cache = new Map();
const market = {};
let miss = 0;
for (const n of targets) {
  const loc = lawdCode(n.address);
  if (!loc) { miss++; continue; }
  if (!cache.has(loc.code)) {
    const all = [];
    for (const ym of months) all.push(...await trades(loc.code, ym));
    cache.set(loc.code, all);
  }
  const all = cache.get(loc.code);
  const sameDong = loc.dong ? all.filter((t) => t.dong === loc.dong) : [];
  const pool = sameDong.length >= 5 ? sameDong : all;
  const perPy = pool.filter((t) => t.area > 0).map((t) => Math.round(t.price / (t.area / 3.3058)));
  const near84 = pool.filter((t) => t.area >= 75 && t.area <= 90).map((t) => t.price);
  const recent = [...pool].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
    .map((t) => ({ apt: t.apt, dong: t.dong, area: Math.round(t.area), floor: t.floor, price: t.price, date: t.date, built: t.built }));
  market[n.id] = {
    scope: pool === sameDong ? loc.dong : '시군구 전체',
    lawd: loc.code,
    count: pool.length,
    medianPerPyeong: median(perPy), // 만원/3.3㎡
    median84: median(near84),       // 만원 (전용 75~90㎡)
    recent,
    period: `${months[2].slice(0, 4)}.${months[2].slice(4)}~${months[0].slice(0, 4)}.${months[0].slice(4)}`,
  };
}
writeFileSync('data/market.json', JSON.stringify(market));
console.log('market', Object.keys(market).length, 'of', targets.length, 'sgg calls', cache.size, 'unmapped', miss);
