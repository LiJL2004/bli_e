#!/usr/bin/env bash
# 临时脚本：找 settingsPanel.ts 的任何副本（git 索引被误恢复后找回 1.2.5 工作区版本）
echo '--- find settingsPanel anywhere under home ---'
find /home/devcontainers -name 'settingsPanel*' -not -path '*node_modules*' -not -path '*/.git/*' 2>/dev/null
echo '--- find any settingsPanel blob in bli_e .git objects (loose) by scanning content ---'
for f in /home/devcontainers/bli_e/.git/objects/??/*; do
  if [ -f "$f" ]; then
    if grep -aqs "DEV_VERSION = '1.2" "$f" 2>/dev/null; then echo "LOOSE HIT: $f"; fi
  fi
done
echo '--- recent large .ts backups anywhere (tmpold / bak) ---'
find /home/devcontainers/bli_e -name '*.tmpold*' -o -name '*.bak' -o -name '*settingsPanel*' 2>/dev/null | grep -v node_modules | head -50
echo '--- done ---'
