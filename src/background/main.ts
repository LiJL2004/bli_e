import { onMessage } from 'webext-bridge/background'

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  import('./contentScriptHMR')
}

browser.runtime.onInstalled.addListener((): void => {
  // eslint-disable-next-line no-console
  console.log('奶睿pro installed')
})

onMessage('get-current-tab', async () => ({ title: undefined }))