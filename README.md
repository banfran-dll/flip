# 바자 플립 추천기 · Hypixel SkyBlock Bazaar Flipper

Hypixel SkyBlock 바자(Bazaar)의 **플립(매수 주문 → 매도 주문) 추천기**이자 **아이템 시세 조회기**입니다.
Hypixel 공개 API를 브라우저에서 직접 호출하므로 서버나 API 키가 필요 없고, 정적 사이트(GitHub Pages 등)로 그대로 배포할 수 있습니다.

> **English summary** — A client-only React + TypeScript app that ranks Hypixel SkyBlock bazaar flips
> (place a buy order one tick above the best bid, sell one tick below the best ask) by a budget-aware
> profit-per-hour estimate, flags suspicious markets, and provides an order-book / calculator view for
> every product. No API key, no backend. `npm install && npm run dev`.

![플립 추천 화면](docs/screenshot-flips.png)

![아이템 상세 패널](docs/screenshot-detail.png)

## 주요 기능

**플립 추천 탭**
- 모든 바자 상품에 대해 *매수 주문가 = 현재 최고 매수 주문 + 0.1*, *매도 주문가 = 현재 최저 매도 주문 − 0.1* 기준으로 계산
- 세후 개당 이익, 마진 %, 시간당 거래량(즉시판매 → 즉시구매), 예산으로 살 수 있는 수량, 회전 시간, 회전당 이익, **시간당 예상 이익**
- 예산·세율(Bazaar Flipper 퍽)·최소 거래량·최소 마진·가격 범위 필터 (설정은 브라우저에 저장)
- 위험 표시: 호가 없음 · 얇은 호가 · 매수/매도 이상치(단일 주문) · 거래량 불균형 · 비정상 스프레드 · 거래량 부족
- 모든 컬럼 정렬 가능, 아이템 이름/ID 검색 (`ench dia`, `wise 5` 처럼 토큰 검색)

**아이템 상세 패널** (행 클릭)
- 즉시 구매가/즉시 판매가, 가중 평균가, 주간 거래량, 열린 주문 수
- 플립 요약 + **플립 계산기** (수량 → 매수 비용, 세금, 세후 수익, 순이익, 체결 예상 시간)
- **즉시 거래 시뮬레이션**: 호가창을 따라가며 N개를 즉시 구매/판매했을 때의 실제 비용·수익
- 호가창(매수 주문 / 매도 주문 상위 12단계, 누적 물량 바)
- 페이지를 열어둔 동안의 세션 가격 추이 차트
- 즐겨찾기(★), ID 복사, 위키 링크

**전체 조회 탭** — 2,000여 개 상품 전체를 시세·거래량·주문 수 기준으로 정렬/검색
**즐겨찾기 탭** — 필터와 무관하게 즐겨찾기한 아이템의 플립 지표를 항상 표시

한국어/영어 UI 전환, 30초(설정 가능) 자동 갱신, 탭이 백그라운드일 때는 갱신을 멈춥니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # 플립 계산·이름·포맷 단위 테스트 (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # dist/ 에 정적 파일 생성
npm run preview    # 빌드 결과 미리보기
```

## GitHub Pages 배포

`.github/workflows/deploy.yml`이 `main` 브랜치에 푸시될 때마다 빌드해서 GitHub Pages에 올립니다.
저장소 **Settings → Pages → Source**를 **GitHub Actions**로 한 번만 바꿔 주면 됩니다.
`vite.config.ts`의 `base: './'` 덕분에 `https://<user>.github.io/<repo>/` 같은 하위 경로에서도 그대로 동작합니다.

## 계산 방식

API 필드 이름은 "플레이어가 하는 행동" 기준이라 헷갈리기 쉽습니다 (`src/api/bazaar.ts` 주석 참고).

| API 필드 | 의미 |
| --- | --- |
| `buy_summary` | 다른 유저의 **매도 주문** (내가 즉시 구매할 때 체결되는 쪽), 오름차순 |
| `sell_summary` | 다른 유저의 **매수 주문** (내가 즉시 판매할 때 체결되는 쪽), 내림차순 |
| `buyMovingWeek` | 최근 7일간 즉시 구매된 수량 → **내 매도 주문**을 채워 줌 |
| `sellMovingWeek` | 최근 7일간 즉시 판매된 수량 → **내 매수 주문**을 채워 줌 |

`src/lib/flip.ts`:

```
매수 주문가  = sell_summary[0].price + 0.1
매도 주문가  = buy_summary[0].price − 0.1
개당 이익    = 매도 주문가 × (1 − 세율) − 매수 주문가        # 세금은 판매 시에만
수량         = min(⌊예산 / 매수 주문가⌋, 71,680)              # 주문당 최대 수량
회전 시간    = 수량 / (sellMovingWeek/168) + 수량 / (buyMovingWeek/168)
시간당 이익  = 수량 × 개당 이익 / max(회전 시간, 최소 회전 시간)
```

"회전 시간"은 내 주문이 항상 대기열 맨 앞에 있다고 가정한 **낙관적** 추정입니다.
경쟁 주문 수(매수 주문 / 매도 주문)를 함께 보고 판단하세요. 위험 표시의 기준값은 `flip.ts` 상단 상수로 조정할 수 있습니다.

## 아이템 이름 갱신

이름/등급은 `src/data/item-names.json`에 들어 있습니다 (Hypixel 아이템 카탈로그에서 생성).
카탈로그에 없는 상품(인챈트 북, 샤드, 에센스 등)은 ID로부터 이름을 만들어 냅니다 (`src/lib/names.ts`).
새 아이템이 추가되면 아래 명령으로 다시 생성하세요.

```bash
npm run update-names
```

## 프로젝트 구조

```
src/
  api/bazaar.ts        Hypixel Bazaar API 타입 + fetch
  lib/flip.ts          플립 계산, 위험 플래그, 필터/랭킹, 호가 워킹, 계산기   (순수 함수, 테스트 대상)
  lib/names.ts         상품 ID → 표시 이름/등급
  lib/format.ts        숫자/시간 포맷, "10m" 같은 입력 파싱
  lib/search.ts        토큰 기반 검색
  lib/history.ts       세션 내 가격 이력 (스파크라인용)
  hooks/               폴링, localStorage 상태, 번역
  components/          헤더, 설정 패널, 정렬 테이블, 상세 패널, 호가창, 스파크라인
  i18n.ts              한국어/영어 문자열
  settings.ts          앱 설정 모델과 기본값
scripts/update-item-names.mjs   이름 데이터 재생성
tests/                 vitest 단위 테스트
```

## 참고

- 데이터 출처: `https://api.hypixel.net/v2/skyblock/bazaar` (공개, 키 불필요, 약 1분 캐시)
- 모든 수치는 추정치이며 실제 체결이나 이익을 보장하지 않습니다.
- Hypixel 및 SkyBlock은 Hypixel Inc.의 상표이며, 이 프로젝트는 비공식 팬 도구입니다.
