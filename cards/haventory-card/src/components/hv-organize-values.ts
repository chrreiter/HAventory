import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { ref } from 'lit/directives/ref.js';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import { tokens, base } from '../ui/tokens';
import { chip, tagLabel } from '../ui/chip';
import { searchBox } from '../ui/filter-chrome';
import { Picker } from '../ui/picker';
import { icon } from '../ui/icons';
import { counted } from '../ui/plural';
import { closestMatch } from '../ui/fuzzy';
import { describeRewrite, filterForValue, rewriteOps } from '../ui/value-rewrite';
import type { ValueKind } from '../ui/value-rewrite';
import {
  organizeTab,
  renderActionSheet,
  renderFailure,
  renderFooter,
  renderRewrite,
  renderToolbar,
  reveal,
  rewriteState,
} from '../ui/organize-tab';
import { SliceWatch } from '../ui/slice-watch';
import type { RewriteKind, RewriteState } from '../ui/organize-tab';
import type { Store } from '../store/store';
import type { DistinctValue, StoreState } from '../store/types';
import './hv-confirm';

/** Picker holder, named so `aria-controls` can point at it while closed. */
const MERGE_VALUE_LIST_ID = 'merge-value-list-holder';

/** Values the merge list holds before it earns a filter: six fit its 200px box. */
const VALUE_FILTER_FROM = 6;

/**
 * The organize dialog's Categories or Tags tab, whichever `kind` names. Neither
 * has a rename or merge endpoint, so those, and removal, are batch rewrites over
 * every affected item with the bulk-action progress treatment; a new value is a
 * draft on the card until an item carries it. It owns the open editor, the touch
 * sheet, the rewrite in flight and the remove confirmation; it talks to the
 * store directly and sends `browse` when a count is picked.
 */
@customElement('hv-organize-values')
export class HVOrganizeValues extends LitElement {
  static override styles = [
    tokens,
    base,
    chip,
    searchBox,
    organizeTab,
    css`
      .draft-note {
        font: 400 12px var(--hv-font);
        color: var(--hv-text-tertiary);
        font-style: italic;
      }
      .list-filter {
        display: block;
        padding: 4px 8px 6px;
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
      :host([mobile]) .option {
        min-height: var(--hv-tap-min, 44px);
        font-size: 15px;
      }
      .option .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option:hover {
        background: var(--hv-hover-overlay);
      }
      .option[aria-pressed='true'] {
        background: var(--hv-primary-tint);
        color: var(--hv-on-primary-tint);
        font-weight: 500;
      }
      .option-empty {
        padding: 8px 12px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .empty {
        padding: 24px 10px;
        text-align: center;
        color: var(--hv-text-tertiary);
        font-size: 13px;
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
  @property({ attribute: false }) kind: ValueKind = 'category';

  private readonly _view = new SliceWatch(this, ['facets']);
  private readonly _emit = emitter<'hv-organize-values'>(this);

  /** The list of values a category or tag merges into; its filter goes with it. */
  private readonly _valuePicker = new Picker(this, {
    onClose: () => {
      this._valueFilter = '';
    },
  });

  /** This tab's own copy of the toolbar filter. */
  @state() private _filter = '';
  /** The value row expanded for rename or merge, if any. */
  @state() private _editingValue: { value: string; mode: 'rename' | 'merge' } | null = null;
  @state() private _valueDraft = '';
  /** What narrows the merge target list, for a vocabulary too long to scan. */
  @state() private _valueFilter = '';
  @state() private _rewrite: RewriteState | null = null;
  @state() private _confirmRemove: string | null = null;
  /** The last confirmation's value, kept past the close for the focus rescue. */
  private _lastConfirmValue: string | null = null;
  @state() private _sheetValue: string | null = null;
  /** The "New category"/"New tag" row, open with the name being typed. */
  @state() private _creatingValue = false;
  @state() private _newValue = '';
  @state() private _newValueError: string | null = null;

  private get st(): StoreState | null {
    return this._view.state;
  }

  private _reveal = (el?: Element) => reveal(el, this.opening());

  /** Every value of the open tab's facet. */
  private get _allValues(): DistinctValue[] {
    const distinct = this.st?.distinctValuesCache;
    return (this.kind === 'tag' ? distinct?.tags : distinct?.categories) ?? [];
  }

  private get _values(): DistinctValue[] {
    const needle = this._filter.trim().toLowerCase();
    const list = this._allValues;
    return needle ? list.filter((v) => v.value.toLowerCase().includes(needle)) : list;
  }

  /** Singular noun for the tab, for button labels and messages. */
  private get _noun(): string {
    return this.kind === 'tag' ? t('hv.organize.noun.tag') : t('hv.organize.noun.category');
  }

  /** Plural noun for the tab, for the two sentences that count its values. */
  private get _plural(): string {
    return this.kind === 'tag' ? t('hv.organize.plural.tags') : t('hv.organize.plural.categories');
  }

  /** One value of the open tab, chipped the way the rest of the card chips it. */
  private _valueChip(value: string, opts: { style?: string; testid?: string } = {}) {
    const style = opts.style ?? '';
    const testid = opts.testid ?? '';
    return this.kind === 'tag'
      ? html`<span class="hv-chip tag" style=${style} data-testid=${testid}>${tagLabel(value)}</span>`
      : html`<span class="hv-chip" style=${style} data-testid=${testid}>${value}</span>`;
  }

  /** True while the value exists only on the card, with no item carrying it. */
  private _isDraft(value: string): boolean {
    return this.store?.isDraftValue(this.kind, value) ?? false;
  }

  private _createValue() {
    const name = this._newValue.trim();
    if (!name) {
      this._newValueError = t('hv.organize.valueNeedsName', { noun: this._noun });
      return;
    }
    if (!this.store?.addDraftValue(this.kind, name)) {
      this._newValueError = t('hv.organize.valueExists', { name });
      return;
    }
    this._creatingValue = false;
    this._newValue = '';
    this._newValueError = null;
  }

  private _startValueEdit(value: string, mode: 'rename' | 'merge') {
    this._editingValue = { value, mode };
    this._sheetValue = null;
    this._rewrite = null;
    this._valuePicker.close();
    if (mode === 'merge') {
      // Pre-fill the closest existing value, which is usually the typo fix.
      this._valueDraft = closestMatch(value, this._otherValues(value)) ?? '';
    } else {
      this._valueDraft = value;
    }
  }

  /** Fetch every affected item, then rewrite them in one chunked batch. */
  private async _runRewrite(from: string, to: string | null, rewrite: RewriteKind) {
    const kind = this.kind;
    this._rewrite = rewriteState(rewrite, 0, 0);
    let items;
    try {
      items = (await this.store?.listAllMatching(filterForValue(kind, from))) ?? [];
    } catch {
      this._rewrite = rewriteState(rewrite, 0, 0, true);
      return;
    }
    const ops = rewriteOps(kind, items, from, to);
    if (!ops.length) {
      this._rewrite = rewriteState(rewrite, 0, 0, true);
      this._editingValue = null;
      return;
    }

    this._rewrite = rewriteState(rewrite, 0, ops.length);
    const outcome = await this.store?.bulkExecute(ops, {
      onProgress: (done, total) => {
        this._rewrite = rewriteState(rewrite, done, total);
      },
    });
    this._rewrite = rewriteState(rewrite, ops.length, ops.length, true, outcome?.failed ?? []);
    this._editingValue = null;
    await this.store?.refreshDistinctValues().catch(() => undefined);
  }

  private _showValue(value: string) {
    if (this.kind === 'tag') this.store?.setFilters({ tags: [value], tagsMode: 'any' });
    else this.store?.setFilters({ categories: [value] });
    this._emit('browse');
  }

  /** The values a merge of `value` can land on: every other one of the tab. */
  private _otherValues(value: string): string[] {
    return this._allValues.map((v) => v.value).filter((v) => v !== value);
  }

  /** The tab's value as the merge target field prints it: a tag wears its mark. */
  private _valueText(value: string) {
    return this.kind === 'tag' ? tagLabel(value) : value;
  }

  /** The merge target's trigger, drawn apart from its full-width list below. */
  private _renderValueTargetTrigger(others: string[]) {
    const picked = this._valueDraft.trim();
    return this._valuePicker.renderTrigger({
      triggerClass: 'control grow',
      testid: 'value-target',
      title: t('hv.organize.mergeInto'),
      disabled: !others.length,
      holderId: MERGE_VALUE_LIST_ID,
      trigger: html`<span class="value"
          >${picked ? this._valueText(picked) : t('hv.organize.mergeIntoPlaceholder')}</span
        >${icon('chevronDown', 15)}`,
    });
  }

  /**
   * The values a merge can land on, as the card's own elements: the companion
   * app's Android WebView draws no `<datalist>` suggestions at all.
   */
  private _renderValueTargetList(others: string[]) {
    const picked = this._valueDraft.trim();
    const needle = this._valueFilter.trim().toLowerCase();
    const shown = needle ? others.filter((v) => v.toLowerCase().includes(needle)) : others;
    return this._valuePicker.renderHolder(
      { holderId: MERGE_VALUE_LIST_ID },
      () => html`
        ${
          others.length > VALUE_FILTER_FROM
            ? html`<label class="list-filter">
              <span class="hv-sr-only">${t('hv.organize.filterValues', { values: this._plural })}</span>
              <input
                class="control"
                data-testid="value-target-filter"
                placeholder=${t('hv.organize.filterValuesPlaceholder', { values: this._plural })}
                .value=${this._valueFilter}
                @input=${(e: Event) => {
                  this._valueFilter = (e.target as HTMLInputElement).value;
                }}
              />
            </label>`
            : null
        }
        ${
          shown.length
            ? shown.map(
                (v) => html`<button
                class="option"
                data-testid="value-target-option"
                data-value=${v}
                aria-pressed=${String(v === picked)}
                @click=${() => {
                  this._valueDraft = v;
                  this._valuePicker.close();
                }}
              >
                <span class="label">${this._valueText(v)}</span>
                ${v === picked ? icon('check', 15) : null}
              </button>`,
              )
            : html`<div class="option-empty" data-testid="value-target-none">
              ${t('hv.organize.noValuesMatch', { values: this._plural })}
            </div>`
        }
      `,
    );
  }

  private _renderValueEditor(value: string, count: number) {
    const editing = this._editingValue!;
    const merging = editing.mode === 'merge';
    const others = merging ? this._otherValues(value) : [];
    const target = this._valueDraft.trim();

    return keyed(
      `${editing.mode}:${value}`,
      html`<div
        class="expander"
        data-testid="value-editor"
        data-mode=${editing.mode}
        data-field=${merging ? 'button[aria-controls]' : '#org-value-target'}
        ${ref(this._reveal)}
      >
        <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
          ${this._valueChip(value, { style: merging ? 'text-decoration: line-through' : undefined })}
          <span style="font-size:12.5px;color:var(--hv-text-secondary)">${counted(count, 'item')}</span>
          ${
            merging
              ? html`${icon('arrowRight', 18)}${this._renderValueTargetTrigger(others)}`
              : html`<label style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px">
                <span class="hv-sr-only">${t('hv.organize.newName')}</span>
                <input
                  id="org-value-target"
                  class="control"
                  data-testid="value-target"
                  placeholder=${t('hv.organize.newNamePlaceholder')}
                  .value=${this._valueDraft}
                  @input=${(e: Event) => {
                    this._valueDraft = (e.target as HTMLInputElement).value;
                  }}
                />
              </label>`
          }
        </div>
        ${merging ? this._renderValueTargetList(others) : null}
        <span class="note" data-testid="value-effect">
          ${
            merging && !others.length
              ? t('hv.organize.mergeNoOther', { values: this._plural })
              : target
                ? describeRewrite(this.kind, count, value, target)
                : t('hv.organize.pickNameToContinue')
          }
        </span>
        ${renderFooter({
          cancelTestid: 'value-cancel',
          onCancel: () => {
            this._editingValue = null;
          },
          testid: 'value-apply',
          label: merging ? t('hv.action.merge') : t('hv.action.rename'),
          disabled: !target || target === value,
          onCommit: () => void this._runRewrite(value, target, merging ? 'merge' : 'rename'),
        })}
      </div>`,
    );
  }

  private _renderValueCreator() {
    return html`<div class="expander" data-testid="value-create">
      <label style="display:flex;align-items:center;gap:8px">
        <span class="hv-sr-only">${t('hv.organize.newValue', { noun: this._noun })}</span>
        <input
          class="control"
          data-testid="new-value-name"
          placeholder=${t('hv.organize.newValuePlaceholder', { noun: this._noun })}
          .value=${this._newValue}
          @input=${(e: Event) => {
            this._newValue = (e.target as HTMLInputElement).value;
            this._newValueError = null;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') this._createValue();
          }}
        />
      </label>
      ${renderFailure('new-value-error', this._newValueError)}
      <span class="note">${t('hv.organize.draftNote', { noun: this._noun })}</span>
      ${renderFooter({
        cancelTestid: 'new-value-cancel',
        onCancel: () => {
          this._creatingValue = false;
          this._newValueError = null;
        },
        testid: 'new-value-create',
        label: t('hv.action.create'),
        disabled: !this._newValue.trim(),
        onCommit: () => this._createValue(),
      })}
    </div>`;
  }

  private _renderValueSheet(value: string, count: number) {
    const suggestion = closestMatch(value, this._otherValues(value));
    return renderActionSheet(
      'value-sheet',
      value,
      [
        {
          testid: 'sheet-show',
          glyph: 'magnify',
          label: t('hv.organize.showItems', { items: counted(count, 'item') }),
          onPick: () => this._showValue(value),
        },
        {
          testid: 'sheet-rename',
          glyph: 'pencil',
          label: t('hv.organize.renameEllipsis'),
          onPick: () => this._startValueEdit(value, 'rename'),
        },
        {
          testid: 'sheet-merge',
          glyph: 'callMerge',
          label: t('hv.organize.mergeIntoEllipsis'),
          trailing: suggestion
            ? this._valueChip(suggestion, {
                style: 'margin-left:auto',
                testid: 'sheet-merge-suggestion',
              })
            : null,
          onPick: () => this._startValueEdit(value, 'merge'),
        },
        {
          testid: 'sheet-remove',
          glyph: 'del',
          label: t('hv.organize.removeFromAllItems'),
          danger: true,
          onPick: () => {
            this._sheetValue = null;
            this._confirmRemove = value;
          },
        },
      ],
      this._reveal,
    );
  }

  /**
   * Focus for a closed delete confirmation whose ✕ opener is hidden in
   * hover-revealed row actions: the row takes it (`:focus-within` re-reveals
   * the actions), or the dialog's panel once a removal has taken the row away
   * (looked up from here, since it is outside this shadow root).
   */
  private _refocusConfirmRow = () => {
    const value = this._lastConfirmValue;
    // Matched on `dataset`: a quote in a tag would end an attribute selector.
    const row =
      value === null
        ? null
        : (Array.from(this.renderRoot.querySelectorAll<HTMLElement>('.value-row')).find(
            (r) => r.dataset.value === value,
          ) ?? null);
    const target = row ?? this.closest<HTMLElement>('.panel');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  override render() {
    const values = this._values;
    const noun = this._plural;
    const removeCount = this._allValues.find((v) => v.value === this._confirmRemove)?.count ?? 0;
    return html`
      ${renderToolbar({
        search: {
          label: t('hv.organize.filterValues', { values: noun }),
          placeholder: t('hv.organize.filterValuesPlaceholder', { values: noun }),
          value: this._filter,
          onInput: (v) => {
            this._filter = v;
          },
        },
        count: counted(values.length, this.kind),
        countTestid: 'organize-value-count',
        newTestid: 'organize-new-value',
        newLabel: t('hv.organize.newValue', { noun: this._noun }),
        onNew: () => {
          this._creatingValue = true;
          this._newValue = '';
          this._newValueError = null;
          this._editingValue = null;
        },
      })}
      <div class="body">
        ${this._creatingValue ? this._renderValueCreator() : null}
        ${
          this._rewrite
            ? renderRewrite(this._rewrite, () => {
                this._rewrite = null;
              })
            : null
        }
        ${
          values.length
            ? values.map(
                (v) => html`
                <div class="value-row" data-testid="value-row" data-value=${v.value}>
                  ${this._valueChip(v.value)}
                  ${
                    this._isDraft(v.value)
                      ? html`<span class="draft-note" data-testid="value-draft">
                        ${t('hv.organize.draftBadge')}
                      </span>`
                      : html`<button
                        class="count-link"
                        data-testid="value-count"
                        @click=${() => this._showValue(v.value)}
                      >
                        ${counted(v.count, 'item')}
                      </button>`
                  }
                  <span class="row-actions">
                    ${
                      this._isDraft(v.value)
                        ? html`<button
                          class="danger"
                          data-testid="value-discard"
                          aria-label=${t('hv.organize.discardValue', { value: v.value })}
                          title=${t('hv.action.discard')}
                          @click=${() => this.store?.removeDraftValue(this.kind, v.value)}
                        >
                          ${icon('del', 16)}
                        </button>`
                        : this.mobile
                          ? html`<button
                          data-testid="value-more"
                          aria-label=${t('hv.organize.actionsFor', { value: v.value })}
                          @click=${() => {
                            this._sheetValue = v.value;
                          }}
                        >
                          ${icon('dotsVertical', 17)}
                        </button>`
                          : html`
                          <button
                            data-testid="value-rename"
                            aria-label=${t('hv.organize.renameValue', { value: v.value })}
                            title=${t('hv.action.rename')}
                            @click=${() => this._startValueEdit(v.value, 'rename')}
                          >
                            ${icon('pencil', 16)}
                          </button>
                          <button
                            data-testid="value-merge"
                            aria-label=${t('hv.organize.mergeValue', { value: v.value })}
                            title=${t('hv.organize.mergeIntoAnother')}
                            @click=${() => this._startValueEdit(v.value, 'merge')}
                          >
                            ${icon('callMerge', 16)}
                          </button>
                          <button
                            class="danger"
                            data-testid="value-remove"
                            aria-label=${t('hv.organize.removeValue', { value: v.value })}
                            title=${t('hv.organize.removeFromEveryItem')}
                            @click=${() => {
                              this._confirmRemove = v.value;
                            }}
                          >
                            ${icon('del', 16)}
                          </button>
                        `
                    }
                  </span>
                </div>
                ${this._editingValue?.value === v.value ? this._renderValueEditor(v.value, v.count) : null}
                ${this._sheetValue === v.value ? this._renderValueSheet(v.value, v.count) : null}
              `,
              )
            : html`<div class="empty" data-testid="organize-empty">
              ${
                this._filter.trim()
                  ? t('hv.organize.noValuesMatch', { values: noun })
                  : t('hv.organize.noValuesYet', { values: noun })
              }
            </div>`
        }
      </div>

      <!-- Its events stop here: an escaping cancel reads to the host as "close Organize". -->
      <hv-confirm
        data-testid="organize-confirm"
        ?open=${this._confirmRemove !== null}
        ?mobile=${this.mobile}
        .heading=${t('hv.organize.removeHeading', {
          value: this._confirmRemove ?? '',
          items: counted(removeCount, 'item'),
        })}
        .message=${t('hv.organize.removeMessage')}
        .confirmLabel=${t('hv.action.remove')}
        destructive
        .onOpenerGone=${this._refocusConfirmRow}
        @confirm=${(e: HvEvent<'hv-confirm', 'confirm'>) => {
          e.stopPropagation();
          const value = this._confirmRemove;
          this._lastConfirmValue = value;
          this._confirmRemove = null;
          if (value) void this._runRewrite(value, null, 'remove');
        }}
        @cancel=${(e: HvEvent<'hv-confirm', 'cancel'>) => {
          e.stopPropagation();
          this._lastConfirmValue = this._confirmRemove;
          this._confirmRemove = null;
        }}
      ></hv-confirm>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-organize-values': HVOrganizeValues;
  }
}
