import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { browseRow } from '../ui/browse-row';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { groupRootsByArea, locationMatches } from '../store/location-tree';
import { renderAreaChip } from '../ui/location-path';
import { rovingTarget, syncRovingTabindex } from '../ui/roving-list';
import { counted } from '../ui/plural';
import type { AreaGroup } from '../store/location-tree';
import type { AreaRef, LocationTreeNode } from '../store/types';

/** The tail of ungrouped roots, keyed like a group so it collapses like one. */
const NO_AREA_KEY = 'no-area';

/**
 * The container a row discloses, which stays in the tree empty while collapsed
 * so `aria-controls` resolves. Every character outside the id alphabet, `_`
 * included, becomes `_<code point>_`, so the id is selector-safe and one-to-one.
 */
const containerId = (prefix: string, key: string) =>
  `${prefix}-${key.replace(/[^A-Za-z0-9-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`)}`;

/** `set` with `key` added, or taken out if it was there. */
function toggledSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** The leading slot of a row with nothing to disclose, holding the column. */
const placeholderTwisty = () =>
  html`<span class="twisty hv-browse-row-lead placeholder">${icon('chevronRight', 17)}</span>`;

/** The desktop manage actions: testid, event, accessible name, title, glyph. */
const MANAGE_ACTIONS: [string, string, TranslationKey, TranslationKey, IconName][] = [
  ['tree-merge', 'merge-location', 'hv.tree.merge', 'hv.tree.mergeTitle', 'callMerge'],
  ['tree-edit', 'edit-location', 'hv.row.editNamed', 'hv.tree.editTitle', 'pencil'],
  ['tree-delete', 'delete-location', 'hv.tree.delete', 'hv.tree.deleteTitle', 'del'],
];

/** Where a node's children go, derived from the node id so it never moves. */
const nodeChildrenId = (nodeId: string) => containerId('tree-children', nodeId);

/** Where an area band's roots go, derived from the key the band collapses under. */
const areaRootsId = (key: string) => containerId('tree-area-roots', key);

/**
 * The backend's nested location tree, rendered as served, for the full-view
 * sidebar, the filter panel, the item editor and the organize dialog.
 *
 * Top-level locations are banded under their HA area; an inventory with no
 * areas renders flat. Counts come from the nodes themselves.
 */
@customElement('hv-location-tree')
export class HVLocationTree extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    browseRow,
    css`
      :host {
        display: block;
      }
      /* Shape and picked state come from ui/browse-row. A node row cannot be a
         button, since it holds buttons, so it asks for the pointer itself. */
      .row {
        cursor: pointer;
      }
      .row[disabled] {
        opacity: 0.4;
        cursor: default;
      }
      .twisty {
        border: none;
        background: none;
        border-radius: 50%;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .twisty:hover {
        background: var(--hv-hover-overlay);
      }
      .count {
        flex: none;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .row.selected .count {
        color: inherit;
      }
      /* In manage mode the count opens the items. */
      .count.link {
        border: none;
        background: none;
        padding: 0 2px;
        font: 400 12px var(--hv-font);
        color: var(--hv-primary-dark);
        /* WCAG 2.2's 24px pointer target. */
        display: inline-flex;
        align-items: center;
        min-height: 24px;
      }
      .count.link:hover {
        text-decoration: underline;
      }
      /* 44px only in the managing tree; the browsing sidebar stays compact. */
      .row.manage.touch .count.link {
        min-height: var(--hv-tap-min, 44px);
      }
      .row.manage .name {
        flex: 0 1 auto;
      }
      .row.manage .actions {
        margin-left: auto;
      }
      /* An area heads a group of locations, so it reads as a band, not a row. */
      .row.area-head {
        font-weight: 500;
        color: var(--hv-text-secondary);
      }
      .row.area-head:hover {
        background: none;
      }
      .row.area-head.selectable:hover {
        background: var(--hv-hover-overlay);
      }
      .area-name {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        padding: 0;
        font: inherit;
        color: inherit;
        text-align: left;
      }
      /* Here the chip is the band's label, so it is not set smaller than the
         locations under it; the no-area band matches it in outline. */
      .area-name .hv-area-chip,
      .area-none {
        font-size: inherit;
      }
      .actions {
        flex: none;
        display: flex;
        gap: 2px;
      }
      /* Reveal-on-hover only where hovering exists; hidden, not unrendered, so
         the row does not shift. */
      @media (hover: hover) {
        .actions {
          visibility: hidden;
        }
        .row:hover .actions,
        .row:focus-within .actions,
        /* The touch layout's single ⋮ is the only way in — never hide it. */
        .row.touch .actions {
          visibility: visible;
        }
      }
      .action {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-primary-dark);
        padding: 0;
      }
      .row.manage.touch .action {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      .action.danger {
        color: var(--hv-error);
      }
      .action:hover {
        background: var(--hv-hover-overlay);
      }
      .empty {
        padding: 10px 12px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      /* The empty tree's offer to create a first location. */
      .create {
        display: grid;
        gap: 6px;
        padding: 0 12px 10px;
      }
      .create-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .create-row .hv-input {
        flex: 1;
        min-width: 0;
      }
      .create-open {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--hv-tap-min, 30px);
        border: 1px dashed var(--hv-primary-tint-border);
        background: none;
        color: var(--hv-primary-dark);
        border-radius: var(--hv-radius-input);
        padding: 0 12px;
        font: 500 12.5px var(--hv-font);
        cursor: pointer;
      }
      .create-row .hv-pill {
        flex: none;
      }
      .divider {
        height: 1px;
        background: var(--hv-row-divider);
        margin: 6px 0;
      }
    `,
  ];

  @property({ attribute: false }) nodes: LocationTreeNode[] = [];
  /** The one selected location, for the pickers that assign exactly one. */
  @property({ type: String }) selectedId: string | null = null;
  /** Every selected location, for the filter surfaces; wins over `selectedId` when non-empty. */
  @property({ attribute: false }) selectedIds: string[] = [];
  /** Show an "All items" row that clears the location filter. */
  @property({ type: Boolean }) showAll = false;
  /** What that row is called and its glyph: in a picker, clearing files the item nowhere. */
  @property({ type: String }) allLabel = t('hv.tree.allItems');
  @property({ type: String }) allIcon: IconName = 'home';
  /** Show a "No location" row bound to the orphans filter. */
  @property({ type: Boolean }) showOrphans = false;
  /** True when the current selection is the orphans row rather than a location. */
  @property({ type: Boolean }) orphansSelected = false;
  @property({ type: Number }) totalCount: number | null = null;
  @property({ type: Number }) orphanCount: number | null = null;
  /** Items matching the active filter, ignoring its location dimension. */
  @property({ type: Number }) matchingTotalCount: number | null = null;
  @property({ type: Boolean }) showCounts = false;
  /** Let an area header be picked, emitting `select-area`; trees that assign a location leave it off. */
  @property({ type: Boolean }) areaSelectable = false;
  /** The area currently chosen, for the header's selected state. */
  @property({ type: String }) selectedAreaId: string | null = null;
  /** Band every HA area, empty ones included, as the parent picker needs; a filter suspends it. */
  @property({ type: Boolean }) showEmptyAreas = false;
  /** Reveal the rename/merge/delete affordances on hover. Only the organize dialog sets this. */
  @property({ type: Boolean }) manage = false;
  /** Phone layout for `manage`: one always-visible ⋮ per row instead of hover icons. */
  @property({ type: Boolean }) mobile = false;
  /** Disable this node and its subtree; the backend rejects a parent cycle. */
  @property({ type: String }) excludeSubtreeOf: string | null = null;
  /** Substring filter over name and display path. */
  @property({ type: String }) filterText = '';
  /** Offer to create a first location from the empty state, emitting `create-location`. */
  @property({ type: Boolean }) allowCreate = false;
  /** Resolves the area ids on the nodes to names for the group headers. */
  @property({ attribute: false }) areas: AreaRef[] = [];

  @state() private _expanded = new Set<string>();
  /** Collapsed area groups; unlike locations, a band starts open. */
  @state() private _collapsedAreas = new Set<string>();
  /** The first-location field is showing, and what has been typed into it. */
  @state() private _creating = false;
  @state() private _newName = '';
  /** Which node holds the tree's one roving tab stop (`_nodeKey`); null until `updated` resolves it. */
  @state() private _activeKey: string | null = null;

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('_creating') && this._creating) {
      this.renderRoot.querySelector<HTMLInputElement>('[data-testid="tree-create-name"]')?.focus();
    }
    this._syncRovingTabindex();
  }

  /**
   * Every node the arrows walk, read from the DOM, which already holds exactly
   * what is visible. Excluded rows cannot be chosen and are left out.
   */
  private _walk(): HTMLElement[] {
    const rows = this.renderRoot.querySelectorAll<HTMLElement>(
      '[data-testid="tree-area-head"], [data-testid="tree-row"]',
    );
    return [...rows].filter((el) => el.getAttribute('aria-disabled') !== 'true');
  }

  /** One namespace for both kinds of node, so `_activeKey` can name either. */
  private _nodeKey(el: HTMLElement): string {
    return el.dataset.id ? `loc:${el.dataset.id}` : `area:${el.dataset.area}`;
  }

  /** Leave exactly one node in the tab order, its own actions riding with it. */
  private _syncRovingTabindex() {
    this._activeKey = syncRovingTabindex(
      this._walk(),
      this._activeKey,
      (el) => this._nodeKey(el),
      (el) => el.querySelectorAll<HTMLElement>('.actions button'),
    );
  }

  /** Move the tab stop to `el` and take focus with it. */
  private _activate(el: HTMLElement) {
    this._activeKey = this._nodeKey(el);
    el.tabIndex = 0;
    el.focus();
    this.requestUpdate();
  }

  /** Open or close the node `el` stands for, whichever kind it is. */
  private _toggleNode(el: HTMLElement) {
    if (el.dataset.id) this._expanded = toggledSet(this._expanded, el.dataset.id);
    else if (el.dataset.area) {
      this._toggleArea(el.dataset.area === NO_AREA_KEY ? NO_AREA_KEY : `area:${el.dataset.area}`);
    }
  }

  /** The ARIA tree pattern's arrow keys, the way to every node past the single tab stop. */
  private _onTreeKeydown(e: KeyboardEvent) {
    const next = rovingTarget(e, this._walk(), {
      toggle: (el) => this._toggleNode(el),
      frozen: this.filterText.trim().length > 0,
    });
    if (next) this._activate(next);
  }

  /** Open the ancestors of `id`, and its area group, so a deep selection is visible. */
  revealPathTo(id: string | null) {
    if (!id) return;
    const path = this._findPath(this.nodes, id) ?? [];
    if (!path.length) return;
    const next = new Set(this._expanded);
    for (const node of path.slice(0, -1)) next.add(node.id);
    this._expanded = next;

    const groupKey = this._groupKeyOf(path[0]);
    if (this._collapsedAreas.has(groupKey)) {
      const areas = new Set(this._collapsedAreas);
      areas.delete(groupKey);
      this._collapsedAreas = areas;
    }
  }

  private _groupKeyOf(root: LocationTreeNode): string {
    return root.area_id ? `area:${root.area_id}` : NO_AREA_KEY;
  }

  private _toggleArea(key: string) {
    this._collapsedAreas = toggledSet(this._collapsedAreas, key);
  }

  private _findPath(nodes: LocationTreeNode[], id: string): LocationTreeNode[] | null {
    for (const node of nodes) {
      if (node.id === id) return [node];
      const deeper = this._findPath(node.children ?? [], id);
      if (deeper) return [node, ...deeper];
    }
    return null;
  }

  /** Pick a node, from anywhere on its row; the tab stop follows the pick. */
  private _select(node: LocationTreeNode, excluded: boolean) {
    if (excluded) return;
    this._activeKey = `loc:${node.id}`;
    this._emit('select', { locationId: node.id, node });
  }

  private _emit(name: string, detail: Record<string, unknown>) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** A node stays visible when it matches (as the organize toolbar's tally counts) or a descendant does. */
  private _visible(node: LocationTreeNode): boolean {
    if (locationMatches(node, this.filterText)) return true;
    return (node.children ?? []).some((c) => this._visible(c));
  }

  /** The per-node tally; in manage mode it names its unit and opens the items. */
  private _renderCount(node: LocationTreeNode, excluded: boolean) {
    const count = node.subtree_item_count ?? node.direct_item_count ?? 0;
    if (!this.manage) return this._pairedCount(count, node.matching_subtree_count ?? null, 'tree-count');
    // Out of the tab order: the row's own Enter emits the same select.
    return html`<button
      class="count link"
      data-testid="tree-count"
      data-id=${node.id}
      tabindex="-1"
      ?disabled=${excluded}
      @click=${(e: Event) => {
        e.stopPropagation();
        if (excluded) return;
        this._emit('select', { locationId: node.id, node });
      }}
    >
      ${counted(count, 'item')}
    </button>`;
  }

  private _renderNode(node: LocationTreeNode, depth: number, excluded: boolean): TemplateResult | null {
    if (!this._visible(node)) return null;

    const children = (node.children ?? []).filter((c) => this._visible(c));
    const hasChildren = children.length > 0;
    const filtering = this.filterText.trim().length > 0;
    const open = filtering ? true : this._expanded.has(node.id);
    const isExcluded = excluded || node.id === this.excludeSubtreeOf;
    const selected = !this.orphansSelected && this._isSelected(node.id);

    return html`
      <div>
        <div
          class="row hv-browse-row ${selected ? 'selected' : ''} ${this.manage ? 'manage' : ''} ${this.mobile
            ? 'touch'
            : ''}"
          role="treeitem"
          aria-selected=${String(selected)}
          aria-expanded=${ifDefined(hasChildren ? String(open) : undefined)}
          aria-controls=${ifDefined(hasChildren ? nodeChildrenId(node.id) : undefined)}
          aria-level=${depth + 1}
          aria-disabled=${ifDefined(isExcluded ? 'true' : undefined)}
          title=${node.path?.display_path ?? node.name}
          tabindex="-1"
          data-testid="tree-row"
          data-id=${node.id}
          data-depth=${depth}
          ?disabled=${isExcluded}
          style="padding-left: ${12 + depth * 18}px"
          @click=${() => this._select(node, isExcluded)}
          @keydown=${(e: KeyboardEvent) => {
            // A div inherits neither Enter nor Space from the browser.
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            this._select(node, isExcluded);
          }}
        >
          ${hasChildren
            ? html`<button
                class="twisty hv-browse-row-lead"
                data-testid="tree-twisty"
                tabindex="-1"
                aria-label=${open
                  ? t('hv.tree.collapse', { name: node.name })
                  : t('hv.tree.expand', { name: node.name })}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._expanded = toggledSet(this._expanded, node.id);
                }}
              >
                ${icon(open ? 'chevronDown' : 'chevronRight', 17)}
              </button>`
            : placeholderTwisty()}
          <span class="name hv-browse-row-label">${node.name}</span>
          ${this.showCounts ? this._renderCount(node, isExcluded) : null}
          ${this.manage && this.mobile
            ? html`<span class="actions">
                <button
                  class="action"
                  data-testid="tree-more"
                  data-id=${node.id}
                  aria-label=${t('hv.row.actionsFor', { name: node.name })}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._emit('more-location', { locationId: node.id, node });
                  }}
                >
                  ${icon('dotsVertical', 17)}
                </button>
              </span>`
            : null}
          ${this.manage && !this.mobile
            ? html`<span class="actions">
                ${MANAGE_ACTIONS.map(
                  ([testid, event, label, title, glyph]) => html`<button
                    class="action ${event === 'delete-location' ? 'danger' : ''}"
                    data-testid=${testid}
                    data-id=${node.id}
                    aria-label=${t(label, { name: node.name })}
                    title=${t(title)}
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._emit(event, { locationId: node.id, node });
                    }}
                  >
                    ${icon(glyph, 16)}
                  </button>`,
                )}
              </span>`
            : null}
        </div>
        <slot name=${`after-${node.id}`}></slot>
        ${hasChildren
          ? html`<div id=${nodeChildrenId(node.id)} ?hidden=${!open}>
              ${open ? children.map((c) => this._renderNode(c, depth + 1, isExcluded)) : null}
            </div>`
          : null}
      </div>
    `;
  }

  /** "4 / 37" while a filter is on, plain "37" otherwise. */
  private _pairedCount(total: number, matching: number | null, testid?: string) {
    return html`<span class="count" data-testid=${ifDefined(testid)}
      >${matching === null ? total : `${matching} / ${total}`}</span
    >`;
  }

  /** An area band's tally, over every root it covers, filtered out or not. */
  private _renderAreaCount(roots: LocationTreeNode[]) {
    const total = roots.reduce((sum, r) => sum + (r.subtree_item_count ?? r.direct_item_count ?? 0), 0);
    const counted = roots.filter((r) => r.matching_subtree_count !== undefined);
    const matching = counted.length
      ? counted.reduce((sum, r) => sum + (r.matching_subtree_count ?? 0), 0)
      : null;
    return this._pairedCount(total, matching, 'tree-area-count');
  }

  /** True when this node is one of the host's selected locations. */
  private _isSelected(id: string): boolean {
    return this.selectedIds.length ? this.selectedIds.includes(id) : this.selectedId === id;
  }

  /** True when any location is selected, by either property. */
  private _anySelected(): boolean {
    return this.selectedIds.length > 0 || this.selectedId !== null;
  }

  /** The band over a group of top-level locations; pressable only where `areaSelectable`. */
  private _renderAreaHeader(
    group: AreaGroup | null,
    roots: LocationTreeNode[],
    open: boolean,
    key: string,
    empty: boolean,
  ) {
    const pickable = this.areaSelectable && group !== null;
    const selected =
      pickable && this.selectedAreaId === group.id && !this._anySelected() && !this.orphansSelected;
    const name = group?.name ?? t('hv.term.noArea');
    const label = group
      ? renderAreaChip(group.name)
      : html`<span class="hv-area-chip quiet area-none"
          ><span class="hv-chip-text">${name}</span></span
        >`;

    return html`<div
      class="row hv-browse-row area-head ${selected ? 'selected' : ''} ${pickable ? 'selectable' : ''}"
      role="treeitem"
      aria-selected=${String(selected)}
      aria-expanded=${ifDefined(empty ? undefined : String(open))}
      aria-controls=${ifDefined(empty ? undefined : areaRootsId(key))}
      aria-level="1"
      tabindex="-1"
      data-testid="tree-area-head"
      data-area=${group?.id ?? NO_AREA_KEY}
      @keydown=${(e: KeyboardEvent) => {
        // A treeitem that answers the keys a button would.
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (pickable) this._emit('select-area', { areaId: group.id });
        else if (!empty) this._toggleArea(key);
      }}
    >
      ${empty
        ? placeholderTwisty()
        : html`<button
            class="twisty hv-browse-row-lead"
            data-testid="tree-area-twisty"
            tabindex="-1"
            data-area=${group?.id ?? NO_AREA_KEY}
            aria-label=${t(open ? 'hv.tree.collapse' : 'hv.tree.expand', { name })}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggleArea(key);
            }}
          >
            ${icon(open ? 'chevronDown' : 'chevronRight', 17)}
          </button>`}
      ${pickable
        ? html`<button
            class="area-name"
            data-testid="tree-area-select"
            tabindex="-1"
            data-area=${group.id}
            title=${name}
            @click=${() => this._emit('select-area', { areaId: group.id })}
          >
            ${label}
          </button>`
        : html`<span class="area-name" title=${name}>${label}</span>`}
      ${this.showCounts ? this._renderAreaCount(roots) : null}
    </div>`;
  }

  /** One group's header and, while it is open, the roots filed under it. */
  private _renderAreaSection(group: AreaGroup | null, roots: LocationTreeNode[], filtering: boolean) {
    const visible = roots.filter((r) => this._visible(r));
    // An empty area is still a pick target, but heads no container.
    const empty = visible.length === 0;
    if (empty && !(this.showEmptyAreas && group !== null && !filtering)) return null;
    const key = group ? `area:${group.id}` : NO_AREA_KEY;
    const open = !empty && (filtering || !this._collapsedAreas.has(key));
    return html`<div>
      ${this._renderAreaHeader(group, roots, open, key, empty)}
      ${empty
        ? null
        : html`<div id=${areaRootsId(key)} ?hidden=${!open}>
            ${open ? visible.map((r) => this._renderNode(r, 1, false)) : null}
          </div>`}
    </div>`;
  }

  /** Matches on items with no location: the whole-inventory matches less the roots'. */
  private get _matchingOrphanCount(): number | null {
    if (this.matchingTotalCount === null) return null;
    const filed = this.nodes.reduce((sum, n) => sum + (n.matching_subtree_count ?? 0), 0);
    return Math.max(0, this.matchingTotalCount - filed);
  }

  /** The way out of an empty tree: a name, emitted for the host to create at the root. */
  private _renderCreate() {
    if (!this._creating) {
      return html`<div class="create">
        <button
          class="create-open"
          data-testid="tree-create"
          @click=${() => {
            this._creating = true;
            this._newName = '';
          }}
        >
          ${icon('plus', 15)} ${t('hv.tree.newLocation')}
        </button>
      </div>`;
    }
    const name = this._newName.trim();
    return html`<div class="create">
      <div class="create-row">
        <input
          class="hv-input"
          data-testid="tree-create-name"
          aria-label=${t('hv.fullView.newLocationName')}
          placeholder=${t('hv.tree.locationNamePlaceholder')}
          .value=${this._newName}
          @input=${(e: Event) => {
            this._newName = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              this._submitCreate();
            } else if (e.key === 'Escape') {
              // Escape closes the field only, not the picker or form around it.
              e.preventDefault();
              e.stopPropagation();
              this._creating = false;
            }
          }}
        />
        <button
          class="hv-pill"
          data-testid="tree-create-submit"
          ?disabled=${!name}
          @click=${() => this._submitCreate()}
        >
          ${t('hv.action.create')}
        </button>
      </div>
    </div>`;
  }

  private _submitCreate() {
    const name = this._newName.trim();
    if (!name) return;
    this._creating = false;
    this._newName = '';
    this._emit('create-location', { name });
  }

  render() {
    const filtering = this.filterText.trim().length > 0;
    const { areaGroups, ungrouped } = groupRootsByArea(this.nodes, this.areas, {
      includeEmptyAreas: this.showEmptyAreas && !filtering,
    });
    // With no area anywhere, a lone "No area" band would name no distinction.
    const rendered = areaGroups.length
      ? [
          ...areaGroups.map((g) => this._renderAreaSection(g, g.roots, filtering)),
          this._renderAreaSection(null, ungrouped, filtering),
        ].filter(Boolean)
      : this.nodes.map((n) => this._renderNode(n, 0, false)).filter(Boolean);
    return html`
      <div role="tree" aria-label=${t('hv.field.locations')} @keydown=${this._onTreeKeydown}>
        ${this.showAll
          ? html`<button
              class="row hv-browse-row ${!this.orphansSelected && !this._anySelected() ? 'selected' : ''}"
              data-testid="tree-all"
              @click=${() => this._emit('select', { locationId: null, node: null })}
            >
              ${placeholderTwisty()} ${icon(this.allIcon, 18)}
              <span class="name hv-browse-row-label">${this.allLabel}</span>
              ${this.showCounts && this.totalCount !== null
                ? this._pairedCount(this.totalCount, this.matchingTotalCount)
                : null}
            </button>`
          : null}
        ${rendered.length
          ? rendered
          : html`
              <div class="empty" data-testid="tree-empty">
                ${filtering ? t('hv.tree.noneMatch') : t('hv.tree.noneYet')}
              </div>
              ${this.allowCreate && !filtering ? this._renderCreate() : null}
            `}
        ${this.showOrphans
          ? html`
              <div class="divider"></div>
              <button
                class="row hv-browse-row orphans ${this.orphansSelected ? 'selected' : ''}"
                data-testid="tree-orphans"
                @click=${() => this._emit('select-orphans', {})}
              >
                ${placeholderTwisty()} ${icon('mapMarkerOff', 18)}
                <span class="name hv-browse-row-label">${t('hv.term.noLocation')}</span>
                ${this.showCounts && this.orphanCount !== null
                  ? this._pairedCount(this.orphanCount, this._matchingOrphanCount)
                  : null}
              </button>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-location-tree': HVLocationTree;
  }
}
