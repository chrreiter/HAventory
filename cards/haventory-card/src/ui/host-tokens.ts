import { css } from 'lit';

/**
 * The tokens a host's placeholder paints with, declared once for it and for
 * `tokens`, so the placeholder and the tree that replaces it bind the same
 * surface, ink, line, accent, ink on the accent, corner and type.
 *
 * A host imports this, so it is in the eager core that every Home Assistant page
 * loads; it holds only what a placeholder draws.
 */
export const hostTokens = css`
  :host {
    --hv-surface: var(--card-background-color, var(--ha-card-background, light-dark(#fff, #1c1c1c)));
    --hv-text: var(--primary-text-color, light-dark(#212121, #e1e1e1));
    --hv-divider: var(--divider-color, light-dark(#e0e0e0, #383838));
    --hv-primary: var(--primary-color, #03a9f4);
    --hv-text-on-primary: var(--text-primary-color, #fff);
    --hv-radius-card: var(--ha-card-border-radius, 12px);
    --hv-font: var(--ha-card-font-family, var(--paper-font-body1_-_font-family, Roboto, sans-serif));
  }
`;
