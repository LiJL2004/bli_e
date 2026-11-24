#!/usr/bin/env bash
f=/home/devcontainers/bli_e/extension/dist/contentScripts/index.global.js
echo "--- around DEV_VERSION ---"
grep -n "DEV_VERSION" "$f" | head -5
echo "--- total lines ---"
wc -l "$f"
echo "--- settingsPanel module boundaries (search markers) ---"
grep -n "setupSettingsPanel\|RIPPLE_TARGETS\|restoreDefaults\|PARAM_GROUPS" "$f" | head -20
echo "--- sample formatting near DEV_VERSION ---"
ln=$(grep -n "DEV_VERSION" "$f" | head -1 | cut -d: -f1)
sed -n "$((ln-3)),$((ln+3))p" "$f" | cut -c1-200
