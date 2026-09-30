import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** Card element width at or below which the card takes its mobile layout. */
export const MOBILE_BREAKPOINT = 600;

/**
 * Viewport width at or below which a `position: fixed` overlay takes its phone
 * form. A second breakpoint because an overlay ignores the card's own width.
 * `hv-full-view` and `hv-overflow-menu` spell it as `@media`; tests pin the two.
 */
export const NARROW_QUERY = '(max-width: 700px)';

/**
 * Follows `NARROW_QUERY` for a component drawing its own fixed overlay; a
 * `mobile` property measures the card, not the window. Without `matchMedia`
 * (jsdom) the answer stays `false`, the desktop form.
 */
export class ViewportNarrow implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly notify?: (narrow: boolean) => void;
  private query: MediaQueryList | null = null;
  private matches = false;

  /** `onChange` lets a host drop state that means something at one width only. */
  constructor(host: ReactiveControllerHost, onChange?: (narrow: boolean) => void) {
    this.host = host;
    this.notify = onChange;
    host.addController(this);
  }

  /** True on a phone-width viewport. */
  get narrow(): boolean {
    return this.matches;
  }

  hostConnected(): void {
    this.query ??= window.matchMedia?.(NARROW_QUERY) ?? null;
    if (!this.query) return;
    this.matches = this.query.matches;
    this.query.addEventListener('change', this.onChange);
  }

  hostDisconnected(): void {
    this.query?.removeEventListener('change', this.onChange);
  }

  private readonly onChange = (e: MediaQueryListEvent) => {
    this.matches = e.matches;
    this.notify?.(this.matches);
    this.host.requestUpdate();
  };
}

/**
 * Drives the card's mobile mode from its own rendered width, since a card can be
 * narrow in a wide viewport. `ResizeObserver` rather than `@container`, so a
 * jsdom test can stand one in that reports the width it wants.
 */
export class ResponsiveController implements ReactiveController {
  private readonly host: ReactiveControllerHost & Element;
  private readonly breakpoint: number;
  private observer?: ResizeObserver;
  private width = 0;

  constructor(host: ReactiveControllerHost & Element, breakpoint: number = MOBILE_BREAKPOINT) {
    this.host = host;
    this.breakpoint = breakpoint;
    host.addController(this);
  }

  /** True when the card should render its mobile layout. */
  get mobile(): boolean {
    return this.width > 0 && this.width <= this.breakpoint;
  }

  /** The one way in for a measured width. */
  setWidth(width: number): void {
    const before = this.mobile;
    this.width = width;
    if (this.mobile !== before) this.host.requestUpdate();
  }

  hostConnected(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentRect ?? entry.target.getBoundingClientRect();
      this.setWidth(box.width);
    });
    this.observer.observe(this.host);
  }

  hostDisconnected(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }
}
