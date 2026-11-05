// An IntersectionObserver that reports every observed element on screen at once. happy-dom's never fires,
// so a test that depends on a section being seen installs this with vi.stubGlobal.
export class OnScreenObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.cb([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
