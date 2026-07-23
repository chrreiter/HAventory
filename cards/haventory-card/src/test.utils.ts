import type { AnyEventPayload, HassLike, Item, Location, StatsCounts } from './store/types';

type SubCb = (msg: { id: number; type: 'event'; event: AnyEventPayload }) => void;

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

  function nextId() {
    return Math.floor(Math.random() * 100000);
  }

  const hass: HassLike & {
    __emit: (topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>) => void;
    __setConflict: (on: boolean) => void;
    __setItems: (it: Item[]) => void;
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
          };
          return counts as unknown as T;
        }
        case 'haventory/health': {
          const counts: StatsCounts = {
            items_total: items.length,
            low_stock_count: items.filter((i) => typeof i.low_stock_threshold === 'number' && i.quantity <= (i.low_stock_threshold as number)).length,
            checked_out_count: items.filter((i) => i.checked_out).length,
            locations_total: locations.length,
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
          return { categories, tags } as unknown as T;
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
          const filter = (msg.filter as Record<string, unknown> | undefined) ?? {};
          // Apply the subset of filters the browsers rely on (category, tags_any),
          // case-insensitively, mirroring the backend indexes.
          let filtered = items;
          const cat = typeof filter.category === 'string' ? filter.category.trim().toLowerCase() : '';
          if (cat) {
            filtered = filtered.filter((i) => (i.category ?? '').trim().toLowerCase() === cat);
          }
          const tagsAny = Array.isArray(filter.tags_any) ? (filter.tags_any as string[]).map((t) => t.toLowerCase()) : [];
          if (tagsAny.length) {
            filtered = filtered.filter((i) => (i.tags ?? []).some((t) => tagsAny.includes(t.toLowerCase())));
          }
          const page1 = filtered.slice(0, limit);
          if (!cursor) {
            const next_cursor = filtered.length > limit ? 'cursor-2' : null;
            return { items: page1, next_cursor } as unknown as T;
          }
          if (cursor === 'cursor-2') {
            return { items: filtered.slice(limit, limit * 2), next_cursor: null } as unknown as T;
          }
          return { items: [], next_cursor: null } as unknown as T;
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
      const event = { domain: 'haventory', topic, action, ts: new Date().toISOString(), ...payload } as AnyEventPayload as any;
      callbacks.forEach((cb) => cb({ id: nextId(), type: 'event', event }));
    },
    __setConflict(on: boolean) { conflictOnUpdate = on; },
    __setItems(it: Item[]) { items = [...it]; },
    __setHealth(patch: { healthy?: boolean; issues?: string[]; generation?: number }) {
      healthOverride = { ...(healthOverride ?? {}), ...patch };
    },
  };

  return hass;
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
