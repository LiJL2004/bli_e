<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { FeatureConfig, FeatureKey } from '~/shared/features'
import { DEFAULT_CONFIG, FEATURES, groupFeatures, STORAGE_KEY } from '~/shared/features'

const config = ref<FeatureConfig>({ ...DEFAULT_CONFIG })
const groups = groupFeatures()
let initialized = false

function readStorage(): Promise<Partial<FeatureConfig>> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        resolve(raw ? JSON.parse(raw) : {})
      } catch { resolve({}) }
      return
    }
    chrome.storage.sync.get(DEFAULT_CONFIG, (s) => resolve(s as Partial<FeatureConfig>))
  })
}

function writeStorage(patch: Partial<FeatureConfig>): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const cur = raw ? JSON.parse(raw) : {}
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...patch }))
      } catch { /* noop */ }
      resolve()
      return
    }
    chrome.storage.sync.set(patch, () => resolve())
  })
}

onMounted(async () => {
  const s = await readStorage()
  config.value = { ...DEFAULT_CONFIG, ...s }
  initialized = true
})

async function toggle(key: FeatureKey, e: Event) {
  if (!initialized) return
  const checked = (e.target as HTMLInputElement).checked
  config.value = { ...config.value, [key]: checked }
  await writeStorage({ [key]: checked })
}
</script>

<template>
  <div class="bili-elite-popup">
    <div class="panel-header">奶睿pro</div>
    <template v-for="(items, groupName) in groups" :key="groupName">
      <div class="section-header">{{ groupName }}</div>
      <div class="settings-group">
        <div v-for="f in items" :key="f.key" class="setting-item">
          <span class="setting-title">{{ f.label }}</span>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="config[f.key]"
              @change="toggle(f.key, $event)"
            >
            <div class="toggle-track"><div class="toggle-thumb" /></div>
          </label>
        </div>
      </div>
    </template>
  </div>
</template>

<style>
:root { --scale: 0.8; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: calc(320px * var(--scale));
  background: #F2F2F7;
  font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
  padding: calc(16px * var(--scale));
}
.panel-header {
  font-size: calc(22px * var(--scale));
  font-weight: 700; color: #000;
  padding: calc(4px * var(--scale)) calc(2px * var(--scale)) calc(14px * var(--scale));
  letter-spacing: -0.3px;
}
.section-header {
  font-size: calc(12px * var(--scale));
  color: #8E8E93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 calc(14px * var(--scale)) calc(6px * var(--scale));
  font-weight: 600;
}
.settings-group {
  background: #FFF;
  border-radius: calc(12px * var(--scale));
  overflow: hidden;
  margin-bottom: calc(10px * var(--scale));
}
.setting-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: calc(12px * var(--scale)) calc(14px * var(--scale));
  position: relative;
}
.setting-item:not(:last-child)::after {
  content: '';
  position: absolute; bottom: 0;
  left: calc(14px * var(--scale)); right: 0;
  height: calc(0.5px * var(--scale));
  background: #C6C6C8;
}
.setting-title {
  font-size: calc(18px * var(--scale));
  color: #000;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.toggle {
  position: relative;
  width: calc(51px * var(--scale));
  height: calc(31px * var(--scale));
  flex-shrink: 0;
}
.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-track {
  position: absolute; inset: 0;
  background: #E9E9EA;
  border-radius: calc(31px * var(--scale));
  transition: background 0.3s ease;
}
.toggle-thumb {
  position: absolute;
  height: calc(27px * var(--scale));
  width: calc(27px * var(--scale));
  left: calc(2px * var(--scale));
  bottom: calc(2px * var(--scale));
  background: #FFF; border-radius: 50%;
  box-shadow: 0 calc(1px * var(--scale)) calc(3px * var(--scale)) rgba(0, 0, 0, 0.2);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toggle input:checked + .toggle-track { background: #34C759; }
.toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(calc(20px * var(--scale)));
}
</style>