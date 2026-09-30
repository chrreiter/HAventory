import { css } from 'lit';

/**
 * A row you browse by: a location in `hv-location-tree`, or a status, category
 * or tag in the full view's sidebar. One control drawn in two shadow roots, so
 * its metrics live here. The 20px leading slot (twisty or check) is always
 * reserved, so every name starts at the same x, and it sets the row's height.
 *
 * Usage: `static styles = [tokens, base, browseRow, css\`...\`]`, with
 * `hv-browse-row` on the row, `hv-browse-row-lead` on its first child and
 * `hv-browse-row-label` on the name.
 */
export const browseRow = css`
  .hv-browse-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
    border: none;
    background: none;
    text-align: left;
    font: 400 13.5px var(--hv-font);
    color: var(--hv-text);
    /* Only the organize dialog declares this, to match its other tabs' rows. */
    padding: var(--hv-organize-row-pad, 7px) 12px;
    border-radius: var(--hv-radius-input);
  }
  .hv-browse-row:hover {
    background: var(--hv-hover-overlay);
  }
  /* The rail still reads when a user theme repaints the tint. */
  .hv-browse-row.selected {
    background: var(--hv-primary-tint);
    color: var(--hv-on-primary-tint);
    font-weight: 500;
    box-shadow: inset -3px 0 0 0 var(--hv-primary);
  }
  .hv-browse-row-lead {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
  }
  .hv-browse-row-lead.placeholder {
    visibility: hidden;
  }
  /* One line each, elided, so the column reads as a run of rows. */
  .hv-browse-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
