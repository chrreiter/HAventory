import { css } from 'lit';

/**
 * The field chrome the item editor and its child elements share: the trigger
 * button a picker opens from, the disabled and invalid states, the error line
 * and the in-flow holder a disclosure opens into. Shadow roots do not pass
 * styles on, so each element lists this sheet beside `tokens` and `base`.
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
