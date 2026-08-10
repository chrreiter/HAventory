import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { groupRootsByArea, locationMatches } from '../store/location-tree';
import { renderAreaChip } from '../ui/location-path';
import { counted } from '../ui/plural';
import type { AreaGroup } from '../store/location-tree';
import type { AreaRef, LocationTreeNode } from '../store/types';

/** The tail of ungrouped roots, keyed like a group so it collapses like one. */
const NO_AREA_KEY = 'no-area';

/**
 * The container a row discloses, named so `aria-controls` can point at it. A
 * collapsed row renders no descendants at all, so the container stays behind
 * empty rather than leaving with them — an `aria-controls` that resolves to
 * nothing announces the row as controlling nothing.
 *
 * The id has to survive being written into a selector and has to be the row's
 * alone. The prefix keeps a uuid that opens with a digit from opening the id,
 * and every character outside the id alphabet — the colon in an area key,
 * whatever a later id scheme brings — becomes `_<code point>_`. Escaping `_`
 * itself is what keeps that mapping one-to-one, so two keys cannot collapse
 * onto one container.
 */
const containerId = (prefix: string, key: string) =>
  `${prefix}-${key.replace(/[^A-Za-z0-9-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`)}`;

/** Where a node's children go, derived from the node id so it never moves. */
const nodeChildrenId = (nodeId: string) => containerId('tree-children', nodeId);

/** Where an area band's roots go, derived from the key the band collapses under. */
const areaRootsId = (key: string) => containerId('tree-area-roots', key);

/**
 * The backend's nested location tree, rendered as it is served. One component
 * serves four callers — the full-view sidebar, the filter panel's location
 * picker, the item editor's location field and the organize dialog — hence the
 * mode/decoration switches rather than four near-identical trees.
 *
 * Top-level locations are filed under the HA area they belong to, so a tree
 * answers "which room is this in" without leaving for the area registry. An
 * inventory that assigns no areas gets no headers and renders flat.
 *
 * Counts come from the tree nodes themselves (`direct_item_count` /
 * `subtree_item_count`), so nothing is computed client-side.
 */
@customElement('hv-location-tree')
export class HVLocationTree extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: block;
      }
      .row {
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
        /* The organize dialog declares this property, so the tree it hosts
           keeps the same vertical rhythm as the value rows on its other three
           tabs. Nothing else declares it, so every other host — the sidebar,
           the filter panel, the editor's location field — takes the fallback
           and is unaffected. */
        padding: var(--hv-organize-row-pad, 7px) 12px;
        border-radius: var(--hv-radius-input);
        /* The whole row picks the location it names. The All-items and
           No-location rows below are real buttons and get this for free; a node
           row cannot be one, because it holds the twisty and the manage actions
           and a button may not contain a button. */
        cursor: pointer;
      }
      .row:hover {
        background: var(--hv-hover-overlay);
      }
      .row.selected {
        background: var(--hv-primary-tint);
        color: var(--hv-on-primary-tint);
        font-weight: 500;
        box-shadow: inset -3px 0 0 0 var(--hv-primary);
      }
      .row.orphans {
        color: var(--hv-warn);
      }
      .row[disabled] {
        opacity: 0.4;
        cursor: default;
      }
      .twisty {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: none;
        background: none;
        border-radius: 50%;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .twisty:hover {
        background: var(--hv-hover-overlay);
      }
      .twisty.placeholder {
        visibility: hidden;
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
      }
      .count {
        flex: none;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .row.selected .count {
        color: inherit;
      }
      /* Managing is browsing too: the count is the way into the items, exactly
         as it is on the organize dialog's category and tag rows. */
      .count.link {
        border: none;
        background: none;
        padding: 0 2px;
        font: 400 12px var(--hv-font);
        color: var(--hv-primary-dark);
        /* 12px text is a 14px-tall target; the box has to be told to be bigger
           than its own line. WCAG 2.2 asks 24px of any pointer, and the count
           is a target wherever it is a link — the browsing sidebar included. */
        display: inline-flex;
        align-items: center;
        min-height: 24px;
      }
      .count.link:hover {
        text-decoration: underline;
      }
      /* A phone reaching for a managed row needs the full 44px, and the row it
         sits in grows to hold it. Confined to the managing tree: the browsing
         sidebar is a list to read down, and 44px counts would stretch it past
         what a phone can show at once. */
      .row.manage.touch .count.link {
        min-height: var(--hv-tap-min, 44px);
      }
      /* Left-packed like a value row (name, then count) instead of the name
         pushing the count to the far edge. */
      .row.manage .name {
        flex: 0 1 auto;
      }
      .row.manage .actions {
        margin-left: auto;
      }
      /* An area heads a group of locations rather than being one, so it reads
         as a band across the tree and never as a row a location could sit at. */
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
      /* Everywhere else the chip annotates a path it sits beside, so it is set
         smaller than the text it qualifies. Here it *is* the row's label, one
         level of the tree above the locations under it, and reading smaller than
         them inverts the hierarchy it heads.
         The no-area band is that same heading for the locations no area claims,
         so it takes the same size and shape and says the difference with its
         fill: an outline where the others carry one. */
      .area-name .hv-area-chip,
      .area-none {
        font-size: inherit;
      }
      .actions {
        flex: none;
        display: flex;
        gap: 2px;
      }
      /* Reveal-on-hover only where hovering exists, or a touch screen could
         never reach these at all. Hidden rather than unrendered, so the rest of
         the row does not jump sideways the moment the pointer arrives. */
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
      /* The touch layout's single ⋮ is the whole of a row's reach on a phone,
         so it carries the tap target the organize dialog's other tabs give
         their row actions. */
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
      /* An inventory with no locations at all: the picker is the first place a
         user meets the concept, so it offers the way in rather than naming a
         menu three steps away. Only the empty state carries it — the organize
         dialog stays the surface that manages a tree that exists. */
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
  @property({ type: String }) selectedId: string | null = null;
  /** Show an "All items" row that clears the location filter. */
  @property({ type: Boolean }) showAll = false;
  /**
   * What that row is called, and the glyph beside it. The row always clears the
   * location, but what clearing *means* depends on who is asking: browsing with
   * no location means every item, while assigning one means the item ends up
   * filed nowhere. Calling it "All items" in a picker promised a set and
   * delivered an empty field.
   */
  @property({ type: String }) allLabel = 'All items';
  @property({ type: String }) allIcon: IconName = 'home';
  /** Show a "No location" row bound to the orphans filter. */
  @property({ type: Boolean }) showOrphans = false;
  /** True when the current selection is the orphans row rather than a location. */
  @property({ type: Boolean }) orphansSelected = false;
  @property({ type: Number }) totalCount: number | null = null;
  @property({ type: Number }) orphanCount: number | null = null;
  /**
   * Items matching the active filter across the whole inventory, ignoring its
   * location dimension. Pairs the "All items" row with the node rows; the
   * orphan row's match count is the part of it no root accounts for.
   */
  @property({ type: Number }) matchingTotalCount: number | null = null;
  @property({ type: Boolean }) showCounts = false;
  /**
   * Let an area header be picked, emitting `select-area` instead of `select`.
   *
   * What picking one means belongs to the caller: browsing filters the list to
   * the area, while the parent picker files the location at the top level of it.
   * Trees that hand back a `location_id` — the item editor's, the merge target —
   * leave this off, because an area is not a location and holds no items itself.
   */
  @property({ type: Boolean }) areaSelectable = false;
  /** The area currently chosen, for the header's selected state. */
  @property({ type: String }) selectedAreaId: string | null = null;
  /**
   * Band every area Home Assistant knows, not only the ones already holding a
   * location tree. An area with nothing in it is still somewhere a tree can be
   * filed, which is the whole point of picking one — so the parent picker sets
   * this and browsing does not. A filter suspends it: an empty band matches
   * nothing and would only stand between the user and the rows that do.
   */
  @property({ type: Boolean }) showEmptyAreas = false;
  /** Reveal the rename/merge/delete affordances on hover. Only the organize dialog sets this. */
  @property({ type: Boolean }) manage = false;
  /**
   * Phone layout for `manage`: one always-visible ⋮ per row instead of a row of
   * icons only a hover can reveal.
   */
  @property({ type: Boolean }) mobile = false;
  /**
   * Disable this node and everything under it. Parent pickers must exclude the
   * location itself and its descendants — the backend rejects cycles.
   */
  @property({ type: String }) excludeSubtreeOf: string | null = null;
  /** Substring filter over name and display path. */
  @property({ type: String }) filterText = '';
  /**
   * Offer to create a first location from the empty state, emitting
   * `create-location`. Only a host that can actually run the command sets it —
   * an affordance that leads nowhere is worse than the plain statement.
   */
  @property({ type: Boolean }) allowCreate = false;
  /** Resolves the area ids on the nodes to names for the group headers. */
  @property({ attribute: false }) areas: AreaRef[] = [];

  @state() private _expanded = new Set<string>();
  /**
   * Collapsed area groups, tracked by absence rather than presence like the
   * locations above: a group is scaffolding over the tree, so hiding what the
   * user came for until they open every band would be the wrong default.
   */
  @state() private _collapsedAreas = new Set<string>();
  /** The first-location field is showing, and what has been typed into it. */
  @state() private _creating = false;
  @state() private _newName = '';

  /** Revealing the name field has to put the caret in it, or it asks for a
   *  second tap before it can be typed into. */
  protected updated(changed: Map<string, unknown>) {
    if (changed.has('_creating') && this._creating) {
      this.renderRoot.querySelector<HTMLInputElement>('[data-testid="tree-create-name"]')?.focus();
    }
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
    const next = new Set(this._collapsedAreas);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._collapsedAreas = next;
  }

  private _findPath(nodes: LocationTreeNode[], id: string): LocationTreeNode[] | null {
    for (const node of nodes) {
      if (node.id === id) return [node];
      const deeper = this._findPath(node.children ?? [], id);
      if (deeper) return [node, ...deeper];
    }
    return null;
  }

  /** Pick a node — from anywhere on its row, which is one target. */
  private _select(node: LocationTreeNode, excluded: boolean) {
    if (excluded) return;
    this._emit('select', { locationId: node.id, node });
  }

  private _toggle(id: string) {
    const next = new Set(this._expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expanded = next;
  }

  private _emit(name: string, detail: Record<string, unknown>) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _matches(node: LocationTreeNode): boolean {
    // Shared with the tally the organize toolbar prints above this tree, so the
    // number and the rows can never tell different stories.
    return locationMatches(node, this.filterText);
  }

  /** A node stays visible when it matches or when any descendant does. */
  private _visible(node: LocationTreeNode): boolean {
    if (this._matches(node)) return true;
    return (node.children ?? []).some((c) => this._visible(c));
  }

  /**
   * The per-node tally. In a picker it is a plain number beside the name; in
   * manage mode it names its unit and opens the items, so a location row offers
   * the same "N items" way in that a category or tag row does.
   */
  private _renderCount(node: LocationTreeNode, excluded: boolean) {
    const count = node.subtree_item_count ?? node.direct_item_count ?? 0;
    if (!this.manage) {
      // A total that never moves while a filter is on says nothing about where
      // the matches are — which is the one thing this sidebar is for.
      const matching = node.matching_subtree_count;
      return html`<span class="count" data-testid="tree-count"
        >${matching === undefined ? count : `${matching} / ${count}`}</span
      >`;
    }
    return html`<button
      class="count link"
      data-testid="tree-count"
      data-id=${node.id}
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
    const selected = !this.orphansSelected && this.selectedId === node.id;

    return html`
      <div>
        <div
          class="row ${selected ? 'selected' : ''} ${this.manage ? 'manage' : ''} ${this.mobile
            ? 'touch'
            : ''}"
          role="treeitem"
          aria-selected=${String(selected)}
          aria-expanded=${ifDefined(hasChildren ? String(open) : undefined)}
          aria-controls=${ifDefined(hasChildren ? nodeChildrenId(node.id) : undefined)}
          aria-level=${depth + 1}
          aria-disabled=${ifDefined(isExcluded ? 'true' : undefined)}
          title=${node.path?.display_path ?? node.name}
          tabindex=${isExcluded ? -1 : 0}
          data-testid="tree-row"
          data-id=${node.id}
          data-depth=${depth}
          ?disabled=${isExcluded}
          style="padding-left: ${12 + depth * 18}px"
          @click=${() => this._select(node, isExcluded)}
          @keydown=${(e: KeyboardEvent) => {
            // The row answers Enter and Space itself now that it is the target;
            // as a div it inherits neither from the browser.
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            this._select(node, isExcluded);
          }}
        >
          ${hasChildren
            ? html`<button
                class="twisty"
                data-testid="tree-twisty"
                aria-label=${open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._toggle(node.id);
                }}
              >
                ${icon(open ? 'chevronDown' : 'chevronRight', 17)}
              </button>`
            : html`<span class="twisty placeholder">${icon('chevronRight', 17)}</span>`}
          <span class="name">${node.name}</span>
          ${this.showCounts ? this._renderCount(node, isExcluded) : null}
          ${this.manage && this.mobile
            ? html`<span class="actions">
                <button
                  class="action"
                  data-testid="tree-more"
                  data-id=${node.id}
                  aria-label=${`Actions for ${node.name}`}
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
                <button
                  class="action"
                  data-testid="tree-merge"
                  data-id=${node.id}
                  aria-label=${`Merge ${node.name}`}
                  title="Merge into another location"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._emit('merge-location', { locationId: node.id, node });
                  }}
                >
                  ${icon('callMerge', 16)}
                </button>
                <button
                  class="action"
                  data-testid="tree-edit"
                  data-id=${node.id}
                  aria-label=${`Edit ${node.name}`}
                  title="Edit location"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._emit('edit-location', { locationId: node.id, node });
                  }}
                >
                  ${icon('pencil', 16)}
                </button>
                <button
                  class="action danger"
                  data-testid="tree-delete"
                  data-id=${node.id}
                  aria-label=${`Delete ${node.name}`}
                  title="Delete location"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._emit('delete-location', { locationId: node.id, node });
                  }}
                >
                  ${icon('del', 16)}
                </button>
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
  private _pairedCount(total: number, matching: number | null) {
    return html`<span class="count">${matching === null ? total : `${matching} / ${total}`}</span>`;
  }

  /**
   * An area group's row: what its whole set of trees holds, over every root it
   * covers — including any the active filter hid, which is what the total half
   * of the pair is for.
   */
  private _renderAreaCount(roots: LocationTreeNode[]) {
    const total = roots.reduce((sum, r) => sum + (r.subtree_item_count ?? r.direct_item_count ?? 0), 0);
    const counted = roots.filter((r) => r.matching_subtree_count !== undefined);
    const matching = counted.length
      ? counted.reduce((sum, r) => sum + (r.matching_subtree_count ?? 0), 0)
      : null;
    return html`<span class="count" data-testid="tree-area-count"
      >${matching === null ? total : `${matching} / ${total}`}</span
    >`;
  }

  /**
   * The band a group of top-level locations sits under. Never a location: it
   * carries no id a picker could assign, and only a browsing tree
   * (`areaSelectable`) makes it pressable at all.
   */
  private _renderAreaHeader(
    group: AreaGroup | null,
    roots: LocationTreeNode[],
    open: boolean,
    key: string,
    empty: boolean,
  ) {
    const pickable = this.areaSelectable && group !== null;
    const selected =
      pickable && this.selectedAreaId === group.id && this.selectedId === null && !this.orphansSelected;
    const label = group
      ? renderAreaChip(group.name)
      : html`<span class="hv-area-chip quiet area-none">No area</span>`;

    return html`<div
      class="row area-head ${selected ? 'selected' : ''} ${pickable ? 'selectable' : ''}"
      role="treeitem"
      aria-selected=${String(selected)}
      aria-expanded=${ifDefined(empty ? undefined : String(open))}
      aria-controls=${ifDefined(empty ? undefined : areaRootsId(key))}
      aria-level="1"
      data-testid="tree-area-head"
      data-area=${group?.id ?? NO_AREA_KEY}
    >
      ${empty
        ? html`<span class="twisty placeholder">${icon('chevronRight', 17)}</span>`
        : html`<button
            class="twisty"
            data-testid="tree-area-twisty"
            data-area=${group?.id ?? NO_AREA_KEY}
            aria-label=${open
              ? `Collapse ${group?.name ?? 'No area'}`
              : `Expand ${group?.name ?? 'No area'}`}
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
            data-area=${group.id}
            @click=${() => this._emit('select-area', { areaId: group.id })}
          >
            ${label}
          </button>`
        : html`<span class="area-name">${label}</span>`}
      ${this.showCounts ? this._renderAreaCount(roots) : null}
    </div>`;
  }

  /** One group's header and, while it is open, the roots filed under it. */
  private _renderAreaSection(group: AreaGroup | null, roots: LocationTreeNode[], filtering: boolean) {
    const visible = roots.filter((r) => this._visible(r));
    // An area holding nothing is still a target where areas are pickable; with
    // no roots under it there is nothing to disclose, so it heads no container.
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

  /**
   * How many matches are on items with no location: the whole-inventory match
   * count less everything the roots already account for. Every item is either
   * filed somewhere or an orphan, so the remainder needs no extra query.
   */
  private get _matchingOrphanCount(): number | null {
    if (this.matchingTotalCount === null) return null;
    const filed = this.nodes.reduce((sum, n) => sum + (n.matching_subtree_count ?? 0), 0);
    return Math.max(0, this.matchingTotalCount - filed);
  }

  /**
   * The way out of an empty tree: a name, and the location it becomes.
   *
   * The new location is filed at the root with no area — the only placement
   * that needs no tree to point at, which is the situation this exists for.
   * Creating it is the host's job; this emits the name and closes.
   */
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
          ${icon('plus', 15)} New location…
        </button>
      </div>`;
    }
    const name = this._newName.trim();
    return html`<div class="create">
      <div class="create-row">
        <input
          class="hv-input"
          data-testid="tree-create-name"
          aria-label="New location name"
          placeholder="Location name"
          .value=${this._newName}
          @input=${(e: Event) => {
            this._newName = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              this._submitCreate();
            } else if (e.key === 'Escape') {
              // The field is what Escape takes back here; the picker around it
              // — and the form around that — are not what the user just opened.
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
          Create
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
    // With no area anywhere there is nothing to group by, and a lone "No area"
    // band over the whole tree would name a distinction that does not exist.
    const rendered = areaGroups.length
      ? [
          ...areaGroups.map((g) => this._renderAreaSection(g, g.roots, filtering)),
          this._renderAreaSection(null, ungrouped, filtering),
        ].filter(Boolean)
      : this.nodes.map((n) => this._renderNode(n, 0, false)).filter(Boolean);
    return html`
      <div role="tree" aria-label="Locations">
        ${this.showAll
          ? html`<button
              class="row ${!this.orphansSelected && this.selectedId === null ? 'selected' : ''}"
              data-testid="tree-all"
              @click=${() => this._emit('select', { locationId: null, node: null })}
            >
              <span class="twisty placeholder">${icon('chevronRight', 17)}</span>
              ${icon(this.allIcon, 18)}
              <span class="name">${this.allLabel}</span>
              ${this.showCounts && this.totalCount !== null
                ? this._pairedCount(this.totalCount, this.matchingTotalCount)
                : null}
            </button>`
          : null}
        ${rendered.length
          ? rendered
          : html`
              <div class="empty" data-testid="tree-empty">
                ${filtering ? 'No locations match' : 'No locations yet'}
              </div>
              ${this.allowCreate && !filtering ? this._renderCreate() : null}
            `}
        ${this.showOrphans
          ? html`
              <div class="divider"></div>
              <button
                class="row orphans ${this.orphansSelected ? 'selected' : ''}"
                data-testid="tree-orphans"
                @click=${() => this._emit('select-orphans', {})}
              >
                <span class="twisty placeholder">${icon('chevronRight', 17)}</span>
                ${icon('alert', 18)}
                <span class="name">No location</span>
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
