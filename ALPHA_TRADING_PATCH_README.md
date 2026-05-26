# ALPHA TRADING SYSTEM — 수정 적용본 안내

## 반영 내용

1. `package.json`
   - React 실행 필수 패키지 `react`, `react-dom` 추가
   - 모바일/내부망 테스트가 쉽도록 Vite client/preview host 옵션 보완

2. `server.js`
   - `/api/ai/analyze` 서버 프록시 엔드포인트 추가
   - 브라우저에서 Anthropic API를 직접 호출하지 않도록 구조 변경
   - Render 환경변수 `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` 사용

3. `trading-platform.jsx`
   - 기존 `https://api.anthropic.com/v1/messages` 직접 호출 제거
   - `fetch(`${API_BASE}/api/ai/analyze`)` 방식으로 서버 호출 전환
   - 서버 오류 메시지를 화면에서 확인할 수 있도록 보완

4. 누락 가능성이 있던 필수 모듈 추가
   - `analysis.js`: 기본 일봉/이평선/거래량 분석 모듈
   - `simulation.js`: 시그널 채점/통계/가중치 계산 모듈
   - `dart.js`: DART API 안전 호출 모듈
   - `firebase-config.js`: Firebase 미설정 시 LocalStorage 폴백이 가능하도록 안전 구성

5. Vite 실행 기본 파일 추가
   - `index.html`
   - `src/main.jsx`

6. `render.yaml`
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` 환경변수 항목 추가

## Render 환경변수 필수

```env
NODE_ENV=production
KIS_APP_KEY=한국투자증권_API_KEY
KIS_APP_SECRET=한국투자증권_API_SECRET
DART_API_KEY=DART_KEY
ANTHROPIC_API_KEY=Anthropic_API_Key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ALLOWED_ORIGIN=https://본인-firebase-url.web.app
```

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포

```bash
npm run build
firebase deploy
```

서버는 Render에서 `node server.js`로 실행합니다.
