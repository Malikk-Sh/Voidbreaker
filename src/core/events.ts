/** Типизированная шина событий (Tech §9): все «сочные» реакции — подписчики. */
export class EventBus<M extends object> {
  private handlers = new Map<keyof M, ((e: never) => void)[]>();

  on<K extends keyof M>(type: K, fn: (e: M[K]) => void): () => void {
    let list = this.handlers.get(type);
    if (!list) { list = []; this.handlers.set(type, list); }
    list.push(fn as (e: never) => void);
    return () => this.off(type, fn);
  }

  off<K extends keyof M>(type: K, fn: (e: M[K]) => void): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn as (e: never) => void);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof M>(type: K, e: M[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) (list[i] as (e: M[K]) => void)(e);
  }

  clear(): void { this.handlers.clear(); }
}
