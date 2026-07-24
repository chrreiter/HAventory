import { css } from 'lit';

/**
 * Design tokens for the revamped card (WP4.1).
 *
 * Every token binds to the Home Assistant theme variable first and falls back to
 * the hex used in the design mocks, so user themes keep working. Tokens that have
 * no HA equivalent (tints, hover washes, warning surfaces) get a light value here
 * and a dark value under `prefers-color-scheme: dark` — HA's own surface variables
 * track the active theme, and these accents track the OS/theme preference alongside
 * them.
 *
 * Usage: `static styles = [tokens, css\`...\`]` in every revamped component. The
 * fragment only declares custom properties on `:host`, so it is safe to compose.
 */
export const tokens = css`
  :host {
    /* Surfaces */
    --hv-surface: var(--card-background-color, var(--ha-card-background, #fff));
    --hv-surface-raised: #f5f5f5;
    --hv-page: var(--primary-background-color, #fafafa);
    --hv-scrim: rgba(0, 0, 0, 0.5);

    /* Text */
    --hv-text: var(--primary-text-color, #212121);
    --hv-text-secondary: var(--secondary-text-color, #727272);
    --hv-text-tertiary: #9e9e9e;
    --hv-text-on-primary: var(--text-primary-color, #fff);

    /* Lines */
    --hv-divider: var(--divider-color, #e0e0e0);
    --hv-row-divider: #ededed;

    /* Primary / accent */
    --hv-primary: var(--primary-color, #03a9f4);
    --hv-primary-dark: #0288d1;
    --hv-primary-darker: #0277bd;
    --hv-primary-tint: #e3f4fd;
    --hv-primary-tint-border: #a8d8f0;
    --hv-row-hover: #f5f9fd;

    /* Warning / low stock */
    --hv-warn: #b26b00;
    --hv-warn-bg: #fff4e0;
    --hv-warn-deep: #7a4d00;
    --hv-warn-border: #e0c98f;
    --hv-amber: #ffa726;

    /* Error */
    --hv-error: var(--error-color, #c62828);
    --hv-error-bg: #fdecea;
    --hv-error-deep: #8b1f1a;
    --hv-error-border: #e6a9a4;
    --hv-error-soft: #c62828;

    /* Success */
    --hv-success: #2e7d32;

    /* Inputs */
    --hv-input-bg: var(--input-fill-color, #f5f5f5);
    --hv-input-border: #cfd8dc;
    --hv-chip-bg: #e7e7e7;
    --hv-chip-text: #4a4a4a;

    /* Interaction */
    --hv-hover-overlay: rgba(0, 0, 0, 0.06);

    /* Shape */
    --hv-radius-card: var(--ha-card-border-radius, 12px);
    --hv-radius-panel: 12px;
    --hv-radius-dialog: 14px;
    --hv-radius-input: 8px;
    --hv-radius-chip: 999px;
    --hv-radius-sheet: 20px;

    /* Elevation */
    --hv-shadow-menu: 0 8px 28px rgba(0, 0, 0, 0.22);
    --hv-shadow-dialog: 0 12px 40px rgba(0, 0, 0, 0.28);
    --hv-shadow-overlay: 0 8px 32px rgba(0, 0, 0, 0.18);
    --hv-shadow-sheet: 0 -8px 32px rgba(0, 0, 0, 0.3);

    /* Type */
    --hv-font: var(--ha-card-font-family, var(--paper-font-body1_-_font-family, Roboto, sans-serif));

    /* Motion — collapses to 0 under prefers-reduced-motion (see below). */
    --hv-motion-fast: 120ms;
    --hv-motion-panel: 180ms;
    --hv-motion-sheet: 240ms;
    --hv-ease-out: cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --hv-surface: var(--card-background-color, var(--ha-card-background, #1c1c1c));
      --hv-surface-raised: #232323;
      --hv-page: var(--primary-background-color, #111);

      --hv-text: var(--primary-text-color, #e1e1e1);
      --hv-text-secondary: var(--secondary-text-color, #9b9b9b);
      --hv-text-tertiary: #7d7d7d;

      --hv-divider: var(--divider-color, #383838);
      --hv-row-divider: #2e2e2e;

      --hv-primary-dark: #4fc3f7;
      --hv-primary-darker: #4fc3f7;
      --hv-primary-tint: rgba(3, 169, 244, 0.16);
      --hv-primary-tint-border: rgba(3, 169, 244, 0.5);
      --hv-row-hover: rgba(255, 255, 255, 0.04);

      --hv-warn: #ffb74d;
      --hv-warn-bg: rgba(255, 167, 38, 0.14);
      --hv-warn-deep: #ffb74d;
      --hv-warn-border: rgba(255, 167, 38, 0.4);

      --hv-error: var(--error-color, #ef5350);
      --hv-error-bg: rgba(198, 40, 40, 0.14);
      --hv-error-deep: #ef9a9a;
      --hv-error-border: rgba(239, 83, 80, 0.7);
      --hv-error-soft: #ef9a9a;

      --hv-success: #81c784;

      --hv-input-bg: var(--input-fill-color, #2b2b2b);
      --hv-input-border: #4a4a4a;
      --hv-chip-bg: #2b2b2b;
      --hv-chip-text: #bdbdbd;

      --hv-hover-overlay: rgba(255, 255, 255, 0.08);
      --hv-shadow-sheet: 0 -8px 32px rgba(0, 0, 0, 0.5);
    }
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
 * Shared primitives every revamped surface reuses: pill buttons, icon buttons,
 * chips, inputs, section labels and the focus ring. Kept separate from `tokens`
 * so a component can take the variables without the opinionated element styles.
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
    gap: 6px;
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

  .hv-text-button {
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
    width: 34px;
    height: 34px;
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
    font: 400 13.5px var(--hv-font);
  }
  .hv-input:focus {
    border-color: var(--hv-primary);
    outline: none;
  }

  .hv-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: var(--hv-radius-chip);
    border: 1px solid var(--hv-divider);
    background: transparent;
    color: var(--hv-chip-text);
    padding: 4px 11px;
    font-size: 12.5px;
  }
  .hv-chip.selected {
    color: var(--hv-primary-darker);
    background: var(--hv-primary-tint);
    border-color: var(--hv-primary);
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
