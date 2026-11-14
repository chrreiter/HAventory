/** A deferred call with at most one fire outstanding; its owner cancels it on dispose. */
export class Coalesced {
  private handle: ReturnType<typeof setTimeout> | null = null;

  /** True while a fire is booked — a grace period that must not be restarted. */
  get pending(): boolean {
    return this.handle !== null;
  }

  /** Book `run`, dropping any fire already booked. */
  schedule(delayMs: number, run: () => void): void {
    this.cancel();
    this.handle = setTimeout(() => {
      this.handle = null;
      run();
    }, delayMs);
  }

  cancel(): void {
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
  }
}

/**
 * Which request of its kind is the newest: two reads can be in flight against
 * different filters, and the one that lands last is not always the newest.
 */
export class Latest {
  private seq = 0;

  /** Take the newest turn; the token reads false once another has taken one. */
  claim(): () => boolean {
    const seq = ++this.seq;
    return () => seq === this.seq;
  }

  /** End every outstanding turn without starting one. */
  invalidate(): void {
    this.seq += 1;
  }
}
