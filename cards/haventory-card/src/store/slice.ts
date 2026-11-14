/** Something to read and to watch: `onChange` returns the call that stops watching. */
export interface Observable<T> {
  readonly value: T;
  onChange(cb: () => void): () => void;
}

/**
 * One slice of the store's state, owned by the part that writes it. `set`
 * replaces the value with a patched copy, so a reader can tell by identity that
 * the slice moved, and notifies only when a patched key holds a new value: every
 * listener re-renders a host.
 */
export class Slice<T extends object> implements Observable<Readonly<T>> {
  private current: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.current = { ...initial };
  }

  get value(): Readonly<T> {
    return this.current;
  }

  set(patch: Partial<T>): void {
    const keys = Object.keys(patch) as (keyof T)[];
    if (keys.every((key) => Object.is(this.current[key], patch[key]))) return;
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((l) => l());
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

type SliceValue<S> = S extends Slice<infer T> ? T : never;
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;
/** Every slice's keys side by side, as one flat state. */
export type Combined<S extends Record<string, Slice<object>>> = UnionToIntersection<SliceValue<S[keyof S]>>;

/**
 * One flat, read-only view over several slices. `value` is a single object
 * whose keys read through to the slice that owns them, so a reference held
 * across an await still reads current state; `onChange` fires on any slice.
 * The slices must not share a key.
 */
export function combineSlices<S extends Record<string, Slice<object>>>(
  slices: S,
): Observable<Readonly<Combined<S>>> {
  const view = {} as Combined<S>;
  for (const slice of Object.values(slices)) {
    for (const key of Object.keys(slice.value)) {
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => (slice.value as Record<string, unknown>)[key],
      });
    }
  }
  return {
    value: view,
    onChange(cb: () => void) {
      const offs = Object.values(slices).map((slice) => slice.onChange(cb));
      return () => offs.forEach((off) => off());
    },
  };
}
