import { css } from 'lit';

/**
 * Design tokens. Each binds the HA theme variable first, with a fallback; those
 * with no HA equivalent carry a `light-dark()` pair, resolved by the
 * `color-scheme` the host publishes (`ui/theme.ts`), not by the OS preference.
 *
 * Usage: `static styles = [tokens, css\`...\`]`; it only declares `:host` properties.
 */
export const tokens = css`
  :host {
    /* Surfaces */
    --hv-surface: var(--card-background-color, var(--ha-card-background, light-dark(#fff, #1c1c1c)));
    --hv-surface-raised: light-dark(#f5f5f5, #232323);
    --hv-page: var(--primary-background-color, light-dark(#fafafa, #111));
    --hv-scrim: rgba(0, 0, 0, 0.5);

    /* Text */
    --hv-text: var(--primary-text-color, light-dark(#212121, #e1e1e1));
    --hv-text-secondary: var(--secondary-text-color, light-dark(#727272, #9b9b9b));
    --hv-text-tertiary: light-dark(#9e9e9e, #7d7d7d);
    --hv-text-on-primary: var(--text-primary-color, #fff);

    /* Lines */
    --hv-divider: var(--divider-color, light-dark(#e0e0e0, #383838));
    --hv-row-divider: light-dark(#ededed, #2e2e2e);

    /* Primary / accent */
    --hv-primary: var(--primary-color, #03a9f4);
    --hv-primary-dark: light-dark(#0288d1, #4fc3f7);
    --hv-primary-darker: light-dark(#0277bd, #4fc3f7);
    --hv-primary-tint: light-dark(#e3f4fd, rgba(3, 169, 244, 0.16));
    /* Ink on --hv-primary-tint: --hv-primary-darker reaches only 4.26:1 there. */
    --hv-on-primary-tint: light-dark(#01579b, #4fc3f7);
    --hv-primary-tint-border: light-dark(#a8d8f0, rgba(3, 169, 244, 0.5));
    --hv-row-hover: light-dark(#f5f9fd, rgba(255, 255, 255, 0.04));

    /* Warning / low stock */
    --hv-warn: light-dark(#b26b00, #ffb74d);
    --hv-warn-bg: light-dark(#fff4e0, rgba(255, 167, 38, 0.14));
    --hv-warn-deep: light-dark(#7a4d00, #ffb74d);
    --hv-amber: #ffa726;
    /* Ink on --hv-amber, one hue in both themes, so the ink is fixed too. */
    --hv-on-amber: #3b2600;

    /* Error */
    --hv-error: var(--error-color, light-dark(#c62828, #ef5350));
    --hv-error-bg: light-dark(#fdecea, rgba(198, 40, 40, 0.14));
    --hv-error-deep: light-dark(#8b1f1a, #ef9a9a);
    --hv-error-soft: light-dark(#c62828, #ef9a9a);

    /* Success */
    --hv-success: light-dark(#2e7d32, #81c784);

    /*
     * Status tones: five hues, light (tint with deep ink) and strong (a fixed
     * fill with fixed ink), all clearing 4.5:1. The blue is an indigo held off
     * --hv-primary and --hv-primary-tint, so a household's choice never reads
     * as one of chip.ts's fixed meanings; tone-contrast.test.ts pins the gap.
     */
    --hv-tone-neutral-bg: var(--hv-chip-bg);
    --hv-tone-neutral-fg: var(--hv-chip-text);
    --hv-tone-green-bg: light-dark(#e6f4ea, rgba(129, 199, 132, 0.16));
    --hv-tone-green-fg: light-dark(#1b5e20, #a5d6a7);
    --hv-tone-blue-bg: light-dark(#dde0f7, rgba(121, 134, 203, 0.26));
    --hv-tone-blue-fg: light-dark(#1a237e, #9fa8da);
    --hv-tone-amber-bg: var(--hv-warn-bg);
    --hv-tone-amber-fg: var(--hv-warn-deep);
    --hv-tone-red-bg: var(--hv-error-bg);
    --hv-tone-red-fg: var(--hv-error-deep);

    --hv-tone-neutral-strong-bg: #5f6b7a;
    --hv-tone-neutral-strong-fg: #fff;
    --hv-tone-green-strong-bg: #2e7d32;
    --hv-tone-green-strong-fg: #fff;
    --hv-tone-blue-strong-bg: #303f9f;
    --hv-tone-blue-strong-fg: #fff;
    --hv-tone-amber-strong-bg: var(--hv-amber);
    --hv-tone-amber-strong-fg: var(--hv-on-amber);
    --hv-tone-red-strong-bg: #c62828;
    --hv-tone-red-strong-fg: #fff;

    /*
     * The bulk bar's band: a dark strip in both themes, a mode rather than a
     * surface, so its ink is fixed. Its washes are mixed from the ink.
     */
    --hv-selection-bar: light-dark(#263238, #1b2429);
    --hv-on-selection-bar: #fff;
    /* Delete on the band, where --hv-error's deep half disappears. */
    --hv-on-selection-bar-danger: #ef9a9a;

    /* Inputs */
    --hv-input-bg: var(--input-fill-color, light-dark(#f5f5f5, #2b2b2b));
    --hv-input-border: light-dark(#cfd8dc, #4a4a4a);
    --hv-chip-bg: light-dark(#e7e7e7, #2b2b2b);
    --hv-chip-text: light-dark(#4a4a4a, #bdbdbd);

    /* Interaction */
    --hv-hover-overlay: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));

    /* Shape */
    --hv-radius-card: var(--ha-card-border-radius, 12px);
    --hv-radius-panel: 12px;
    --hv-radius-dialog: 14px;
    --hv-radius-input: 8px;
    --hv-radius-chip: 999px;
    --hv-chip-font-size: 11.5px;
    --hv-chip-padding: 2px 8px;
    --hv-radius-sheet: 20px;
    /* Roughly HA's own more-info dialog. */
    --hv-sheet-max-width: 640px;

    /* Elevation */
    --hv-shadow-menu: 0 8px 28px rgba(0, 0, 0, 0.22);
    --hv-shadow-dialog: 0 12px 40px rgba(0, 0, 0, 0.28);
    --hv-shadow-overlay: 0 8px 32px rgba(0, 0, 0, 0.18);
    --hv-shadow-sheet: light-dark(0 -8px 32px rgba(0, 0, 0, 0.3), 0 -8px 32px rgba(0, 0, 0, 0.5));

    /* Type */
    --hv-font: var(--ha-card-font-family, var(--paper-font-body1_-_font-family, Roboto, sans-serif));

    /* Motion — collapses to 0 under prefers-reduced-motion (see below). */
    --hv-motion-fast: 120ms;
    --hv-motion-panel: 180ms;
    --hv-motion-sheet: 240ms;
    --hv-ease-out: cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --hv-motion-fast: 0ms;
      --hv-motion-panel: 0ms;
      --hv-motion-sheet: 0ms;
    }
  }
`;

/**
 * Shared primitives: pill, text and icon buttons, inputs, labels, focus ring.
 * `--hv-tap-min` and `--hv-input-font` are deliberately not in `tokens`, whose
 * per-`:host` redeclaration would stop one value on the card host inheriting
 * into every nested component.
 */
export const base = css`
  :host {
    font-family: var(--hv-font);
    color: var(--hv-text);
  }

  button {
    font-family: inherit;
    cursor: pointer;
  }

  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid var(--hv-primary);
    outline-offset: -1px;
  }

  .hv-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: var(--hv-tap-min, auto);
    border-radius: var(--hv-radius-chip);
    border: none;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 500;
    background: var(--hv-primary);
    color: var(--hv-text-on-primary);
  }
  .hv-pill:hover {
    opacity: 0.9;
  }
  .hv-pill[disabled] {
    opacity: 0.5;
    cursor: default;
  }

  .hv-pill.outline {
    background: transparent;
    color: var(--hv-primary-darker);
    border: 1px solid var(--hv-divider);
    font-weight: 500;
  }
  .hv-pill.outline:hover {
    background: var(--hv-hover-overlay);
    opacity: 1;
  }

  .hv-pill.danger {
    background: var(--hv-error);
  }

  /* A phone's committing action: a thumb target. */
  .hv-pill.large {
    min-height: 48px;
    padding: 0 20px;
    font-size: 14.5px;
  }

  .hv-text-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--hv-tap-min, auto);
    background: none;
    border: none;
    color: var(--hv-primary-dark);
    font: 500 13px var(--hv-font);
    padding: 8px 12px;
    border-radius: var(--hv-radius-input);
  }
  .hv-text-button:hover {
    background: var(--hv-hover-overlay);
  }
  .hv-text-button.danger {
    color: var(--hv-error-soft);
  }

  .hv-icon-button {
    display: inline-grid;
    place-items: center;
    width: var(--hv-tap-min, 34px);
    height: var(--hv-tap-min, 34px);
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--hv-text-secondary);
    padding: 0;
    flex: none;
  }
  .hv-icon-button:hover {
    background: var(--hv-hover-overlay);
  }
  .hv-icon-button[disabled] {
    opacity: 0.4;
    cursor: default;
  }

  .hv-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--hv-text-secondary);
  }

  .hv-input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    background: var(--hv-surface);
    color: var(--hv-text);
    border: 1px solid var(--hv-input-border);
    border-radius: var(--hv-radius-input);
    padding: 9px 11px;
    font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
  }
  .hv-input:focus {
    border-color: var(--hv-primary);
    outline: none;
  }

  /* A facet's count, dimmed by opacity so it keeps the ink around it, a status tone included. */
  .hv-tally {
    flex: none;
    font-size: 11.5px;
    opacity: 0.65;
  }

  .hv-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
`;
