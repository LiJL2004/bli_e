type Cleanup = () => void

export class EventBag {
  private cleanups: Cleanup[] = []

  on(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, handler, opts)
    this.cleanups.push(() => target.removeEventListener(type, handler, opts))
  }

  observe(observer: MutationObserver): void {
    this.cleanups.push(() => observer.disconnect())
  }

  add(fn: Cleanup): void {
    this.cleanups.push(fn)
  }

  dispose(): void {
    for (const fn of this.cleanups) {
      try { fn() } catch { /* noop */ }
    }
    this.cleanups = []
  }
}
