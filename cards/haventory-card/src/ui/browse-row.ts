import { css } from 'lit';

/**
 * A row you browse by: one location in `hv-location-tree`, one status,
 * category or tag in the full view's sidebar.
 *
 * Pressing either narrows the table to that value, and the two lists sit one
 * under the other in the same column — so they are one control drawn in two
 * shadow roots, which cannot share a rule and had drifted 4px of height and
 * 22px of label inset apart. The metrics live here instead of being written
 * out on each side.
 *
 * The leading slot is what holds the inset together. The tree puts its twisty
 * in it and reserves it on a leaf; a facet row puts its check in it and
 * reserves it while nothing is picked. A name therefore starts at the same x
 * whatever the row can do and whichever state it is in: 12px of padding, a
 * 20px slot and the 6px gap — where the tree's own top-level entries (All
 * items, No location, an area band) have always started. A nested location
 * indents from there, which is the one difference that means something.
 *
 * That slot is also the row's height, so there is no number here to keep in
 * step with it.
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
    /* The organize dialog declares this property, so the tree it hosts keeps
       the same vertical rhythm as the value rows on its other three tabs.
       Nothing else declares it, so every other host takes the fallback. */
    padding: var(--hv-organize-row-pad, 7px) 12px;
    border-radius: var(--hv-radius-input);
  }
  .hv-browse-row:hover {
    background: var(--hv-hover-overlay);
  }
  /* Picked. The rail on the closing edge is what still reads when a user theme
     repaints the tint out from under the fill. */
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
  /* Held open rather than removed: a row with nothing to put in the slot still
     starts its name where the rows around it do. */
  .hv-browse-row-lead.placeholder {
    visibility: hidden;
  }
  /* One line each, elided. A value long enough to wrap would break the run of
     rows the column is read down. */
  .hv-browse-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
