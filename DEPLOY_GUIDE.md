# ALPHA TRADING SYSTEM — 최종 배포 가이드

현재 관리자 인증·웹앱 운영 경로는 Firebase Hosting이 아니라 Render 동일 출처입니다.
- 브라우저: https://alpha-trading-server.onrender.com/  (Express가 dist + /api 제공)
- Firebase Hosting/Firestore 설정 파일은 유지하지만, 세션 쿠키 인증 경로에서는 사용하지 않습니다.
- Firebase 설정을 삭제하지 마세요.

서버(server.js) → Render 배포
클라이언트(trading-platform.jsx) → Firebase Hosting 배포
데이터(시뮬레이션 시그널) → Firestore 동기화

---

## 전체 구조

```
┌─ Firebase Hosting ─────────────────┐
│  trading-platform.jsx (React 앱)    │  ← 폰/PC 브라우저 접속
│  https://alpha-trading.web.app      │
└──────────────┬─────────────────────┘
               │  /api/* 요청
┌──────────────▼─────────────────────┐
│  Render (server.js)                 │
│  https://alpha-trading-server.render│  ← KIS + DART 프록시
│  .com/api/...                       │
└─────────────────────────────────────┘
               │  시그널 저장/로드
┌──────────────▼─────────────────────┐
│  Firebase Firestore                 │  ← 시뮬레이션 데이터
│  users/{uid}/signals                │
└─────────────────────────────────────┘
```

---

## STEP 1 — GitHub 저장소 준비

프로젝트 파일들을 GitHub에 올립니다.

### 저장소 구조 확인
```
your-repo/
├── server.js              ← KIS+DART 프록시 서버
├── analysis.js            ← 경제명탐정+독개미 분석 모듈
├── dart.js                ← DART 국민연금 모듈
├── simulation.js          ← 시뮬레이션 채점 모듈
├── firebase-config.js     ← Firebase 초기화 + Firestore CRUD
├── firestore.rules        ← Firestore 보안 규칙
├── firebase.json          ← Firebase 설정
├── firestore.indexes.json ← Firestore 인덱스
├── render.yaml            ← Render 배포 설정
├── vite.config.js         ← Vite 빌드 설정
├── package.json           ← 의존성
├── trading-platform.jsx   ← React 웹앱 (src/App.jsx 또는 src/main.jsx에서 import)
└── .env                   ← 절대 git에 올리지 마세요! (.gitignore에 추가)
```

### .gitignore 필수 항목
```
.env
.env.local
node_modules/
dist/
.firebase/
```

### GitHub에 올리기
```bash
git init
git add .
git commit -m "init: alpha trading system v3"
git remote add origin https://github.com/your-id/alpha-trading.git
git push -u origin main
```

---

## STEP 2 — Render로 server.js 배포 (무료)

### 2-1. Render 계정 가입
https://render.com → GitHub 계정으로 가입 (5초)

### 2-2. Web Service 생성
1. Dashboard → **New +** → **Web Service**
2. **GitHub 저장소 연결** → alpha-trading 선택
3. 설정 확인:
   - **Name**: `alpha-trading-server`
   - **Region**: `Singapore` (한국과 가장 가까움)
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: **Free**

### 2-3. 환경 변수 추가
**Environment** 탭 → **Add Environment Variable** (하나씩 추가):

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `KIS_APP_KEY` | 한국투자증권 API 키 |
| `KIS_APP_SECRET` | 한국투자증권 API 시크릿 |
| `DART_API_KEY` | DART OpenAPI 키 |
| `ALLOWED_ORIGIN` | *(일단 빈칸, Firebase URL 발급 후 입력)* |

### 2-4. 배포 시작
**Create Web Service** → 2~3분 대기

배포 완료 → URL 확인:
```
https://alpha-trading-server.onrender.com
```

> ⚠️ **Render 무료 플랜 주의사항**
> - 15분간 요청이 없으면 슬립 (다음 요청 시 30~60초 웨이크업 딜레이)
> - 월 750시간 제공 (한 서비스만 쓰면 사실상 무제한)
> - 해결책: `/api/health`로 14분마다 ping 보내는 UptimeRobot 무료 등록

### 2-5. 서버 동작 확인
브라우저에서:
```
https://alpha-trading-server.onrender.com/api/health
```
`{"status":"ok","token":true}` 응답이 오면 성공.

---

## STEP 3 — .env에 Render URL 추가

로컬 `.env` 파일에 Render URL 추가:

```env
# Firebase (기존)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Render 서버 URL (새로 추가)
VITE_API_URL=https://alpha-trading-server.onrender.com
```

---

## STEP 4 — Firebase Hosting에 클라이언트 배포

### 4-1. Firebase CLI 설치 (처음 한 번)
```bash
npm install -g firebase-tools
firebase login
```

### 4-2. 프로젝트 초기화
```bash
firebase init
```
- Firestore, Hosting 선택
- 기존 프로젝트 선택
- public directory: `dist`
- SPA 설정: Yes

### 4-3. 빌드 + 배포
```bash
npm run build
firebase deploy
```

배포 완료 → Firebase Hosting URL 확인:
```
https://alpha-trading-xxxxxx.web.app
```

---

## STEP 5 — Render에 Firebase URL 등록

Render 대시보드 → Environment → `ALLOWED_ORIGIN` 값 입력:
```
https://alpha-trading-xxxxxx.web.app
```
**Save Changes** → 자동 재배포 (1분)

---

## 최종 확인 체크리스트

### 서버 동작
- [ ] `https://alpha-trading-server.onrender.com/api/health` → `{"status":"ok"}`
- [ ] `https://alpha-trading-server.onrender.com/api/index` → KOSPI/KOSDAQ 데이터

### 클라이언트 동작
- [ ] `https://alpha-trading-xxxxxx.web.app` 접속 가능
- [ ] 대시보드 → KOSPI/KOSDAQ 카드에 실시간 숫자 표시
- [ ] 시뮬레이션 탭 → `● Firebase 동기화` 녹색 뱃지 표시
- [ ] 국민연금 탭 → DART 공시 목록 로드

### 모바일 확인
- [ ] 폰에서 Firebase URL 접속 → 알약 탭 정상 표시
- [ ] 데모 시그널 추가 → PC에서 같은 URL 접속 시 동일 시그널 표시 *(같은 브라우저 유지 시)*

---

## 로컬 개발 (계속 쓰는 법)

Render 배포 후에도 로컬 개발은 그대로 가능합니다:

```bash
# 터미널 1: 서버
node server.js

# 터미널 2: 클라이언트 (Vite가 /api를 localhost:3001로 자동 프록시)
npm run client

# 또는 한 줄로
npm run dev
```

`.env.local` (로컬 전용, git 제외)에 로컬 설정 오버라이드 가능:
```env
# 로컬 개발 시에는 Render 안 쓰고 로컬 server.js 사용
VITE_API_URL=
```

---

## Render 슬립 방지 (UptimeRobot 무료)

무료 플랜은 15분 비활성 시 슬립됩니다. 이를 막으려면:

1. https://uptimerobot.com → 무료 가입
2. **Add New Monitor** → **HTTP(s)**
3. **URL**: `https://alpha-trading-server.onrender.com/api/health`
4. **Monitoring Interval**: `14 minutes`
5. 저장 → 이후 14분마다 자동 핑 → 슬립 없음

---

## 트러블슈팅

### "CORS 차단" 에러
- Render의 `ALLOWED_ORIGIN`에 Firebase URL이 정확히 입력됐는지 확인
- `https://`까지 포함된 전체 URL 필요

### 시뮬레이션 채점이 안 됨 (모바일)
- Render 서버가 슬립 상태 → 첫 요청 후 30~60초 대기
- UptimeRobot으로 슬립 방지 설정 권장

### KIS 토큰 발급 실패
- KIS API 키·시크릿이 Render 환경 변수에 정확히 입력됐는지 확인
- 한국투자증권 실전 API는 IP 등록이 필요할 수 있음 (Render IP를 KIS에 등록)

### Firebase Hosting 빌드 실패
- `npm run build` 로컬에서 먼저 테스트
- `dist/` 폴더 생성 확인 후 `firebase deploy`
