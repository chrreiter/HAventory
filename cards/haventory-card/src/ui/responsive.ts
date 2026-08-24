import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Container width at or below which the card switches to its mobile layout.
 * Matches the ~600px breakpoint the design calls for.
 */
export const MOBILE_BREAKPOINT = 600;

/**
 * Viewport width at or below which a surface that covers the screen takes its
 * phone form.
 *
 * Two breakpoints live here because they answer two different questions.
 * `MOBILE_BREAKPOINT` measures the card *element*, which is what in-card layout
 * depends on: a card in a dashboard column is 300–500px wide inside a 1920px
 * window, and its list, steppers and in-card sheets have to lay out for that
 * width. An overlay is placed against the viewport instead — `position: fixed`
 * ignores the card entirely — so the card's width says nothing about the room
 * an overlay has. Dialogs, menus and sheets use this query; everything drawn
 * inside the card's own box keeps the element measurement.
 *
 * `hv-full-view` and `hv-overflow-menu` spell the same width as a CSS `@media`
 * block, which cannot read a constant. Tests pin the two spellings together.
 */
export const NARROW_QUERY = '(max-width: 700px)';

/**
 * Follows `NARROW_QUERY` for a component that draws a `position: fixed` surface
 * of its own.
 *
 * A component already handed a `mobile` property cannot answer this from it:
 * that property is the card element's width on the card's side of the tree, and
 * a fixed overlay is laid out against the window whatever the card measures.
 * The property keeps governing in-flow layout; the overlay asks this.
 *
 * `matchMedia` is missing in jsdom unless a test provides one; without it the
 * answer stays `false`, which is the desktop form — the honest default for a
 * host that cannot say how wide the window is.
 */
export class ViewportNarrow implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private query: MediaQueryList | null = null;
  private matches = false;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
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
    this.host.requestUpdate();
  };
}

/**
 * Drives the card's mobile/desktop mode from its own rendered width.
 *
 * Media queries are unreliable inside HA dashboards — a card can be narrow in a
 * wide viewport — so the handoff asks for element-based detection.
 * `ResizeObserver` is used rather than `@container` because jsdom implements
 * neither container queries nor layout, so a test can stand an observer in that
 * reports the width it wants and the mode is decided the way it is in a browser.
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
