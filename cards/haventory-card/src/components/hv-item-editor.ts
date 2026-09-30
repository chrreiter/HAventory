import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { areaMarkName, locationPathParts, pathTitle, renderAreaChip } from '../ui/location-path';
import { icon } from '../ui/icons';
import { DEFAULT_CUSTOM_DAYS, formatDate, isOverdue, relativeTime } from '../ui/relative-time';
import { dayOffsets, renderDayOffsets } from '../ui/day-offsets';
import { onDayChange } from '../ui/day-clock';
import { saveShortcutLabel } from '../ui/keyboard';
import { counted } from '../ui/plural';
import type { ConfirmDiscard } from '../ui/discard';
import { CopyFlash, idRow } from '../ui/clipboard';
import { ViewportNarrow } from '../ui/responsive';
import { focusStranded } from '../ui/dialog-focus';
import { LocationPicker } from '../ui/location-picker';
import {
  REMINDER_UNITS,
  customFieldsFrom,
  formFromItem,
  isDirty,
  newCustomFieldRow,
  toCreatePayload,
  toUpdatePayload,
  validateForm,
} from '../ui/item-form';
import type { CustomFieldRow, CustomFieldType, FieldError, ItemFormModel } from '../ui/item-form';
import { statusLabel, statusList } from '../ui/status';
import {
  MEDIA_VARIANT_THUMB,
  MediaUrls,
  attachmentNameToken,
  attachmentTitle,
  formatBytes,
  manuals,
  pictureAlt,
  pictures,
} from '../ui/media';
import { prepareForUpload } from '../ui/downscale';
import { docIcon, renderDocumentRow, renderLightboxHost, renderPhotoFigure } from '../ui/attachments';
import type { MediaBindings } from '../ui/media';
import type {
  AreaRef,
  AttachmentKind,
  Item,
  ItemStatus,
  Location,
  LocationTreeNode,
  MediaConfig,
  ReminderUnit,
  StatusDefinition,
} from '../store/types';
import './hv-chip-input';
import './hv-confirm';
import './hv-checkout-popover';

const customFieldTypes = (): { value: CustomFieldType; label: string }[] => [
  { value: 'string', label: t('hv.editor.type.string') },
  { value: 'number', label: t('hv.editor.type.number') },
  { value: 'boolean', label: t('hv.editor.type.boolean') },
  { value: 'date', label: t('hv.editor.type.date') },
];

/** The two disclosures' holders, named so `aria-controls` can point at them while closed. */
const LOCATION_TREE_ID = 'editor-location-tree-holder';
const CATEGORY_LIST_ID = 'editor-category-list';

/**
 * One file the picker is working through. A failed entry keeps the `File` so
 * Retry sends exactly what was picked, even a photo never written to disk.
 */
interface UploadEntry {
  id: string;
  name: string;
  state: 'queued' | 'preparing' | 'uploading' | 'error';
  message: string | null;
  file: File | null;
  kind: AttachmentKind;
}

/** How each kind of attachment names itself in a confirmation. */
const removeCopy = (kind: AttachmentKind): { heading: string; message: string } =>
  kind === 'manual'
    ? {
        heading: t('hv.editor.removeDocument.heading'),
        message: t('hv.editor.removeDocument.message'),
      }
    : {
        heading: t('hv.editor.removePhoto.heading'),
        message: t('hv.editor.removePhoto.message'),
      };

/** The message on a rejected command, whatever shape the rejection arrived in. */
function errorText(err: unknown, fallback = t('hv.editor.upload.failed')): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/**
 * The one edit surface: the inline expander, the full view and the mobile
 * sheet. Every editable field lives here, and the location tree opens inside
 * the form so picking one never stacks a second modal. Mobile stacks the same
 * set into one column.
 */
@customElement('hv-item-editor')
export class HVItemEditor extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    dayOffsets,
    docIcon,
    idRow,
    css`
      :host {
        display: block;
        /* The one size of this form's small print: hints, sizes, errors, the
           upload queue. */
        --hv-editor-note: 12px;
        background: var(--hv-row-hover);
        border-left: 3px solid var(--hv-primary);
      }
      :host([mobile]) {
        background: transparent;
        border-left: none;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px 4px;
      }
      .head .name {
        font-size: 15px;
        font-weight: 500;
        color: var(--hv-primary-darker);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .head .meta {
        margin-left: auto;
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
        white-space: nowrap;
      }
      /* Name takes what is left; the two numbers take what a number needs. */
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 140px 160px;
        gap: 12px;
        padding: 8px 18px 14px;
      }
      :host([mobile]) .grid {
        grid-template-columns: 1fr;
        gap: 14px;
        padding: 14px 16px;
      }
      .cell.span2 {
        grid-column: span 2;
      }
      .cell.span3 {
        grid-column: span 3;
      }
      :host([mobile]) .cell.span2,
      :host([mobile]) .cell.span3 {
        grid-column: span 1;
      }
      /* Packed to the top: a stretched cell beside the textarea would share the
         surplus between its label and control. */
      .cell {
        display: grid;
        align-content: start;
        gap: 4px;
        min-width: 0;
      }
      /* Check-out with its due date, and the unrelated inspection date, as two
         boxes of equal height so they read as two things, not three peers. */
      .state {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
      }
      :host([mobile]) .state {
        grid-template-columns: 1fr;
      }
      /* Three controls, so the reminder takes the whole row. */
      .state .reminder {
        grid-column: 1 / -1;
      }
      .repeat {
        display: grid;
        grid-template-columns: auto minmax(0, 4.5rem) minmax(0, 7rem);
        align-items: center;
        gap: 8px;
      }
      :host([mobile]) .repeat {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      :host([mobile]) .repeat > label {
        grid-column: 1 / -1;
      }
      /* Packed to the top, as .cell, inside a box stretched to its neighbour. */
      .group {
        display: grid;
        align-content: start;
        gap: 9px;
        min-width: 0;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px 11px;
      }
      .group-caption {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .group-caption .hv-icon {
        flex: none;
        opacity: 0.8;
      }
      .group-body {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      /* The date and its clear button on one line, no taller than the input. */
      .inspection-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) var(--hv-tap-min, 34px);
        align-items: center;
        gap: 8px;
      }
      /* Shut, it would still take a grid row and a gap. */
      hv-checkout-popover:not([open]) {
        display: none;
      }
      /* The button and the due date share a row by construction: the label row
         leaves column 1 empty because the button has no label. */
      .checkout-body {
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          '. label'
          'action field'
          'hint hint';
        gap: 4px 12px;
      }
      .due-label {
        grid-area: label;
      }
      .due-input {
        grid-area: field;
      }
      .checkout-body .group-hint {
        grid-area: hint;
      }
      .hv-label.muted {
        color: var(--hv-text-tertiary);
      }
      .checkout-action {
        grid-area: action;
        justify-content: center;
        gap: 7px;
        min-height: var(--hv-tap-min, auto);
        font-weight: 500;
        cursor: pointer;
      }
      .checkout-action:hover {
        background: var(--hv-row-hover);
      }
      .checkout-action .hv-icon {
        flex: none;
        opacity: 0.85;
      }
      .group-hint {
        font-size: var(--hv-editor-note);
        line-height: 1.4;
        color: var(--hv-text-tertiary);
      }
      :host([mobile]) .offset {
        min-height: var(--hv-tap-min, auto);
        padding: 0 15px;
        font-size: 13.5px;
      }
      :host([mobile]) .day-box input {
        min-height: 44px;
        width: 88px;
        font-size: var(--hv-input-font, 14.5px);
      }
      /* A native date input clips its placeholder below ~140px, so a phone stacks. */
      :host([mobile]) .checkout-body {
        grid-template-columns: 1fr;
        grid-template-areas:
          'action'
          'label'
          'field'
          'hint';
      }
      :host([mobile]) .checkout-action {
        margin-bottom: 8px;
      }
      label.hv-label {
        display: block;
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
      textarea.hv-input {
        min-height: 44px;
        line-height: 1.5;
        resize: vertical;
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
      .combo {
        position: relative;
        display: flex;
        align-items: center;
      }
      .combo .hv-input {
        padding-right: 34px;
      }
      .combo-arrow {
        position: absolute;
        right: 4px;
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .combo-arrow:hover {
        background: var(--hv-hover-overlay);
      }
      :host([mobile]) .combo-arrow {
        right: 2px;
        width: var(--hv-tap-min, 32px);
        height: var(--hv-tap-min, 32px);
      }
      .option {
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
        padding: 7px 12px;
        border-radius: var(--hv-radius-input);
      }
      .option .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option:hover,
      .option.active {
        background: var(--hv-hover-overlay);
      }
      .option.selected {
        background: var(--hv-primary-tint);
        color: var(--hv-on-primary-tint);
        font-weight: 500;
      }
      .option.active {
        box-shadow: inset 0 0 0 1px var(--hv-primary);
      }
      .option-empty {
        padding: 8px 12px;
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 9px 0;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .switch {
        width: 34px;
        height: 18px;
        border-radius: 999px;
        background: var(--hv-divider);
        position: relative;
        flex: none;
        transition: background var(--hv-motion-fast) ease-out;
      }
      .switch.on {
        background: var(--hv-primary);
      }
      .switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform var(--hv-motion-fast) ease-out;
      }
      .switch.on::after {
        transform: translateX(16px);
      }
      .custom {
        border-top: 1px solid var(--hv-divider);
        padding-top: 12px;
        display: grid;
        gap: 8px;
        /* Rows size from their own room: the mobile flag describes the card. */
        container-type: inline-size;
      }
      .custom-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .custom-head .hv-tally {
        margin-left: auto;
      }
      .cf-row {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) 110px minmax(0, 1.6fr) var(--hv-tap-min, 34px);
        gap: 8px;
        align-items: center;
      }
      /* No named area: it auto-places into the row below whatever came before. */
      .cf-row .field-error {
        grid-column: 1 / -1;
      }
      /* Too tight: the value drops under its key and remove spans both rows. */
      @container (max-width: 520px) {
        .cf-row {
          grid-template-columns: minmax(0, 1fr) 104px var(--hv-tap-min, 34px);
          grid-template-areas:
            'key type remove'
            'value value remove';
        }
        .cf-row .cf-key {
          grid-area: key;
        }
        .cf-row .cf-type {
          grid-area: type;
        }
        .cf-row .cf-value {
          grid-area: value;
        }
        .cf-row .cf-remove {
          grid-area: remove;
        }
      }
      .cf-remove {
        display: inline-grid;
        place-items: center;
        width: var(--hv-tap-min, 30px);
        height: var(--hv-tap-min, 30px);
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .cf-remove:hover {
        background: var(--hv-hover-overlay);
      }
      .cf-add {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--hv-tap-min, auto);
        border: 1px dashed var(--hv-primary-tint-border);
        background: none;
        color: var(--hv-primary-dark);
        border-radius: var(--hv-radius-input);
        padding: 8px 13px;
        font: 500 12.5px var(--hv-font);
      }
      /* A note inside a label steps out of its uppercase treatment. */
      .label-note {
        text-transform: none;
        letter-spacing: 0;
        font-weight: 400;
        color: var(--hv-text-tertiary);
      }
      .key-hints {
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
      .key-hints button {
        border: none;
        background: none;
        padding: 0 2px;
        font: inherit;
        color: var(--hv-primary-dark);
      }
      :host([mobile]) .key-hints button {
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
        padding: 0 8px;
      }
      /* A phone shows the bare "Delete" verb so the three buttons fit at 375px;
         wrap is the last resort. */
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 4px;
        flex-wrap: wrap;
      }
      /* The actions stay pinned at the bottom of whatever scroller hosts the
         form. Sticky goes on the cell, whose containing block is the tall grid;
         the negative margins bleed the bar over .grid's side padding. */
      .actions-cell {
        position: sticky;
        bottom: -14px;
        z-index: 1;
        background: var(--hv-surface);
        margin: 0 -18px;
        padding: 10px 18px 14px;
        border-top: 1px solid var(--hv-row-divider);
      }
      :host([mobile]) .actions-cell {
        margin: 0 -16px;
        padding: 10px 16px 14px;
      }
      /* On a spacer, not the hint, which a phone drops. */
      .actions .spacer {
        margin-left: auto;
      }
      .actions .hint {
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
      /* Whether there is a keyboard is a pointer question, not a width one. */
      @media (hover: none), (pointer: coarse) {
        .actions .hint {
          display: none;
        }
      }
      .save {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--hv-tap-min, auto);
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 8px 20px;
        font: 500 13px var(--hv-font);
      }
      .save[disabled] {
        opacity: 0.5;
      }
      .banner {
        margin: 0 18px;
        padding: 9px 12px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
        font-size: var(--hv-editor-note);
      }
      .photos {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .photos figure {
        position: relative;
        margin: 0;
        width: 72px;
        border-radius: 8px;
        overflow: hidden;
        background: var(--hv-surface-raised);
      }
      .photos .open {
        display: block;
        padding: 0;
        border: none;
        background: none;
      }
      .photos img {
        width: 72px;
        height: 72px;
        object-fit: cover;
        display: block;
      }
      .photos .placeholder {
        display: grid;
        place-items: center;
        width: 72px;
        height: 72px;
        color: var(--hv-text-tertiary);
      }
      /* A picture whose file is gone keeps its box so the strip does not reflow. */
      .photos .placeholder.missing {
        gap: 4px;
        box-sizing: border-box;
        border: 1px dashed var(--hv-input-border);
        border-radius: 8px;
      }
      /* Smaller than the card's chip, which a 72px tile would clip. */
      .photos .placeholder.missing .hv-chip {
        max-width: 100%;
        padding: 1px 5px;
        font-size: 10px;
        line-height: 1.2;
        white-space: normal;
        text-align: center;
      }
      /* Under the thumbnail, since no overlay is legible on every photo. Three
         share the tile's width, so a finger gets height rather than 44px squares. */
      .tile-controls {
        display: flex;
        align-items: stretch;
        justify-content: space-between;
        height: 24px;
        background: var(--hv-surface-raised);
      }
      :host([mobile]) .tile-controls {
        height: var(--hv-tap-min, 24px);
      }
      .tile-controls button,
      .tile-controls .is-cover {
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        background: none;
        color: var(--hv-text-secondary);
      }
      :host([mobile]) .tile-controls button,
      :host([mobile]) .tile-controls .is-cover {
        height: auto;
      }
      .tile-controls button[disabled] {
        opacity: 0.3;
      }
      .tile-controls .is-cover {
        color: var(--hv-amber);
      }
      /* WCAG's 24px floor is also the most a control on a 72px thumbnail can
         take; the confirm step behind it makes the small target safe. */
      .photos .remove {
        position: absolute;
        top: 2px;
        right: 2px;
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: 50%;
        /* Fixed dark chip: it sits on an arbitrary photo in either theme. */
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
      }
      .photos .picker {
        display: grid;
        place-items: center;
        gap: 2px;
        width: 72px;
        height: 72px;
        border: 1px dashed var(--hv-input-border);
        border-radius: 8px;
        color: var(--hv-text-secondary);
        font-size: 11px;
        text-align: center;
        cursor: pointer;
      }
      /* Hidden but focusable; display: none would leave the tab order. */
      .reveal {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      .documents {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      /* Outline, so nothing inside shifts as a drag crosses in. */
      .photos.dropping,
      .documents.dropping {
        outline: 2px dashed var(--hv-primary);
        outline-offset: 4px;
        border-radius: var(--hv-radius-input);
      }
      .documents li {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .documents .doc-title {
        flex: 1;
        min-width: 0;
      }
      .documents .doc-size {
        flex: none;
        font-size: var(--hv-editor-note);
        color: var(--hv-text-secondary);
      }
      .documents .doc-open,
      .documents .doc-remove {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: none;
        background: none;
        border-radius: 50%;
        color: var(--hv-text-secondary);
      }
      .doc-picker {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: start;
        margin-top: 6px;
        min-height: 36px;
        padding: 0 12px;
        border: 1px dashed var(--hv-input-border);
        border-radius: var(--hv-radius-chip);
        color: var(--hv-text-secondary);
        font-size: var(--hv-editor-note);
        cursor: pointer;
      }
      .upload-list {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        display: grid;
        gap: 5px;
        font-size: var(--hv-editor-note);
        color: var(--hv-text-secondary);
      }
      .upload-list li {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px 8px;
      }
      .upload-list li .kind {
        flex: none;
        display: inline-grid;
        place-items: center;
        color: var(--hv-text-tertiary);
      }
      .upload-list li .file {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 45%;
      }
      .upload-list li.failed .state {
        color: var(--hv-error);
      }
      .upload-list li .retry,
      .upload-list li .dismiss {
        display: inline-grid;
        place-items: center;
        margin-left: auto;
        min-width: var(--hv-tap-min, 24px);
        min-height: var(--hv-tap-min, 24px);
        border: none;
        background: none;
        padding: 0 4px;
        color: var(--hv-primary-dark);
        font: 500 var(--hv-editor-note) var(--hv-font);
        cursor: pointer;
      }
      .upload-list li .dismiss {
        color: var(--hv-text-secondary);
      }
      /* Retry already claimed the free space; the dismiss follows it. */
      .upload-list li .retry ~ .dismiss {
        margin-left: 0;
      }
      /* Indeterminate: nothing on the WebSocket path reports bytes sent. */
      .progress {
        flex: 0 0 100%;
        position: relative;
        overflow: hidden;
        height: 3px;
        border-radius: 999px;
        background: var(--hv-divider);
      }
      .progress .fill {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 40%;
        border-radius: inherit;
        background: var(--hv-primary);
      }
      @media (prefers-reduced-motion: no-preference) {
        .progress .fill {
          animation: hv-upload-sweep 1.3s ease-in-out infinite;
        }
      }
      @keyframes hv-upload-sweep {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(250%);
        }
      }
      .attach-hint {
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
    `,
  ];

  /** null means "add item" — the same expander, empty. */
  @property({ attribute: false }) item: Item | null = null;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  /** HA areas, so the location picker files its roots under the right one. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  @property({ attribute: false }) categorySuggestions: string[] = [];
  @property({ attribute: false }) tagSuggestions: string[] = [];
  @property({ attribute: false }) customFieldKeys: string[] = [];
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ type: Boolean }) busy = false;
  /** Server-side failure to show above the actions. */
  @property({ type: String }) errorMessage: string | null = null;
  /** Hide the header row when the host already provides one (the mobile sheet). */
  @property({ type: Boolean }) noHeader = false;
  /** The status vocabulary from `haventory/config`; the built-ins stand in until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  /** Attachment access; null hides the attachment sections entirely. */
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** Caps and accepted types, so a doomed file is refused before it is sent. */
  @property({ attribute: false }) mediaConfig: MediaConfig | null = null;
  /** Creates a location from inside the picker, for a first run; null offers no create. */
  @property({ attribute: false }) createLocation: ((name: string) => Promise<Location>) | null =
    null;

  /**
   * How this form asks before its Cancel, ✕ or Escape throws typing away. The
   * host owns the dialog, so every way out asks one question; null closes quietly.
   */
  @property({ attribute: false }) confirmDiscard: ConfirmDiscard | null = null;

  @state() private _model: ItemFormModel = formFromItem(null);
  @state() private _errors: FieldError[] = [];
  @state() private _showErrors = false;
  @state() private _categoryOpen = false;
  /** Opened from the arrow: list everything, ignoring what is already typed. */
  @state() private _categoryShowAll = false;
  /** Keyboard cursor into the visible category options; -1 = nothing active. */
  @state() private _categoryIndex = -1;
  /** The check-out dialog, and the button it hangs from on a wide screen. */
  @state() private _checkoutOpen = false;
  @state() private _checkoutAnchor: DOMRect | null = null;
  /** The inspection field's "+X days" row is showing, and owns the date. */
  @state() private _inspectionCustomOpen = false;
  @state() private _inspectionCustomDays = DEFAULT_CUSTOM_DAYS;
  /** Files the picker is working through; a failed one stays until retried or dismissed. */
  @state() private _uploads: UploadEntry[] = [];
  /** The item as an upload left it, until `item` catches up; saves use its version. */
  @state() private _uploaded: Item | null = null;
  /** The attachment awaiting a yes, and what kind it is. */
  @state() private _confirmRemove: { id: string; kind: AttachmentKind } | null = null;
  /** Which attachment section a drag is currently over, for the over-state. */
  @state() private _dropTarget: AttachmentKind | null = null;
  /** Which photo the lightbox was opened on, or null when it is closed. */
  @state() private _lightbox: number | null = null;
  /** Why creating a first location from the picker failed. */
  @state() private _locationError: string | null = null;
  /** Locations this form created, until the `locations` prop carries them. */
  @state() private _createdLocations: Location[] = [];

  private readonly _urls = new MediaUrls(this);
  /** The "Copied" label on the id row's button. */
  private readonly _copyFlash = new CopyFlash(this);
  /** Window width, for the two dialogs this form raises over itself. */
  private readonly _viewport = new ViewportNarrow(this);
  /** The location field: one location, so a pick finishes the job. */
  private readonly _location = new LocationPicker(this);
  private _uploadSeq = 0;
  /** The item id `_model` was built from: `undefined` before the first update, `null` to create. */
  private _formItemId: string | null | undefined;
  /**
   * The item as the form was filled from it, which a save diffs against: `item`
   * may already carry another member's edit, which must stay out of the payload.
   */
  private _formItem: Item | null = null;

  /** The item to save against: whatever the last upload returned, else the input. */
  private get _current(): Item | null {
    return this._uploaded ?? this.item;
  }

  /** Focus inside the form so its Escape handler hears the key. */
  protected firstUpdated() {
    this.renderRoot.querySelector<HTMLInputElement>('[data-testid="editor-name"]')?.focus();
  }

  /**
   * The form belongs to an item id, not to one `item` object: hosts re-bind
   * `.item` on every store broadcast, and rebuilding on that would throw away
   * the typing. A different id (including a create's null→id hop) is a new form.
   */
  protected willUpdate() {
    this._urls.configure(this.media?.sign ?? null);
    const id = this.item?.id ?? null;
    if (id !== this._formItemId) {
      this._formItemId = id;
      this._formItem = this.item ?? null;
      this._model = formFromItem(this.item);
      this._errors = [];
      this._showErrors = false;
      this._location.close();
      this._checkoutOpen = false;
      this._uploads = [];
      this._uploaded = null;
      this._confirmRemove = null;
      this._lightbox = null;
      this._locationError = null;
      this._createdLocations = [];
      this._copyFlash.reset();
      this._closeCategory();
      return;
    }
    // Once `item` reaches the upload's version it is the fresher copy.
    if (this._uploaded && this.item && this.item.version >= this._uploaded.version) {
      this._uploaded = null;
    }
  }

  /** True when the user has typed something they would lose. */
  get dirty(): boolean {
    return isDirty(this._model, this.item);
  }

  private _patch(patch: Partial<ItemFormModel>) {
    this._model = { ...this._model, ...patch };
    if (this._showErrors) this._errors = validateForm(this._model, this._current);
  }

  private _errorFor(field: string): string | null {
    if (!this._showErrors) return null;
    return this._errors.find((e) => e.field === field)?.message ?? null;
  }

  private _save = () => {
    // The caps refuse growth past the stored item, not a legacy over-cap value.
    const errors = validateForm(this._model, this._current);
    this._errors = errors;
    this._showErrors = true;
    if (errors.length) return;
    const current = this._current;
    const detail = current
      ? {
          itemId: current.id,
          expectedVersion: current.version,
          // Newest version, but diffed against the copy the form was filled from.
          changes: toUpdatePayload(this._model, this._formItem ?? current),
        }
      : { itemId: null, expectedVersion: undefined, create: toCreatePayload(this._model) };
    this.dispatchEvent(new CustomEvent('save', { detail, bubbles: true, composed: true }));
  };

  private _cancel = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  /** Cancel, the ✕ and Escape: a dirty form asks the host first, then sends `cancel`. */
  private _requestCancel = () => {
    const ask = this.confirmDiscard;
    if (this.dirty && ask) ask(() => this._cancel());
    else this._cancel();
  };

  /** Escape closes whatever is open over the form first, then the form. */
  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this._categoryOpen) {
        this._closeCategory();
      } else if (this._checkoutOpen) {
        this._checkoutOpen = false;
      } else if (this._location.open) {
        this._closeLocation();
      } else {
        this._requestCancel();
      }
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this._save();
    }
  };

  /** Rescue focus into the form when a surface over it closes with its opener gone. */
  private _refocus() {
    this.renderRoot.querySelector<HTMLElement>('[data-testid="editor-name"]')?.focus();
  }

  /** Shut the location picker and put focus back on the control that opened it. */
  private _closeLocation() {
    this._location.close();
    this._locationError = null;
    this.renderRoot.querySelector<HTMLElement>('[data-testid="editor-location"]')?.focus();
  }

  // ---------- Field renderers ----------
  private _text(field: keyof ItemFormModel, label: string, opts: { type?: string; testid: string }) {
    const error = this._errorFor(field as string);
    return html`<div class="cell ${error ? 'invalid' : ''}">
      <label class="hv-label" for=${opts.testid}>${label}</label>
      <input
        id=${opts.testid}
        class="hv-input"
        type=${opts.type ?? 'text'}
        data-testid=${opts.testid}
        .value=${String(this._model[field] ?? '')}
        @input=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value;
          const value = opts.type !== 'number' ? raw : raw === '' ? null : Number(raw);
          this._patch({ [field]: value } as Partial<ItemFormModel>);
        }}
      />
      ${error ? html`<span class="field-error" data-testid=${`${opts.testid}-error`}>${error}</span>` : null}
    </div>`;
  }

  /** The description, placed differently per width, so one renderer keeps one id. */
  private _renderDescriptionField() {
    return html`<div class="cell span2">
      <label class="hv-label" for="editor-description">${t('hv.field.description')}</label>
      <textarea
        id="editor-description"
        class="hv-input"
        data-testid="editor-description"
        .value=${this._model.description}
        @input=${(e: Event) => this._patch({ description: (e.target as HTMLTextAreaElement).value })}
      ></textarea>
    </div>`;
  }

  /** The host's flat list, plus anything this form created that it still lacks. */
  private get _knownLocations(): Location[] {
    const known = this.locations ?? [];
    if (!this._createdLocations.length) return known;
    const extra = this._createdLocations.filter((c) => !known.some((l) => l.id === c.id));
    return extra.length ? [...known, ...extra] : known;
  }

  /** The host's tree, plus the same additions as roots, which is all the picker creates. */
  private get _knownLocationTree(): LocationTreeNode[] {
    const known = this.locationTree ?? [];
    if (!this._createdLocations.length) return known;
    const seen = new Set<string>();
    const mark = (nodes: LocationTreeNode[]) => {
      for (const n of nodes) {
        seen.add(n.id);
        mark(n.children ?? []);
      }
    };
    mark(known);
    const extra = this._createdLocations
      .filter((c) => !seen.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        parent_id: c.parent_id,
        area_id: c.area_id,
        path: c.path,
        direct_item_count: 0,
        subtree_item_count: 0,
        children: [],
      }));
    return extra.length ? [...known, ...extra] : known;
  }

  private _renderLocationField() {
    const locations = this._knownLocations;
    const loc = locations.find((l) => l.id === this._model.locationId);
    const parts = locationPathParts(loc, locations, this.areas, t('hv.term.noLocation'));
    return html`<div class="cell span2">
      <span class="hv-label">${t('hv.field.location')}</span>
      ${this._location.render(
        {
          triggerClass: `field-button ${this._model.locationId ? '' : 'empty'}`,
          testid: 'editor-location',
          title: pathTitle(parts),
          holderId: LOCATION_TREE_ID,
          trigger: html`${icon('mapMarker', 15)}${renderAreaChip(
            areaMarkName(parts.areaName, parts.path),
          )}<span class="value">${parts.path}</span>${icon('chevronDown', 15)}`,
        },
        () => html`<hv-location-tree
          data-testid="editor-location-tree"
          .nodes=${this._knownLocationTree}
          .areas=${this.areas}
          .selectedId=${this._model.locationId}
          showAll
          allLabel=${t('hv.term.noLocation')}
          allIcon="close"
          ?allowCreate=${this.createLocation !== null}
          @select=${(e: CustomEvent) => {
            this._patch({ locationId: (e.detail as { locationId: string | null }).locationId });
            this._locationError = null;
          }}
          @create-location=${(e: CustomEvent) => {
            e.stopPropagation();
            void this._createLocation((e.detail as { name: string }).name);
          }}
        ></hv-location-tree>`,
      )}
      ${this._locationError
        ? html`<span class="field-error" data-testid="editor-location-error">${this._locationError}</span>`
        : null}
    </div>`;
  }

  /** Make a location from the picker and file the item in it in one move. */
  private async _createLocation(name: string) {
    const create = this.createLocation;
    if (!create) return;
    this._locationError = null;
    try {
      const created = await create(name);
      this._createdLocations = [...this._createdLocations, created];
      this._patch({ locationId: created.id });
      this._location.close();
    } catch (err) {
      this._locationError = errorText(err, t('hv.editor.locationCreateFailed'));
    }
  }

  /** What the dropdown shows: typing narrows it, the arrow and focus show all. */
  private get _categoryOptions(): string[] {
    const query = this._model.category.trim().toLowerCase();
    if (this._categoryShowAll || !query) return this.categorySuggestions;
    return this.categorySuggestions.filter((c) => c.toLowerCase().includes(query));
  }

  private _openCategory(showAll: boolean) {
    if (!this.categorySuggestions.length) return;
    this._categoryShowAll = showAll;
    this._categoryOpen = true;
    this._categoryIndex = -1;
  }

  private _closeCategory() {
    this._categoryOpen = false;
    this._categoryShowAll = false;
    this._categoryIndex = -1;
  }

  /** Re-render at midnight, since the editor marks a past due date overdue. */
  connectedCallback(): void {
    super.connectedCallback();
    this._dayUnsub = onDayChange(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._dayUnsub?.();
    this._dayUnsub = undefined;
    this._closeCategory();
  }

  private _dayUnsub?: () => void;

  private _chooseCategory(value: string) {
    this._patch({ category: value });
    this._closeCategory();
  }

  private _onCategoryKeydown(e: KeyboardEvent) {
    const options = this._categoryOptions;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!this._categoryOpen) {
          this._openCategory(false);
          this._categoryIndex = 0;
          return;
        }
        if (!options.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        this._categoryIndex = (this._categoryIndex + step + options.length) % options.length;
        break;
      }
      case 'Enter':
        if (this._categoryOpen && options[this._categoryIndex]) {
          e.preventDefault();
          e.stopPropagation();
          this._chooseCategory(options[this._categoryIndex]);
        }
        break;
      case 'Escape':
        // Dismiss the list only — the editor's own Escape would discard the edit.
        if (this._categoryOpen) {
          e.preventDefault();
          e.stopPropagation();
          this._closeCategory();
        }
        break;
      case 'Tab':
        this._closeCategory();
        break;
    }
  }

  private _renderCategoryField() {
    const typed = this._model.category.trim();
    const options = this._categoryOptions;
    return html`<div class="cell">
      <label class="hv-label" for="editor-category">${t('hv.field.category')}</label>
      <div class="combo">
        <input
          id="editor-category"
          class="hv-input"
          data-testid="editor-category"
          role="combobox"
          autocomplete="off"
          placeholder=${t('hv.editor.categoryPlaceholder')}
          aria-autocomplete="list"
          aria-expanded=${String(this._categoryOpen)}
          aria-controls=${CATEGORY_LIST_ID}
          aria-activedescendant=${this._categoryOpen && this._categoryIndex >= 0
            ? `editor-category-option-${this._categoryIndex}`
            : ''}
          .value=${this._model.category}
          @focus=${() => this._openCategory(true)}
          @input=${(e: Event) => {
            this._patch({ category: (e.target as HTMLInputElement).value });
            this._openCategory(false);
          }}
          @keydown=${this._onCategoryKeydown}
          @blur=${() => this._closeCategory()}
        />
        ${this.categorySuggestions.length
          ? html`<button
              class="combo-arrow"
              data-testid="editor-category-toggle"
              tabindex="-1"
              aria-label=${t('hv.editor.showAllCategories')}
              title=${t('hv.editor.showAllCategories')}
              @mousedown=${(e: Event) => e.preventDefault()}
              @click=${() => {
                // Only a second click on the *full* list closes it — pressing the
                // arrow while a typed filter is showing means "show me the rest".
                if (this._categoryOpen && this._categoryShowAll) this._closeCategory();
                else this._openCategory(true);
              }}
            >
              ${icon('chevronDown', 18)}
            </button>`
          : null}
      </div>
      <div
        class="list-holder"
        role="listbox"
        id=${CATEGORY_LIST_ID}
        data-testid="editor-category-list"
        ?hidden=${!this._categoryOpen}
      >
        ${this._categoryOpen
          ? html`${options.length
              ? options.map(
                  (c, i) => html`<button
                    class="option ${i === this._categoryIndex ? 'active' : ''} ${
                      c.toLowerCase() === typed.toLowerCase() ? 'selected' : ''
                    }"
                    id=${`editor-category-option-${i}`}
                    role="option"
                    aria-selected=${String(c.toLowerCase() === typed.toLowerCase())}
                    data-testid="editor-category-option"
                    data-value=${c}
                    @mousedown=${(e: Event) => e.preventDefault()}
                    @click=${() => this._chooseCategory(c)}
                  >
                    <span class="label">${c}</span>
                    ${c.toLowerCase() === typed.toLowerCase() ? icon('check', 15) : null}
                  </button>`,
                )
              : html`<div class="option-empty" data-testid="editor-category-empty">
                  ${t('hv.editor.categoryEmpty', { typed })}
                </div>`}`
          : null}
      </div>
    </div>`;
  }

  private _renderStatusField() {
    return html`<div class="cell">
      <label class="hv-label" for="editor-status">${t('hv.field.status')}</label>
      <select
        id="editor-status"
        class="hv-input"
        data-testid="editor-status"
        @change=${(e: Event) =>
          this._patch({ status: (e.target as HTMLSelectElement).value as ItemStatus })}
      >
        <!-- An <option> cannot hold an SVG, so the picker carries labels
             alone; the colour and glyph appear wherever the status is shown. -->
        ${statusList(this.statuses).map(
          ({ slug: s }) =>
            html`<option value=${s} ?selected=${this._model.status === s}>
              ${statusLabel(s, this.statuses)}
            </option>`,
        )}
      </select>
    </div>`;
  }

  /**
   * The checkout with its due date (live only while out), and the unrelated
   * inspection date. Checking out writes `checkedOut` into the form model
   * rather than sending the command, since a new item has no id yet.
   */
  private _renderStateFields() {
    const model = this._model;
    return html`<div class="cell span3">
      <div class="state">
        <div class="group" role="group" aria-labelledby="editor-checkout-caption">
          <span class="hv-label group-caption" id="editor-checkout-caption" data-testid="editor-checkout-caption">
            ${icon('account', 14)} ${t('hv.editor.checkOutCaption')}
          </span>
          <div class="group-body checkout-body">
            <button
              class="field-button checkout-action"
              data-testid="editor-checked-out"
              @click=${this._onCheckoutPressed}
            >
              ${icon(model.checkedOut ? 'check' : 'account', 16)}
              <span
                >${model.checkedOut ? t('hv.action.checkIn') : t('hv.action.checkOutEllipsis')}</span
              >
            </button>
            <label class="hv-label due-label ${model.checkedOut ? '' : 'muted'}" for="editor-due">
              ${t('hv.field.due_date')}
            </label>
            <input
              id="editor-due"
              class="hv-input due-input"
              type="date"
              data-testid="editor-due-date"
              ?disabled=${!model.checkedOut}
              title=${model.checkedOut ? '' : t('hv.editor.dueDateHint')}
              .value=${model.dueDate}
              @input=${(e: Event) => this._patch({ dueDate: (e.target as HTMLInputElement).value })}
            />
            ${model.checkedOut
              ? null
              : html`<span class="group-hint" data-testid="editor-due-hint">${t('hv.editor.dueDateHint')}</span>`}
          </div>
          <hv-checkout-popover
            data-testid="editor-checkout"
            .item=${this.item}
            .itemName=${model.name.trim() || t('hv.editor.thisItem')}
            .anchor=${this._checkoutAnchor}
            ?inline=${this.mobile}
            ?touch=${this.mobile}
            ?open=${this._checkoutOpen}
            @check-out=${(e: CustomEvent) => {
              // A form event only: the shell would send the real command.
              e.stopPropagation();
              const { dueDate } = e.detail as { dueDate: string | null };
              this._patch({ checkedOut: true, dueDate: dueDate ?? '' });
              this._checkoutOpen = false;
            }}
            @cancel=${(e: Event) => {
              e.stopPropagation();
              this._checkoutOpen = false;
            }}
          ></hv-checkout-popover>
        </div>
        <div class="group">
          <label class="hv-label group-caption" for="editor-inspection" data-testid="editor-inspection-caption">
            ${icon('calendar', 14)} ${t('hv.field.inspection_date')}
          </label>
          <div class="group-body">
            <div class="inspection-row">
              <input
                id="editor-inspection"
                class="hv-input"
                type="date"
                data-testid="editor-inspection-date"
                .value=${model.inspectionDate}
                @input=${(e: Event) =>
                  this._patch({ inspectionDate: (e.target as HTMLInputElement).value })}
              />
              <button
                class="hv-icon-button"
                data-testid="editor-inspection-clear"
                aria-label=${t('hv.editor.clearInspectionDate')}
                ?disabled=${!model.inspectionDate}
                @click=${this._clearInspection}
              >
                ${icon('close', 16)}
              </button>
            </div>
            ${this._renderInspectionOffsets(model.inspectionDate)}
          </div>
        </div>
        ${this._renderReminderFields()}
      </div>
    </div>`;
  }

  /**
   * A date that comes round again, with an optional repeat (blank is a one-off).
   * Saved with the rest of the form, not through `haventory/reminder/set`.
   */
  private _renderReminderFields() {
    const model = this._model;
    return html`<div class="group reminder" role="group" aria-labelledby="editor-reminder-caption">
      <span class="hv-label group-caption" id="editor-reminder-caption" data-testid="editor-reminder-caption">
        ${icon('clock', 14)} ${t('hv.field.reminder_date')}
      </span>
      <div class="group-body">
        <input
          id="editor-reminder-date"
          class="hv-input"
          type="date"
          aria-label=${t('hv.editor.reminderDate')}
          data-testid="editor-reminder-date"
          .value=${model.reminderDate}
          @input=${(e: Event) =>
            this._patch({ reminderDate: (e.target as HTMLInputElement).value })}
        />
        <div class="repeat">
          <label class="hv-label ${model.reminderDate ? '' : 'muted'}" for="editor-reminder-count">
            ${t('hv.editor.repeatEvery')}
          </label>
          <input
            id="editor-reminder-count"
            class="hv-input repeat-count"
            type="number"
            min="1"
            max="1000"
            placeholder="—"
            data-testid="editor-reminder-count"
            ?disabled=${!model.reminderDate}
            title=${model.reminderDate ? '' : t('hv.editor.reminderHint')}
            .value=${model.reminderCount === null ? '' : String(model.reminderCount)}
            @input=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value.trim();
              this._patch({ reminderCount: raw === '' ? null : Number(raw) });
            }}
          />
          <select
            class="hv-input repeat-unit"
            aria-label=${t('hv.editor.repeatUnit')}
            data-testid="editor-reminder-unit"
            ?disabled=${!model.reminderDate}
            .value=${model.reminderUnit}
            @change=${(e: Event) =>
              this._patch({ reminderUnit: (e.target as HTMLSelectElement).value as ReminderUnit })}
          >
            ${REMINDER_UNITS.map(
              (unit) => html`<option value=${unit} ?selected=${unit === model.reminderUnit}>
                ${t(`hv.editor.unit.${unit}`)}
              </option>`,
            )}
          </select>
        </div>
        ${model.reminderDate
          ? null
          : html`<span class="group-hint" data-testid="editor-reminder-hint">${t('hv.editor.reminderHint')}</span>`}
      </div>
    </div>`;
  }

  /** The `ui/day-offsets` quick jumps for the inspection date. */
  private _renderInspectionOffsets(current: string) {
    return renderDayOffsets(
      {
        current,
        customOpen: this._inspectionCustomOpen,
        customDays: this._inspectionCustomDays,
      },
      {
        prefix: 'editor-inspection',
        onPick: (date) => {
          this._inspectionCustomOpen = false;
          this._patch({ inspectionDate: date });
        },
        onCustom: (date) => {
          this._inspectionCustomOpen = true;
          this._patch({ inspectionDate: date });
        },
        onDays: (days, date) => {
          this._inspectionCustomDays = days;
          this._patch({ inspectionDate: date ?? '' });
        },
      },
    );
  }

  /**
   * Clear the inspection date and its custom row. Focus moves to the field,
   * since the button disables itself and would drop focus to the page body.
   */
  private _clearInspection = () => {
    this._inspectionCustomOpen = false;
    this._patch({ inspectionDate: '' });
    this.renderRoot.querySelector<HTMLElement>('[data-testid="editor-inspection-date"]')?.focus();
  };

  private _onCheckoutPressed = (e: Event) => {
    if (this._model.checkedOut) {
      this._patch({ checkedOut: false });
      return;
    }
    this._checkoutAnchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this._checkoutOpen = true;
  };

  private _patchRow(id: number, patch: Partial<CustomFieldRow>) {
    this._patch({
      customFields: this._model.customFields.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  private _renderCustomFields() {
    const rows = this._model.customFields;
    const used = Object.keys(customFieldsFrom(this._model)).length;
    const unusedKeys = this.customFieldKeys.filter((k) => !rows.some((r) => r.key === k)).slice(0, 3);
    return html`<div class="cell span3">
      <div class="custom">
        <div class="custom-head">
          <span class="hv-label">${t('hv.editor.customFields')}</span>
          <span class="hv-tally" data-testid="editor-cf-tally"
            >${t('hv.editor.fieldsSet', { fields: counted(used, 'field') })}</span
          >
        </div>
        ${rows.map((row) => {
          const error = this._errorFor(`custom:${row.id}`);
          return html`<div class="cf-row ${error ? 'invalid' : ''}" data-testid="editor-cf-row" data-id=${row.id}>
            <input
              class="hv-input cf-key"
              data-testid="editor-cf-key"
              aria-label=${t('hv.editor.fieldKey')}
              placeholder=${t('hv.editor.fieldKeyPlaceholder')}
              .value=${row.key}
              @input=${(e: Event) => this._patchRow(row.id, { key: (e.target as HTMLInputElement).value })}
            />
            <select
              class="hv-input cf-type"
              data-testid="editor-cf-type"
              aria-label=${t('hv.editor.fieldType')}
              @change=${(e: Event) =>
                this._patchRow(row.id, { type: (e.target as HTMLSelectElement).value as CustomFieldType })}
            >
              ${customFieldTypes().map(
                (t) => html`<option value=${t.value} ?selected=${row.type === t.value}>${t.label}</option>`,
              )}
            </select>
            ${row.type === 'boolean'
              ? html`<button
                  class="toggle cf-value"
                  role="switch"
                  aria-checked=${String(row.value === 'true')}
                  data-testid="editor-cf-value"
                  @click=${() => this._patchRow(row.id, { value: row.value === 'true' ? 'false' : 'true' })}
                >
                  <span class="switch ${row.value === 'true' ? 'on' : ''}"></span>
                  <span>${row.value === 'true' ? t('hv.term.yes') : t('hv.term.no')}</span>
                </button>`
              : html`<input
                  class="hv-input cf-value"
                  data-testid="editor-cf-value"
                  aria-label=${t('hv.editor.fieldValue')}
                  type=${row.type === 'number' ? 'number' : row.type === 'date' ? 'date' : 'text'}
                  .value=${row.value}
                  @input=${(e: Event) => this._patchRow(row.id, { value: (e.target as HTMLInputElement).value })}
                />`}
            <button
              class="cf-remove"
              data-testid="editor-cf-remove"
              aria-label=${t('hv.editor.removeNamedField', {
                key: row.key || t('hv.editor.fieldFallbackName'),
              })}
              title=${t('hv.editor.removeField')}
              @click=${() => this._patch({ customFields: rows.filter((r) => r.id !== row.id) })}
            >
              ${icon('close', 16)}
            </button>
            ${error ? html`<span class="field-error" data-testid="editor-cf-error">${error}</span>` : null}
          </div>`;
        })}
        <button
          class="cf-add"
          data-testid="editor-cf-add"
          @click=${() => this._patch({ customFields: [...rows, newCustomFieldRow()] })}
        >
          ${icon('plus', 15)}${t('hv.editor.addField')}
        </button>
        ${unusedKeys.length
          ? html`<span class="key-hints" data-testid="editor-cf-key-hints">
              ${t('hv.editor.keySuggestions')}
              ${unusedKeys.map(
                (k) => html`<button
                  data-testid="editor-cf-key-hint"
                  data-value=${k}
                  @click=${() => this._patch({ customFields: [...rows, newCustomFieldRow({ key: k })] })}
                >
                  ${k}
                </button>`,
              )}
              · ${t('hv.editor.clearingUnsets')}
            </span>`
          : html`<span class="key-hints">${t('hv.editor.clearingUnsets')}</span>`}
      </div>
    </div>`;
  }

  // ---------- Attachments ----------

  /**
   * Why this file cannot be uploaded, or null when it can: a courtesy check
   * against the reported caps, so a doomed file fails before it is sent. The
   * backend decides from the file's own bytes.
   */
  private _preflight(file: File, kind: AttachmentKind, alreadyAttached: number): string | null {
    const config = this.mediaConfig;
    if (!config) return null;
    const cap = kind === 'manual' ? config.max_manuals_per_item : config.max_pictures_per_item;
    if (cap !== undefined && alreadyAttached >= cap) {
      return kind === 'manual'
        ? t('hv.editor.preflight.tooManyDocuments', { cap })
        : t('hv.editor.preflight.tooManyPhotos', { cap });
    }
    if (file.size > config.max_attachment_bytes) {
      return t('hv.editor.preflight.tooBig', {
        size: formatBytes(file.size),
        limit: formatBytes(config.max_attachment_bytes),
      });
    }
    const accepted = kind === 'manual' ? config.manual_mime_types : config.picture_mime_types;
    if (file.type && accepted && !accepted.includes(file.type)) {
      return kind === 'manual'
        ? t('hv.editor.preflight.badDocumentType', { type: file.type })
        : t('hv.editor.preflight.badImageType', { type: file.type });
    }
    return null;
  }

  private _patchUpload(id: string, patch: Partial<UploadEntry>) {
    this._uploads = this._uploads.map((u) => (u.id === id ? { ...u, ...patch } : u));
  }

  /** Report a failed reorder, removal or retitle in the upload queue, without Retry. */
  private _pushUploadError(prefix: string, kind: AttachmentKind, name: string, err: unknown) {
    this._uploads = [
      ...this._uploads,
      {
        id: `${prefix}-${(this._uploadSeq += 1)}`,
        name,
        state: 'error',
        message: errorText(err),
        file: null,
        kind,
      },
    ];
  }

  /**
   * Upload the picked files one at a time: each upload bumps the version and
   * returns the whole attachment list, so two in flight would race.
   */
  private async _uploadFiles(files: File[], kind: AttachmentKind) {
    const queued: UploadEntry[] = files.map((file) => ({
      id: `upload-${(this._uploadSeq += 1)}`,
      name: file.name,
      state: 'queued',
      message: null,
      file,
      kind,
    }));
    this._uploads = [...this._uploads, ...queued];
    for (const entry of queued) await this._sendOne(entry);
  }

  /**
   * One file from preflight to attached, for the picker and Retry alike. The
   * shrink comes first so the byte cap measures the size actually sent.
   */
  private async _sendOne(entry: UploadEntry) {
    const media = this.media;
    const item = this._current;
    const picked = entry.file;
    if (!media || !item || !picked) return;

    this._patchUpload(entry.id, { state: 'preparing', message: null });
    const file = await prepareForUpload(picked, entry.kind);
    this._patchUpload(entry.id, { state: 'uploading', name: file.name });

    const attached =
      entry.kind === 'manual'
        ? manuals(this._current?.attachments)
        : pictures(this._current?.attachments);
    const refused = this._preflight(file, entry.kind, attached.length);
    if (refused) {
      this._patchUpload(entry.id, { state: 'error', message: refused });
      return;
    }
    try {
      this._uploaded = await media.upload(item.id, file, entry.kind);
      this._uploads = this._uploads.filter((u) => u.id !== entry.id);
    } catch (err) {
      this._patchUpload(entry.id, { state: 'error', message: errorText(err) });
    }
  }

  /** Move one attachment within its kind; `-Infinity` makes a picture the cover (position 0). */
  private async _moveAttachment(attachmentId: string, kind: AttachmentKind, delta: number) {
    const media = this.media;
    const item = this._current;
    if (!media || !item) return;
    const ordered = (kind === 'manual' ? manuals : pictures)(item.attachments).map((a) => a.id);
    const from = ordered.indexOf(attachmentId);
    if (from < 0) return;
    const to = Math.min(Math.max(from + delta, 0), ordered.length - 1);
    if (to === from) return;
    ordered.splice(from, 1);
    ordered.splice(to, 0, attachmentId);
    try {
      this._uploaded = await media.reorder(item.id, kind, ordered);
    } catch (err) {
      this._pushUploadError('reorder', kind, t('hv.editor.upload.reorderPhotos'), err);
    }
  }

  /** Delete one attachment, once `_confirmRemove` has been answered. */
  private async _removeAttachment(attachmentId: string, kind: AttachmentKind) {
    const media = this.media;
    const item = this._current;
    if (!media || !item) return;
    try {
      this._uploaded = await media.remove(item.id, attachmentId);
      // The confirm's opener was this tile's remove button, now gone.
      await this.updateComplete;
      if (focusStranded()) this._refocus();
    } catch (err) {
      this._pushUploadError(
        'remove',
        kind,
        kind === 'manual'
          ? t('hv.editor.upload.removeDocument')
          : t('hv.editor.upload.removePhoto'),
        err,
      );
    }
  }

  /**
   * Move and cover buttons under one thumbnail, keyboard-usable like the
   * organize dialog's. The star is inert on the cover and a button elsewhere.
   */
  private _renderPhotoControls(attachmentId: string, index: number, total: number) {
    const move = (delta: number) => () =>
      void this._moveAttachment(attachmentId, 'picture', delta);
    return html`<div class="tile-controls">
      <button
        data-testid="editor-photo-earlier"
        aria-label=${t('hv.editor.movePhotoEarlier', { position: index + 1 })}
        ?disabled=${index === 0}
        @click=${move(-1)}
      >
        ${icon('chevronLeft', 15)}
      </button>
      ${index === 0
        ? html`<span
            class="is-cover"
            data-testid="editor-photo-cover"
            title=${t('hv.editor.coverPhoto')}
            >${icon('star', 14)}</span
          >`
        : html`<button
            data-testid="editor-photo-make-cover"
            aria-label=${t('hv.editor.makePhotoCover', { position: index + 1 })}
            title=${t('hv.editor.makeCover')}
            @click=${move(-Infinity)}
          >
            ${icon('star', 14)}
          </button>`}
      <button
        data-testid="editor-photo-later"
        aria-label=${t('hv.editor.movePhotoLater', { position: index + 1 })}
        ?disabled=${index === total - 1}
        @click=${move(1)}
      >
        ${icon('chevronRight', 15)}
      </button>
    </div>`;
  }

  /** The photos already attached and the picker; only for a saved item, which has an id. */
  private _renderPictures() {
    const item = this._current;
    if (!item || !this.media) return null;
    const shots = pictures(item.attachments);
    const accepted = this.mediaConfig?.picture_mime_types.join(',') ?? 'image/*';

    const drop = this._dropBindings('picture');
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.editor.photos')}</span>
      <div
        class="photos ${!this.mobile && this._dropTarget === 'picture' ? 'dropping' : ''}"
        data-testid="editor-photos"
        @dragover=${drop.over}
        @dragleave=${drop.leave}
        @drop=${drop.drop}
      >
        ${shots.map((picture, index) => {
          const alt = pictureAlt(item.name, index, shots.length);
          const missing = this._urls.presence(item.id, picture.id) === 'missing';
          // The thumbnail; the lightbox asks for the stored file itself.
          const src = missing
            ? null
            : this._urls.get(
                item.id,
                picture.id,
                attachmentNameToken(picture),
                MEDIA_VARIANT_THUMB,
              );
          return renderPhotoFigure(
            {
              src,
              missing,
              alt,
              openLabel: t('hv.editor.viewPhoto', { photo: alt }),
              onOpen: () => {
                this._lightbox = index;
              },
            },
            {
              testid: 'editor-photo',
              glyph: 20,
              tileClass: 'placeholder',
              openClass: 'open',
              pendingTile: true,
            },
            html`<button
                class="remove"
                data-testid="editor-photo-remove"
                aria-label=${t('hv.editor.removePhoto', { photo: alt })}
                @click=${() => {
                  this._confirmRemove = { id: picture.id, kind: 'picture' };
                }}
              >
                ${icon('close', 15)}
              </button>
              ${shots.length > 1
                ? this._renderPhotoControls(picture.id, index, shots.length)
                : null}`,
          );
        })}
        <!-- Two inputs on a phone: capture="environment" opens the camera with
             no way to the library, so the library needs its own. -->
        ${this.mobile
          ? html`<label class="picker" data-testid="editor-photo-camera">
              ${icon('camera', 20)}
              <span>${t('hv.editor.takePhoto')}</span>
              <input
                class="reveal"
                type="file"
                accept=${accepted}
                capture="environment"
                data-testid="editor-photo-camera-input"
                @change=${(e: Event) => this._onPicked(e, 'picture')}
              />
            </label>`
          : null}
        <label class="picker" data-testid="editor-photo-picker">
          ${icon('image', 20)}
          <span>${t('hv.editor.addPhoto')}</span>
          <input
            class="reveal"
            type="file"
            accept=${accepted}
            multiple
            data-testid="editor-photo-input"
            @change=${(e: Event) => this._onPicked(e, 'picture')}
          />
        </label>
      </div>
      ${this._renderUploadList('picture')}
    </div>`;
  }

  /** Why a new item has no attachment sections yet: it has no id until saved. */
  private _renderCreateAttachmentHint() {
    if (this.item !== null || !this.media) return null;
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.editor.attachmentsLater')}</span>
      <span class="attach-hint" data-testid="editor-attachment-hint">
        ${t('hv.editor.attachmentsHint')}
      </span>
    </div>`;
  }

  /** The `item_id` every `haventory.*` action takes; on a desktop only this form shows it. */
  private _renderIdRow() {
    const id = this.item?.id;
    if (!id) return null;
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.term.id')}</span>
      <div class="id-row">
        <code data-testid="editor-id">${id}</code>
        <button
          class="hv-text-button"
          data-testid="editor-copy-id"
          @click=${() => void this._copyFlash.copy(id)}
        >
          ${this._copyFlash.copied ? t('hv.action.copied') : t('hv.action.copy')}
        </button>
      </div>
    </div>`;
  }

  /** Hand the picked files to the queue and let the same file be picked again. */
  private _onPicked(e: Event, kind: AttachmentKind) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Cleared so picking the same file twice still fires `change`.
    input.value = '';
    void this._uploadFiles(files, kind);
  }

  /**
   * Attach dropped files, each routed by its own type rather than where it
   * landed: pictures first, then manuals, so the two queues never interleave.
   */
  private async _onDrop(e: DragEvent) {
    e.preventDefault();
    this._dropTarget = null;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const pictureFiles = files.filter((f) => f.type.startsWith('image/'));
    const manualFiles = files.filter((f) => !f.type.startsWith('image/'));
    if (pictureFiles.length) await this._uploadFiles(pictureFiles, 'picture');
    if (manualFiles.length) await this._uploadFiles(manualFiles, 'manual');
  }

  /**
   * An uncancelled drop navigates to the dropped file, taking the form with it,
   * and HA does not block that; so the root cancels both events on every layout.
   */
  private _onRootDragOver(e: DragEvent) {
    e.preventDefault();
  }

  private _onRootDrop(e: DragEvent) {
    e.preventDefault();
    this._dropTarget = null;
  }

  /** A section's drop-target listeners, or none on a phone (Lit drops `undefined` ones). */
  private _dropBindings(kind: AttachmentKind) {
    if (this.mobile) return { over: undefined, leave: undefined, drop: undefined };
    return {
      over: (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        this._dropTarget = kind;
      },
      leave: () => {
        if (this._dropTarget === kind) this._dropTarget = null;
      },
      drop: (e: DragEvent) => void this._onDrop(e),
    };
  }

  /** Rename one document, on `change` so typing is not a command per keystroke. */
  private async _retitle(attachmentId: string, title: string) {
    const media = this.media;
    const item = this._current;
    if (!media || !item) return;
    try {
      this._uploaded = await media.retitle(item.id, attachmentId, title);
    } catch (err) {
      this._pushUploadError('retitle', 'manual', t('hv.editor.upload.renameDocument'), err);
    }
  }

  /**
   * The documents already attached, each with a title field that falls back to
   * the filename, and the picker that adds one (no `capture`: a document comes
   * from the file system).
   */
  private _renderDocuments() {
    const item = this._current;
    if (!item || !this.media) return null;
    const docs = manuals(item.attachments);
    const accepted = this.mediaConfig?.manual_mime_types?.join(',') ?? 'application/pdf';

    const drop = this._dropBindings('manual');
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.field.documents')}</span>
      <ul
        class="documents ${!this.mobile && this._dropTarget === 'manual' ? 'dropping' : ''}"
        data-testid="editor-documents"
        @dragover=${drop.over}
        @dragleave=${drop.leave}
        @drop=${drop.drop}
      >
        ${docs.map((doc) =>
          renderDocumentRow(
            {
              src: this._urls.get(item.id, doc.id, attachmentNameToken(doc)),
              missing: this._urls.presence(item.id, doc.id) === 'missing',
            },
            {
              testid: 'editor-document',
              glyph: 18,
              openLabel: t('hv.editor.openNamed', { name: attachmentTitle(doc) }),
              openTitle: t('hv.editor.openDocument'),
            },
            html`<input
                class="hv-input doc-title"
                data-testid="editor-document-title"
                .value=${doc.title ?? ''}
                placeholder=${doc.filename}
                aria-label=${t('hv.editor.titleFor', { filename: doc.filename })}
                @change=${(e: Event) =>
                  void this._retitle(doc.id, (e.target as HTMLInputElement).value.trim())}
              />
              <span class="doc-size">${formatBytes(doc.size)}</span>`,
            html`<button
              class="doc-remove"
              data-testid="editor-document-remove"
              aria-label=${t('hv.editor.removeNamed', { name: attachmentTitle(doc) })}
              @click=${() => {
                this._confirmRemove = { id: doc.id, kind: 'manual' };
              }}
            >
              ${icon('close', 15)}
            </button>`,
          ),
        )}
      </ul>
      <label class="picker doc-picker" data-testid="editor-manual-picker">
        ${icon('fileDocument', 18)}
        <span>${t('hv.editor.addManual')}</span>
        <input
          class="reveal"
          type="file"
          accept=${accepted}
          multiple
          data-testid="editor-manual-input"
          @change=${(e: Event) => this._onPicked(e, 'manual')}
        />
      </label>
      ${this._renderUploadList('manual')}
    </div>`;
  }

  /** The upload queue for one kind, under the section it is filling. */
  private _renderUploadList(kind: AttachmentKind) {
    const entries = this._uploads.filter((u) => u.kind === kind);
    if (!entries.length) return null;
    const glyph = kind === 'manual' ? 'fileDocument' : 'camera';
    return html`<ul class="upload-list" data-testid="editor-upload-list" data-kind=${kind}>
      ${entries.map(
        (entry) => html`<li
          class=${entry.state === 'error' ? 'failed' : ''}
          data-testid="editor-upload"
          data-state=${entry.state}
        >
          <span class="kind">${icon(glyph, 14)}</span>
          <span class="file">${entry.name}</span>
          <span class="state"
            >${entry.state === 'error'
              ? entry.message
              : t(`hv.editor.upload.state.${entry.state}`)}</span
          >
          ${entry.state === 'error'
            ? html`${entry.file
                  ? html`<button
                      class="retry"
                      data-testid="editor-upload-retry"
                      aria-label=${t('hv.editor.upload.retryNamed', { name: entry.name })}
                      @click=${() => void this._sendOne(entry)}
                    >
                      ${t('hv.action.repeat')}
                    </button>`
                  : null}
                <button
                  class="dismiss"
                  data-testid="editor-upload-dismiss"
                  aria-label=${t('hv.editor.upload.dismissNamed', { name: entry.name })}
                  @click=${() => {
                    this._uploads = this._uploads.filter((u) => u.id !== entry.id);
                  }}
                >
                  ${icon('close', 13)}
                </button>`
            : html`<span
                class="progress"
                role="progressbar"
                aria-label=${t('hv.editor.upload.progress', {
                  name: entry.name,
                  state: entry.state,
                })}
                data-testid="editor-upload-progress"
                ><span class="fill"></span
              ></span>`}
        </li>`,
      )}
    </ul>`;
  }

  render() {
    const model = this._model;
    const creating = this.item === null;
    const overdue = isOverdue(this.item?.due_date);
    const removing = removeCopy(this._confirmRemove?.kind ?? 'picture');

    return html`
      <div
        data-testid="item-editor"
        @keydown=${this._onKeydown}
        @dragover=${this._onRootDragOver}
        @drop=${this._onRootDrop}
      >
        ${this.noHeader
          ? null
          : html`<div class="head">
              ${icon('chevronDown', 18)}
              <span class="name" data-testid="editor-heading">
                ${creating
                  ? t('hv.editor.heading.new')
                  : t('hv.editor.heading.editing', { name: this.item?.name ?? '' })}
              </span>
              ${this.item?.checked_out
                ? html`<span class="hv-chip ${overdue ? 'error' : 'state'}" data-testid="editor-out-chip">
                    ${overdue ? t('hv.term.overdue') : t('hv.term.checkedOut')}${this.item
                      ?.due_date
                      ? ` · ${t('hv.term.due', { date: formatDate(this.item.due_date) })}`
                      : ''}
                  </span>`
                : null}
              ${this.item
                ? html`<span class="meta" data-testid="editor-version"
                    >${t('hv.editor.version', {
                      version: this.item.version,
                      when: relativeTime(this.item.updated_at),
                    })}</span
                  >`
                : null}
              <button
                class="hv-icon-button"
                data-testid="editor-close"
                aria-label=${t('hv.editor.close')}
                @click=${this._requestCancel}
              >
                ${icon('close', 18)}
              </button>
            </div>`}
        ${this.errorMessage
          ? html`<div class="banner" role="alert" data-testid="editor-error">${this.errorMessage}</div>`
          : null}

        <div class="grid">
          ${this._text('name', t('hv.field.name'), { testid: 'editor-name' })}
          ${this._text('quantity', t('hv.field.quantity'), {
            type: 'number',
            testid: 'editor-quantity',
          })}
          ${this._text('lowStock', t('hv.field.lowStock'), {
            type: 'number',
            testid: 'editor-low-stock',
          })}
          ${this.mobile
            ? null
            : html`${this._renderDescriptionField()} ${this._renderStatusField()}`}
          ${this._renderLocationField()} ${this._renderCategoryField()}
          ${this.mobile ? this._renderStatusField() : null}
          <div class="cell span3">
            <span class="hv-label"
              >${t('hv.field.tags')}
              <span class="label-note">${t('hv.editor.field.tagsNote')}</span></span
            >
            <hv-chip-input
              data-testid="editor-tags"
              .values=${model.tags}
              .suggestions=${this.tagSuggestions}
              @change=${(e: CustomEvent) => this._patch({ tags: (e.detail as { values: string[] }).values })}
            ></hv-chip-input>
          </div>
          ${this._renderPictures()} ${this._renderDocuments()} ${this._renderCreateAttachmentHint()}
          ${this.mobile ? this._renderDescriptionField() : null} ${this._renderStateFields()}
          ${this._renderCustomFields()}

          ${this._renderIdRow()}

          <div class="cell span3 actions-cell">
            <div class="actions">
              ${this.item
                ? html`<button
                    class="hv-text-button danger"
                    data-testid="editor-delete"
                    aria-label=${t('hv.action.deleteItem')}
                    @click=${() =>
                      this.dispatchEvent(
                        new CustomEvent('delete-item', {
                          detail: { itemId: this.item!.id, name: this.item!.name },
                          bubbles: true,
                          composed: true,
                        }),
                      )}
                  >
                    ${t(this.mobile ? 'hv.action.delete' : 'hv.action.deleteItem')}
                  </button>`
                : null}
              <span class="spacer"></span>
              ${this.mobile
                ? null
                : html`<span class="hint" data-testid="editor-key-hint">
                    ${t('hv.editor.keyHint', { chord: saveShortcutLabel() })}
                  </span>`}
              <button class="hv-text-button" data-testid="editor-cancel" @click=${this._requestCancel}>
                ${t('hv.action.cancel')}
              </button>
              <button class="save" data-testid="editor-save" ?disabled=${this.busy} @click=${this._save}>
                ${this.busy ? t('hv.action.saving') : t('hv.action.save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      ${renderLightboxHost({
        testid: 'editor-lightbox-host',
        item: this._current,
        media: this.media,
        index: this._lightbox,
        onOpenerGone: () => this._refocus(),
        onClose: () => {
          this._lightbox = null;
        },
      })}

      <!-- Its events stop here, or its cancel would read to the host as "close
           the form". Fixed to the window, so it follows the viewport's width. -->
      <hv-confirm
        data-testid="editor-remove-confirm"
        ?open=${this._confirmRemove !== null}
        ?mobile=${this._viewport.narrow}
        .heading=${removing.heading}
        .message=${removing.message}
        .confirmLabel=${t('hv.action.remove')}
        destructive
        @confirm=${(e: Event) => {
          e.stopPropagation();
          const target = this._confirmRemove;
          this._confirmRemove = null;
          if (target) void this._removeAttachment(target.id, target.kind);
        }}
        @cancel=${(e: Event) => {
          e.stopPropagation();
          this._confirmRemove = null;
        }}
      ></hv-confirm>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-item-editor': HVItemEditor;
  }
}
