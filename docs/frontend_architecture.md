# HAventory Frontend Architecture

## Overview

The HAventory Lovelace card is a custom Home Assistant dashboard component built with modern web technologies:

- **Framework**: Lit 3.1 (web components)
- **Language**: TypeScript
- **Build Tool**: Vite 5
- **Testing**: Vitest with jsdom
- **Virtualization**: `@lit-labs/virtualizer` for efficient list rendering

The card provides a complete inventory management interface with real-time updates via WebSocket.

---

## Component Hierarchy

```
haventory-card (main container)
├── hv-search-bar (filters and search)
├── hv-inventory-list (virtualized list)
│   └── hv-item-row (individual item rows) × N
├── hv-item-dialog (add/edit modal)
└── hv-location-selector (location picker modal)
```

---

## Component Details

### `haventory-card` (Main Container)

**Purpose**: Root component managing overall state, store, and layout modes.

**Modes**:
- **Collapsed**: Inline card view (default)
- **Expanded**: Full-screen overlay with focus trap

**State**:
- `store`: Central data store instance
- `expanded`: Boolean for overlay mode
- `_locationSelectorOpen`: Location picker visibility

**Key Features**:
- Initializes store on `hass` property change
- Renders overlay into `#haventory-overlay-root` (appended to `document.body`)
- Focus trap with sentinel elements (Tab/Shift+Tab cycling, Esc to close)
- Conflict resolution banners with "View latest" / "Re-apply" actions
- Quick Add (+) button in header

**Responsive Layout**:
- Collapsed: Compact header + filters + list
- Expanded: Two-column layout (sidebar filters + wide list) + optional diagnostics panel

---

### `hv-search-bar`

**Purpose**: Search input and filter controls.

**Properties**:
- `q`: Search query string
- `areaId`: Selected area (UUID or null)
- `locationId`: Selected location (UUID or null)
- `includeSubtree`: Boolean for subtree filtering
- `checkedOutOnly`: Boolean for checked-out filter
- `lowStockFirst`: Boolean for low-stock sorting
- `sort`: Sort configuration (field + order)
- `areas`: Array of `{id, name}` area options
- `locations`: Array of location objects with `{id, name, path}`

**Interactions**:
- Search input: debounced 200ms, emits `change` event with `{q: string}`
- Dropdowns & checkboxes: emit `change` event immediately
- All changes emit `CustomEvent<SearchBarChangeDetail>`

**Rendering**:
- Populates Area dropdown from `areas` array
- Populates Location dropdown from `locations` array (shows `display_path`)
- Sort options: Name, Updated, Created, Quantity

---

### `hv-inventory-list`

**Purpose**: Virtualized container for item rows.

**Properties**:
- `items`: Array of items to display
- `areas`: Passed through to rows
- `locations`: Passed through to rows

**Features**:
- Uses `@lit-labs/virtualizer` with `lit-virtualizer` element
- Fixed height: 420px with overflow scroll
- Renders only visible rows + buffer
- Header row with column labels (Name, Qty, Category, Location path, Actions)

**Events**:
- `near-end`: Emitted on scroll with `{ratio}` (triggers prefetch at ~70%)
- Bubbles row events: `decrement`, `increment`, `toggle-checkout`, `edit`, `request-delete`

**Performance**:
- Handles 1000+ items smoothly
- Only renders ~10-15 visible rows at a time

---

### `hv-item-row`

**Purpose**: Individual item row with inline actions.

**Properties**:
- `item`: Full Item object
- `areas`: Array for area resolution
- `locations`: Array for area resolution

**Display**:
- **Name** + LOW badge (if `quantity ≤ low_stock_threshold`)
- **Area label**: `[Area: {name}]` resolved via `resolveAreaName()`
- **Quantity**
- **Category**
- **Location path**: `display_path`
- **Actions**: [−] [+] [Out/In] [Edit]

**Area Resolution Logic**:
```typescript
1. Get item.location_id
2. Find location in locations array
3. Get location.area_id
4. Find area in areas array
5. Return area.name
```

**Keyboard Shortcuts**:
- `Enter`: Open edit dialog
- `Delete`: Request deletion (with confirmation)
- `+` or `=`: Increment quantity
- `-`: Decrement quantity

**Events**:
- `decrement`, `increment`, `toggle-checkout`, `edit`, `request-delete`

---

### `hv-item-dialog`

**Purpose**: Modal for creating/editing items.

**Properties**:
- `open`: Boolean visibility
- `item`: Item object (null for create mode)
- `error`: Error message string

**Fields**:
- **Name*** (required)
- **Quantity** (default 1)
- **Low-stock threshold**
- **Category**
- **Tags** (comma-separated, converted to array)
- **Location** (opens `hv-location-selector`)
- **Checked-out** (checkbox)
- **Due date** (enabled only when checked out)

**Validation**:
- Name required (non-empty after trim)
- Quantity ≥ 0
- Low-stock threshold ≥ 0 or null
- Displays inline error banner on validation failure

**Events**:
- `save`: Emits item data (create or update payload)
- `cancel`: Close without saving
- `delete-item`: Delete existing item (only in edit mode)
- `open-location-selector`: Open location picker

**Keyboard**:
- `Esc`: Close dialog

---

### `hv-location-selector`

**Purpose**: Modal location picker with search.

**Properties**:
- `open`: Boolean visibility
- `locations`: Array of locations (flat list)
- `tree`: Unused (reserved for future tree rendering)

**Features**:
- Search input: filters by name or display_path (case-insensitive)
- Radio buttons for location selection
- "Include sublocations" checkbox
- Currently flat list (tree view deferred to Phase 2.5)

**Events**:
- `select`: Emits `{locationId, includeSubtree}`
- `cancel`: Close without selection

**Keyboard**:
- `Esc`: Close selector

---

## Store Architecture

### `Store` Class

**Purpose**: Central state management and WebSocket client wrapper.

**State** (Observable):
```typescript
{
  items: Item[],
  cursor: string | null,
  filters: StoreFilters,
  selection: Set<string>,
  pendingOps: Map<string, PendingOp>,
  errorQueue: ErrorEntry[],
  areasCache: AreasListResult | null,
  locationTreeCache: unknown[] | null,
  locationsFlatCache: Location[] | null,
  statsCounts: StatsCounts | null,
  connected: { items: boolean, stats: boolean }
}
```

**Initialization** (`init()`):
1. Fetch `stats()`, `listAreas()`, `getLocationTree()`, `listLocations()`
2. Load first page of items (50, sorted by updated_at desc)
3. Subscribe to `items` and `stats` topics

**CRUD Operations**:
- `createItem()`, `updateItem()`, `deleteItem()`
- `adjustQuantity()`, `setQuantity()`
- `checkOut()`, `markCheckedIn()`
- `setLowStockThreshold()`, `moveItem()`

**Optimistic Updates**:
1. Apply change to local state immediately
2. Send WS request
3. On success: reconcile with server response
4. On error: rollback + add to error queue

**Conflict Handling**:
- Detect `conflict` error code
- Add to `errorQueue` with `kind: 'conflict'`
- Store `itemId` and `changes` for retry
- UI shows banner with "View latest" / "Re-apply" buttons

**Pagination**:
- Page size: 50 items
- Prefetch triggered at ~70% scroll (`prefetchIfNeeded()`)
- Cursor-based (opaque string from backend)
- Merges new pages into existing list

**Filtering**:
- `setFilters()`: resets cursor and items, triggers new list call
- Debounced search: 200ms delay on `q` changes
- Re-subscribes to items topic with new `location_id` / `include_subtree`

---

### `WSClient` Class

**Purpose**: WebSocket message abstraction.

**Methods**:
- Utility: `ping()`, `version()`, `stats()`, `health()`
- Items: `listItems()`, `getItem()`, `createItem()`, `updateItem()`, `deleteItem()`
- Quantities: `adjustQuantity()`, `setQuantity()`
- Check-out: `checkOut()`, `markCheckedIn()`
- Other: `setLowStockThreshold()`, `moveItem()`
- Locations: `listLocations()`, `getLocationTree()`
- Areas: `listAreas()`
- Subscriptions: `subscribe()` (returns `Unsubscribe` function)

**WebSocket Integration**:
- Uses Home Assistant's `hass.callWS<T>(message)` for requests
- Uses `hass.connection.subscribeMessage(callback, message)` for subscriptions
- Returns typed results via generics

---

## Data Flow

### Startup Flow

```
1. User opens dashboard with haventory-card
2. Card receives `hass` property
3. Card creates Store instance
4. Store.init():
   a. Fetch stats, areas, locations (parallel)
   b. Fetch first page of items (50)
   c. Subscribe to items & stats topics
5. Card renders with populated data
```

### User Action Flow (Example: Edit Item)

```
1. User clicks "Edit" button on row
2. Row emits 'edit' event with itemId
3. Card finds item in store.state.value.items
4. Card sets dialog.item = item, dialog.open = true
5. Dialog renders with item data
6. User modifies fields and clicks "Save"
7. Dialog emits 'save' event with changes
8. Card calls store.updateItem(itemId, changes)
9. Store:
   a. Applies optimistic update to state
   b. Sends haventory/item/update via WS
   c. On success: reconciles with server response
   d. On conflict: adds to errorQueue
10. State change triggers re-render
11. Updated row appears immediately (optimistic)
12. WS event confirms change (reconciliation)
```

### Real-time Event Flow

```
1. Another client creates an item
2. Backend broadcasts 'items/created' event
3. Store's subscription callback receives event
4. Store.onItemsEvent(evt):
   a. Extracts item from event
   b. Finds index in local items array
   c. Updates or inserts item
5. Observable notifies listeners
6. Card re-renders with new item
```

### Filter Change Flow

```
1. User selects Area in dropdown
2. hv-search-bar emits 'change' with {areaId}
3. Card calls store.setFilters({areaId})
4. Store:
   a. Merges filter patch into state
   b. Resets cursor to null
   c. Clears items array
   d. Resubscribes to items topic (with new filters)
   e. Calls listItems(reset=true)
5. Backend returns filtered items
6. Store updates items in state
7. List re-renders with filtered results
```

---

## Testing Strategy

### Unit Tests (Vitest)

**Coverage**: 46 tests, 88.83% statements, 71.63% functions

**Test Files**:
1. `store.test.ts` (15 tests):
   - Initialization, pagination, prefetch
   - CRUD operations with optimistic updates
   - Conflict handling, error dismissal
   - Filter changes, refreshStats

2. `hv-search-bar.test.ts` (6 tests):
   - Render all controls
   - Debounced search (200ms)
   - Area/Location dropdown changes
   - Checkbox toggles
   - Sort selection

3. `hv-item-row.test.ts` (13 tests):
   - Render with all fields
   - LOW badge logic
   - Area name resolution
   - Button actions (−, +, Out/In, Edit)
   - Keyboard shortcuts (Enter, Delete, +, -)

4. `hv-inventory-list.test.ts` (1 test):
   - Virtualized rendering
   - Scroll near-end detection

5. `hv-item-dialog.test.ts` (1 test):
   - Name validation
   - Due date enable/disable

6. `hv-location-selector.test.ts` (8 tests):
   - Open/close states
   - Location list rendering
   - Search filtering
   - Select/Cancel events
   - Escape key, backdrop clicks

7. `haventory-card.test.ts` (2 tests):
   - Header and search bar rendering
   - Overlay toggle, Esc close, focus trap, banners

**Mock Strategy**:
- `makeMockHass()`: Simulates Home Assistant's `hass` object
- In-memory WS client with controlled responses
- Conflict simulation via `conflictOnUpdate` flag

---

## Build & Deployment

### Development

```powershell
cd cards/haventory-card
npm ci                    # Install dependencies
npm run dev              # Dev server with HMR
npm run lint             # ESLint
npm test                 # Run tests once
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
```

### Production Build

```powershell
npm run build
# Output: www/haventory/haventory-card.js
```

**Vite Configuration**:
- Entry: `src/index.ts`
- Output: Single bundle (no code splitting for simplicity)
- Target: ES2020+ (modern browsers, matches HA requirements)
- Source maps: Enabled

### Integration with Home Assistant

1. Built file copied to `www/haventory/`
2. Home Assistant serves from `/local/haventory/haventory-card.js`
3. Card registered via Lovelace as `custom:haventory-card`
4. No configuration required (zero-config MVP)

---

## Performance Characteristics

### Rendering

- **Initial load**: <200ms for 50-item viewport (p95)
- **Scroll**: 60fps steady-state (virtualization)
- **Search debounce**: 200ms (prevents excessive filtering)
- **Prefetch threshold**: 70% scroll position

### Network

- **WS round-trip** (LAN): <200ms p95
- **Optimistic updates**: 0ms perceived latency
- **Subscription overhead**: Minimal (single connection)

### Memory

- **List virtualization**: Renders ~15 DOM nodes for 1000+ items
- **Observable pattern**: Lightweight reactivity without framework overhead
- **Cache strategy**: Areas and locations cached for session

---

## Future Enhancements (Phase 2.5+)

1. **Tree View for Locations**: Recursive rendering with expand/collapse
2. **Bulk Operations**: Multi-select with bulk edit/delete
3. **Advanced Filters**: Tag-based, category, date ranges
4. **Drag & Drop**: Reorder, move items between locations
5. **Image Upload**: Item photos stored in HA media
6. **Mobile Optimization**: Touch gestures, swipe actions
7. **Offline Support**: Service worker for basic offline access
8. **Performance**: Virtual scrolling optimizations, lazy loading

---

## Key Design Decisions

### Why Lit?

- **Native web components**: No framework lock-in
- **Small bundle size**: ~15KB (vs 50KB+ for React/Vue)
- **SSR ready**: Home Assistant uses web components
- **TypeScript support**: First-class
- **Performance**: Efficient re-rendering with template caching

### Why `@lit-labs/virtualizer`?

- **Scalability**: Handles 1000+ items without performance degradation
- **Lit integration**: Native support for Lit templates
- **Accessibility**: Maintains proper ARIA roles
- **Small footprint**: Adds ~5KB to bundle

### Why Observable Pattern?

- **Simplicity**: No complex state management library needed
- **Type safety**: Full TypeScript inference
- **Reactivity**: Components re-render on state changes
- **Testability**: Easy to mock and verify state transitions

### Why Optimistic Updates?

- **UX**: Instant feedback on user actions
- **Network resilience**: Works offline temporarily
- **Conflict handling**: Backend version checks prevent data loss
- **Rollback**: Errors automatically revert optimistic changes

---

## Troubleshooting

### Card Not Showing

1. Check `www/haventory/haventory-card.js` exists
2. Verify Lovelace config: `type: custom:haventory-card`
3. Check browser console for load errors
4. Clear browser cache

### WebSocket Errors

1. Verify Home Assistant is running
2. Check HAventory integration is loaded (`hass.services.haventory`)
3. Check browser console for WS errors
4. Review HA logs: `grep haventory /config/home-assistant.log`

### Search Not Working

1. Check debounce: wait 200ms after typing
2. Verify store is initialized (`store.state.value.items.length > 0`)
3. Check filter state in browser DevTools

### Area Labels Missing

1. Verify `areasCache` is populated (`store.state.value.areasCache`)
2. Check `locationsFlatCache` has `area_id` fields
3. Ensure items have `location_id` set
4. Check area resolution in `hv-item-row.resolveAreaName()`

---

## References

- **Lit Documentation**: https://lit.dev
- **Home Assistant Frontend**: https://developers.home-assistant.io/docs/frontend
- **WebSocket API Contract**: `docs/backend_api_contract.md`
- **Data Shapes**: `docs/data_shapes.md`
