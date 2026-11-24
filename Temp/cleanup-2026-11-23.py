# -*- coding: utf-8 -*-
"""2026-11-23 整理：把仓库里的垃圾残留移进 _bli_e_trash/2026-11-23/。

原则：不做真删除，一律 os.rename 到回收站目录（UNC 上 delete 会被钩子挡掉）。
"""
import os
import time

ROOT = r'\\wsl.localhost\Ubuntu-26.04.1\home\devcontainers\bli_e'
TRASH = os.path.join(ROOT, '_bli_e_trash', '2026-11-23')
SKIP_DIRS = {'.git', 'node_modules', '_bli_e_trash'}

os.makedirs(TRASH, exist_ok=True)


def move(src, sub=''):
    dst_dir = os.path.join(TRASH, sub) if sub else TRASH
    os.makedirs(dst_dir, exist_ok=True)
    name = os.path.basename(src.rstrip('\\/'))
    dst = os.path.join(dst_dir, name)
    if os.path.exists(dst):
        dst = dst + '.%d' % int(time.time() * 1000)
    os.rename(src, dst)
    return os.path.relpath(dst, ROOT)


moved = []

# 1. 编辑残留（.tmpold* / .new*）—— 都是「改名法」写文件时留下的旧副本
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if '.tmpold' in fn or fn.endswith('.new'):
            moved.append(move(os.path.join(dirpath, fn), 'tmpold'))

# 2. 未被任何代码引用的 vitesse 模板组件（components.d.ts 是自动生成的，会自己重建）
for fn in ['Logo.vue', 'SharedSubtitle.vue', 'README.md']:
    p = os.path.join(ROOT, 'src', 'components', fn)
    if os.path.exists(p):
        moved.append(move(p, 'src-components'))

# 3. 过时的 opencode skill（v1.0.0，已被 .workbuddy-ai/skills/bili-elite-dev 取代）
p = os.path.join(ROOT, '.opencode', 'skills', 'bili-elite')
if os.path.exists(p):
    moved.append(move(p, 'opencode'))

# 4. 空目录收尾（src/components 搬空后留一个空壳）
for d in [os.path.join(ROOT, 'src', 'components'), os.path.join(ROOT, '.opencode', 'skills')]:
    if os.path.isdir(d) and not os.listdir(d):
        try:
            os.rmdir(d)
            moved.append('rmdir: ' + os.path.relpath(d, ROOT))
        except OSError:
            pass

for m in moved:
    print(m)
print('--- total:', len(moved))
