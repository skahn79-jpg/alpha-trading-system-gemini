#!/usr/bin/env node
/**
 * App Store Connect API JWT 인증 프로브 (의존성 없음)
 * 사용: node AlphaTradingIOS/scripts/asc-jwt-probe.mjs
 */
import { createSign } from 'node:crypto';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_LOCAL = join(ROOT, '.env.local');
const DEBUG_LOG = join(ROOT, '.cursor/debug-73e95f.log');

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_KEY_PATH|APPSTORE_KEY_ID|APPSTORE_ISSUER_ID)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function logDebug(hypothesisId, message, data) {
  try {
    mkdirSync(dirname(DEBUG_LOG), { recursive: true });
    appendFileSync(
      DEBUG_LOG,
      `${JSON.stringify({
        sessionId: '73e95f',
        runId: 'jwt-probe',
        hypothesisId,
        location: 'asc-jwt-probe.mjs',
        message,
        data,
        timestamp: Date.now(),
      })}\n`,
    );
  } catch {
    /* ignore */
  }
}

function makeJwt(keyId, issuerId, p8) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }),
  ).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = createSign('SHA256')
    .update(data)
    .sign({ key: p8, format: 'pem', dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${data}.${sig}`;
}

function probe(token) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.appstoreconnect.apple.com',
        path: '/v1/apps?limit=1',
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: body.slice(0, 400) });
        });
      },
    );
    req.on('error', (err) => resolve({ status: 0, body: String(err.message) }));
    req.end();
  });
}

const env = parseEnv(ENV_LOCAL);
const keyId = env.APPSTORE_KEY_ID || env.ASC_API_KEY_ID || '';
const issuerId = env.APPSTORE_ISSUER_ID || env.ASC_ISSUER_ID || '';
const p8Path = env.ASC_API_KEY_PATH || `${process.env.HOME}/Downloads/AuthKey_${keyId}.p8`;

if (!keyId || !issuerId || !existsSync(p8Path)) {
  console.log('❌ .env.local 에 ASC_API_KEY_ID / ASC_ISSUER_ID / ASC_API_KEY_PATH 필요');
  logDebug('H5', 'missing_env', { ok: false });
  process.exit(1);
}

const p8 = readFileSync(p8Path, 'utf8');
let token;
try {
  token = makeJwt(keyId, issuerId, p8);
  logDebug('H5', 'jwt_built', { ok: true });
} catch (err) {
  console.log('❌ JWT 생성 실패 (.p8 파싱 오류)');
  logDebug('H5', 'jwt_build_fail', { ok: false, err: String(err.message) });
  process.exit(1);
}

const { status, body } = await probe(token);
const authOk = status >= 200 && status < 300;

if (authOk) {
  console.log(`✅ App Store Connect API 인증 성공 (HTTP ${status})`);
  logDebug('H4', 'api_jwt', { ok: true, httpStatus: status });
  process.exit(0);
}

console.log(`❌ App Store Connect API 인증 실패 (HTTP ${status})`);
if (status === 401) {
  console.log('');
  console.log('   Key ID, Issuer ID, .p8 세트가 Apple에 등록된 것과 일치하지 않습니다.');
  console.log('   → npm run setup:asc 로 새 키를 설정하세요.');
}
const code = (() => {
  try {
    return JSON.parse(body)?.errors?.[0]?.code ?? '';
  } catch {
    return '';
  }
})();
logDebug('H4', 'api_jwt', { ok: false, httpStatus: status, code });
process.exit(1);
