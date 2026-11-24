#!/usr/bin/env bash
echo '--- other dirs in /home/devcontainers ---'
ls /home/devcontainers/ 2>/dev/null
echo '--- .zwork/admitting ---'
find /home/devcontainers/bli_e/.zwork -type f 2>/dev/null | head -10
echo '--- design/ ---'
find /home/devcontainers/bli_e/design -type f 2>/dev/null | head -20
echo '--- any file >50KB containing panelHotkey or cdn-row (panel source markers) ---'
grep -rl 'cdn-row' /home/devcontainers/bli_e --include='*.ts' --include='*.js' --include='*.txt' 2>/dev/null | grep -v node_modules | grep -v '.git' | head
echo '--- trash 11-24 & 11-23 file list ---'
find /home/devcontainers/bli_e/_bli_e_trash/2026-11-24 /home/devcontainers/bli_e/_bli_e_trash/2026-11-23 -type f 2>/dev/null | grep -vi 'index.global' | head -40
echo '--- done ---'
