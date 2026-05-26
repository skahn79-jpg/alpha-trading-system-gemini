# ALPHA TRADING SYSTEM — Gemini 변경 전체 수정본

## 반영 사항

- Anthropic 환경변수 제거
- Gemini 환경변수 추가
- `/api/ai/analyze`를 Gemini REST API 호출 방식으로 변경
- 프론트엔드는 그대로 `/api/ai/analyze`만 호출하므로 추가 수정 불필요
- API Key는 브라우저에 노출하지 않고 Render 서버 환경변수로만 관리

## Render Environment 입력값

| Key | Value |
|---|---|
| NODE_ENV | production |
| PORT | 10000 |
| KIS_APP_KEY | 한국투자증권 API Key |
| KIS_APP_SECRET | 한국투자증권 API Secret |
| DART_API_KEY | DART API Key |
| GEMINI_API_KEY | Google AI Studio에서 발급받은 Gemini API Key |
| GEMINI_MODEL | gemini-2.5-flash |
| ALLOWED_ORIGIN | Firebase Hosting 주소 |

## Gemini API Key 발급

1. https://aistudio.google.com/app/apikey 접속
2. Create API key 클릭
3. 생성된 API Key 복사
4. Render → Web Service → Environment → `GEMINI_API_KEY`에 붙여넣기

## 로컬 실행

```bash
npm install
npm run dev
```

`.env` 또는 `.env.local` 예시:

```env
KIS_APP_KEY=...
KIS_APP_SECRET=...
DART_API_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
VITE_API_URL=
```

## 배포

```bash
npm run build
firebase deploy
```

Render 서버는 GitHub push 후 자동 배포되며, 시작 명령은 `node server.js`입니다.
