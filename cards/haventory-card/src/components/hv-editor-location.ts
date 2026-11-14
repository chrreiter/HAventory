import { t } from '../i18n';
import { serverErrorText } from '../store/server-error';
import { LitElement, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import { tokens, base } from '../ui/tokens';
import { editorFields } from '../ui/editor-fields';
import { chip } from '../ui/chip';
import { areaMarkName, locationPathParts, pathTitle, renderAreaChip } from '../ui/location-path';
import { icon } from '../ui/icons';
import { LocationPicker } from '../ui/location-picker';
import type { AreaRef, Location, LocationTreeNode } from '../store/types';

/** The location tree's holder, named so `aria-controls` can point at it while closed. */
const LOCATION_TREE_ID = 'editor-location-tree-holder';

/**
 * The item editor's location field: a trigger showing the chosen path that
 * opens the location tree inside the form, so picking one never stacks a
 * second modal. It owns the picker's open state and the first-run create; the
 * value is the editor's, which this element hears back as `.value` after each
 * `change`.
 */
@customElement('hv-editor-location')
export class HVEditorLocation extends LitElement {
  static override styles = [tokens, base, editorFields, chip];

  /** The chosen location's id, as the editor's form model has it. */
  @property({ type: String }) value: string | null = null;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  /** HA areas, so the picker files its roots under the right one. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  /** Creates a location from inside the picker, for a first run; null offers no create. */
  @property({ attribute: false }) createLocation: ((name: string) => Promise<Location>) | null = null;
  @property({ type: Boolean, reflect: true }) mobile = false;

  /** Why creating a first location from the picker failed. */
  @state() private _locationError: string | null = null;
  /** Locations this field created, until the `locations` prop carries them. */
  @state() private _createdLocations: Location[] = [];

  /** One location, so a pick finishes the job. */
  private readonly _location = new LocationPicker(this);
  private readonly _emit = emitter<'hv-editor-location'>(this);

  @query(`button[aria-controls="${LOCATION_TREE_ID}"]`) private _trigger!: HTMLElement | null;

  /** Whether the tree is showing, for the editor deciding what Escape takes back. */
  get open(): boolean {
    return this._location.open;
  }

  /** Shut the picker, drop its error and put focus back on the control that opened it. */
  close(): void {
    this._location.close();
    this._locationError = null;
    this._trigger?.focus();
  }

  /** The host's flat list, plus anything this field created that it still lacks. */
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

  /** Make a location from the picker and file the item in it in one move. */
  private async _createLocation(name: string) {
    const create = this.createLocation;
    if (!create) return;
    this._locationError = null;
    try {
      const created = await create(name);
      this._createdLocations = [...this._createdLocations, created];
      this._emit('change', { locationId: created.id });
      this._location.close();
    } catch (err) {
      this._locationError = serverErrorText(err, t('hv.editor.locationCreateFailed'));
    }
  }

  override render() {
    const locations = this._knownLocations;
    const loc = locations.find((l) => l.id === this.value);
    const parts = locationPathParts(loc, locations, this.areas, t('hv.term.noLocation'));
    return html`
      <span class="hv-label">${t('hv.field.location')}</span>
      ${this._location.render(
        {
          triggerClass: `field-button ${this.value ? '' : 'empty'}`,
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
          .selectedId=${this.value}
          showAll
          allLabel=${t('hv.term.noLocation')}
          allIcon="close"
          ?allowCreate=${this.createLocation !== null}
          @select=${(e: HvEvent<'hv-location-tree', 'select'>) => {
            this._emit('change', { locationId: e.detail.locationId });
            this._locationError = null;
          }}
          @create-location=${(e: HvEvent<'hv-location-tree', 'create-location'>) => {
            e.stopPropagation();
            void this._createLocation(e.detail.name);
          }}
        ></hv-location-tree>`,
      )}
      ${
        this._locationError
          ? html`<span class="field-error" data-testid="editor-location-error">${this._locationError}</span>`
          : null
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-editor-location': HVEditorLocation;
  }
}
