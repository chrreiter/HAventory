import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { ref } from 'lit/directives/ref.js';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { searchBox } from '../ui/filter-chrome';
import { LocationPicker } from '../ui/location-picker';
import { icon } from '../ui/icons';
import { counted } from '../ui/plural';
import { areaChangePreview, areaNameById } from '../ui/area';
import type { AreaChangePreview } from '../ui/area';
import { renderAreaChip } from '../ui/location-path';
import { countLocations } from '../store/location-tree';
import { CopyFlash, idRow } from '../ui/clipboard';
import {
  errorText,
  organizeTab,
  renderActionSheet,
  renderFailure,
  renderFooter,
  renderRewrite,
  renderToolbar,
  reveal,
  rewriteState,
  selectChevron,
} from '../ui/organize-tab';
import { SliceWatch } from '../ui/slice-watch';
import type { RewriteState } from '../ui/organize-tab';
import { makeBulkOp } from '../store/store';
import type { Store } from '../store/store';
import type { AreaRef, Item, LocationTreeNode, StoreState } from '../store/types';

/** Picker holders, named so `aria-controls` can point at them while closed. */
const LOC_PARENT_TREE_ID = 'location-parent-tree-holder';
const MERGE_TARGET_TREE_ID = 'merge-target-tree-holder';

/**
 * The organize dialog's Locations tab: the managed tree with counts, edit in
 * place (name, area with its consequence spelled out, parent, the id
 * automations use), merge into another location as a batch with progress, and
 * a delete guarded by an inline explanation. It owns the open editor, merge,
 * sheet, guard and rewrite; it talks to the store directly and sends `browse`
 * when a location or its count is picked.
 */
@customElement('hv-organize-locations')
export class HVOrganizeLocations extends LitElement {
  static override styles = [
    tokens,
    base,
    chip,
    idRow,
    searchBox,
    organizeTab,
    css`
      .grid2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      :host([mobile]) .grid2 {
        grid-template-columns: 1fr;
      }
      .cell {
        display: grid;
        gap: 4px;
        min-width: 0;
        /* The area cell's preview line makes it taller; keep fields aligned. */
        align-content: start;
      }
      .cell.wide {
        grid-column: span 2;
      }
      :host([mobile]) .cell.wide {
        grid-column: span 1;
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

  private readonly _view = new SliceWatch(this, ['locations']);
  private readonly _emit = emitter<'hv-organize-locations'>(this);

  /** The parent picker and the merge target: one location each, so a pick ends it. */
  private readonly _parentPicker = new LocationPicker(this);
  private readonly _mergePicker = new LocationPicker(this);
  /** The "Copied" label on the open location editor's id row. */
  private readonly _copyFlash = new CopyFlash(this);

  @state() private _filter = '';
  /** Location being edited, `'new'` for the create row, or null. */
  @state() private _editingLocation: string | 'new' | null = null;
  @state() private _locName = '';
  @state() private _locArea: string | null = null;
  @state() private _locParent: string | null = null;
  @state() private _locError: string | null = null;
  @state() private _guard: { locationId: string; message: string } | null = null;
  /** Location being merged away, with the location it is merging into. */
  @state() private _mergingLocation: string | null = null;
  @state() private _mergeTarget: string | null = null;
  /** Location whose actions are open in the touch sheet. */
  @state() private _sheetLocation: string | null = null;
  @state() private _rewrite: RewriteState | null = null;

  @query('#org-loc-area') private _areaSelect?: HTMLSelectElement | null;

  private get st(): StoreState | null {
    return this._view.state;
  }

  private _reveal = (el?: Element) => reveal(el, this.opening());

  protected override updated() {
    // A touched native select stops following its options' `selected`, so an
    // area chosen in the parent tree is written to the live element.
    const areaSelect = this._areaSelect;
    if (areaSelect) areaSelect.value = this._locArea ?? '';
  }

  private _findNode(nodes: LocationTreeNode[], id: string): LocationTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const deeper = this._findNode(node.children ?? [], id);
      if (deeper) return deeper;
    }
    return null;
  }

  private _startLocationEdit(id: string | 'new') {
    const node = id === 'new' ? null : this._findNode(this.st?.locationTreeCache ?? [], id);
    this._mergingLocation = null;
    this._sheetLocation = null;
    this._editingLocation = id;
    this._locName = node?.name ?? '';
    this._locArea = node?.area_id ?? null;
    this._locParent = node?.parent_id ?? null;
    this._parentPicker.close();
    this._locError = null;
    this._guard = null;
    this._copyFlash.reset();
  }

  private async _saveLocation() {
    const name = this._locName.trim();
    if (!name) {
      this._locError = t('hv.organize.locationNeedsName');
      return;
    }
    this._locError = null;
    try {
      if (this._editingLocation === 'new') {
        await this.store?.createLocation(name, this._locParent, this._locArea);
      } else if (this._editingLocation) {
        const node = this._findNode(this.st?.locationTreeCache ?? [], this._editingLocation);
        await this.store?.updateLocation(this._editingLocation, {
          name,
          areaId: this._locArea,
          // Re-parenting moves the whole subtree; sending it with the rename
          // keeps the edit to a single round trip.
          ...(node && (node.parent_id ?? null) !== this._locParent ? { newParentId: this._locParent } : {}),
        });
      }
      this._editingLocation = null;
    } catch (err) {
      this._locError = errorText(err, 'hv.organize.locationSaveFailed');
    }
  }

  private async _deleteLocation(node: LocationTreeNode) {
    const children = node.children?.length ?? 0;
    const items = node.subtree_item_count ?? 0;
    if (children > 0 || items > 0) {
      // The backend refuses a non-empty location; say why before asking it.
      const parts: string[] = [];
      if (items) parts.push(counted(items, 'item'));
      if (children) parts.push(counted(children, 'subLocation'));
      this._guard = {
        locationId: node.id,
        message: t('hv.organize.locationStillHolds', {
          name: node.name,
          contents: parts.join(t('hv.import.and')),
        }),
      };
      return;
    }
    this._guard = null;
    try {
      await this.store?.deleteLocation(node.id);
    } catch (err) {
      this._guard = {
        locationId: node.id,
        message: errorText(err, 'hv.organize.locationDeleteFailed'),
      };
    }
  }

  private _startLocationMerge(id: string) {
    this._editingLocation = null;
    this._sheetLocation = null;
    this._guard = null;
    this._rewrite = null;
    this._mergingLocation = id;
    this._mergeTarget = null;
    this._mergePicker.close();
  }

  /**
   * Fold one location into another and delete it, as the three moves it
   * decomposes into: re-file its direct items in one batch, re-parent each
   * child subtree, delete the emptied location. The delete is skipped if
   * anything before it failed, so the error reported is the real one.
   */
  private async _runLocationMerge(source: LocationTreeNode, targetId: string) {
    this._mergingLocation = null;
    this._rewrite = rewriteState('merge', 0, 0);

    let items: Item[];
    try {
      items = (await this.store?.listAllMatching({ location_id: source.id, include_subtree: false })) ?? [];
    } catch (err) {
      this._rewrite = rewriteState('merge', 0, 0, true, [], errorText(err, 'hv.organize.locationReadFailed'));
      return;
    }

    const ops = items.map((i) =>
      makeBulkOp('item_move', { item_id: i.id, location_id: targetId, expected_version: i.version }),
    );
    this._rewrite = rewriteState('merge', 0, ops.length);
    const outcome = ops.length
      ? await this.store?.bulkExecute(ops, {
          onProgress: (done, total) => {
            this._rewrite = rewriteState('merge', done, total);
          },
        })
      : undefined;
    const failed = outcome?.failed ?? [];

    let error: string | null = null;
    if (!failed.length) {
      try {
        for (const child of source.children ?? []) {
          await this.store?.moveLocationSubtree(child.id, targetId);
        }
        await this.store?.deleteLocation(source.id);
      } catch (err) {
        error = errorText(err, 'hv.organize.mergeMovedNotRemoved', { name: source.name });
      }
    } else {
      error = t('hv.organize.mergeKeptSource', {
        name: source.name,
        items: counted(failed.length, 'item'),
      });
    }

    this._rewrite = rewriteState('merge', ops.length, ops.length, true, failed, error);
  }

  private _showLocation(locationId: string | null) {
    if (!locationId) return;
    this.store?.setFilters({ locationIds: [locationId], orphansOnly: false });
    this._emit('browse');
  }

  /**
   * The consequence of the area select, spelled out before Save: an area
   * belongs to a whole location tree, so a change reaches locations the editor
   * does not show.
   */
  private _renderAreaPreview(preview: AreaChangePreview) {
    const areas = this.st?.areasCache?.areas ?? [];
    const chip = renderAreaChip(areaNameById(areas, preview.effectiveAreaId));
    const wholeTree = preview.treeSize > 1 && preview.rootName !== null;
    const size = counted(preview.treeSize, 'location');
    // The chip is an element, so the sentence is split at its placeholder.
    const around = (key: TranslationKey, params?: Record<string, string | number>) => {
      const [before, after] = t(key, { ...params, chip: '\u0000' }).split('\u0000');
      return html`${before}${chip}${after}`;
    };

    let line;
    if (preview.kind === 'assign-root') {
      line = wholeTree
        ? html`${around('hv.organize.areaAssignTree', {
            root: preview.rootName ?? '',
            size,
          })}${preview.editsRoot ? '' : t('hv.organize.areaStoredOnRoot', { root: preview.rootName ?? '' })}`
        : around('hv.organize.areaAssignOne');
    } else if (preview.kind === 'clear-tree') {
      line = wholeTree
        ? html`${t('hv.organize.areaClearTree', { root: preview.rootName ?? '', size })}`
        : html`${t('hv.organize.areaClearOne')}`;
    } else if (this._locArea === null && preview.effectiveAreaId !== null) {
      // No change, but name the area the empty option inherits.
      line = around('hv.organize.areaInherited');
    } else {
      return null;
    }

    return html`<span class="note" data-testid="location-area-preview">${line}</span>`;
  }

  /** What the parent button reads; a top-level one names its area, which the picker also sets. */
  private _parentLabel(parent: LocationTreeNode | null, areas: readonly AreaRef[]): string {
    if (parent) return parent.name;
    const areaName = areaNameById(areas, this._locArea);
    return areaName ? t('hv.organize.topLevelIn', { area: areaName }) : t('hv.organize.topLevel');
  }

  private _renderLocationEditor(nodeId: string | 'new') {
    const tree = this.st?.locationTreeCache ?? [];
    const node = nodeId === 'new' ? null : this._findNode(tree, nodeId);
    const parent = this._locParent ? this._findNode(tree, this._locParent) : null;
    const areas = this.st?.areasCache?.areas ?? [];
    // A nested location inherits from its tree's root; a top-level one has no area.
    const areaDefaultLabel = parent ? t('hv.organize.areaInherit') : t('hv.term.noArea');
    const preview = areaChangePreview(
      this.st?.locationsFlatCache ?? [],
      { id: nodeId === 'new' ? null : nodeId, parentId: this._locParent },
      this._locArea,
    );

    return keyed(
      nodeId,
      html`<div class="expander" data-testid="location-editor" data-field="#org-loc-name" ${ref(this._reveal)}>
        <div class="grid2">
          <div class="cell ${areas.length ? '' : 'wide'}">
            <label class="hv-label" for="org-loc-name">${t('hv.field.name')}</label>
            <input
              id="org-loc-name"
              class="control"
              data-testid="location-name"
              .value=${this._locName}
              @input=${(e: Event) => {
                this._locName = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          ${
            areas.length
              ? html`<div class="cell">
                  <label class="hv-label" for="org-loc-area">${t('hv.organize.locationArea')}</label>
                  <span class="hv-select">
                    <select
                      id="org-loc-area"
                      class="control"
                      data-testid="location-area"
                      @change=${(e: Event) => {
                        this._locArea = (e.target as HTMLSelectElement).value || null;
                      }}
                    >
                      <option value="" ?selected=${!this._locArea}>${areaDefaultLabel}</option>
                      ${areas.map(
                        (a) =>
                          html`<option value=${a.id} ?selected=${this._locArea === a.id}>${a.name}</option>`,
                      )}
                    </select>
                    ${selectChevron()}
                  </span>
                  ${this._renderAreaPreview(preview)}
                </div>`
              : null
          }
          <div class="cell wide">
            <span class="hv-label">
              ${t('hv.organize.parentLocation')}
              <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--hv-text-tertiary)">
                ${t('hv.organize.parentLocationNote')}
              </span>
            </span>
            ${this._parentPicker.render(
              {
                triggerClass: 'control',
                testid: 'location-parent',
                holderId: LOC_PARENT_TREE_ID,
                trigger: html`${icon('mapMarker', 15)}<span class="value"
                    >${this._parentLabel(parent, areas)}</span
                  >${icon('chevronDown', 15)}`,
              },
              () => html`<hv-location-tree
                data-testid="location-parent-tree"
                .nodes=${tree}
                .areas=${areas}
                .selectedId=${this._locParent}
                .selectedAreaId=${this._locParent === null ? this._locArea : null}
                .excludeSubtreeOf=${node?.id ?? null}
                showAll
                allLabel=${t('hv.organize.topLevel')}
                areaSelectable
                showEmptyAreas
                @select=${(e: HvEvent<'hv-location-tree', 'select'>) => {
                  this._locParent = e.detail.locationId;
                }}
                @select-area=${(e: HvEvent<'hv-location-tree', 'select-area'>) => {
                  // Picking an area moves the location to the top level, in it.
                  this._locParent = null;
                  this._locArea = e.detail.areaId;
                }}
              ></hv-location-tree>`,
            )}
          </div>
          ${
            // The id automations pass as location_id / parent_id; unsaved has none.
            nodeId === 'new'
              ? null
              : html`<div class="cell wide">
                  <span class="hv-label">${t('hv.term.id')}</span>
                  <div class="id-row">
                    <code data-testid="location-id">${nodeId}</code>
                    <button
                      class="hv-text-button"
                      data-testid="location-copy-id"
                      @click=${() => void this._copyFlash.copy(nodeId)}
                    >
                      ${this._copyFlash.copied ? t('hv.action.copied') : t('hv.action.copy')}
                    </button>
                  </div>
                </div>`
          }
        </div>
        ${renderFailure('location-error', this._locError)}
        ${renderFooter({
          lead: node
            ? html`<button
                class="hv-text-button danger"
                data-testid="location-delete"
                @click=${() => void this._deleteLocation(node)}
              >
                ${t('hv.action.delete')}
              </button>`
            : null,
          cancelTestid: 'location-cancel',
          onCancel: () => {
            this._editingLocation = null;
          },
          testid: 'location-save',
          label: t('hv.action.save'),
          onCommit: () => void this._saveLocation(),
        })}
      </div>`,
    );
  }

  private _renderLocationSheet(node: LocationTreeNode) {
    const count = node.subtree_item_count ?? 0;
    return renderActionSheet(
      'location-sheet',
      node.id,
      [
        {
          testid: 'location-sheet-show',
          glyph: 'magnify',
          label: t('hv.organize.showItems', { items: counted(count, 'item') }),
          onPick: () => this._showLocation(node.id),
        },
        {
          testid: 'location-sheet-edit',
          glyph: 'pencil',
          label: t('hv.organize.editEllipsis'),
          onPick: () => this._startLocationEdit(node.id),
        },
        {
          testid: 'location-sheet-merge',
          glyph: 'callMerge',
          label: t('hv.organize.mergeIntoEllipsis'),
          onPick: () => this._startLocationMerge(node.id),
        },
        {
          testid: 'location-sheet-delete',
          glyph: 'del',
          label: t('hv.action.delete'),
          danger: true,
          onPick: () => {
            this._sheetLocation = null;
            void this._deleteLocation(node);
          },
        },
      ],
      this._reveal,
    );
  }

  /** The merge step: pick where this location's contents should end up. */
  private _renderLocationMerge(source: LocationTreeNode) {
    const tree = this.st?.locationTreeCache ?? [];
    const target = this._mergeTarget ? this._findNode(tree, this._mergeTarget) : null;
    const items = source.direct_item_count ?? 0;
    const children = source.children?.length ?? 0;
    const parts = [counted(items, 'item')];
    if (children) parts.push(counted(children, 'subLocation'));

    return html`<div class="expander" data-testid="location-merge">
      <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
        <span class="hv-chip" style="text-decoration: line-through">${source.name}</span>
        ${icon('arrowRight', 18)}
        ${this._mergePicker.renderTrigger({
          triggerClass: 'control grow',
          testid: 'merge-target',
          holderId: MERGE_TARGET_TREE_ID,
          trigger: html`${icon('mapMarker', 15)}<span class="value"
              >${target?.name ?? t('hv.organize.mergeIntoPlaceholder')}</span
            >${icon('chevronDown', 15)}`,
        })}
      </div>
      ${this._mergePicker.renderHolder(
        { holderId: MERGE_TARGET_TREE_ID },
        () => html`<hv-location-tree
          data-testid="merge-target-tree"
          .nodes=${tree}
          .areas=${this.st?.areasCache?.areas ?? []}
          .selectedId=${this._mergeTarget}
          .excludeSubtreeOf=${source.id}
          @select=${(e: HvEvent<'hv-location-tree', 'select'>) => {
            this._mergeTarget = e.detail.locationId;
          }}
        ></hv-location-tree>`,
      )}
      <span class="note" data-testid="merge-effect">
        ${
          target
            ? t('hv.organize.mergeEffect', {
                contents: parts.join(t('hv.import.and')),
                target: target.name,
                source: source.name,
              })
            : // An area cannot take a merge; the note points at editing instead.
              `${t('hv.organize.mergePickLocation')}${
                (this.st?.areasCache?.areas?.length ?? 0) > 0 ? t('hv.organize.mergeAreasNote') : ''
              }`
        }
      </span>
      ${renderFooter({
        cancelTestid: 'merge-cancel',
        onCancel: () => {
          this._mergingLocation = null;
        },
        testid: 'merge-apply',
        label: t('hv.action.merge'),
        disabled: !this._mergeTarget,
        onCommit: () => {
          if (this._mergeTarget) void this._runLocationMerge(source, this._mergeTarget);
        },
      })}
    </div>`;
  }

  override render() {
    const tree = this.st?.locationTreeCache ?? [];
    const merging = this._mergingLocation ? this._findNode(tree, this._mergingLocation) : null;
    const sheeted = this._sheetLocation ? this._findNode(tree, this._sheetLocation) : null;
    const count = countLocations(tree, this._filter);
    return html`
      ${renderToolbar({
        search: {
          label: t('hv.organize.filterLocations'),
          placeholder: t('hv.organize.filterLocationsPlaceholder'),
          value: this._filter,
          onInput: (v) => {
            this._filter = v;
          },
        },
        count: counted(count, 'location'),
        countTestid: 'organize-location-count',
        newTestid: 'organize-new-location',
        newLabel: t('hv.fullView.newLocation'),
        onNew: () => this._startLocationEdit('new'),
      })}
      <div class="body">
        ${this._editingLocation === 'new' ? this._renderLocationEditor('new') : null}
        ${
          this._rewrite
            ? renderRewrite(this._rewrite, () => {
                this._rewrite = null;
              })
            : null
        }
        <hv-location-tree
          data-testid="organize-tree"
          manage
          showCounts
          ?mobile=${this.mobile}
          .nodes=${tree}
          .areas=${this.st?.areasCache?.areas ?? []}
          .filterText=${this._filter}
          @select=${(e: HvEvent<'hv-location-tree', 'select'>) => this._showLocation(e.detail.locationId)}
          @edit-location=${(e: HvEvent<'hv-location-tree', 'edit-location'>) =>
            this._startLocationEdit(e.detail.locationId)}
          @merge-location=${(e: HvEvent<'hv-location-tree', 'merge-location'>) =>
            this._startLocationMerge(e.detail.locationId)}
          @more-location=${(e: HvEvent<'hv-location-tree', 'more-location'>) => {
            const { locationId } = e.detail;
            this._sheetLocation = this._sheetLocation === locationId ? null : locationId;
            this._editingLocation = null;
            this._mergingLocation = null;
          }}
          @delete-location=${(e: HvEvent<'hv-location-tree', 'delete-location'>) => {
            void this._deleteLocation(e.detail.node);
          }}
        ></hv-location-tree>
        ${sheeted ? this._renderLocationSheet(sheeted) : null}
        ${merging ? this._renderLocationMerge(merging) : null}
        ${
          this._editingLocation && this._editingLocation !== 'new'
            ? this._renderLocationEditor(this._editingLocation)
            : null
        }
        ${
          this._guard
            ? keyed(
                this._guard.locationId,
                html`<div class="guard" role="alert" data-testid="location-guard" ${ref(this._reveal)}>
                <span class="guard-mark">${icon('alert', 17)}</span>
                <span>${this._guard.message}</span>
              </div>`,
              )
            : null
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-organize-locations': HVOrganizeLocations;
  }
}
