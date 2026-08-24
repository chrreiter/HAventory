import type { CSSResult } from 'lit';
import { vi } from 'vitest';

import { Store } from './store/store';
import { toIsoDate } from './ui/relative-time';
import type {
  AnyEventPayload,
  AreaRef,
  Attachment,
  AttachmentKind,
  ExportDocument,
  HassLike,
  ImportPreview,
  ImportSummary,
  Item,
  Location,
  StatsCounts,
  StatusDefinition,
} from './store/types';

// Mirror real Home Assistant: `subscribeMessage` hands the callback the *inner*
// event payload, not the `{id, type:'event', event}` envelope.
type SubCb = (event: AnyEventPayload) => void;

export interface MockConfig {
  items?: Item[];
  locations?: Location[];
  conflictOnUpdate?: boolean;
  /** What `haventory/config` reports as the configured card heading. */
  cardTitle?: string;
  /**
   * What `haventory/config` reports as the integration-wide pill choice.
   * Omitted means the key is absent from the response, as an older backend
   * leaves it; `null` is a backend saying it has no opinion.
   */
  quickFilters?: string[] | null;
  /** What `haventory/areas/list` reports — the HA area registry, read-only. */
  areas?: AreaRef[];
  /** The status vocabulary; defaults to the built-in three the backend seeds. */
  statuses?: StatusDefinition[];
}

type HealthPatch = {
  healthy?: boolean;
  issues?: string[];
};

export interface MockHass extends HassLike {
  __emit(topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>): void;
  __setConflict(on: boolean): void;
  __setItems(items: Item[]): void;
  __setLocations(locations: Location[]): void;
  __setHealth(patch: HealthPatch): void;
  /** Reject the next `n` commands with an arbitrary error (transport by default). */
  __failNext(n: number, err?: unknown): void;
  /** Make every subsequent `haventory/subscribe` reject with `err`. */
  __failSubscribe(err: unknown | null): void;
  /** Reject the next `n` `haventory/subscribe` calls with `err`, then behave normally. */
  __failSubscribeNext(n: number, err: unknown): void;
  /** Every callWS `type` seen so far, in order. */
  __calls: string[];
  /** Every command message in full, for assertions about what went on the wire. */
  __messages: Record<string, unknown>[];
  /** Every subscribed topic seen so far, in order — refused attempts included. */
  __subscribeCalls: string[];
  /** Every `haventory/subscribe` message in full, for assertions about its filters. */
  __subscribeMessages: Record<string, unknown>[];
  /** Deliver a Home Assistant core event to whoever subscribed to it. */
  __emitHaEvent(eventType: string, data?: Record<string, unknown>): void;
  /** Open core-event subscriptions for `eventType` — 0 once a store disposes. */
  __haEventSubscriberCount(eventType: string): number;
  /** Replace what `haventory/areas/list` reports, as an HA area edit would. */
  __setAreas(areas: AreaRef[]): void;
  /**
   * Drop the socket and bring it back, the way Home Assistant does.
   *
   * The order is the point: HA re-issues the subscriptions it was holding and
   * only then fires `ready`, so a live watch survives a reconnect without ever
   * reporting a refusal — and any event fired while the socket was down is
   * simply gone. Subscribers stay registered; nothing is replayed.
   */
  __reconnect(): void;
  /** Close the socket and leave it closed, the way a stopped server does. */
  __disconnect(): void;
  /** Report the socket back up, with the watches already re-issued. */
  __connectionReady(): void;
}

export function makeMockHass(initial?: MockConfig): MockHass {
  let items: Item[] = initial?.items ? [...initial.items] : [];
  let locations: Location[] = initial?.locations ? [...initial.locations] : [];
  let conflictOnUpdate = !!initial?.conflictOnUpdate;
  const cardTitle = initial?.cardTitle ?? 'HAventory';
  const quickFilters = initial?.quickFilters;
  let areas: AreaRef[] = initial?.areas ? [...initial.areas] : [];
  // The three the backend seeds, so a test that says nothing about statuses
  // still sees what a real install carries.
  const statuses: StatusDefinition[] = initial?.statuses
    ? initial.statuses.map((d) => ({ ...d }))
    : [
        { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
        { slug: 'missing', label: 'Missing', order: 1, color: 'amber', icon: 'alert' },
        { slug: 'needs_repair', label: 'Needs repair', order: 2, color: 'amber', icon: 'wrench' },
      ];
  let healthOverride: HealthPatch | null = null;
  let failRemaining = 0;
  let failError: unknown = new Error('connection lost');
  let subscribeError: unknown | null = null;
  let subscribeFailRemaining = 0;
  const subs: Record<string, SubCb[]> = {};
  const lifecycleListeners: Record<string, (() => void)[]> = {};
  const haEventSubs: Record<string, SubCb[]> = {};
  const calls: string[] = [];
  const messages: Record<string, unknown>[] = [];
  const subscribeCalls: string[] = [];
  const subscribeMessages: Record<string, unknown>[] = [];

  const findItem = (msg: Record<string, unknown>): Item => {
    const itemId = String((msg as any).item_id);
    const it = items.find((i) => i.id === itemId);
    if (!it) throw { code: 'not_found', message: 'not found' };
    return it;
  };
  const replaceItem = (next: Item): Item => {
    const idx = items.findIndex((i) => i.id === next.id);
    const stamped = { ...next, updated_at: new Date().toISOString(), version: next.version + 1 };
    if (idx >= 0) items[idx] = stamped;
    return stamped;
  };

  const hass: MockHass = {
    __calls: calls,
    __messages: messages,
    __subscribeCalls: subscribeCalls,
    __subscribeMessages: subscribeMessages,
    async callWS<T>(msg: Record<string, unknown>): Promise<T> {
      const type = String(msg.type || '');
      calls.push(type);
      messages.push({ ...msg });
      if (failRemaining > 0) {
        failRemaining -= 1;
        throw failError;
      }
      switch (type) {
        // ---- statuses ----
        case 'haventory/status/list': {
          return [...statuses].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)) as unknown as T;
        }
        case 'haventory/status/create': {
          const slug = String(msg.slug);
          if (statuses.some((d) => d.slug === slug)) throw { code: 'validation_error', message: 'status already exists' };
          const created: StatusDefinition = {
            slug,
            label: String(msg.label),
            order: typeof msg.order === 'number' ? msg.order : statuses.length,
            color: (msg.color as StatusDefinition['color']) ?? 'neutral',
            icon: (msg.icon as string) ?? 'check',
          };
          statuses.push(created);
          return created as unknown as T;
        }
        case 'haventory/status/update': {
          const found = statuses.find((d) => d.slug === msg.slug);
          if (!found) throw { code: 'not_found', message: 'status not found' };
          if (typeof msg.label === 'string') found.label = msg.label;
          if (typeof msg.color === 'string') found.color = msg.color as StatusDefinition['color'];
          if (typeof msg.icon === 'string') found.icon = msg.icon;
          return { ...found } as unknown as T;
        }
        case 'haventory/status/reorder': {
          const slugs = (msg.slugs as string[]) ?? [];
          const live = statuses.map((d) => d.slug);
          if ([...slugs].sort().join() !== [...live].sort().join()) {
            throw { code: 'validation_error', message: 'reorder must name every status exactly once' };
          }
          slugs.forEach((slug, index) => {
            const found = statuses.find((d) => d.slug === slug);
            if (found) found.order = index;
          });
          return statuses.map((d) => ({ ...d })) as unknown as T;
        }
        case 'haventory/status/delete': {
          const slug = String(msg.slug);
          if (slug === 'ok') throw { code: 'validation_error', message: 'the default status cannot be deleted' };
          const index = statuses.findIndex((d) => d.slug === slug);
          if (index < 0) throw { code: 'not_found', message: 'status not found' };
          const carrying = items.filter((i) => (i.status ?? 'ok') === slug);
          const target = msg.reassign_to as string | undefined;
          if (carrying.length > 0 && !target) {
            throw { code: 'validation_error', message: `status '${slug}' is on ${carrying.length} item(s)` };
          }
          if (target) carrying.forEach((i) => (i.status = target));
          const [removed] = statuses.splice(index, 1);
          return { status: removed, reassigned: carrying.length } as unknown as T;
        }
        case 'haventory/stats': {
          const counts: StatsCounts = {
            items_total: items.length,
            low_stock_count: items.filter((i) => typeof i.low_stock_threshold === 'number' && i.quantity <= (i.low_stock_threshold as number)).length,
            checked_out_count: items.filter((i) => i.checked_out).length,
            overdue_count: items.filter((i) => isMockOverdue(i)).length,
            checked_out_due_count: items.filter((i) => isMockCheckedOutDue(i)).length,
            inspection_overdue_count: items.filter((i) => isMockInspectionOverdue(i)).length,
            inspection_due_count: items.filter((i) => isMockInspectionDue(i)).length,
            missing_count: items.filter((i) => (i.status ?? 'ok') === 'missing').length,
            needs_repair_count: items.filter((i) => (i.status ?? 'ok') === 'needs_repair').length,
            status_counts: Object.fromEntries(
              statuses.map((d) => [d.slug, items.filter((i) => (i.status ?? 'ok') === d.slug).length]),
            ),
            locations_total: locations.length,
            no_location_count: items.filter((i) => i.location_id == null).length,
          };
          return counts as unknown as T;
        }
        case 'haventory/health': {
          const counts: StatsCounts = {
            items_total: items.length,
            low_stock_count: items.filter((i) => typeof i.low_stock_threshold === 'number' && i.quantity <= (i.low_stock_threshold as number)).length,
            checked_out_count: items.filter((i) => i.checked_out).length,
            overdue_count: items.filter((i) => isMockOverdue(i)).length,
            checked_out_due_count: items.filter((i) => isMockCheckedOutDue(i)).length,
            inspection_overdue_count: items.filter((i) => isMockInspectionOverdue(i)).length,
            inspection_due_count: items.filter((i) => isMockInspectionDue(i)).length,
            locations_total: locations.length,
            no_location_count: items.filter((i) => i.location_id == null).length,
          };
          return {
            healthy: healthOverride?.healthy ?? true,
            issues: healthOverride?.issues ?? [],
            counts,
          } as unknown as T;
        }
        case 'haventory/version': {
          return { integration_version: '0.0.1', schema_version: 4 } as unknown as T;
        }
        case 'haventory/config': {
          return {
            card_title: cardTitle,
            statuses: [...statuses],
            ...(quickFilters === undefined ? {} : { quick_filters: quickFilters }),
          } as unknown as T;
        }
        case 'haventory/areas/list': {
          return { areas } as unknown as T;
        }
        case 'haventory/export': {
          const doc: ExportDocument = {
            haventory_export_version: 1,
            schema_version: 4,
            exported_at: new Date().toISOString(),
            integration_version: '0.0.1',
            items: items.map((i) => ({ ...i })),
            locations: locations.map((l) => ({ ...l })),
          };
          return doc as unknown as T;
        }
        case 'haventory/import/preview': {
          const doc = ((msg as any).document ?? {}) as { items?: Item[]; locations?: Location[] };
          const policy = String((msg as any).policy || 'merge');
          const itemIds = (doc.items ?? []).map((i) => i.id);
          const locIds = (doc.locations ?? []).map((l) => l.id);
          const bucket = (ids: string[]) => ({ add: ids, update: [], conflict: [], unchanged: [] });
          const counts = (ids: string[]) => ({ total: ids.length, add: ids.length, update: 0, conflict: 0, unchanged: 0 });
          const report: ImportPreview = {
            valid: true,
            errors: [],
            policy: policy as ImportPreview['policy'],
            document: { haventory_export_version: 1, schema_version: 4, exported_at: null, integration_version: null },
            items: bucket(itemIds),
            locations: bucket(locIds),
            counts: { items: counts(itemIds), locations: counts(locIds) },
          };
          return report as unknown as T;
        }
        case 'haventory/import/execute': {
          const doc = ((msg as any).document ?? {}) as { items?: Item[]; locations?: Location[] };
          const policy = String((msg as any).policy || 'merge');
          items = (doc.items ?? []).map((i) => ({ ...i }));
          locations = (doc.locations ?? []).map((l) => ({ ...l }));
          const summary: ImportSummary = {
            applied: true,
            policy: policy as ImportSummary['policy'],
            items: { total: items.length, add: items.length, update: 0, conflict: 0, unchanged: 0 },
            locations: { total: locations.length, add: locations.length, update: 0, conflict: 0, unchanged: 0 },
            totals: {
              items_total: items.length,
              low_stock_count: 0,
              checked_out_count: 0,
              locations_total: locations.length,
              no_location_count: 0,
            },
          };
          return summary as unknown as T;
        }
        case 'haventory/distinct_values': {
          // Mirror the backend: distinct categories (case-insensitive) and tags,
          // each with a usage count, sorted case-insensitively by value. With a
          // filter each entry also carries `matching_count`, and no entry is
          // dropped — the list is autocomplete's vocabulary, not a result set.
          const facetFilter = (msg as any).filter as unknown;
          const facetMatched = facetFilter ? applyMockFilter(items, facetFilter) : null;
          const matchedIds = facetMatched && new Set(facetMatched.map((i) => i.id));
          const priced = <T extends { count: number }>(entry: T, ids: Set<string>) =>
            matchedIds
              ? { ...entry, matching_count: [...ids].filter((id) => matchedIds.has(id)).length }
              : entry;
          const catGroups = new Map<string, { display: string; ids: Set<string> }>();
          for (const it of items) {
            const raw = (it.category ?? '').trim();
            if (!raw) continue;
            const key = raw.toLowerCase();
            const group = catGroups.get(key) ?? { display: raw, ids: new Set<string>() };
            group.ids.add(it.id);
            catGroups.set(key, group);
          }
          const categories = Array.from(catGroups.values())
            .map((g) => priced({ value: g.display, count: g.ids.size }, g.ids))
            .sort((a, b) => a.value.toLowerCase().localeCompare(b.value.toLowerCase()));
          const tagGroups = new Map<string, Set<string>>();
          for (const it of items) {
            for (const tag of it.tags ?? []) {
              const set = tagGroups.get(tag) ?? new Set<string>();
              set.add(it.id);
              tagGroups.set(tag, set);
            }
          }
          const tags = Array.from(tagGroups.entries())
            .map(([value, ids]) => priced({ value, count: ids.size }, ids))
            .sort((a, b) => a.value.toLowerCase().localeCompare(b.value.toLowerCase()));
          const customKeys = new Set<string>();
          for (const it of items) {
            for (const k of Object.keys(it.custom_fields ?? {})) {
              if (k.trim()) customKeys.add(k);
            }
          }
          const custom_field_keys = Array.from(customKeys).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase()),
          );
          return { categories, tags, custom_field_keys } as unknown as T;
        }
        case 'haventory/location/tree': {
          // Mirror the backend: nested nodes carrying direct and subtree counts,
          // plus the matching pair when (and only when) a filter is sent.
          const directCount = (id: string) => items.filter((i) => i.location_id === id).length;
          const treeFilter = (msg as any).filter as unknown;
          const matched = treeFilter ? applyMockFilter(items, treeFilter) : null;
          const matchingDirect = (id: string) =>
            (matched ?? []).filter((i) => i.location_id === id).length;
          // Guard against a fixture that parents a location to itself: the real
          // backend rejects cycles, but a test can hand us one.
          const seen = new Set<string>();
          const build = (parentId: string | null): any[] =>
            locations
              .filter((l) => (l.parent_id ?? null) === parentId && !seen.has(l.id))
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((l) => {
                seen.add(l.id);
                const children = build(l.id);
                const direct = directCount(l.id);
                const node: Record<string, unknown> = {
                  id: l.id,
                  name: l.name,
                  parent_id: l.parent_id ?? null,
                  area_id: l.area_id ?? null,
                  path: l.path,
                  direct_item_count: direct,
                  subtree_item_count:
                    direct + children.reduce((sum, c) => sum + (c.subtree_item_count as number), 0),
                  children,
                };
                if (matched) {
                  const mDirect = matchingDirect(l.id);
                  node.matching_direct_count = mDirect;
                  node.matching_subtree_count =
                    mDirect + children.reduce((sum, c) => sum + ((c.matching_subtree_count as number) ?? 0), 0);
                }
                return node;
              });
          return build(null) as unknown as T;
        }
        case 'haventory/location/list': {
          return locations as unknown as T;
        }
        case 'haventory/location/get': {
          const locationId = String((msg as any).location_id);
          const loc = locations.find((l) => l.id === locationId);
          if (!loc) throw { code: 'not_found', message: 'location not found' };
          return loc as unknown as T;
        }
        case 'haventory/location/update': {
          const locationId = String((msg as any).location_id);
          const loc = locations.find((l) => l.id === locationId);
          if (!loc) throw { code: 'not_found', message: 'location not found' };
          const next: Location = { ...loc };
          if ('name' in msg) next.name = String((msg as any).name);
          if ('area_id' in msg) next.area_id = ((msg as any).area_id ?? null) as string | null;
          if ('new_parent_id' in msg) {
            const newParentId = ((msg as any).new_parent_id ?? null) as string | null;
            if (newParentId === locationId) {
              throw { code: 'validation_error', message: 'a location cannot be its own parent' };
            }
            next.parent_id = newParentId;
            next.path = {
              ...next.path,
              id_path: newParentId ? [newParentId, next.id] : [next.id],
            };
          }
          locations = locations.map((l) => (l.id === locationId ? next : l));
          return next as unknown as T;
        }
        case 'haventory/location/create': {
          const id = `${Date.now()}`;
          const name = String((msg as any).name);
          const parent_id = (msg as any).parent_id ?? null;
          const area_id = (msg as any).area_id ?? null;
          const pathSegment = parent_id ? `${parent_id}/${name}` : name;
          const created: Location = {
            id,
            name,
            parent_id,
            area_id,
            path: {
              id_path: parent_id ? [parent_id, id] : [id],
              name_path: parent_id ? [String(parent_id), name] : [name],
              display_path: parent_id ? `${parent_id}/${name}` : name,
              sort_key: pathSegment.toLowerCase(),
            },
          };
          locations = locations.concat([created]);
          return created as unknown as T;
        }
        case 'haventory/location/delete': {
          const locationId = String((msg as any).location_id);
          const loc = locations.find((l) => l.id === locationId);
          if (!loc) throw { code: 'not_found', message: 'location not found' };
          if (locations.some((l) => l.parent_id === locationId)) {
            throw { code: 'validation_error', message: 'cannot delete a location that has child locations' };
          }
          if (items.some((i) => i.location_id === locationId)) {
            throw { code: 'validation_error', message: 'cannot delete a location that contains items' };
          }
          locations = locations.filter((l) => l.id !== locationId);
          return null as unknown as T;
        }
        case 'haventory/location/move_subtree': {
          const locationId = String((msg as any).location_id);
          const newParentId = (msg as any).new_parent_id ?? null;
          const loc = locations.find((l) => l.id === locationId);
          if (!loc) throw { code: 'not_found', message: 'location not found' };
          const moved: Location = {
            ...loc,
            parent_id: newParentId,
            path: {
              ...loc.path,
              id_path: newParentId ? [String(newParentId), loc.id] : [loc.id],
            },
          };
          locations = locations.map((l) => (l.id === locationId ? moved : l));
          return moved as unknown as T;
        }
        case 'haventory/item/list': {
          const limit = (typeof msg.limit === 'number' ? (msg.limit as number) : 50) || 50;
          const cursor = (msg.cursor as string | undefined) || undefined;
          // Mirror the backend: filter, then sort, then paginate.
          const listed = applyMockSort(applyMockFilter(items, msg.filter), msg.sort);
          const total = listed.length;
          const page1 = listed.slice(0, limit);
          if (!cursor) {
            const next_cursor = listed.length > limit ? 'cursor-2' : null;
            return { items: page1, next_cursor, total } as unknown as T;
          }
          if (cursor === 'cursor-2') {
            return { items: listed.slice(limit, limit * 2), next_cursor: null, total } as unknown as T;
          }
          return { items: [], next_cursor: null, total } as unknown as T;
        }
        case 'haventory/item/get': {
          const itemId = String((msg as any).item_id);
          const it = items.find((i) => i.id === itemId);
          if (!it) throw { code: 'not_found', message: 'not found' };
          return it as unknown as T;
        }
        case 'haventory/item/create': {
          const id = `${Date.now()}`;
          const now = new Date().toISOString();
          const created: Item = {
            id,
            name: String((msg as any).name),
            description: null,
            quantity: Number((msg as any).quantity ?? 0),
            checked_out: Boolean((msg as any).checked_out ?? false),
            due_date: (msg as any).due_date ?? null,
            inspection_date: (msg as any).inspection_date ?? null,
            location_id: (msg as any).location_id ?? null,
            tags: ((msg as any).tags as string[]) ?? [],
            category: (msg as any).category ?? null,
            low_stock_threshold: (msg as any).low_stock_threshold ?? null,
            custom_fields: {},
            created_at: now,
            updated_at: now,
            version: 1,
            location_path: {
              id_path: (msg as any).location_id ? [String((msg as any).location_id)] : [],
              name_path: [],
              display_path: '',
              sort_key: '',
            },
          };
          items.unshift(created);
          return created as unknown as T;
        }
        case 'haventory/item/update': {
          const itemId = String((msg as any).item_id);
          if (conflictOnUpdate) {
            throw { code: 'conflict', message: 'version conflict', context: { item_id: itemId } };
          }
          const it = items.find((i) => i.id === itemId);
          if (!it) throw { code: 'not_found', message: 'not found' };
          const updated = { ...it, ...Object.fromEntries(Object.entries(msg).filter(([k]) => !['id', 'type', 'item_id', 'expected_version'].includes(k))) } as Item;
          updated.updated_at = new Date().toISOString();
          const idx = items.findIndex((i) => i.id === itemId);
          items[idx] = updated;
          return updated as unknown as T;
        }
        case 'haventory/item/delete': {
          const itemId = String((msg as any).item_id);
          items = items.filter((i) => i.id !== itemId);
          return null as unknown as T;
        }
        case 'haventory/item/check_out': {
          const it = findItem(msg);
          return replaceItem({
            ...it,
            checked_out: true,
            due_date: ((msg as any).due_date ?? null) as string | null,
          }) as unknown as T;
        }
        case 'haventory/item/check_in': {
          const it = findItem(msg);
          // Checking in clears the due date — it only exists while an item is out.
          return replaceItem({ ...it, checked_out: false, due_date: null }) as unknown as T;
        }
        case 'haventory/reminder/bump': {
          const it = findItem(msg);
          if (!it.reminder_interval) {
            throw { code: 'validation_error', message: 'a reminder with no interval has no next occurrence; clear it instead' };
          }
          // The real backend counts the next occurrence from the series anchor;
          // the stand-in only has to move the date and leave the anchor alone,
          // which is the property a caller can observe.
          const days = { days: 1, weeks: 7, months: 30 }[it.reminder_interval.unit] ?? 1;
          const next = new Date(`${it.reminder_date}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + days * it.reminder_interval.count);
          return replaceItem({
            ...it,
            reminder_date: next.toISOString().slice(0, 10),
          }) as unknown as T;
        }
        case 'haventory/item/adjust_quantity': {
          const it = findItem(msg);
          const delta = Number((msg as any).delta ?? 0);
          const next = it.quantity + delta;
          if (next < 0) throw { code: 'validation_error', message: 'quantity must be >= 0' };
          return replaceItem({ ...it, quantity: next }) as unknown as T;
        }
        case 'haventory/item/set_quantity': {
          const it = findItem(msg);
          const quantity = Number((msg as any).quantity ?? 0);
          if (quantity < 0) throw { code: 'validation_error', message: 'quantity must be >= 0' };
          return replaceItem({ ...it, quantity }) as unknown as T;
        }
        case 'haventory/item/set_low_stock_threshold': {
          const it = findItem(msg);
          return replaceItem({
            ...it,
            low_stock_threshold: ((msg as any).low_stock_threshold ?? null) as number | null,
          }) as unknown as T;
        }
        case 'haventory/item/add_tags': {
          const it = findItem(msg);
          const incoming = (((msg as any).tags as string[]) ?? []).map((t) => t.trim().toLowerCase());
          return replaceItem({ ...it, tags: [...new Set([...it.tags, ...incoming])] }) as unknown as T;
        }
        case 'haventory/item/remove_tags': {
          const it = findItem(msg);
          const drop = new Set((((msg as any).tags as string[]) ?? []).map((t) => t.trim().toLowerCase()));
          return replaceItem({ ...it, tags: it.tags.filter((t) => !drop.has(t)) }) as unknown as T;
        }
        case 'haventory/item/update_custom_fields': {
          const it = findItem(msg);
          const next = { ...it.custom_fields, ...(((msg as any).set as Record<string, never>) ?? {}) };
          for (const key of ((msg as any).unset as string[]) ?? []) delete next[key];
          return replaceItem({ ...it, custom_fields: next }) as unknown as T;
        }
        case 'haventory/item/move': {
          const it = findItem(msg);
          const locationId = ((msg as any).location_id ?? null) as string | null;
          return replaceItem({ ...it, location_id: locationId }) as unknown as T;
        }
        case 'haventory/items/bulk': {
          // Mirror the backend: run each op independently, key results by op_id,
          // never roll back. Note the per-op error key is `context`, not `data`.
          const operations = ((msg as any).operations as
            | { op_id: string; kind: string; payload: Record<string, unknown> }[]
            | undefined) ?? [];
          const results: Record<string, unknown> = {};
          for (const op of operations) {
            const kind = String(op.kind || '');
            const payload = { ...(op.payload ?? {}) };
            const dispatch: Record<string, string> = {
              item_update: 'haventory/item/update',
              item_delete: 'haventory/item/delete',
              item_move: 'haventory/item/move',
              item_adjust_quantity: 'haventory/item/adjust_quantity',
              item_set_quantity: 'haventory/item/set_quantity',
              item_check_out: 'haventory/item/check_out',
              item_check_in: 'haventory/item/check_in',
              item_add_tags: 'haventory/item/add_tags',
              item_remove_tags: 'haventory/item/remove_tags',
              item_update_custom_fields: 'haventory/item/update_custom_fields',
              item_set_low_stock_threshold: 'haventory/item/set_low_stock_threshold',
            };
            const inner = dispatch[kind];
            if (!inner) {
              results[op.op_id] = {
                success: false,
                error: { code: 'validation_error', message: `unknown kind ${kind}`, context: { kind } },
              };
              continue;
            }
            try {
              const result = await hass.callWS<unknown>({ type: inner, ...payload });
              results[op.op_id] = { success: true, result };
            } catch (err) {
              const anyErr = err as { code?: string; message?: string };
              results[op.op_id] = {
                success: false,
                error: {
                  code: anyErr?.code ?? 'unknown_error',
                  message: anyErr?.message ?? 'failed',
                  context: { op_id: op.op_id, kind },
                },
              };
            }
          }
          return { results } as unknown as T;
        }
      }
      throw new Error(`Unhandled callWS type: ${type}`);
    },
    connection: {
      subscribeMessage(cb: SubCb, msg: Record<string, unknown>) {
        // Home Assistant's own event bus, not a `haventory/subscribe` topic:
        // core events are not part of a subscribe round, so they stay out of
        // `__subscribeCalls` too.
        if (String(msg.type || '') === 'subscribe_events') {
          const eventType = String((msg as any).event_type || '');
          haEventSubs[eventType] ||= [];
          haEventSubs[eventType].push(cb);
          return () => {
            haEventSubs[eventType] = (haEventSubs[eventType] || []).filter((x) => x !== cb);
          };
        }
        const topic = String((msg as any).topic || '');
        subscribeCalls.push(topic);
        subscribeMessages.push({ ...msg });
        if (subscribeFailRemaining > 0) {
          // Real HA rejects the subscribe promise; the client must not treat the
          // topic as live.
          subscribeFailRemaining -= 1;
          return Promise.reject(subscribeError);
        }
        subs[topic] ||= [];
        subs[topic].push(cb);
        return () => {
          subs[topic] = (subs[topic] || []).filter((x) => x !== cb);
        };
      },
      addEventListener(event: string, cb: () => void) {
        lifecycleListeners[event] ||= [];
        lifecycleListeners[event].push(cb);
      },
      removeEventListener(event: string, cb: () => void) {
        lifecycleListeners[event] = (lifecycleListeners[event] || []).filter((x) => x !== cb);
      },
    },
    __emit(topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>) {
      const callbacks = subs[topic] || [];
      // Deliver the inner payload exactly as real Home Assistant does.
      const event = { domain: 'haventory', topic, action, ts: new Date().toISOString(), ...payload } as AnyEventPayload;
      callbacks.forEach((cb) => cb(event));
    },
    __emitHaEvent(eventType: string, data: Record<string, unknown> = {}) {
      const event = { event_type: eventType, data } as unknown as AnyEventPayload;
      (haEventSubs[eventType] || []).forEach((cb) => cb(event));
    },
    __haEventSubscriberCount(eventType: string) {
      return (haEventSubs[eventType] || []).length;
    },
    __setAreas(next: AreaRef[]) { areas = [...next]; },
    __reconnect() {
      hass.__disconnect();
      hass.__connectionReady();
    },
    __disconnect() {
      (lifecycleListeners.disconnected || []).forEach((cb) => cb());
    },
    __connectionReady() {
      (lifecycleListeners.ready || []).forEach((cb) => cb());
    },
    __setConflict(on: boolean) { conflictOnUpdate = on; },
    __setItems(it: Item[]) { items = [...it]; },
    __setLocations(locs: Location[]) { locations = [...locs]; },
    __setHealth(patch: HealthPatch) {
      healthOverride = { ...(healthOverride ?? {}), ...patch };
    },
    __failNext(n: number, err?: unknown) {
      failRemaining = n;
      if (err !== undefined) failError = err;
    },
    __failSubscribe(err: unknown | null) {
      subscribeError = err;
      subscribeFailRemaining = err === null ? 0 : Number.POSITIVE_INFINITY;
    },
    __failSubscribeNext(n: number, err: unknown) {
      subscribeError = err;
      subscribeFailRemaining = n;
    },
  };

  return hass;
}

/**
 * Today in this machine's zone, the day every one of these rules compares against.
 *
 * `toIsoDate` is what the components themselves read, and the backend now names
 * the instance's own day rather than a UTC one. Slicing an ISO string would give
 * the UTC day instead, which agrees with neither for part of every day — a mock
 * that disagreed with the code it stands in for on any machine outside UTC.
 */
function mockToday(): string {
  return toIsoDate();
}

/** Mirror of the backend's overdue rule: a due date strictly before today. */
function isMockOverdue(item: Item): boolean {
  return !!item.due_date && item.due_date < mockToday();
}

/** The inclusive twin: due back today counts, which is what *due* means. */
function isMockCheckedOutDue(item: Item): boolean {
  return !!item.due_date && item.due_date <= mockToday();
}

/** Same strict rule against `inspection_date`, over every item rather than the out ones. */
function isMockInspectionOverdue(item: Item): boolean {
  return !!item.inspection_date && item.inspection_date < mockToday();
}

/** And its inclusive twin, which is the population the card's pill shows. */
function isMockInspectionDue(item: Item): boolean {
  return !!item.inspection_date && item.inspection_date <= mockToday();
}

/** Faithful-but-small mirror of the backend ItemFilter semantics (AND of all predicates). */
function applyMockFilter(list: Item[], rawFilter: unknown): Item[] {
  const filter = (rawFilter ?? null) as {
    q?: string;
    status?: string;
    checked_out?: boolean;
    orphaned_only?: boolean;
    low_stock_only?: boolean;
    overdue_only?: boolean;
    checked_out_due_only?: boolean;
    inspection_overdue_only?: boolean;
    inspection_due_only?: boolean;
    location_id?: string | null;
    location_ids?: string[];
    include_subtree?: boolean;
    category?: string;
    categories?: string[];
    tags_any?: string[];
    updated_after?: string;
    updated_before?: string;
    created_after?: string;
    created_before?: string;
  } | null;
  if (!filter) return list;
  // The scalar and the list are one selection, unioned — an item has one
  // category and one location, so requiring both keys would match nothing.
  const categories = [
    ...(typeof filter.category === 'string' ? [filter.category] : []),
    ...(filter.categories ?? []),
  ]
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const locationIds = [
    ...(typeof filter.location_id === 'string' ? [filter.location_id] : []),
    ...(filter.location_ids ?? []),
  ].filter(Boolean);
  return list.filter((it) => {
    // Category equals + tags_any (case-insensitive), used by the browser views.
    if (categories.length && !categories.includes((it.category ?? '').trim().toLowerCase()))
      return false;
    if (Array.isArray(filter.tags_any) && filter.tags_any.length) {
      const wanted = filter.tags_any.map((t) => t.toLowerCase());
      if (!(it.tags ?? []).some((t) => wanted.includes(t.toLowerCase()))) return false;
    }
    if (filter.q) {
      const q = String(filter.q).toLowerCase();
      const blob = [
        it.name,
        it.description ?? '',
        it.category ?? '',
        (it.tags ?? []).join(' '),
        it.location_path?.display_path ?? '',
      ].join(' ').toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (filter.status && (it.status ?? 'ok') !== filter.status) return false;
    if (typeof filter.checked_out === 'boolean' && it.checked_out !== filter.checked_out) return false;
    if (filter.orphaned_only && it.location_id !== null) return false;
    // Low stock needs a threshold to be below: an item without one is never low,
    // which is also how the stats counts read it.
    if (
      filter.low_stock_only &&
      !(typeof it.low_stock_threshold === 'number' && it.quantity <= it.low_stock_threshold)
    ) {
      return false;
    }
    if (filter.overdue_only && !isMockOverdue(it)) return false;
    if (filter.checked_out_due_only && !isMockCheckedOutDue(it)) return false;
    if (filter.inspection_overdue_only && !isMockInspectionOverdue(it)) return false;
    if (filter.inspection_due_only && !isMockInspectionDue(it)) return false;
    // Canonical 'Z' timestamps compare lexicographically; both bounds are exclusive.
    if (filter.updated_after && !(it.updated_at > filter.updated_after)) return false;
    if (filter.updated_before && !(it.updated_at < filter.updated_before)) return false;
    if (filter.created_after && !(it.created_at > filter.created_after)) return false;
    if (filter.created_before && !(it.created_at < filter.created_before)) return false;
    if (locationIds.length) {
      // One include_subtree flag for the whole selection, as the backend has it.
      const matches = locationIds.some((id) =>
        filter.include_subtree
          ? it.location_id === id || (it.location_path?.id_path ?? []).includes(id)
          : it.location_id === id,
      );
      if (!matches) return false;
    }
    return true;
  });
}

/** Mirror of backend sort_items: supported fields, nullable dates last in both orders, id-asc tie-break. */
function applyMockSort(list: Item[], rawSort: unknown): Item[] {
  const sort = (rawSort ?? null) as { field?: string; order?: string } | null;
  if (!sort?.field) return list;
  const order = sort.order === 'desc' ? 'desc' : 'asc';
  const dir = order === 'desc' ? -1 : 1;
  const dateKey = (v: string | null) => v ?? (order === 'asc' ? '~' : '');
  // Unlocated items sort last in both orders. The ascending sentinel is the
  // highest code point rather than a printable one, because a path key is built
  // from location names and any accented name would outrank "~".
  const pathKey = (v: string) => v || (order === 'asc' ? '\u{10FFFF}' : '');
  const key = (it: Item): string | number => {
    switch (sort.field) {
      case 'name': return it.name.toLowerCase();
      case 'quantity': return it.quantity;
      case 'due_date': return dateKey(it.due_date);
      case 'inspection_date': return dateKey(it.inspection_date);
      case 'reminder_date': return dateKey(it.reminder_date ?? null);
      case 'location': return pathKey(it.location_path?.sort_key ?? '');
      case 'created_at': return it.created_at;
      default: return it.updated_at;
    }
  };
  return list.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // id asc tie-break in both orders
  });
}

/**
 * Fixture stamps are fixed rather than "now".
 *
 * The default item order is `updated_at` descending with an id-ascending
 * tie-break, so two wall-clock fixtures order by id only while both stamps land
 * inside the same millisecond, and by construction order when they straddle
 * one — the same list, two orders, decided by how busy the machine is. A
 * constant makes every default fixture tie, so the tie-break always decides. A
 * test that needs a distinct stamp passes one; the mock backend still stamps
 * its own mutations from the clock, so a mutated item still sorts above these.
 */
const FIXTURE_TS = '2026-01-01T00:00:00.000Z';

/** Counts anonymous fixtures, which the clock cannot number uniquely: two
 * `makeItem()` calls in one millisecond used to share an id. Zero-padded so
 * lexical order — what the id tie-break compares — follows creation order. */
let anonymousItems = 0;

export function makeItem(partial?: Partial<Item>): Item {
  const id = partial?.id ?? `fixture-item-${String((anonymousItems += 1)).padStart(4, '0')}`;
  const now = FIXTURE_TS;
  return {
    id: String(id),
    name: partial?.name ?? 'Item',
    description: partial?.description ?? null,
    quantity: partial?.quantity ?? 0,
    checked_out: partial?.checked_out ?? false,
    due_date: partial?.due_date ?? null,
    inspection_date: partial?.inspection_date ?? null,
    location_id: partial?.location_id ?? null,
    tags: partial?.tags ?? [],
    category: partial?.category ?? null,
    low_stock_threshold: partial?.low_stock_threshold ?? null,
    custom_fields: partial?.custom_fields ?? {},
    created_at: partial?.created_at ?? now,
    updated_at: partial?.updated_at ?? now,
    version: partial?.version ?? 1,
    location_path: partial?.location_path ?? { id_path: [], name_path: [], display_path: '', sort_key: '' },
    // Optional on the wire, so it stays off the object unless a caller asks for
    // it — an item built without one looks exactly like an older backend's.
    ...(partial?.effective_area_id === undefined
      ? {}
      : { effective_area_id: partial.effective_area_id }),
    ...(partial?.status === undefined ? {} : { status: partial.status }),
    ...(partial?.attachments === undefined ? {} : { attachments: partial.attachments }),
    ...(partial?.reminder_date === undefined ? {} : { reminder_date: partial.reminder_date }),
    ...(partial?.reminder_anchor === undefined ? {} : { reminder_anchor: partial.reminder_anchor }),
    ...(partial?.reminder_interval === undefined
      ? {}
      : { reminder_interval: partial.reminder_interval }),
  };
}

let anonymousAttachments = 0;

/** One picture's metadata, as the backend reports it on an item. */
export function makeAttachment(partial?: Partial<Attachment>): Attachment {
  return {
    id: partial?.id ?? `fixture-att-${String((anonymousAttachments += 1)).padStart(4, '0')}`,
    kind: partial?.kind ?? 'picture',
    filename: partial?.filename ?? 'photo.png',
    mime: partial?.mime ?? 'image/png',
    size: partial?.size ?? 2048,
    uploaded_at: partial?.uploaded_at ?? FIXTURE_TS,
    // Left off unless asked for, so a bare fixture is shaped like the payload
    // a backend that predates these two fields sends.
    ...(partial?.title === undefined ? {} : { title: partial.title }),
    ...(partial?.order === undefined ? {} : { order: partial.order }),
  };
}

/** One manual's metadata: the same fixture with the document defaults. */
export function makeManual(partial?: Partial<Attachment>): Attachment {
  return makeAttachment({
    kind: 'manual',
    filename: 'scan_0142.pdf',
    mime: 'application/pdf',
    ...partial,
  });
}

/**
 * A `MediaBindings` whose calls are recorded and whose answers are scripted.
 *
 * Signing resolves immediately, so a mounted component has its URLs after one
 * more `updateComplete`. `uploads`, `removals` and `retitles` record what was
 * asked for; any of them can be made to reject, which is how the per-file error
 * paths are exercised.
 */
export function makeMediaBindings(
  options: {
    upload?: (itemId: string, file: File, kind: AttachmentKind) => Promise<Item>;
    remove?: (itemId: string, attachmentId: string) => Promise<Item>;
    retitle?: (itemId: string, attachmentId: string, title: string) => Promise<Item>;
    reorder?: (itemId: string, kind: AttachmentKind, attachmentIds: string[]) => Promise<Item>;
    signFails?: boolean;
  } = {},
) {
  const signed: string[] = [];
  const uploads: { itemId: string; file: File; kind: AttachmentKind }[] = [];
  const removals: { itemId: string; attachmentId: string }[] = [];
  const retitles: { itemId: string; attachmentId: string; title: string }[] = [];
  const reorders: { itemId: string; kind: AttachmentKind; attachmentIds: string[] }[] = [];
  return {
    signed,
    uploads,
    removals,
    retitles,
    reorders,
    sign: async (path: string) => {
      signed.push(path);
      if (options.signFails) throw new Error('signing refused');
      // Core appends to whatever query the path already has — a media URL
      // carries the name token — so the separator has to follow suit or every
      // signed URL here is malformed in a way no real one is.
      return `${path}${path.includes('?') ? '&' : '?'}authSig=test`;
    },
    upload: async (itemId: string, file: File, kind: AttachmentKind = 'picture') => {
      uploads.push({ itemId, file, kind });
      if (options.upload) return options.upload(itemId, file, kind);
      return makeItem({ id: itemId });
    },
    remove: async (itemId: string, attachmentId: string) => {
      removals.push({ itemId, attachmentId });
      if (options.remove) return options.remove(itemId, attachmentId);
      return makeItem({ id: itemId });
    },
    retitle: async (itemId: string, attachmentId: string, title: string) => {
      retitles.push({ itemId, attachmentId, title });
      if (options.retitle) return options.retitle(itemId, attachmentId, title);
      return makeItem({ id: itemId });
    },
    reorder: async (itemId: string, kind: AttachmentKind, attachmentIds: string[]) => {
      reorders.push({ itemId, kind, attachmentIds });
      if (options.reorder) return options.reorder(itemId, kind, attachmentIds);
      return makeItem({ id: itemId });
    },
  };
}

/**
 * Pin `window.matchMedia` to one answer for the length of a test, and hand back
 * the restore.
 *
 * jsdom performs no layout, so every media query it is asked about reports
 * `false` — which reads as "desktop viewport" to the overlays that switch on
 * one, and leaves their phone form untestable. Call the restore in a `finally`
 * so the next test starts from the real implementation.
 */
export function stubViewport(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((media: string) => ({
    matches,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

// ---------------------------------------------------------------------------
// Component-test harness
// ---------------------------------------------------------------------------

/** What a mounted component hands back: the element and its shadow root. */
export interface Mounted<T extends HTMLElement> {
  el: T;
  sr: ShadowRoot;
}

export interface MountOptions {
  /** Light-DOM markup, set before the element is connected. */
  light?: string;
  /**
   * Render passes to await after connecting. One is enough for a component that
   * draws itself; a component that renders another Lit element and then reads
   * it needs two, because the child's first update is queued by the parent's.
   */
  renders?: number;
}

/** A Lit element seen from a test: the render-settled promise is all we need. */
type Renderable = HTMLElement & { updateComplete?: Promise<unknown> };

/**
 * Create a component, set its properties, connect it, and wait for it to draw.
 *
 * Every component test mounts through here, so the ordering is the same
 * everywhere: properties are assigned *before* the element is connected, which
 * is what a Lit component's first render sees, and the custom element is
 * awaited as defined before the first `updateComplete` is read — an element
 * that has not been upgraded yet has no such property.
 */
export async function mountComponent<T extends HTMLElement>(
  tag: string,
  props: Partial<T> = {},
  options: MountOptions = {},
): Promise<Mounted<T>> {
  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  if (options.light) el.innerHTML = options.light;
  document.body.appendChild(el);
  await customElements.whenDefined(tag);
  for (let i = 0; i < (options.renders ?? 1); i++) {
    await (el as Renderable).updateComplete;
  }
  return { el, sr: el.shadowRoot as ShadowRoot };
}

/**
 * A mock hass and an initialised `Store` over it, for the components that take
 * one. The whole `MockConfig` is forwarded — statuses and areas included — so a
 * test that needs a household vocabulary does not have to build its own hass.
 */
export async function mountStore(config: MockConfig = {}): Promise<{
  hass: MockHass;
  store: Store;
}> {
  const hass = makeMockHass(config);
  // No retry backoff: a test that provokes a failure would otherwise wait it out.
  const store = new Store(hass, { retryBaseMs: 0 });
  await store.init();
  return { hass, store };
}

/**
 * Mount one of the host components over a store of its own.
 *
 * `hv-card-shell`, `hv-full-view` and `hv-organize-dialog` each take a `store`
 * property and are asserted against both halves, so their specs need the store
 * and the mock hass back alongside the element. The two things a caller varies
 * are the dataset the store answers with and the host's own properties.
 */
export async function mountHost<T extends HTMLElement>(
  tag: string,
  config: MockConfig = {},
  props: Partial<T> = {},
  options: MountOptions = {},
): Promise<Mounted<T> & { store: Store; hass: MockHass }> {
  const { hass, store } = await mountStore(config);
  const { el, sr } = await mountComponent<T>(tag, { ...props, store }, options);
  return { el, store, hass, sr };
}

/** The first match for a selector, from an element's shadow root or from a root itself. */
export function q<T extends Element = HTMLElement>(
  root: Element | DocumentFragment,
  selector: string,
): T | null {
  return queryRoot(root).querySelector(selector) as T | null;
}

/** Every match for a selector, in document order. */
export function all<T extends Element = HTMLElement>(
  root: Element | DocumentFragment,
  selector: string,
): T[] {
  return [...queryRoot(root).querySelectorAll(selector)] as T[];
}

function queryRoot(root: Element | DocumentFragment): ParentNode {
  return 'shadowRoot' in root && root.shadowRoot ? root.shadowRoot : root;
}

/**
 * Wait for everything a click or a property write set in motion.
 *
 * The macrotask boundary is what separates this from awaiting `updateComplete`
 * alone: it drains the microtask queue first, so a render that another render
 * queued has already been scheduled by the time the element is awaited.
 *
 * Under fake timers that boundary has to be driven rather than waited on —
 * nothing advances a fake clock on its own, so a real zero-delay wait there
 * never resolves and the test hangs until vitest kills it.
 */
export async function settle(el: HTMLElement): Promise<void> {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise((resolve) => setTimeout(resolve, 0));
  await (el as Renderable).updateComplete;
}

/**
 * Everything a component draws with: its own block plus every shared fragment,
 * whitespace-normalized so a rule reads as one line.
 *
 * jsdom lays nothing out, so a layout or type-size rule is asserted against the
 * stylesheet rather than against a measured box.
 */
export function componentCss(tag: string): string {
  return sheetsOf(tag)
    .map((sheet) => String(sheet.cssText))
    .join('\n')
    .replace(/\s+/g, ' ');
}

/**
 * A component's *own* block — the last fragment, after the shared ones.
 *
 * The distinction decides what a `not.toMatch` proves: against
 * {@link componentCss} it says "nothing draws this", which a shared fragment
 * would falsify; against this it says "this component does not restate what the
 * shared fragment already gives it".
 */
export function ownCss(tag: string): string {
  const sheets = sheetsOf(tag);
  return String(sheets[sheets.length - 1].cssText).replace(/\s+/g, ' ');
}

/**
 * A component's style fragments, in the order it lists them.
 *
 * The fragments themselves rather than their text, so a test can assert that a
 * shared sheet *is* one of them rather than that its rules appear somewhere.
 */
export function sheetsOf(tag: string): CSSResult[] {
  const ctor = customElements.get(tag) as { styles?: CSSResult | CSSResult[] } | undefined;
  if (!ctor?.styles) throw new Error(`${tag} has no styles`);
  return Array.isArray(ctor.styles) ? ctor.styles : [ctor.styles];
}
