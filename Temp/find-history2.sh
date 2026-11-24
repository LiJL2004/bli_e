#!/usr/bin/env bash
echo '--- vscode-server history dirs ---'
ls -d /home/devcontainers/.vscode-server/data/User/History 2>/dev/null && ls /home/devcontainers/.vscode-server/data/User/History | head -20
echo '--- entries mentioning settingsPanel (search by content entries.json) ---'
grep -rl 'settingsPanel' /home/devcontainers/.vscode-server/data/User/History 2>/dev/null | head -30
echo '--- any entries.json resource field with settingsPanel ---'
find /home/devcontainers/.vscode-server/data/User/History -name entries.json 2>/dev/null | while read f; do
  if grep -q 'settingsPanel' "$f" 2>/dev/null; then echo "$f"; fi
done | head -30
echo '--- workbuddy memory sizes ---'
wc -c /home/devcontainers/bli_e/.workbuddy-ai/memory/*.md | sort -n | tail -8
echo '--- done ---'
