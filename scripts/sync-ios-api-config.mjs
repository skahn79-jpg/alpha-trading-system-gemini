#!/usr/bin/env node
/**
 * 웹앱(.env / .env.local)의 API 설정을 iOS xcconfig로 동기화합니다.
 * trading-platform.jsx 와 동일한 우선순위:
 *   VITE_API_URL → 없으면 https://alpha-trading-server.onrender.com
 *   VITE_APP_API_KEY → 없으면 APP_API_KEY (서버 .env)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IOS_CONFIG = path.join(ROOT, "AlphaTradingIOS", "Config");
const OUT_FILE = path.join(IOS_CONFIG, "Generated.xcconfig");

const DEFAULT_PROD_URL = "https://alpha-trading-server.onrender.com";
const DEFAULT_LOCAL_URL = "http://localhost:3001";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function mergeEnv() {
  const fromFiles = {
    ...parseEnvFile(path.join(ROOT, ".env")),
    ...parseEnvFile(path.join(ROOT, ".env.local")),
  };
  const fromProcess = {};
  for (const key of ["VITE_API_URL", "VITE_APP_API_KEY", "APP_API_KEY"]) {
    const v = process.env[key];
    if (v != null && String(v).trim() !== "") fromProcess[key] = String(v).trim();
  }
  return { ...fromFiles, ...fromProcess };
}

function resolveApiBaseUrl(env) {
  const raw = (env.VITE_API_URL || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  // trading-platform.jsx: import.meta.env.VITE_API_URL || "https://alpha-trading-server.onrender.com"
  return DEFAULT_PROD_URL;
}

function resolveApiKey(env) {
  return (env.VITE_APP_API_KEY || env.APP_API_KEY || "").trim();
}

function main() {
  const mode = (process.argv[2] || "debug").toLowerCase();
  const env = mergeEnv();
  const apiBaseUrl = resolveApiBaseUrl(env);
  const appApiKey = resolveApiKey(env);

  const lines = [
    "// 자동 생성 — scripts/sync-ios-api-config.mjs (수동 편집 금지)",
    `// 소스: .env / .env.local (웹앱과 동일)`,
    `// 생성 시각: ${new Date().toISOString()}`,
    "",
    `API_BASE_URL = ${apiBaseUrl}`,
    `APP_API_KEY = ${appApiKey}`,
    "",
  ];

  fs.mkdirSync(IOS_CONFIG, { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf8");

  console.log(`[sync-ios-api] Generated.xcconfig updated (mode=${mode})`);
  console.log(`[sync-ios-api] API_BASE_URL = ${apiBaseUrl}`);
  console.log(`[sync-ios-api] APP_API_KEY = ${appApiKey ? "(set)" : "(empty)"}`);
}

main();
