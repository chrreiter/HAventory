import { css, html } from 'lit';
import { icon } from './icons';

/**
 * The chevron `.hv-select` draws over its select. It goes after the select in
 * the wrapper, because the disabled rule reaches it as the select's next sibling.
 */
export const selectChevron = () => html`<span class="chevron">${icon('chevronDown', 18)}</span>`;

/**
 * The field chrome the item editor and its child elements share: the trigger
 * button a picker opens from, the disabled and invalid states, the error line,
 * the in-flow holder a disclosure opens into and the wrapper that gives a
 * select the filter panel's chevron. Shadow roots do not pass styles on, so
 * each element lists this sheet beside `tokens` and `base`.
 *
 * The `:host([mobile])` rules expect the element to reflect a `mobile`
 * attribute, as the editor and every child it renders do.
 */
export const editorFields = css`
  label.hv-label {
    display: block;
  }
  .hv-label.muted {
    color: var(--hv-text-tertiary);
  }
  .field-button {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    background: var(--hv-surface);
    border: 1px solid var(--hv-input-border);
    border-radius: var(--hv-radius-input);
    padding: 9px 11px;
    font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
    color: var(--hv-text);
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  :host([mobile]) .hv-input,
  :host([mobile]) .field-button {
    min-height: 48px;
    font-size: var(--hv-input-font, 14.5px);
  }
  /* The browser's disabled colour is indistinguishable on a dark HA theme. */
  .hv-input:disabled {
    background: var(--hv-input-bg);
    border-color: var(--hv-divider);
    color: var(--hv-text-tertiary);
    -webkit-text-fill-color: var(--hv-text-tertiary);
    cursor: not-allowed;
  }
  /* The wrapper is the grid or flex item, so a placement rule goes on it and the
     select just fills it. The browser's own arrow is heavier than the drawn one. */
  .hv-select {
    position: relative;
    display: block;
    min-width: 0;
  }
  .hv-select select.hv-input {
    display: block;
    appearance: none;
    /* The chevron sits in this padding, so a long label ends before it: the
       trigger's 11px padding, the 18px icon and its 8px gap to the label. */
    padding-right: 37px;
    text-overflow: ellipsis;
  }
  /* Its right edge is a .field-button's: the 1px border plus the 11px padding,
     so the chevrons of neighbouring fields stand in one column. */
  .hv-select .chevron {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    color: var(--hv-text-secondary);
    pointer-events: none;
  }
  .hv-select select:disabled + .chevron {
    color: var(--hv-text-tertiary);
  }
  .field-button .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .field-button.empty .value {
    color: var(--hv-text-tertiary);
  }
  .invalid .hv-input,
  .invalid .field-button {
    border-color: var(--hv-error);
  }
  .field-error {
    font-size: var(--hv-editor-note);
    color: var(--hv-error);
  }
  /* In flow rather than overlaid, so a scroll cannot move them off their field. */
  .tree-holder,
  .list-holder {
    margin-top: 6px;
    border: 1px solid var(--hv-divider);
    border-radius: var(--hv-radius-input);
    background: var(--hv-surface);
    max-height: 220px;
    overflow: auto;
    padding: 4px 0;
  }
`;
