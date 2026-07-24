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
}

export function makeMockHass(initial?: MockConfig): HassLike & {
  __emit(topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>): void;
  __setConflict(on: boolean): void;
  __setItems(items: Item[]): void;
  __setHealth(patch: { healthy?: boolean; issues?: string[]; generation?: number }): void;
} {
  let items: Item[] = initial?.items ? [...initial.items] : [];
  let locations: Location[] = initial?.locations ? [...initial.locations] : [];
  let conflictOnUpdate = !!initial?.conflictOnUpdate;
  let healthOverride: { healthy?: boolean; issues?: string[]; generation?: number } | null = null;
  const subs: Record<string, SubCb[]> = {};

  const hass: HassLike & {
    __emit: (topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>) => void;
    __setConflict: (on: boolean) => void;
    __setItems: (it: Item[]) => void;
    __setHealth: (patch: { healthy?: boolean; issues?: string[]; generation?: number }) => void;
  } = {
    async callWS<T>(msg: Record<string, unknown>): Promise<T> {
      const type = String(msg.type || '');
      switch (type) {
        case 'haventory/stats': {
          const counts: StatsCounts = {
            items_total: items.length,
            low_stock_count: items.filter((i) => typeof i.low_stock_threshold === 'number' && i.quantity <= (i.low_stock_threshold as number)).length,
            checked_out_count: items.filter((i) => i.checked_out).length,
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
            locations_total: locations.length,
            no_location_count: items.filter((i) => i.location_id == null).length,
          };
          return {
            healthy: healthOverride?.healthy ?? true,
            issues: healthOverride?.issues ?? [],
            counts,
            generation: healthOverride?.generation ?? 1,
          } as unknown as T;
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
          return [] as unknown as T;
        }
        case 'haventory/location/list': {
          return locations as unknown as T;
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
        case 'haventory/item/check_out':
        case 'haventory/item/check_in':
        case 'haventory/item/adjust_quantity':
        case 'haventory/item/set_quantity':
        case 'haventory/item/set_low_stock_threshold': {
          // For tests, return the first item unchanged
          const itemId = String((msg as any).item_id);
          const it = items.find((i) => i.id === itemId);
          if (!it) throw { code: 'not_found', message: 'not found' };
          return it as unknown as T;
        }
        case 'haventory/item/move': {
          // Update location_id and return updated item
          const itemId = String((msg as any).item_id);
          const locationId = (msg as any).location_id ?? null;
          const it = items.find((i) => i.id === itemId);
          if (!it) throw { code: 'not_found', message: 'not found' };
          const moved = { ...it, location_id: locationId, updated_at: new Date().toISOString() };
          const idx = items.findIndex((i) => i.id === itemId);
          items[idx] = moved;
          return moved as unknown as T;
        }
      }
      throw new Error(`Unhandled callWS type: ${type}`);
    },
    connection: {
      subscribeMessage(cb: SubCb, msg: Record<string, unknown>) {
        const topic = String((msg as any).topic || '');
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
    __setHealth(patch: { healthy?: boolean; issues?: string[]; generation?: number }) {
      healthOverride = { ...(healthOverride ?? {}), ...patch };
    },
  };

  return hass;
}

/** Faithful-but-small mirror of the backend ItemFilter semantics (AND of all predicates). */
function applyMockFilter(list: Item[], rawFilter: unknown): Item[] {
  const filter = (rawFilter ?? null) as {
    q?: string;
    checked_out?: boolean;
    orphaned_only?: boolean;
    location_id?: string | null;
    include_subtree?: boolean;
    category?: string;
    tags_any?: string[];
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
  };
}
