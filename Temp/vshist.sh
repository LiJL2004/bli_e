#!/usr/bin/env bash
for d in -168cecf4 54ecb29c; do
  h=/home/devcontainers/.vscode-server/data/User/History/$d
  echo "== $d"
  python3 - "$h/entries.json" <<'EOF'
import json, sys, os, datetime
h = os.path.dirname(sys.argv[1])
data = json.load(open(sys.argv[1]))
print('resource:', data.get('resource', ''))
for e in data.get('entries', []):
    p = os.path.join(h, e['id'])
    try:
        txt = open(p, encoding='utf-8', errors='replace').read(200000)
        import re
        m = re.search(r"DEV_VERSION = '([^']+)'", txt)
        v = m.group(1) if m else '(no DEV_VERSION)'
        lines = txt.count('\n')
        ts = datetime.datetime.fromtimestamp(e['timestamp']/1000).isoformat()
        print(f"{e['id']}  {ts}  {lines} lines  DEV_VERSION={v}  size={os.path.getsize(p)}")
    except Exception as ex:
        print(e['id'], 'ERR', ex)
EOF
done
