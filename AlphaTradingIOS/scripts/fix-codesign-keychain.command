#!/usr/bin/env bash
cd "$(dirname "$0")"
bash ./fix-codesign-keychain.sh
read -r -p "Enter 키를 누르면 종료합니다..."
