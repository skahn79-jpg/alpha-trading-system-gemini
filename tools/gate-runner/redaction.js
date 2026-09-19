"use strict";

const SECRET_KEY_RE = /(TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTHORIZATION|COOKIE|PRIVATE[_ ]?KEY)/i;

function looksLikeSecretEnvKey(key) {
  return typeof key === "string" && SECRET_KEY_RE.test(key);
}

function redactSecrets(text) {
  if (text == null) return "";
  let out = String(text);
  out = out.replace(
    /\b([A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTHORIZATION|COOKIE|PRIVATE[_ ]?KEY)[A-Za-z0-9_.-]*)\s*[:=]\s*([^\s,;]+)/gi,
    "$1=[REDACTED]"
  );
  out = out.replace(
    /(["'][A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTHORIZATION|COOKIE|PRIVATE[_ ]?KEY)[A-Za-z0-9_.-]*["'])\s*:\s*(["'])(?:\\.|[^\\])*?\2/gi,
    "$1:[REDACTED]"
  );
  out = out.replace(
    /\b(Authorization|Cookie)\s*:\s*([^\r\n]+)/gi,
    "$1: [REDACTED]"
  );
  out = out.replace(
    /\b(Bearer)\s+[A-Za-z0-9._\-+=/]+/gi,
    "$1 [REDACTED]"
  );
  out = out.replace(
    /PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----/gi,
    "PRIVATE KEY [REDACTED]"
  );
  // Negative lookahead keeps this idempotent so already-redacted spans do not
  // swallow the 64 characters that follow them.
  out = out.replace(
    /PRIVATE KEY(?! \[REDACTED\])[\s\S]{0,64}/gi,
    "PRIVATE KEY [REDACTED]"
  );
  return out;
}

module.exports = {
  looksLikeSecretEnvKey,
  redactSecrets,
  SECRET_KEY_RE,
};
