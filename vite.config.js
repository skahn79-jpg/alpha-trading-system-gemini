import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 운영 웹은 동일 Render 출처에서 Express가 dist 를 서빙합니다.
// Vite `/api` 프록시는 로컬 개발 전용입니다.
const API_URL = process.env.VITE_API_URL || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],

  // 개발 서버 설정
  server: {
    port: 5173,
    proxy: {
      // /api/* 요청을 server.js로 포워딩 (로컬 개발 시 CORS 없이)
      "/api": {
        target: API_URL,
        changeOrigin: true,
        secure: false,
      },
    },
  },

  // 빌드 출력 — 운영에서는 Express가 동일 Render 출처에서 dist 서빙
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // 청크 분리로 초기 로딩 빠르게
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
        },
      },
    },
  },

  // 환경 변수 (VITE_ 접두사만 클라이언트에 노출)
  define: {
    __API_URL__: JSON.stringify(
      process.env.VITE_API_URL || ""
    ),
  },
});
