import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_API_URL: 배포된 server.js Render URL
// 없으면 로컬 localhost:3001 프록시 사용
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

  // 빌드 출력 (firebase.json의 hosting.public과 일치)
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
