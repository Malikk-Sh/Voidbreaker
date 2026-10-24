/** Пул с преаллокацией (Tech §12): в бою ноль `new` в горячем цикле. */
export class Pool<T> {
  private free: T[] = [];
  constructor(private make: () => T, private reset: (o: T) => void, prealloc = 0) {
    for (let i = 0; i < prealloc; i++) this.free.push(make());
  }
  get(): T { return this.free.pop() ?? this.make(); }
  release(o: T): void { this.reset(o); this.free.push(o); }
}

/** Массив с удалением «перестановкой с последним» — порядок не важен, удаление O(1). */
export function swapRemove<T>(arr: T[], i: number): void {
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}
