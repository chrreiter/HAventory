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
 * Drives the card's mobile/desktop mode from its own rendered width.
 *
 * Media queries are unreliable inside HA dashboards — a card can be narrow in a
 * wide viewport — so the handoff asks for element-based detection. `ResizeObserver`
 * is used rather than `@container` because jsdom implements neither container
 * queries nor layout, and this way tests can drive the mode deterministically via
 * `setWidth()`, or pin it with `setForced()`.
 */
export class ResponsiveController implements ReactiveController {
  private readonly host: ReactiveControllerHost & Element;
  private readonly breakpoint: number;
  private observer?: ResizeObserver;
  private width = 0;
  private forced: boolean | null = null;

  constructor(host: ReactiveControllerHost & Element, breakpoint: number = MOBILE_BREAKPOINT) {
    this.host = host;
    this.breakpoint = breakpoint;
    host.addController(this);
  }

  /** True when the card should render its mobile layout. */
  get mobile(): boolean {
    if (this.forced !== null) return this.forced;
    return this.width > 0 && this.width <= this.breakpoint;
  }

  /**
   * Pin the mode regardless of measured width; `null` restores measurement.
   * `hv-card-shell` feeds this from its own `forceMobile` property, so a test
   * can pin either layout.
   */
  setForced(value: boolean | null): void {
    if (this.forced === value) return;
    this.forced = value;
    this.host.requestUpdate();
  }

  /** Feed a measured width in. Called by the observer, and directly by tests. */
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
