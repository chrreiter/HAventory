import type {
  AnyEventPayload,
  ExportDocument,
  HassLike,
  ImportPreview,
  ImportSummary,
  Item,
  Location,
  StatsCounts,
} from './store/types';

// Mirror real Home Assistant: `subscribeMessage` hands the callback the *inner*
// event payload, not the `{id, type:'event', event}` envelope.
type SubCb = (event: AnyEventPayload) => void;

interface MockConfig {
  items?: Item[];
  locations?: Location[];
  conflictOnUpdate?: boolean;
  /** What `haventory/config` reports as the configured card heading. */
  cardTitle?: string;
}

type HealthPatch = {
  healthy?: boolean;
  issues?: string[];
  generation?: number;
  rate_limit?: { enabled: boolean; dropped_commands: number; dropped_events: number };
};

export interface MockHass extends HassLike {
  __emit(topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>): void;
  __setConflict(on: boolean): void;
  __setItems(items: Item[]): void;
  __setLocations(locations: Location[]): void;
  __setHealth(patch: HealthPatch): void;
  /** Reject the next `n` commands with `rate_limited`, then behave normally. */
  __rateLimitNext(n: number): void;
  /** Reject the next `n` commands with an arbitrary error (transport by default). */
  __failNext(n: number, err?: unknown): void;
  /** Make every subsequent `haventory/subscribe` reject with `err`. */
  __failSubscribe(err: unknown | null): void;
  /** Reject the next `n` `haventory/subscribe` calls with `err`, then behave normally. */
  __failSubscribeNext(n: number, err: unknown): void;
  /** Every callWS `type` seen so far, in order. */
  __calls: string[];
  /** Every subscribed topic seen so far, in order — refused attempts included. */
  __subscribeCalls: string[];
}

export function makeMockHass(initial?: MockConfig): MockHass {
  let items: Item[] = initial?.items ? [...initial.items] : [];
  let locations: Location[] = initial?.locations ? [...initial.locations] : [];
  let conflictOnUpdate = !!initial?.conflictOnUpdate;
  const cardTitle = initial?.cardTitle ?? 'HAventory';
  let healthOverride: HealthPatch | null = null;
  let rateLimitRemaining = 0;
  let failRemaining = 0;
  let failError: unknown = new Error('connection lost');
  let subscribeError: unknown | null = null;
  let subscribeFailRemaining = 0;
  const subs: Record<string, SubCb[]> = {};
  const calls: string[] = [];
  const subscribeCalls: string[] = [];

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
    __subscribeCalls: subscribeCalls,
    async callWS<T>(msg: Record<string, unknown>): Promise<T> {
      const type = String(msg.type || '');
      calls.push(type);
      if (rateLimitRemaining > 0) {
        rateLimitRemaining -= 1;
        throw { code: 'rate_limited', message: 'rate limit exceeded; retry later' };
      }
      if (failRemaining > 0) {
        failRemaining -= 1;
        throw failError;
      }
      switch (type) {
        case 'haventory/stats': {
          const counts: StatsCounts = {
            items_total: items.length,
            low_stock_count: items.filter((i) => typeof i.low_stock_threshold === 'number' && i.quantity <= (i.low_stock_threshold as number)).length,
            checked_out_count: items.filter((i) => i.checked_out).length,
            overdue_count: items.filter((i) => isMockOverdue(i)).length,
            inspection_overdue_count: items.filter((i) => isMockInspectionDue(i)).length,
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
            inspection_overdue_count: items.filter((i) => isMockInspectionDue(i)).length,
            locations_total: locations.length,
            no_location_count: items.filter((i) => i.location_id == null).length,
          };
          return {
            healthy: healthOverride?.healthy ?? true,
            issues: healthOverride?.issues ?? [],
            counts,
            generation: healthOverride?.generation ?? 1,
            rate_limit: healthOverride?.rate_limit ?? {
              enabled: false,
              dropped_commands: 0,
              dropped_events: 0,
            },
          } as unknown as T;
        }
        case 'haventory/version': {
          return { integration_version: '0.0.1', schema_version: 4 } as unknown as T;
        }
        case 'haventory/config': {
          return { card_title: cardTitle } as unknown as T;
        }
        case 'haventory/areas/list': {
          return { areas: [] } as unknown as T;
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
          // each with a usage count, sorted case-insensitively by value.
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
            .map((g) => ({ value: g.display, count: g.ids.size }))
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
            .map(([value, ids]) => ({ value, count: ids.size }))
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
        const topic = String((msg as any).topic || '');
        subscribeCalls.push(topic);
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
    },
    __emit(topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>) {
      const callbacks = subs[topic] || [];
      // Deliver the inner payload exactly as real Home Assistant does.
      const event = { domain: 'haventory', topic, action, ts: new Date().toISOString(), ...payload } as AnyEventPayload;
      callbacks.forEach((cb) => cb(event));
    },
    __setConflict(on: boolean) { conflictOnUpdate = on; },
    __setItems(it: Item[]) { items = [...it]; },
    __setLocations(locs: Location[]) { locations = [...locs]; },
    __setHealth(patch: HealthPatch) {
      healthOverride = { ...(healthOverride ?? {}), ...patch };
    },
    __rateLimitNext(n: number) { rateLimitRemaining = n; },
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

/** Mirror of the backend's overdue rule: a due date strictly before today (UTC). */
function isMockOverdue(item: Item): boolean {
  return !!item.due_date && item.due_date < new Date().toISOString().slice(0, 10);
}

/** Same rule against `inspection_date`, over every item rather than the out ones. */
function isMockInspectionDue(item: Item): boolean {
  return !!item.inspection_date && item.inspection_date < new Date().toISOString().slice(0, 10);
}

/** Faithful-but-small mirror of the backend ItemFilter semantics (AND of all predicates). */
function applyMockFilter(list: Item[], rawFilter: unknown): Item[] {
  const filter = (rawFilter ?? null) as {
    q?: string;
    checked_out?: boolean;
    orphaned_only?: boolean;
    overdue_only?: boolean;
    inspection_overdue_only?: boolean;
    location_id?: string | null;
    include_subtree?: boolean;
    category?: string;
    tags_any?: string[];
    updated_after?: string;
    updated_before?: string;
    created_after?: string;
    created_before?: string;
  } | null;
  if (!filter) return list;
  return list.filter((it) => {
    // Category equals + tags_any (case-insensitive), used by the browser views.
    const cat = typeof filter.category === 'string' ? filter.category.trim().toLowerCase() : '';
    if (cat && (it.category ?? '').trim().toLowerCase() !== cat) return false;
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
    if (typeof filter.checked_out === 'boolean' && it.checked_out !== filter.checked_out) return false;
    if (filter.orphaned_only && it.location_id !== null) return false;
    if (filter.overdue_only && !isMockOverdue(it)) return false;
    if (filter.inspection_overdue_only && !isMockInspectionDue(it)) return false;
    // Canonical 'Z' timestamps compare lexicographically; both bounds are exclusive.
    if (filter.updated_after && !(it.updated_at > filter.updated_after)) return false;
    if (filter.updated_before && !(it.updated_at < filter.updated_before)) return false;
    if (filter.created_after && !(it.created_at > filter.created_after)) return false;
    if (filter.created_before && !(it.created_at < filter.created_before)) return false;
    if (filter.location_id) {
      const inSubtree = it.location_id === filter.location_id
        || (it.location_path?.id_path ?? []).includes(filter.location_id);
      if (filter.include_subtree ? !inSubtree : it.location_id !== filter.location_id) return false;
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
  const key = (it: Item): string | number => {
    switch (sort.field) {
      case 'name': return it.name.toLowerCase();
      case 'quantity': return it.quantity;
      case 'due_date': return dateKey(it.due_date);
      case 'inspection_date': return dateKey(it.inspection_date);
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

export function makeItem(partial?: Partial<Item>): Item {
  const id = partial?.id ?? `${Date.now()}`;
  const now = new Date().toISOString();
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
  };
}
