import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { keyed } from 'lit/directives/keyed.js';
import { ref } from 'lit/directives/ref.js';
import { emitter } from '../events';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { counted } from '../ui/plural';
import {
  DEFAULT_STATUS,
  STATUS_COLORS,
  STATUS_ICONS,
  displayLabel,
  hexToneStyle,
  isHexColor,
  knownIcon,
  renderStatusChip,
  slugFromLabel,
  statusCount,
  statusLabel,
  statusList,
} from '../ui/status';
import {
  SliceWatch,
  errorText,
  organizeTab,
  renderFailure,
  renderFooter,
  renderToolbar,
  reveal,
} from '../ui/organize-tab';
import type { Store } from '../store/store';
import type { StatusColorValue, StatusDefinition, StoreState } from '../store/types';

/**
 * What the colour input opens on, since a native one has no empty state. It is
 * stored only once the picker reports a choice, and is held off the ten tones
 * so an accidental accept is visibly custom.
 */
const CUSTOM_COLOR_SEED = '#7b5ea7';

/**
 * The organize dialog's Statuses tab: the vocabulary in display order, reorder,
 * create and rename with a colour and a glyph, and a guarded delete that
 * reassigns the items still carrying the slug. It owns the open editor, the
 * guard and their drafts; it talks to the store directly and tells the dialog
 * with `browse` when a count is picked, leaving the closing to the dialog.
 */
@customElement('hv-organize-statuses')
export class HVOrganizeStatuses extends LitElement {
  static override styles = [
    tokens,
    base,
    chip,
    organizeTab,
    css`
      /* Arrow buttons rather than a drag handle, so reordering works from the
         keyboard; side by side so the row is no taller than on other tabs. */
      .move {
        display: flex;
        flex-direction: row;
        flex: none;
        gap: 3px;
      }
      /* Above WCAG 2.2's 24px pointer target. */
      .move button {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: none;
        background: none;
        color: var(--hv-text-tertiary);
        cursor: pointer;
        padding: 0;
        line-height: 0;
      }
      /* A phone stacks them: a 44px pair side by side does not fit the row. */
      :host([mobile]) .move {
        flex-direction: column;
        gap: 1px;
      }
      :host([mobile]) .move button {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      .move button:hover:not([disabled]) {
        color: var(--hv-text);
      }
      .move button[disabled] {
        opacity: 0.3;
        cursor: default;
      }
      /* The stored slug, muted; a title attribute carries one that elides. */
      .status-slug {
        font: 400 12px var(--hv-font);
        color: var(--hv-text-tertiary);
        white-space: nowrap;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* A long label must shrink, or it pushes the delete button off a phone row. */
      .status-row .hv-status-chip {
        flex: 0 1 auto;
        min-width: 0;
      }
      .status-name {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }
      .status-name .control {
        flex: 1 1 180px;
        width: auto;
      }
      /* In the editor the slug is for automation writers: it wraps, never elides. */
      .status-name .status-slug {
        flex: 0 0 auto;
        max-width: 100%;
      }
      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 2px 0 4px;
      }
      /* A swatch shows the tone's tint and ink both, with the status glyph as
         the ink: a bare fill leaves the light tints all but identical. */
      .swatch {
        justify-content: center;
        width: 34px;
        height: 26px;
        border-radius: var(--hv-radius-chip);
        cursor: pointer;
        padding: 0;
      }
      :host([mobile]) .swatch {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      /* Stands in for a glyph this bundle does not carry. */
      .swatch .letters {
        font: 600 12px var(--hv-font);
      }
      .glyph {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 26px;
        border-radius: var(--hv-radius-input);
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-text-secondary);
        cursor: pointer;
      }
      .glyph:hover {
        background: var(--hv-hover-overlay);
      }
      :host([mobile]) .glyph {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      /* A household's own colour: the native colour input, which cannot be
         styled to match, is stretched invisibly over the swatch and the focus
         ring is drawn from the swatch around it. */
      .swatch.custom {
        position: relative;
        overflow: hidden;
        /* The unchosen face, written as the pair .hv-status-chip reads: a
           background longhand would outrank the inline pair a chosen colour
           arrives as. */
        --hv-status-bg: var(--hv-chip-bg);
        --hv-status-fg: var(--hv-text-secondary);
      }
      .swatch.custom > input[type='color'] {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        padding: 0;
        border: none;
        cursor: pointer;
      }
      .swatch.custom:focus-within {
        outline: 2px solid var(--hv-primary);
        outline-offset: 1px;
      }
      .swatch.on,
      .glyph.on {
        outline: 2px solid var(--hv-primary);
        outline-offset: 1px;
      }
      .glyph.on {
        color: var(--hv-primary-darker);
      }
      .status-guard .guard-message {
        flex: 1 1 100%;
      }
      .status-guard .actions {
        flex: 1 1 auto;
      }
      :host([mobile]) .status-guard {
        flex-direction: column;
        align-items: stretch;
      }
      :host([mobile]) .status-guard .guard-message,
      :host([mobile]) .status-guard .actions {
        flex: none;
      }
      .guard-target {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        flex: 1 1 auto;
        min-width: 0;
      }
      .guard-target > span {
        flex: none;
      }
      .guard-target select.control {
        flex: 1 1 auto;
        width: auto;
        min-width: 140px;
      }
      /* A step softer than .failure: the household may go ahead regardless. */
      .hint {
        display: flex;
        gap: 8px;
        padding: 9px 11px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12.5px;
      }
    `,
  ];

  @property({ attribute: false }) store!: Store;
  @property({ type: Boolean, reflect: true }) mobile = false;
  /**
   * True during the update that puts the dialog on screen, when the dialog's
   * Modal owns focus, so a disclosure re-attached then must not take it.
   */
  @property({ attribute: false }) opening: () => boolean = () => false;

  private readonly _view = new SliceWatch(this, ['config', 'stats']);
  private readonly _emit = emitter<'hv-organize-statuses'>(this);

  @state() private _editingStatus: string | 'new' | null = null;
  @state() private _statusLabel = '';
  @state() private _statusColor: StatusColorValue = 'neutral';
  @state() private _statusIcon = 'check';
  @state() private _statusError: string | null = null;
  /** A delete refused because items still carry the slug, and how many. */
  @state() private _statusGuard: { slug: string; count: number } | null = null;
  @state() private _reassignTarget = '';

  private get st(): StoreState | null {
    return this._view.state;
  }

  private _reveal = (el?: Element) => reveal(el, this.opening());

  /** The live vocabulary, or the built-ins until `haventory/config` answers. */
  private get _statusDefs(): readonly StatusDefinition[] {
    return statusList(this.st?.statuses);
  }

  /** How many items carry a slug; 0 until the counts catch up with a new one. */
  private _statusCount(slug: string): number {
    return statusCount(this.st?.statsCounts, slug) ?? 0;
  }

  /**
   * The displayed label of another status the one being typed would duplicate,
   * or null. Compared against what each status displays, since that is what
   * would be indistinguishable on the card.
   */
  private get _duplicateLabel(): string | null {
    const typed = this._statusLabel.trim().toLowerCase();
    if (!typed) return null;
    const editing = this._editingStatus;
    const clash = this._statusDefs.find(
      (d) => d.slug !== editing && displayLabel(d).trim().toLowerCase() === typed,
    );
    return clash ? displayLabel(clash) : null;
  }

  private _startStatusEdit(slug: string | 'new') {
    const existing = slug === 'new' ? undefined : this._statusDefs.find((d) => d.slug === slug);
    this._editingStatus = slug;
    // The stored label, never the displayed one: seeded with a translation, a
    // save would rename a built-in for every language.
    this._statusLabel = existing?.label ?? '';
    this._statusColor = existing?.color ?? 'neutral';
    this._statusIcon = existing?.icon ?? 'check';
    this._statusError = null;
    this._statusGuard = null;
  }

  private _cancelStatusEdit() {
    this._editingStatus = null;
    this._statusError = null;
  }

  private async _saveStatus() {
    const label = this._statusLabel.trim();
    if (!label) return;
    const editing = this._editingStatus;
    try {
      if (editing === 'new') {
        await this.store?.createStatus({
          slug: slugFromLabel(label, this.st?.statuses),
          label,
          color: this._statusColor,
          icon: this._statusIcon,
        });
      } else if (editing) {
        await this.store?.updateStatus(editing, {
          label,
          color: this._statusColor,
          icon: this._statusIcon,
        });
      }
      this._editingStatus = null;
      this._statusError = null;
    } catch (err) {
      this._statusError = errorText(err, 'hv.organize.statusSaveFailed');
    }
  }

  /**
   * Move a status one place. `status/reorder` takes the whole permutation, so a
   * partial list cannot leave two definitions claiming one position.
   */
  private async _moveStatus(slug: string, delta: -1 | 1) {
    const slugs = this._statusDefs.map((d) => d.slug);
    const from = slugs.indexOf(slug);
    const to = from + delta;
    const moved = slugs[from];
    const displaced = slugs[to];
    if (moved === undefined || displaced === undefined) return;
    slugs[from] = displaced;
    slugs[to] = moved;
    try {
      await this.store?.reorderStatuses(slugs);
    } catch (err) {
      this._statusError = errorText(err, 'hv.organize.statusReorderFailed');
    }
  }

  /**
   * Ask before deleting, in one inline disclosure; an in-use status adds the
   * reassign select, since the backend refuses a delete that strands items.
   */
  private _askDeleteStatus(slug: string) {
    const count = this._statusCount(slug);
    this._statusGuard = { slug, count };
    this._reassignTarget = count > 0 ? (this._statusDefs.find((d) => d.slug !== slug)?.slug ?? '') : '';
  }

  /** Send the delete, reassigning the items that carry the slug if any do. */
  private async _deleteStatus(slug: string, reassignTo?: string) {
    try {
      await this.store?.deleteStatus(slug, reassignTo);
      this._statusGuard = null;
      this._statusError = null;
    } catch (err) {
      this._statusError = errorText(err, 'hv.organize.statusDeleteFailed');
    }
  }

  /**
   * The dialog re-attaches this tab as it was, on a return to the tab or a
   * re-opening, and the list starts from its top as a freshly drawn one would.
   */
  override connectedCallback(): void {
    super.connectedCallback();
    const body = this.renderRoot.querySelector('.body');
    if (body) body.scrollTop = 0;
  }

  override render() {
    const defs = this._statusDefs;
    return html`
      ${renderToolbar({
        count: counted(defs.length, 'status'),
        countTestid: 'organize-status-count',
        newTestid: 'organize-new-status',
        newLabel: t('hv.organize.newStatus'),
        onNew: () => this._startStatusEdit('new'),
      })}
      <div class="body">
        ${this._editingStatus === 'new' ? this._renderStatusEditor('new') : null}
        ${defs.map((d, index) => {
          const isDefault = d.slug === DEFAULT_STATUS;
          const count = this._statusCount(d.slug);
          // What the chip says, so a screen reader names the row the same way.
          const shown = displayLabel(d);
          return html`
            <div class="value-row status-row" data-testid="status-row" data-value=${d.slug}>
              <span class="move">
                <button
                  data-testid="status-up"
                  aria-label=${t('hv.organize.statusMoveUp', { label: shown })}
                  title=${t('hv.term.moveUp')}
                  ?disabled=${index === 0}
                  @click=${() => this._moveStatus(d.slug, -1)}
                >
                  ${icon('chevronUp', 18)}
                </button>
                <button
                  data-testid="status-down"
                  aria-label=${t('hv.organize.statusMoveDown', { label: shown })}
                  title=${t('hv.term.moveDown')}
                  ?disabled=${index === defs.length - 1}
                  @click=${() => this._moveStatus(d.slug, 1)}
                >
                  ${icon('chevronDown', 18)}
                </button>
              </span>
              ${renderStatusChip(d.slug, defs, { testid: 'status-chip' })}
              <button class="count-link" data-testid="status-count" @click=${() => this._showStatus(d.slug)}>
                ${counted(count, 'item')}
              </button>
              <span class="row-actions">
                ${
                  isDefault
                    ? html`<span class="hv-chip quiet" data-testid="status-default"
                      >${t('hv.organize.statusDefault')}</span
                    >`
                    : null
                }
                <button
                  data-testid="status-edit"
                  aria-label=${t('hv.organize.statusEdit', { label: shown })}
                  title=${t('hv.action.edit')}
                  @click=${() => this._startStatusEdit(d.slug)}
                >
                  ${icon('pencil', 16)}
                </button>
                ${
                  isDefault
                    ? null
                    : html`
                      <button
                        class="danger"
                        data-testid="status-remove"
                        aria-label=${t('hv.organize.statusDelete', { label: shown })}
                        title=${t('hv.action.delete')}
                        @click=${() => this._askDeleteStatus(d.slug)}
                      >
                        ${icon('del', 16)}
                      </button>
                    `
                }
              </span>
            </div>
            ${this._editingStatus === d.slug ? this._renderStatusEditor(d.slug) : null}
            ${this._statusGuard?.slug === d.slug ? this._renderStatusGuard(this._statusGuard) : null}
          `;
        })}
        ${this._editingStatus ? null : renderFailure('status-error', this._statusError)}
      </div>
    `;
  }

  /** Take the user to the items on a status, the way a value count does. */
  private _showStatus(slug: string) {
    this.store?.setFilters({ status: slug });
    this._emit('browse');
  }

  private _renderStatusEditor(slug: string | 'new') {
    const creating = slug === 'new';
    const derived = creating ? slugFromLabel(this._statusLabel, this.st?.statuses) : slug;
    const duplicate = this._duplicateLabel;
    const glyph = knownIcon(this._statusIcon);
    const custom = isHexColor(this._statusColor) ? this._statusColor : null;
    const face = glyph ? icon(glyph, 15) : html`<span class="letters">Aa</span>`;
    // While the box holds an untranslated stored label, show what it prints as,
    // so the English is not "corrected" into a rename for everyone.
    const stored = creating ? undefined : this._statusDefs.find((d) => d.slug === slug);
    const shown = stored ? displayLabel(stored) : null;
    const printsAs = stored && this._statusLabel === stored.label && shown !== stored.label ? shown : null;
    return keyed(
      slug,
      html`<div class="expander" data-testid="status-editor" data-field="#org-status-label" ${ref(this._reveal)}>
        <label class="status-name">
          <span class="hv-sr-only">${t('hv.organize.statusName')}</span>
          <input
            id="org-status-label"
            class="control"
            data-testid="status-label"
            placeholder=${t('hv.organize.statusNamePlaceholder')}
            .value=${this._statusLabel}
            @input=${(e: Event) => {
              this._statusLabel = (e.target as HTMLInputElement).value;
              this._statusError = null;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') void this._saveStatus();
            }}
          />
          <span class="status-slug" data-testid="status-slug-preview" title=${derived}
            >${derived}</span
          >
          ${
            printsAs === null
              ? null
              : html`<span class="hv-chip quiet" data-testid="status-shown">${printsAs}</span>`
          }
        </label>
        ${
          duplicate
            ? html`<div class="hint" data-testid="status-duplicate-hint">
              ${t('hv.organize.statusDuplicate', { label: duplicate })}
            </div>`
            : null
        }

        <span class="hv-label">${t('hv.organize.colour')}</span>
        <div class="swatches" data-testid="status-colors">
          ${STATUS_COLORS.map(
            (c) => html`<button
              class="swatch hv-status-chip tone-${c.replace(/_/g, '-')} ${this._statusColor === c ? 'on' : ''}"
              data-testid="status-color"
              data-value=${c}
              aria-label=${c.replace(/_/g, ' ')}
              aria-pressed=${String(this._statusColor === c)}
              @click=${() => {
                this._statusColor = c;
              }}
            >
              ${face}
            </button>`,
          )}
          <label
            class="swatch custom hv-status-chip ${custom ? 'on' : ''}"
            style=${ifDefined(custom ? hexToneStyle(custom) : undefined)}
            data-testid="status-color-custom"
          >
            <input
              type="color"
              data-testid="status-color-hex"
              aria-label=${t('hv.organize.customColour')}
              .value=${custom ?? CUSTOM_COLOR_SEED}
              @input=${(e: Event) => {
                this._statusColor = (e.target as HTMLInputElement).value.toLowerCase();
              }}
            />
            ${face}
          </label>
        </div>
        ${
          custom
            ? html`<div class="hint" data-testid="status-color-custom-hint">
              ${t('hv.organize.customColourHint', { hex: custom })}
            </div>`
            : null
        }

        <span class="hv-label">${t('hv.organize.icon')}</span>
        <div class="swatches" data-testid="status-icons">
          ${STATUS_ICONS.map(
            (name) => html`<button
              class="glyph ${this._statusIcon === name ? 'on' : ''}"
              data-testid="status-icon"
              data-value=${name}
              aria-label=${name}
              aria-pressed=${String(this._statusIcon === name)}
              @click=${() => {
                this._statusIcon = name;
              }}
            >
              ${icon(name, 16)}
            </button>`,
          )}
        </div>

        ${renderFailure('status-editor-error', this._statusError)}
        ${renderFooter({
          cancelTestid: 'status-cancel',
          onCancel: () => this._cancelStatusEdit(),
          testid: 'status-save',
          label: creating ? t('hv.action.create') : t('hv.action.save'),
          disabled: !this._statusLabel.trim(),
          onCommit: () => void this._saveStatus(),
        })}
      </div>`,
    );
  }

  private _renderStatusGuard(guard: { slug: string; count: number }) {
    const label = statusLabel(guard.slug, this._statusDefs);
    const targets = this._statusDefs.filter((d) => d.slug !== guard.slug);
    const inUse = guard.count > 0;
    return keyed(
      guard.slug,
      html`<div
        class="expander guard status-guard"
        data-testid="status-guard"
        role="alert"
        ${ref(this._reveal)}
      >
        <span class="guard-message" data-testid="status-guard-message"
          >${
            inUse
              ? t('hv.organize.statusInUse', { label, items: counted(guard.count, 'item') })
              : t('hv.organize.statusUnused', { label })
          }</span
        >
        ${
          inUse
            ? html`<label class="guard-target">
              <span>${t('hv.organize.moveThoseItemsTo')}</span>
              <select
                class="control"
                data-testid="status-reassign"
                .value=${this._reassignTarget}
                @change=${(e: Event) => {
                  this._reassignTarget = (e.target as HTMLSelectElement).value;
                }}
              >
                ${targets.map((d) => html`<option value=${d.slug}>${displayLabel(d)}</option>`)}
              </select>
            </label>`
            : null
        }
        ${renderFooter({
          cancelTestid: 'status-guard-cancel',
          onCancel: () => {
            this._statusGuard = null;
          },
          testid: 'status-guard-confirm',
          label: inUse ? t('hv.organize.reassignAndDelete') : t('hv.action.delete'),
          danger: true,
          onCommit: () => void this._deleteStatus(guard.slug, inUse ? this._reassignTarget : undefined),
        })}
      </div>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-organize-statuses': HVOrganizeStatuses;
  }
}
