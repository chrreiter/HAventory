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
import { COPIED_MS, copyText } from '../ui/clipboard';
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
import { renderDocumentRow, renderLightboxHost, renderPhotoFigure } from '../ui/attachments';
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
import './hv-location-tree';
import './hv-checkout-popover';

/**
 * Why the due date is dead until the item is out. Shown as a note under the
 * checkout, and as the field's `title` — a tooltip alone never reaches a phone,
 * which is where the whole block hides behind a disclosure to begin with.
 */
const dueDateHint = () => t('hv.editor.dueDateHint');

/**
 * Why the repeat is dead until a date is set. The backend refuses an interval
 * with nothing to count from, so this says the same thing before the round trip
 * — as a note and as the field's `title`, for the same reason as the due date's.
 */
const reminderHint = () => t('hv.editor.reminderHint');

const customFieldTypes = (): { value: CustomFieldType; label: string }[] => [
  { value: 'string', label: t('hv.editor.type.string') },
  { value: 'number', label: t('hv.editor.type.number') },
  { value: 'boolean', label: t('hv.editor.type.boolean') },
  { value: 'date', label: t('hv.editor.type.date') },
];

/**
 * What the form's three disclosures open, named so `aria-controls` can point at
 * them. Each target stays in the tree whether or not it is open — an
 * `aria-controls` that resolves to nothing announces the control as controlling
 * nothing — and only the contents come and go, so closing still discards the
 * state inside. Shadow scoping keeps the ids unique with several editors mounted.
 */
const LOCATION_TREE_ID = 'editor-location-tree-holder';
const CATEGORY_LIST_ID = 'editor-category-list';
const MORE_FIELDS_ID = 'editor-more-fields';

/**
 * One file the picker is working through, and how it ended up.
 *
 * A failed entry keeps the `File` itself so Retry sends exactly what was
 * picked; without it the user has to find the file again, and on a phone that
 * means retaking a photo the camera never wrote to disk.
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
  if (err instanceof Error && err.message) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/**
 * The one edit surface: the inline expander, the full view and the mobile sheet.
 *
 * The row expands in place and the location tree opens *inside* the form, so
 * picking a location never stacks a second modal over the edit surface. Every
 * editable field lives here: name, description, quantity, low-stock threshold,
 * category (with suggestions), tags, location, checked-out plus due date,
 * inspection date and typed custom fields — on mobile the rarely-touched half
 * collapses behind one "More fields" disclosure rather than being dropped.
 */
@customElement('hv-item-editor')
export class HVItemEditor extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    dayOffsets,
    css`
      :host {
        display: block;
        /*
         * The form's small print, at one size. Labels are 11px (the shared
         * hv-label recipe and the photo picker's caption); everything this
         * form declares as a note about a field — hints, sizes, errors, the
         * upload queue — reads at this one. The custom-fields tally is the one
         * piece of small print here that is not this form's to size: it is the
         * same facet count the sidebar shows, priced once in the shared sheet.
         */
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
      /* Name takes what is left; the two numbers take what a number needs.
         The proportional tracks were authored for a 600–900px card, where 1fr
         landed near 180px — in the expanded view at 1080p they handed a
         three-digit quantity a field about 400px wide. */
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
      /* Packed to the top rather than sharing out the row's surplus. A grid
         item stretches by default, so a cell holding a label and a control
         takes the height of the tallest cell in the row — the Description
         textarea — and its two auto rows split the difference, leaving a select
         taller than an input and shorter than the textarea beside it. The boxes
         on the state row are stretched on purpose and close the same hazard
         inside themselves. */
      .cell {
        display: grid;
        align-content: start;
        gap: 4px;
        min-width: 0;
      }
      /* Checked out and Due date are two halves of one fact; Next inspection is
         unrelated to both, and the boxes below carry that split visually so the
         three are never read as three peer settings. Both boxes take the height
         of the taller one: sized to themselves they disagree — one carries a
         note, the other three offset chips — and two boxes of different heights
         read as four stacked pieces rather than two. */
      .state {
        display: grid;
        /* Even halves. At 2fr/1fr the inspection box was narrow enough that its
           three offset chips wrapped onto three rows beside a check-out box
           with room to spare. */
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
      }
      :host([mobile]) .state {
        grid-template-columns: 1fr;
      }
      /* The reminder is three controls where the boxes beside it are one or
         two, so it takes the row rather than being squeezed into a half. */
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
        /* The label owns the first row on a phone; the two inputs share the
           second, which keeps the number wide enough to read at 375px. */
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      :host([mobile]) .repeat > label {
        grid-column: 1 / -1;
      }
      /* Packed to the top, because the row above stretches these boxes to the
         taller of the two: auto rows in a stretched grid share the surplus out
         between the caption and the controls instead of leaving it below them,
         which would make the date field in the shorter box taller than the one
         beside it. */
      .group {
        display: grid;
        align-content: start;
        gap: 9px;
        min-width: 0;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px 11px;
      }
      /* Layout only: the type is the shared hv-label recipe, which every
         other label in this form already uses. Two recipes differing by one
         weight step read as two kinds of label. */
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
      /* Shut, the popover renders nothing but still takes a row of the box and
         the gap above it — nine invisible pixels that decided how tall the row
         beside it had to stretch. */
      hv-checkout-popover:not([open]) {
        display: none;
      }
      /*
       * The button and the due date share a row by construction, not by
       * matching heights: three named rows, and column 1 of the label row is
       * empty because the button carries no label of its own. Aligning the two
       * halves by hand only moves the dead air — top-aligned puts the button
       * level with the *label* opposite it, bottom-aligned puts the gap between
       * the caption and the first control. The note spans the box: it says what
       * state both controls are in, not just the field above it.
       */
      .checkout-body {
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          '. label'
          'action field'
          'hint hint';
        gap: 4px 12px;
      }
      .checkout-action {
        grid-area: action;
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
      /* Checking out is something you do, not a setting you hold — the same
         button the detail sheet has offered all along, in the same words. */
      .checkout-action {
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
      /* The shape is ui/day-offsets; a finger's worth of height on top of it
         is this form's, and the popover that draws the same chips grows them
         by its own amount. */
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
      /* A native date input clips its own placeholder much below ~140px, and
         half of a 375px screen minus the box padding is under that. Stacked,
         the alignment question above does not arise: the areas are re-mapped
         rather than dropped, so the order is written down here too. */
      :host([mobile]) .checkout-body {
        grid-template-columns: 1fr;
        grid-template-areas:
          'action'
          'label'
          'field'
          'hint';
      }
      /* The row gap is the one between a label and its own control. Stacked,
         the button is not a caption for the field below it, so it keeps the
         distance the two halves have side by side. */
      :host([mobile]) .checkout-action {
        margin-bottom: 8px;
      }
      label.hv-label {
        display: block;
      }
      .hv-input,
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
      }
      :host([mobile]) .hv-input,
      :host([mobile]) .field-button {
        min-height: 48px;
        font-size: var(--hv-input-font, 14.5px);
      }
      /* A disabled date input keeps the browser's own colour, which against a
         dark HA theme is all but indistinguishable from an enabled one. */
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
      .field-button {
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
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
      /* Both disclosures the form opens under a control push the form down
         rather than covering it: they belong to the field above them, and a
         layer measured against the viewport drifts off that field the moment
         the surface behind it scrolls. */
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
      /* The category field is a text input plus its own dropdown affordance —
         without the arrow the existing values were only findable by guessing. */
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
        /* The rows size themselves from the room they actually have. The mobile
           flag describes the *card*, and the same editor runs inside a desktop
           row and inside a sheet far wider than the card that opened it. */
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
      /* Too tight for one line: the value drops under its key, and the remove
         button spans both rows so it still reads as belonging to that field
         rather than floating under the one before it. */
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
      /* A note riding inside a label: it says something about the field rather
         than naming it, so it steps out of the label's uppercase treatment
         while keeping its line. */
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
      /* These sit inline inside a sentence, so they get height and breathing
         room rather than becoming blocks that break the line up. */
      :host([mobile]) .key-hints button {
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
        padding: 0 8px;
      }
      /* The fields it holds are cells of the form's grid, and a box around them
         would take their place in it and collapse the gaps between them. This
         element exists only to carry the id the More fields toggle names, so it
         lays nothing out — empty, it takes no room either. */
      .more-fields {
        display: contents;
      }
      .more-toggle {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: var(--hv-tap-min, auto);
        border: none;
        border-top: 1px solid var(--hv-divider);
        background: none;
        padding: 12px 0 0;
        font: 500 14.5px var(--hv-font);
        color: var(--hv-text);
        text-align: left;
      }
      .more-toggle .summary {
        margin-left: auto;
        font: 400 12px var(--hv-font);
        color: var(--hv-text-secondary);
      }
      /* The id is not read, it is pasted: user-select: all takes the whole uuid
         from a single click or long-press, which is the copy route left when
         the browser has no clipboard API (Home Assistant over plain http:// is
         not a secure context). A uuid carries no space to break at, so it may
         break anywhere rather than push the button off a phone's row — and it
         takes a row of its own above Delete, Cancel and Save, which have 343px
         to spend at 375px. */
      .id-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .id-row code {
        min-width: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11.5px;
        color: var(--hv-text-secondary);
        overflow-wrap: anywhere;
        -webkit-user-select: all;
        user-select: all;
      }
      /* Delete is hv-text-button danger from the shared sheet — the same
         borderless red every other destructive action in the card uses. The row
         is Delete, Cancel and Save, and only three labels wide: at 375px it has
         343px, which German's full "Gegenstand löschen" overruns by 9px and
         drops Save onto a line of its own. Hence the bare verb on the narrow
         branch; wrap is the last resort for a language longer still. */
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 4px;
        flex-wrap: wrap;
      }
      /* Save, Delete and Cancel sit at the bottom of a form inside a nested
         scroller, so they land below the fold on any host tall enough to need
         scrolling — a phone sheet, the card's list, and the expanded view,
         which caps the form at 70dvh. The editor answers that itself rather
         than each host growing a pinned footer of its own.
         Sticky goes on the wrapping cell, not on .actions: an element sticks
         only within its containing block, and .actions' parent is exactly as
         tall as .actions, while the cell's is the tall form grid. The negative
         side margins and matching padding bleed the opaque bar out to the
         form's edges, which .grid's 18px side padding would otherwise leave
         showing in two strips either side of it. */
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
      /* The auto margin lives on a spacer of its own, not on the hint: the hint
         is gone on a phone (no keyboard to press Esc with), and with the margin
         attached to it Cancel and Save fell back to the left edge — right next
         to Delete. */
      .actions .spacer {
        margin-left: auto;
      }
      .actions .hint {
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
      /* The property that drops the hint describes how wide the surface is,
         and turning a phone sideways makes it 760px wide — so the expanded
         view went back to telling a screen with no keyboard on it to press Esc
         and Ctrl+Enter. Whether there is a keyboard to press was never a width
         question, so ask the pointer instead: coarse in both orientations,
         fine on the desktop where the hint belongs. The chords themselves stay
         bound either way, for a phone that is docked to a keyboard. */
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
      /* A 72px square of photo is not a photo; every surface that shows one
         opens it full-size, and the strip is the one that did not. */
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
      /* A picture whose file the backend no longer has. The tile keeps its box
         so the strip does not reflow around it, and says what is wrong with the
         same amber mark the document rows carry. */
      .photos .placeholder.missing {
        gap: 4px;
        box-sizing: border-box;
        border: 1px dashed var(--hv-input-border);
        border-radius: 8px;
      }
      /* The one place the card-wide chip metric does not fit: this chip sits
         inside a 72px tile, where 11.5px on a single line would be clipped by
         the tile's own edge. */
      .photos .placeholder.missing .hv-chip {
        max-width: 100%;
        padding: 1px 5px;
        font-size: 10px;
        line-height: 1.2;
        white-space: normal;
        text-align: center;
      }
      /* Under the thumbnail rather than over it: these sit on whatever photo
         was uploaded, and no overlay treatment is legible against every one.
         The same 24px square the organize dialog's reorder buttons take, so
         one reordering control is one size across the card. A finger gets the
         strip's full height instead of the dialog's 44px square, because these
         are three controls sharing the width of the thumbnail they belong to
         and a square each would be wider than the tile. */
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
      /* The photo the list row and the detail header show. Filled and inert,
         so the mark reads the same whether it is a state or an action. */
      .tile-controls .is-cover {
        color: var(--hv-amber);
      }
      /* 24px is the floor WCAG asks of a pointer target, and also the ceiling
         a control sitting *on* a 72px thumbnail can take: a full tap-min square
         would cover a third of the photo it is asking about. The confirm step
         behind it is what makes the small target survivable. */
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
        /* Fixed dark chip rather than a theme colour: it sits on an arbitrary
           photo, so it needs its own contrast in light and dark alike. */
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
      /* Visually hidden but still focusable and still clicked by the label;
         display:none would take it out of the tab order entirely. */
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
      /* Desktop only: there is no drag on touch, so the over-state could only
         ever fire by accident there — the mobile branch renders no target at
         all. Outset so an empty section still has an edge to aim at, and drawn
         with outline rather than border so nothing inside shifts as the drag
         crosses in. */
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
      .documents .doc-icon {
        display: inline-grid;
        place-items: center;
        flex: none;
        color: var(--hv-text-secondary);
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
      /* A row rather than the photo picker's 72px square: a document has a
         name to read, so the control sits with the list it adds to. */
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
      /* Nothing on the WebSocket path reports bytes sent, so the bar says
         "working" and never lies about how far along it is. It takes the whole
         row width on a line of its own, because on a phone the file name and
         the state word already fill the first one. */
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
      /* Create mode has no attachment sections at all — an upload is filed
         against an item id and there is none yet. Said once, where the photo
         grid will be, rather than left as an unexplained absence. */
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
  /** Picture access; null hides the pictures section entirely. */
  /** The status vocabulary from `haventory/config`; the built-ins stand in
   * until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** Caps and accepted types, so a doomed file is refused before it is sent. */
  @property({ attribute: false }) mediaConfig: MediaConfig | null = null;
  /**
   * Creating a location from inside the picker, for an inventory that has none
   * yet — the form's most important field is otherwise unsatisfiable on a first
   * run. Null leaves the empty picker as a plain statement: only a host holding
   * the store can run the command, and an affordance that cannot is worse than
   * none.
   */
  @property({ attribute: false }) createLocation: ((name: string) => Promise<Location>) | null =
    null;

  /**
   * How this form asks before its own Cancel, ✕ or Escape throws typing away.
   *
   * The dialog belongs to the host, not to the form: the same question is asked
   * when a host switches rows or takes a sheet down, and one asker means one
   * wording and one prompt on screen however the user left. Null closes without
   * asking — every host in this card passes one, and a form that could not be
   * left at all would be worse than one that closes quietly.
   */
  @property({ attribute: false }) confirmDiscard: ConfirmDiscard | null = null;

  @state() private _model: ItemFormModel = formFromItem(null);
  @state() private _errors: FieldError[] = [];
  @state() private _showErrors = false;
  @state() private _moreOpen = false;
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
  /**
   * Files the picker is working through. A finished one leaves the list; a
   * failed one stays until it is retried or dismissed, so a sibling's success
   * cannot carry away the only report the user gets of a refused file.
   */
  @state() private _uploads: UploadEntry[] = [];
  /**
   * The item as the backend now holds it, once an upload has moved past the
   * `item` property. Each upload bumps the version, so a save that still used
   * the pre-upload one would come back `conflict`.
   */
  @state() private _uploaded: Item | null = null;
  /** The attachment awaiting a yes, and what kind it is. */
  @state() private _confirmRemove: { id: string; kind: AttachmentKind } | null = null;
  /** Which attachment section a drag is currently over, for the over-state. */
  @state() private _dropTarget: AttachmentKind | null = null;
  /** Which photo the lightbox was opened on, or null when it is closed. */
  @state() private _lightbox: number | null = null;
  /**
   * Whether the item's id was copied a moment ago. Set only on a copy the
   * browser confirmed — the button is the only feedback there is, so it must
   * not announce a clipboard that still holds something else.
   */
  @state() private _copiedId = false;
  private _copiedTimer?: ReturnType<typeof setTimeout>;
  /** Why creating a first location from the picker failed. */
  @state() private _locationError: string | null = null;
  /**
   * Locations this form created, until the `locations` prop carries them.
   *
   * The picker fills the Location field the moment the create resolves, but the
   * list it names from is a host property that reaches this form an update
   * later at the earliest. The created `Location` is in hand regardless, so
   * holding it is what keeps the field from reading "No location" in the gap —
   * the same defence `_uploaded` gives the attachment list.
   */
  @state() private _createdLocations: Location[] = [];

  private readonly _urls = new MediaUrls(this);
  /** Window width, for the two dialogs this form raises over itself. */
  private readonly _viewport = new ViewportNarrow(this);
  /** The location field: one location, so a pick finishes the job. */
  private readonly _location = new LocationPicker(this);
  private _uploadSeq = 0;
  /**
   * The item id `_model` was built from. `undefined` until the first update,
   * which is what makes that first pass build the form; `null` is the create
   * form, a real id every other case.
   */
  private _formItemId: string | null | undefined;

  /** The item to save against: whatever the last upload returned, else the input. */
  private get _current(): Item | null {
    return this._uploaded ?? this.item;
  }

  /**
   * The footer promises "Esc discards", but that is a keydown handler on the
   * editor root — it never fires while focus is still on the page body, which
   * is where it stayed when a row expanded. Focusing the name field also
   * scrolls the expander into view inside the list's scroller.
   */
  protected firstUpdated() {
    this.renderRoot.querySelector<HTMLInputElement>('[data-testid="editor-name"]')?.focus();
  }

  /**
   * The form belongs to an item *id*, not to one `item` object.
   *
   * Every host re-binds `.item` from a fresh lookup on each store broadcast, so
   * an upload finishing — or anyone editing the same row elsewhere — hands the
   * form a new object for the item being typed into, and rebuilding on that
   * throws away everything typed since the last save. Keyed on the id, a
   * different one (including the null→id hop a create makes when it saves) is a
   * different form; everything else is a refresh the open form absorbs.
   */
  protected willUpdate() {
    this._urls.configure(this.media?.sign ?? null);
    const id = this.item?.id ?? null;
    if (id !== this._formItemId) {
      this._formItemId = id;
      this._model = formFromItem(this.item);
      this._errors = [];
      this._showErrors = false;
      this._location.close();
      this._moreOpen = false;
      this._checkoutOpen = false;
      this._uploads = [];
      this._uploaded = null;
      this._confirmRemove = null;
      this._lightbox = null;
      this._locationError = null;
      this._createdLocations = [];
      this._clearCopied();
      this._closeCategory();
      return;
    }
    // `_uploaded` stands in for `item` only while the prop lags an upload's
    // result. Once the prop is at that version or past it, it is the fresher of
    // the two — holding the older copy would render stale attachments and send
    // a superseded `expectedVersion` on the next save.
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
    // `_current` as the baseline: the caps refuse growth past the stored item,
    // so a legacy over-cap value the form still carries is not an error.
    const errors = validateForm(this._model, this._current);
    this._errors = errors;
    this._showErrors = true;
    if (errors.length) return;
    // `_current`, not `item`: an upload made during this edit already moved the
    // version on, and saving against the stale one would fail with `conflict`.
    const current = this._current;
    const detail = current
      ? {
          itemId: current.id,
          expectedVersion: current.version,
          changes: toUpdatePayload(this._model, current),
        }
      : { itemId: null, expectedVersion: undefined, create: toCreatePayload(this._model) };
    this.dispatchEvent(new CustomEvent('save', { detail, bubbles: true, composed: true }));
  };

  private _cancel = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  /**
   * Every close this form owns: Cancel, the ✕, and Escape with nothing over it.
   *
   * A clean form goes at once. A dirty one hands the question to the host and
   * waits: `cancel` is sent only once the answer is yes, and it is the same
   * event either way, so a host closes the form on one signal however it went.
   */
  private _requestCancel = () => {
    const ask = this.confirmDiscard;
    if (!this.dirty || !ask) {
      this._cancel();
      return;
    }
    ask(() => this._cancel());
  };

  /**
   * Escape takes back one thing at a time.
   *
   * Whatever the form has open on top of itself goes first — a dropdown is what
   * the user just opened, and closing it is what the key is muscle memory for.
   * With nothing open, Escape means the form, and typing that has not been
   * saved is worth a question before it is thrown away. A clean form has
   * nothing to lose and closes on the spot.
   */
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

  /**
   * Rescue focus into the form when a surface over it closes with its opener
   * gone — the lightbox outliving the photo it was opened from. A dialog whose
   * opener is still there hands focus back itself.
   */
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
  private _text(
    field: keyof ItemFormModel,
    label: string,
    opts: { type?: string; testid: string } = { testid: '' },
  ) {
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
          if (opts.type === 'number') {
            this._patch({ [field]: raw === '' ? null : Number(raw) } as Partial<ItemFormModel>);
          } else {
            this._patch({ [field]: raw } as Partial<ItemFormModel>);
          }
        }}
      />
      ${error ? html`<span class="field-error" data-testid=${`${opts.testid}-error`}>${error}</span>` : null}
    </div>`;
  }

  /** The host's flat list, plus anything this form created that it still lacks. */
  private get _knownLocations(): Location[] {
    const known = this.locations ?? [];
    if (!this._createdLocations.length) return known;
    const extra = this._createdLocations.filter((c) => !known.some((l) => l.id === c.id));
    return extra.length ? [...known, ...extra] : known;
  }

  /**
   * The host's tree, plus the same additions as roots.
   *
   * The picker only ever creates a root with no area, so a created location
   * needs no placement inside the existing nodes and carries no children.
   */
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
      <span class="hv-label">${t('hv.editor.field.location')}</span>
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

  /**
   * Make the first location and file the item in it in one move.
   *
   * The picker is where a first-run user meets locations at all, so the one it
   * creates is also the one they were reaching for — anything else would send
   * them back through the same empty dropdown.
   */
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

  /**
   * What the dropdown shows right now. Typing narrows the list; the arrow
   * (and re-focusing the field) puts every category back, because a native
   * `<datalist>` only ever revealed matches for what you had already guessed.
   */
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

  /**
   * The editor marks a past due date as overdue, and it is the surface most
   * likely to be sitting open when the day turns over.
   */
  connectedCallback(): void {
    super.connectedCallback();
    this._dayUnsub = onDayChange(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._dayUnsub?.();
    this._dayUnsub = undefined;
    this._closeCategory();
    this._clearCopied();
  }

  private _dayUnsub?: () => void;

  private _clearCopied() {
    clearTimeout(this._copiedTimer);
    this._copiedTimer = undefined;
    this._copiedId = false;
  }

  /**
   * Put the item's id on the clipboard, and say so only if it got there.
   *
   * The label reverts on its own: a button that stays "Copied" reads as the
   * name of what it does, and the next copy would then look like a no-op.
   */
  private async _copyId(id: string) {
    if (!(await copyText(id))) return;
    clearTimeout(this._copiedTimer);
    this._copiedId = true;
    this._copiedTimer = setTimeout(() => {
      this._copiedId = false;
    }, COPIED_MS);
  }

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
      <label class="hv-label" for="editor-category">${t('hv.editor.field.category')}</label>
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

  /**
   * The stored condition, as a plain select.
   *
   * A three-value enum with a required answer is exactly what a native select
   * is for; the flagged states surface as chips on the row and sheet, so the
   * editor only needs the value to be settable, not loud.
   */
  private _renderStatusField() {
    return html`<div class="cell">
      <label class="hv-label" for="editor-status">${t('hv.editor.field.status')}</label>
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
   * The checkout, and the one date that is not part of it.
   *
   * A due date is half of the checkout — it means something only while an item
   * is out, which is why it is disabled otherwise and why `commonFields()`
   * nulls it on save; the inspection date stands whether or not anyone has
   * borrowed it. As three equal thirds of a row the fields read as three
   * settings of one kind, so the two boxes below carry the distinction on both
   * widths.
   *
   * The state is a button, not a switch: a switch says "a property of the item,
   * set it either way", and checking out is an act. Same words and icons as the
   * detail sheet, so the two surfaces cannot teach different things. It writes
   * `checkedOut` into the form model rather than firing the WS command — this
   * editor also creates items, which have no id to check out yet.
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
              ${t('hv.editor.dueDate')}
            </label>
            <input
              id="editor-due"
              class="hv-input due-input"
              type="date"
              data-testid="editor-due-date"
              ?disabled=${!model.checkedOut}
              title=${model.checkedOut ? '' : dueDateHint()}
              .value=${model.dueDate}
              @input=${(e: Event) => this._patch({ dueDate: (e.target as HTMLInputElement).value })}
            />
            ${model.checkedOut
              ? null
              : html`<span class="group-hint" data-testid="editor-due-hint">${dueDateHint()}</span>`}
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
              // Purely a form event: nothing outside this editor should act on
              // it, and the shell would fire the real WS command if it did.
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
            ${icon('calendar', 14)} ${t('hv.editor.nextInspection')}
          </label>
          <div class="group-body">
            <input
              id="editor-inspection"
              class="hv-input"
              type="date"
              data-testid="editor-inspection-date"
              .value=${model.inspectionDate}
              @input=${(e: Event) => this._patch({ inspectionDate: (e.target as HTMLInputElement).value })}
            />
            ${this._renderInspectionOffsets(model.inspectionDate)}
          </div>
        </div>
        ${this._renderReminderFields()}
      </div>
    </div>`;
  }

  /**
   * A date that comes round again — "change the HVAC filter every 3 months".
   *
   * Two controls for one setting: the date is when it next comes round, the
   * repeat is optional beside it, and an empty repeat is a one-off — which is
   * why the count is blank rather than 1. The pair is written with the rest of
   * the form, not through `haventory/reminder/set`: one save, one version bump,
   * one conflict to resolve. The dedicated commands exist for automations,
   * which have no form to carry the other fields.
   */
  private _renderReminderFields() {
    const model = this._model;
    return html`<div class="group reminder" role="group" aria-labelledby="editor-reminder-caption">
      <span class="hv-label group-caption" id="editor-reminder-caption" data-testid="editor-reminder-caption">
        ${icon('clock', 14)} ${t('hv.editor.reminder')}
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
            title=${model.reminderDate ? '' : reminderHint()}
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
          : html`<span class="group-hint" data-testid="editor-reminder-hint">${reminderHint()}</span>`}
      </div>
    </div>`;
  }

  /**
   * Checking out asks for a due date; checking in just happens.
   *
   * The same `hv-checkout-popover` the detail sheet uses — quick offsets, a
   * date, a "no due date" way out — anchored under the button on a wide screen
   * and expanded inside the box on a phone. Confirming patches the form model
   * only; the item is written on save, which is what lets it work while
   * creating an item that has no id to check out yet.
   */
  /**
   * The same quick jumps the check-out popover offers, on the one date it does
   * not own. An inspection interval is known in weeks or months rather than as
   * a calendar square, and typing a date three months out means doing the
   * arithmetic yourself; pressing an offset writes the date into the field
   * above, so the two controls are one value with two ways in. The custom row
   * appears only once "+X days" is pressed — the escape hatch for an interval
   * the three presets do not cover, not a fourth preset.
   */
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
   * Why this file cannot be uploaded, or null when it can.
   *
   * A courtesy check against the caps `haventory/config` reports, so an 80 MB
   * video is refused instantly instead of after a minute of upload; the backend
   * re-derives all of it from the file's own bytes and is the only thing that
   * decides. A cap the config does not report is not checked at all — an older
   * backend that never mentioned documents still enforces its own limit, and
   * guessing one would refuse a file the server would have taken.
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

  /**
   * Report a failed attachment command in the queue the uploads already use.
   *
   * A reorder, a removal and a retitle all fail the same way and have nowhere
   * else to be seen — the item they act on is unchanged, so nothing on the form
   * would move. The entry carries no `File`, so it offers dismiss and no Retry.
   */
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
   * Upload the picked files, one at a time.
   *
   * Sequential rather than parallel: every upload bumps the item's version and
   * returns the whole attachment list as of that moment, so two in flight would
   * race and the loser's picture would vanish from the form's copy of the item.
   * A file that fails keeps its own error message and leaves the queue behind
   * it running.
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
   * One file, from preflight to attached — the unit both the picker and Retry
   * work in, so a retried file goes through exactly what it did the first time.
   *
   * The shrink happens here rather than in the picker's handler because it is
   * what makes the byte cap pass: a phone photo is checked against the cap
   * *after* it has been re-encoded, so an 11 MB frame is measured at the size
   * it will actually be sent at.
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

  /** Send one failed file again, exactly as it was picked. */
  private async _retryUpload(id: string) {
    const entry = this._uploads.find((u) => u.id === id);
    if (entry?.file) await this._sendOne(entry);
  }

  /**
   * Drop one entry from the queue, and only that one. An upload clears its own
   * row when it succeeds and a different item rebuilds the form; nothing else
   * touches the queue, so an error row is the user's to dismiss.
   */
  private _dismissUpload(id: string) {
    this._uploads = this._uploads.filter((u) => u.id !== id);
  }

  /**
   * Move one attachment within its kind, and adopt the item that comes back.
   *
   * `delta` of `-Infinity` is "make this the cover" — the same command, since
   * position 0 is what makes a picture the cover and there is no flag to set.
   */
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

  /**
   * Delete one attachment, once it has been confirmed.
   *
   * Every other destructive action on the card asks first, and this one destroys
   * the only copy of a file the household may not have anywhere else — so the
   * buttons open `_confirmRemove` and only this runs the command.
   */
  private async _removeAttachment(attachmentId: string, kind: AttachmentKind) {
    const media = this.media;
    const item = this._current;
    if (!media || !item) return;
    try {
      this._uploaded = await media.remove(item.id, attachmentId);
      // The guard handed focus back to the control that raised it, and that
      // control was this tile's own remove button — still there at the time,
      // gone the moment the strip redraws without the tile. Nobody else is
      // watching for that: the guard closed cleanly and the form is still up.
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
   * Move and cover controls under one thumbnail.
   *
   * Buttons rather than a drag handle, matching the organize dialog's status
   * rows: one reordering idiom across the card, and both work from a keyboard
   * without a second implementation beside the pointer one. The star is the
   * cover in both directions — filled and inert on the photo that already is
   * one, a button on every other — because the list row and the detail header
   * show position 0.
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

  /**
   * The picture picker and the photos already attached.
   *
   * Only when editing an existing item: an attachment is filed against an item
   * id, and a new item has none until it is saved.
   */
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
          // The tile, not the picture: tapping one opens the lightbox, which
          // asks for the stored file itself.
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
        <label class="picker" data-testid="editor-photo-picker">
          ${icon('camera', 20)}
          <span>${t('hv.editor.addPhoto')}</span>
          <!-- capture="environment" is what opens the companion app's camera
               straight from this control; a browser without one ignores it and
               shows the ordinary file picker. -->
          <input
            class="reveal"
            type="file"
            accept=${accepted}
            capture="environment"
            multiple
            data-testid="editor-photo-input"
            @change=${(e: Event) => this._onPicked(e, 'picture')}
          />
        </label>
      </div>
      ${this._renderUploadList('picture')}
    </div>`;
  }

  /**
   * Why the photo grid is not here yet, in create mode.
   *
   * An attachment is filed against an item id and a new item has none, so the
   * sections cannot exist before the first save. Unexplained, that absence
   * reads as a missing feature at exactly the moment the user is holding the
   * object they wanted to photograph.
   */
  private _renderCreateAttachmentHint() {
    if (this.item !== null || !this.media) return null;
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.editor.attachmentsLater')}</span>
      <span class="attach-hint" data-testid="editor-attachment-hint">
        ${t('hv.editor.attachmentsHint')}
      </span>
    </div>`;
  }

  /**
   * The string every `haventory.*` action names this item by, as `item_id`.
   *
   * This form is the only surface a desktop gets: the detail sheet that also
   * prints the id opens on a card element of 600px or less, and in the full
   * view only below the 700px viewport query — while automation YAML is written
   * on a wide screen. Last in the grid, below the fields and above the actions:
   * it is a fact about the item, not something to fill in. The create form has
   * no id yet and says nothing rather than showing a blank.
   */
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
          @click=${() => void this._copyId(id)}
        >
          ${this._copiedId ? t('hv.action.copied') : t('hv.action.copy')}
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
   * Which section a dropped file belongs in, decided by the file and not by
   * where it landed.
   *
   * A PDF dragged onto the photo strip is a manual — refusing it because of the
   * cell it crossed would be arguing with something the user can see. Anything
   * that is neither is left to `_preflight`, which is the one place that knows
   * what the backend accepts and phrases the refusal.
   */
  private _kindFor(file: File): AttachmentKind {
    return file.type.startsWith('image/') ? 'picture' : 'manual';
  }

  /**
   * Attach dropped files, routing each by its own type.
   *
   * `_uploadFiles` runs a queue per call, and the two queues would interleave
   * their version bumps, so a mixed drop is sent as pictures first and then
   * manuals rather than as one call per file.
   */
  private async _onDrop(e: DragEvent) {
    e.preventDefault();
    this._dropTarget = null;
    if (this.mobile) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    const pictureFiles = files.filter((f) => this._kindFor(f) === 'picture');
    const manualFiles = files.filter((f) => this._kindFor(f) === 'manual');
    if (pictureFiles.length) await this._uploadFiles(pictureFiles, 'picture');
    if (manualFiles.length) await this._uploadFiles(manualFiles, 'manual');
  }

  /**
   * `dragover` must be cancelled or the browser treats the drop as navigation
   * and replaces the page with the dropped file — taking the whole open form
   * with it. Home Assistant's frontend does not block that, so the editor root
   * cancels both events whatever the layout: `mobile` here is the card
   * element's width, and a narrow card in a desktop window still has a mouse
   * with a file on the end of it.
   */
  private _onRootDragOver(e: DragEvent) {
    e.preventDefault();
  }

  private _onRootDrop(e: DragEvent) {
    e.preventDefault();
    this._dropTarget = null;
  }

  private _onDragOver(e: DragEvent, target: AttachmentKind) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    this._dropTarget = target;
  }

  private _onDragLeave(target: AttachmentKind) {
    if (this._dropTarget === target) this._dropTarget = null;
  }

  /**
   * The drag-and-drop bindings a section's drop target needs, or none at all on
   * a phone: there is no drag on touch, so an over-state could only ever fire by
   * accident. Lit removes a listener bound to `undefined`, so the mobile branch
   * really carries no target rather than a target that declines.
   */
  private _dropBindings(kind: AttachmentKind) {
    if (this.mobile) return { over: undefined, leave: undefined, drop: undefined };
    return {
      over: (e: DragEvent) => this._onDragOver(e, kind),
      leave: () => this._onDragLeave(kind),
      drop: (e: DragEvent) => void this._onDrop(e),
    };
  }

  /**
   * Rename one document.
   *
   * On `change`, not `input`: a keystroke-per-command would bump the item's
   * version on every letter typed, and every one of those is a broadcast to
   * every open card.
   */
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
   * The documents already attached, and the picker that adds one.
   *
   * Each row carries its own title field because a filename is what a scanner
   * or a manufacturer chose — `scan_0142.pdf` says nothing about which
   * appliance it belongs to — and an empty title falls back to the filename
   * rather than blanking the row. No `capture` on this input: a document comes
   * from the file system, and pointing the control at the camera would put a
   * photo of a page where the PDF should be. Each row opens from here as well
   * as from the detail sheet's read view, which is a phone surface — on a
   * desktop this form is the only place a manual is reachable at all.
   */
  private _renderDocuments() {
    const item = this._current;
    if (!item || !this.media) return null;
    const docs = manuals(item.attachments);
    const accepted = this.mediaConfig?.manual_mime_types?.join(',') ?? 'application/pdf';

    const drop = this._dropBindings('manual');
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.editor.documents')}</span>
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

  /**
   * What the upload queue is doing, under the section it is doing it to.
   *
   * One list per kind keeps each report beside the control that started it: a
   * single queue below both pickers puts a phone's photo uploads two sections
   * away from the grid they are filling, and reports a refused document under
   * "Photos".
   */
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
          ${entry.state === 'error' && entry.file
            ? html`<button
                class="retry"
                data-testid="editor-upload-retry"
                aria-label=${t('hv.editor.upload.retryNamed', { name: entry.name })}
                @click=${() => void this._retryUpload(entry.id)}
              >
                ${t('hv.action.repeat')}
              </button>`
            : null}
          ${entry.state === 'error'
            ? html`<button
                class="dismiss"
                data-testid="editor-upload-dismiss"
                aria-label=${t('hv.editor.upload.dismissNamed', { name: entry.name })}
                @click=${() => this._dismissUpload(entry.id)}
              >
                ${icon('close', 13)}
              </button>`
            : null}
          ${entry.state === 'error'
            ? null
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

  private _renderMoreFields() {
    const model = this._model;
    const summary = [
      model.description ? t('hv.editor.summary.description') : null,
      model.dueDate || model.inspectionDate ? t('hv.editor.summary.dates') : null,
      // Named separately from the dates: a reminder is the one thing in here a
      // household set deliberately, and folding it into "dates" would hide it
      // behind a word that is already true of half the items.
      model.reminderDate ? t('hv.editor.summary.reminder') : null,
      model.customFields.length
        ? t('hv.editor.summary.custom', { count: model.customFields.length })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return html`
      <button
        class="more-toggle"
        data-testid="editor-more-toggle"
        aria-expanded=${String(this._moreOpen)}
        aria-controls=${MORE_FIELDS_ID}
        @click=${() => {
          this._moreOpen = !this._moreOpen;
        }}
      >
        ${icon(this._moreOpen ? 'chevronDown' : 'chevronRight', 19)} ${t('hv.editor.moreFields')}
        <span class="summary">${summary || t('hv.editor.moreSummaryFallback')}</span>
      </button>
      <div class="more-fields" id=${MORE_FIELDS_ID}>
        ${this._moreOpen
          ? html`
              <div class="cell span3">
                <label class="hv-label" for="editor-description"
                  >${t('hv.editor.field.description')}</label
                >
                <textarea
                  id="editor-description"
                  class="hv-input"
                  data-testid="editor-description"
                  .value=${model.description}
                  @input=${(e: Event) =>
                    this._patch({ description: (e.target as HTMLTextAreaElement).value })}
                ></textarea>
              </div>
              ${this._renderStateFields()} ${this._renderCustomFields()}
            `
          : null}
      </div>
    `;
  }

  render() {
    const model = this._model;
    const creating = this.item === null;
    const overdue = isOverdue(this.item?.due_date);

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
          ${this._text('name', t('hv.editor.field.name'), { testid: 'editor-name' })}
          ${this._text('quantity', t('hv.editor.field.quantity'), {
            type: 'number',
            testid: 'editor-quantity',
          })}
          ${this._text('lowStock', t('hv.editor.field.lowStock'), {
            type: 'number',
            testid: 'editor-low-stock',
          })}
          ${this.mobile
            ? null
            : html`<div class="cell span2">
                  <label class="hv-label" for="editor-description-desktop"
                    >${t('hv.editor.field.description')}</label
                  >
                  <textarea
                    id="editor-description-desktop"
                    class="hv-input"
                    data-testid="editor-description"
                    .value=${model.description}
                    @input=${(e: Event) => this._patch({ description: (e.target as HTMLTextAreaElement).value })}
                  ></textarea>
                </div>
                ${this._renderStatusField()}`}
          ${this._renderLocationField()} ${this._renderCategoryField()}
          ${this.mobile ? this._renderStatusField() : null}
          <div class="cell span3">
            <span class="hv-label"
              >${t('hv.editor.field.tags')}
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
          ${this.mobile
            ? html`<div class="cell span3">${this._renderMoreFields()}</div>`
            : html`${this._renderStateFields()} ${this._renderCustomFields()}`}

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

      <!-- Outside the form's own keydown scope, and its events stopped here: a
           host listens for the cancel event on this editor to close it, and a
           dialog saying "no, keep the photo" must not read as "close the
           form".

           The mobile flag below is the viewport, not this form's own mobile
           property: the dialog is fixed to the window, so the card's width says
           nothing about the room it has. -->
      <hv-confirm
        data-testid="editor-remove-confirm"
        ?open=${this._confirmRemove !== null}
        ?mobile=${this._viewport.narrow}
        .heading=${removeCopy(this._confirmRemove?.kind ?? 'picture').heading}
        .message=${removeCopy(this._confirmRemove?.kind ?? 'picture').message}
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
