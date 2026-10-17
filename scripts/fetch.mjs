// 청약홈 분양정보 수집 → data/list.json (앱이 raw.githubusercontent.com 으로 읽음)
// 실행: ODCLOUD_KEY=... node scripts/fetch.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.ODCLOUD_KEY;
if (!KEY) { console.error('ODCLOUD_KEY 가 없어요'); process.exit(1); }
const BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1';

// 공고 종류별 상세/주택형 오퍼레이션
const KINDS = [
  { kind: 'APT', label: '아파트', detail: 'getAPTLttotPblancDetail', model: 'getAPTLttotPblancMdl' },
  { kind: 'REMNDR', label: '무순위·잔여', detail: 'getRemndrLttotPblancDetail', model: 'getRemndrLttotPblancMdl' },
  { kind: 'URBTY', label: '오피스텔·도시형', detail: 'getUrbtyOfctlLttotPblancDetail', model: 'getUrbtyOfctlLttotPblancMdl' },
  { kind: 'PBLRENT', label: '공공지원 민간임대', detail: 'getPblPvtRentLttotPblancDetail', model: 'getPblPvtRentLttotPblancMdl' },
  { kind: 'OPT', label: '임의공급', detail: 'getOPTLttotPblancDetail', model: 'getOPTLttotPblancMdl' },
];

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST
const since = new Date(Date.now() - 75 * 86400 * 1000).toISOString().slice(0, 10);

async function call(op, params) {
  const url = new URL(`${BASE}/${op}`);
  url.searchParams.set('serviceKey', KEY);
  url.searchParams.set('returnType', 'JSON');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`${op} 요청 실패`);
}

async function all(op, cond) {
  const out = [];
  for (let page = 1; page < 40; page++) {
    const d = await call(op, { page, perPage: 500, ...cond });
    out.push(...(d.data ?? []));
    if (out.length >= (d.matchCount ?? 0) || !(d.data ?? []).length) break;
  }
  return out;
}

const pick = (...v) => v.find((x) => x) ?? null;

function normalize(k, r) {
  return {
    id: `${k.kind}-${r.HOUSE_MANAGE_NO}-${r.PBLANC_NO}`,
    kind: k.kind,
    kindLabel: k.label,
    houseKind: pick(r.HOUSE_DTL_SECD_NM, r.HOUSE_DETAIL_SECD_NM, r.HOUSE_SECD_NM),
    name: (r.HOUSE_NM ?? '').trim(),
    region: r.SUBSCRPT_AREA_CODE_NM ?? '기타',
    address: r.HSSPLY_ADRES ?? '',
    units: r.TOT_SUPLY_HSHLDCO ?? null,
    notice: r.RCRIT_PBLANC_DE ?? null,
    special: [r.SPSPLY_RCEPT_BGNDE ?? null, r.SPSPLY_RCEPT_ENDDE ?? null],
    rank1: [pick(r.GNRL_RNK1_CRSPAREA_RCPTDE, r.GNRL_RCEPT_BGNDE), pick(r.GNRL_RNK1_ETC_AREA_ENDDE, r.GNRL_RNK1_CRSPAREA_ENDDE, r.GNRL_RCEPT_ENDDE)],
    rank2: [r.GNRL_RNK2_CRSPAREA_RCPTDE ?? null, pick(r.GNRL_RNK2_ETC_AREA_ENDDE, r.GNRL_RNK2_CRSPAREA_ENDDE)],
    receipt: [pick(r.RCEPT_BGNDE, r.SUBSCRPT_RCEPT_BGNDE, r.SPSPLY_RCEPT_BGNDE, r.GNRL_RCEPT_BGNDE), pick(r.RCEPT_ENDDE, r.SUBSCRPT_RCEPT_ENDDE, r.GNRL_RCEPT_ENDDE)],
    winner: r.PRZWNER_PRESNATN_DE ?? null,
    contract: [r.CNTRCT_CNCLS_BGNDE ?? null, r.CNTRCT_CNCLS_ENDDE ?? null],
    moveIn: r.MVN_PREARNGE_YM ?? null,
    builder: r.CNSTRCT_ENTRPS_NM ?? null,
    developer: r.BSNS_MBY_NM ?? null,
    phone: r.MDHS_TELNO ?? null,
    url: r.PBLANC_URL ?? null,
    homepage: r.HMPG_ADRES ?? null,
    priceCap: r.PARCPRC_ULS_AT === 'Y',
    models: [],
  };
}

const items = [];
for (const k of KINDS) {
  const rows = await all(k.detail, { 'cond[RCRIT_PBLANC_DE::GTE]': since });
  for (const r of rows) items.push(normalize(k, r));
  console.log(k.kind, rows.length);
}

// 접수가 아직 안 끝났거나 최근 끝난 공고만 주택형(평형·분양가) 상세를 붙임 (호출량 절약)
const recent = items.filter((it) => (it.receipt[1] ?? it.notice ?? '') >= new Date(Date.now() - 21 * 86400 * 1000).toISOString().slice(0, 10));
for (const it of recent) {
  const k = KINDS.find((x) => x.kind === it.kind);
  const [, houseNo, pblancNo] = it.id.split('-');
  try {
    const rows = await all(k.model, { 'cond[HOUSE_MANAGE_NO::EQ]': houseNo, 'cond[PBLANC_NO::EQ]': pblancNo });
    it.models = rows.map((m) => ({
      type: String(m.HOUSE_TY ?? m.TP ?? '').trim(),
      area: m.SUPLY_AR ? Number(m.SUPLY_AR) : null,
      units: (m.SUPLY_HSHLDCO ?? 0) + (m.SPSPLY_HSHLDCO ?? 0) || null,
      topPrice: m.LTTOT_TOP_AMOUNT ? Number(String(m.LTTOT_TOP_AMOUNT).replace(/,/g, '')) : null, // 만원
    }));
  } catch { /* 일부 실패해도 목록은 유지 */ }
}

// 중복 제거 + 접수 시작일 기준 정렬
const seen = new Set();
const list = items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
  .sort((a, b) => String(a.receipt[0] ?? a.notice).localeCompare(String(b.receipt[0] ?? b.notice)));

mkdirSync('data', { recursive: true });
writeFileSync('data/list.json', JSON.stringify(list));
writeFileSync('data/meta.json', JSON.stringify({ updatedAt: new Date().toISOString(), today, count: list.length }));
console.log('total', list.length, 'with models', recent.length);
