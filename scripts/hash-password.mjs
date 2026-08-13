#!/usr/bin/env node
/**
 * 관리자 비밀번호 Argon2id 해시 생성기.
 * 실행: npm run auth:hash-password
 *
 * 평문은 터미널에 표시·저장하지 않으며, 표준출력에는 해시만 출력한다.
 * 명령줄 인수로 비밀번호를 넘기는 것은 거부한다.
 */

import { createRequire } from "node:module";
import readline from "node:readline";

const require = createRequire(import.meta.url);
const { hashPassword } = require("../kb/auth.js");

if (process.argv.length > 2) {
  process.stderr.write("비밀번호를 명령줄 인수로 전달하지 마세요...\n");
  process.exit(1);
}

if (!process.stdin.isTTY) {
  process.stderr.write("대화형 터미널에서만 실행할 수 있습니다.\n");
  process.exit(1);
}

function readHidden(promptText) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const rl = readline.createInterface({
      input: stdin,
      output: process.stdout,
      terminal: true,
    });
    rl._writeToOutput = () => {};
    process.stderr.write(promptText);

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let value = "";
    const onData = (buf) => {
      const str = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
      for (const ch of str) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          cleanup();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          process.exit(1);
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= " ") value += ch;
      }
    };

    function cleanup() {
      stdin.off("data", onData);
      stdin.setRawMode(!!wasRaw);
      rl.close();
    }

    stdin.on("data", onData);
  });
}

let password = await readHidden("비밀번호: ");
let confirm = await readHidden("비밀번호 확인: ");

if (password !== confirm) {
  password = "";
  confirm = "";
  process.stderr.write("비밀번호가 일치하지 않습니다.\n");
  process.exit(1);
}

if (!password) {
  password = "";
  confirm = "";
  process.stderr.write("비밀번호를 입력하세요.\n");
  process.exit(1);
}

const hash = await hashPassword(password);
password = "";
confirm = "";
process.stdout.write(`${hash}\n`);
