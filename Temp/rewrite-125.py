# -*- coding: utf-8 -*-
"""1.2.5 改成「精简官方描述 + 开发记录」两段式（开发中的版本才这样）。

A 段内容 = whatsNew.ts 的 INTRO + SECTIONS，一个字不改地搬过来；
B 段 = 原文件里 `## v001` 到结尾的全部内容，原样保留。
"""
import os
import time

ROOT = '//wsl.localhost/Ubuntu-26.04.1/home/devcontainers/bli_e'
SRC = ROOT + '/CHANGELOG/1.2.5.md'
TRASH = ROOT + '/_bli_e_trash/2026-11-23/changelog-orig'

with open(SRC, 'rb') as f:
    raw = f.read().decode('utf-8')

marker = '## v001'
idx = raw.index(marker)
detail = raw[idx:].rstrip('\n')

A = '''# 1.2.5

> 本次更新修复了动态悬浮窗播放视频时开头内容被跳过的问题。

## 修复

- 修复动态悬浮窗打开视频时，加载转圈期间视频已在后台起播，导致揭开画面后开头一小段被跳过的问题；现在视频自悬浮窗揭开的瞬间从片头开始播放。
'''

B_HEAD = '''
---

## 开发记录

> 这一段**只在开发期间存在**。打包（出 zip）之后整段剪到 `archive/1.2.5.md`，
> 本文件只留上面那段官方描述。上面那段与 `src/contentScripts/modules/whatsNew.ts` 必须一致
> —— 那份是来源，改文案改那边。

'''

out = A.rstrip('\n') + '\n' + B_HEAD + detail + '\n'

os.makedirs(TRASH, exist_ok=True)
dst = os.path.join(TRASH, '1.2.5.md')
if os.path.exists(dst):
    dst += '.%d' % int(time.time() * 1000)
os.rename(SRC, dst)

with open(SRC, 'wb') as f:
    f.write(out.encode('utf-8'))

print('ok, detail chars:', len(detail), 'total:', len(out))
