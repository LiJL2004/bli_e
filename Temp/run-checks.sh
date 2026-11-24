#!/usr/bin/env bash
# 一次性校验脚本（Temp，不入库）：在 WSL 内用 nvm 的 node 跑 tsc / eslint
set -u
export PATH="/home/devcontainers/.nvm/versions/node/v24.21.0/bin:$PATH"
cd /home/devcontainers/bli_e || exit 1

echo "== tsc --noEmit =="
node ./node_modules/.bin/tsc --noEmit 2>&1 | tail -20
echo "tsc exit: ${PIPESTATUS[0]}"

echo "== eslint (touched files) =="
node ./node_modules/.bin/eslint src/contentScripts/modules/videoBeta.ts src/contentScripts/modules/dynamicOverlay.ts src/contentScripts/modules/whatsNew.ts src/contentScripts/modules/settingsPanel.ts 2>&1 | tail -30
echo "eslint exit: $?"
