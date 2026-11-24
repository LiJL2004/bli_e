#!/usr/bin/env bash
cd /home/devcontainers/bli_e
for z in bili-elite-1.2.4.zip bili-elite-1.2.3.zip bili-elite-1.2.2.zip bili-elite-1.2.1.zip bili-elite-1.1.4-source.zip; do
  echo "== $z"
  if command -v unzip >/dev/null 2>&1; then
    unzip -l "$z" 2>/dev/null | grep -i -E 'settingsPanel|contentScripts' | head -10
    unzip -l "$z" 2>/dev/null | tail -1
  else
    echo "no unzip"
  fi
done
echo '--- dist freshness ---'
ls -la extension/dist/contentScripts/ 2>/dev/null
grep -ao "DEV_VERSION = '[^']*'" extension/dist/contentScripts/index.global.js 2>/dev/null | head -3
grep -ao "1\.2\.5 v0[0-9]*" extension/dist/contentScripts/index.global.js 2>/dev/null | sort | uniq -c | head
echo '--- manifest version ---'
grep -o '"version": "[^"]*"' extension/manifest.json 2>/dev/null
