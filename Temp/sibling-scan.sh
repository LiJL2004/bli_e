#!/usr/bin/env bash
echo '--- template backup settingsPanel ---'
find /home/devcontainers/bli_e_template_backup /home/devcontainers/bili_cat /home/devcontainers/_bli_junk_test -name 'settingsPanel*' -not -path '*node_modules*' 2>/dev/null
echo '--- DEV_VERSION in those trees ---'
grep -r "DEV_VERSION = '" /home/devcontainers/bli_e_template_backup /home/devcontainers/bili_cat /home/devcontainers/_bli_junk_test --include='*.ts' 2>/dev/null | head -5
echo '--- tmpold settingsPanel copies in whole trash (name search already done; content search for 1.2.4/1.2.5) ---'
grep -rl "DEV_VERSION = '1.2" /home/devcontainers/bli_e/_bli_e_trash 2>/dev/null | head -10
echo '--- done ---'
