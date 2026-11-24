import os, time, shutil

src = r'C:/Users/86157/bli-build-tmp/out/index.global.js'
dst = r'\\wsl.localhost\Ubuntu-26.04.1\home\devcontainers\bli_e\extension\dist\contentScripts\index.global.js'

with open(src, 'rb') as f:
    data = f.read()

bak = dst + '.tmpold%d' % int(time.time() * 1000)
os.rename(dst, bak)
with open(dst, 'wb') as f:
    f.write(data)
print('ok', len(data), 'backup:', os.path.basename(bak))
