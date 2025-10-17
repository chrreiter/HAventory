import type { AnyEventPayload, HassLike, Item, ListItemsResult, Location, StatsCounts } from './store/types';

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
} {
  let items: Item[] = initial?.items ? [...initial.items] : [];
  let locations: Location[] = initial?.locations ? [...initial.locations] : [];
  let conflictOnUpdate = !!initial?.conflictOnUpdate;
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
        case 'haventory/areas/list': {
          return { areas: [] } as unknown as T;
        }
        case 'haventory/location/tree': {
          return [] as unknown as T;
        }
        case 'haventory/location/list': {
          return locations as unknown as T;
        }
        case 'haventory/item/list': {
          const limit = (typeof msg.limit === 'number' ? (msg.limit as number) : 50) || 50;
          const cursor = (msg.cursor as string | undefined) || undefined;
          const page1 = items.slice(0, limit);
          if (!cursor) {
            const next_cursor = items.length > limit ? 'cursor-2' : null;
            return { items: page1, next_cursor } as unknown as T;
          }
          if (cursor === 'cursor-2') {
            return { items: items.slice(limit, limit * 2), next_cursor: null } as unknown as T;
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
      }
      throw new Error(`Unhandled callWS type: ${type}`);
    },
    subscribeMessage(cb: SubCb, msg: Record<string, unknown>) {
      const topic = String(msg.topic || '');
      const id = Number(msg.id || nextId());
      subs[topic] ||= [];
      subs[topic].push(cb);
      return () => {
        subs[topic] = (subs[topic] || []).filter((x) => x !== cb);
      };
    },
    __emit(topic: AnyEventPayload['topic'], action: string, payload: Record<string, unknown>) {
      const callbacks = subs[topic] || [];
      const event = { domain: 'haventory', topic, action, ts: new Date().toISOString(), ...payload } as AnyEventPayload as any;
      callbacks.forEach((cb) => cb({ id: nextId(), type: 'event', event }));
    },
    __setConflict(on: boolean) { conflictOnUpdate = on; },
    __setItems(it: Item[]) { items = [...it]; },
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
