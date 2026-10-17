<script setup lang="ts">
// 版本号与图标都从扩展自身读取，避免和 package.json 漂移
const manifest = typeof chrome !== 'undefined' ? chrome.runtime.getManifest?.() : undefined
const version = manifest?.version ?? '1.0.0'
const iconUrl = typeof chrome !== 'undefined'
  ? chrome.runtime.getURL?.('assets/icon-128.png') ?? ''
  : ''

function openBilibili() {
  window.open('https://www.bilibili.com/', '_blank', 'noopener')
}
</script>

<template>
  <main class="wrap">
    <section class="card">
      <img v-if="iconUrl" :src="iconUrl" class="icon" alt="奶睿pro">
      <h1 class="name">奶睿pro</h1>
      <p class="version">v{{ version }}</p>

      <p class="lead">
        所有开关都在 B 站页面里：任意页面右下角的 <span class="gear">⚙</span> 按钮。
      </p>

      <ul class="tips">
        <li>顶栏、搜索面板、卡片效果：首页 / 搜索页 / 播放页</li>
        <li>全屏切换动画：播放页、直播页</li>
        <li>图片开合动画：评论区、动态页相册</li>
        <li>一键恢复默认：设置面板 → 界面优化 → 设置管理</li>
      </ul>

      <button class="cta" type="button" @click="openBilibili">
        打开哔哩哔哩
      </button>
    </section>
  </main>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  box-sizing: border-box;
  background: #F5F6F8;
  font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif;
  color: #1c1c1e;
}

.card {
  width: min(420px, 100%);
  box-sizing: border-box;
  padding: 32px 28px 26px;
  border-radius: 18px;
  background: #FFFFFF;
  border: 1px solid rgba(20, 22, 30, 0.1);
  box-shadow:
    0 16px 40px rgba(20, 22, 30, 0.1),
    0 3px 10px rgba(20, 22, 30, 0.06);
  text-align: center;
}

.icon {
  width: 64px;
  height: 64px;
  display: block;
  margin: 0 auto 12px;
  border-radius: 16px;
}

.name {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.version {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8E8E93;
  font-variant-numeric: tabular-nums;
}

.lead {
  margin: 20px 0 0;
  font-size: 14px;
  line-height: 21px;
  color: #3a3a3c;
}

.gear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4C9BFF 0%, #0A6CFF 100%);
  color: #fff;
  font-size: 12px;
  vertical-align: -4px;
}

.tips {
  margin: 18px 0 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: #F7F8FA;
  border: 1px solid rgba(20, 22, 30, 0.08);
  list-style: none;
  text-align: left;
  font-size: 12.5px;
  line-height: 20px;
  color: #6c6c72;
}

.tips li + li {
  margin-top: 4px;
}

.cta {
  margin-top: 20px;
  width: 100%;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(135deg, #4C9BFF 0%, #0A6CFF 100%);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow:
    0 4px 12px rgba(10, 108, 255, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: box-shadow 0.2s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cta:hover {
  box-shadow:
    0 6px 16px rgba(10, 108, 255, 0.44),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.cta:active {
  transform: scale(0.97);
}
</style>
