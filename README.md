# cheongyak-content

청약 알리미 미니앱이 읽는 청약 일정 데이터. 출처: 공공데이터포털 「한국부동산원_청약홈 분양정보 조회 서비스」.

- `data/list.json` — 최근 75일 이내 모집공고 (아파트·무순위·오피스텔·공공지원 민간임대·임의공급)
- `data/meta.json` — 갱신 시각
- 매일 오전 6시(KST) GitHub Actions 가 갱신 (`secrets.ODCLOUD_KEY` 필요)
- `data/market.json` — 접수 전·중 공고 주변 아파트 매매 실거래가 요약 (국토교통부 아파트 매매 실거래가 상세, 최근 3개월, `secrets.DATA_GO_KR_KEY`)
- `scripts/sgg.json` — 법정동 시군구 이름→코드 (특별자치도 전환·군위 편입 보정 포함)
