import './index';
import { makeMockHass, makeItem } from './test.utils';
import { Store } from './store/store';
import { getStubConfig } from './index';

describe('HAventoryCard', () => {
  it('renders header and search bar', async () => {
    const el = document.createElement('haventory-card') as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    document.body.appendChild(el);

    await customElements.whenDefined('haventory-card');

    if ('updateComplete' in el && el.updateComplete) {
      await el.updateComplete;
    }

    const sr = el.shadowRoot as ShadowRoot;
    expect(sr.textContent || '').toContain('HAventory');
    expect(sr.querySelector('hv-search-bar')).toBeTruthy();
    expect(sr.querySelector('hv-inventory-list')).toBeTruthy();
  });

  it('overlay toggles and Esc closes; focus returns to toggle; banners render', async () => {
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'A' })] });
    (el as any).hass = hass;

    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }
    const sr = el.shadowRoot as ShadowRoot;

    const toggle = sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement;
    toggle.click();
    // Overlay should exist and contain content
    await el.updateComplete;
    const overlay = sr.querySelector('.overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent || '').toContain('HAventory');

    // Inject a conflict to render banner
    const store = (el as any).store as Store;
    store['pushError']({ code: 'conflict', message: 'conflict', context: {} }, { itemId: '1', changes: { name: 'B' } } as any);
    (el as any).requestUpdate?.();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }
    expect((sr.querySelector('.overlay')?.textContent || '')).toContain('conflict');

    // Send Esc key to close overlay
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }
    // Toggle should regain focus
    expect(document.activeElement === toggle || (sr.activeElement === toggle)).toBeTruthy();
  });

  it('shows add button in overlay header and opens dialog', async () => {
    // Expanded view should surface the Add button in the header with prominent styling
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [] });
    (el as any).hass = hass;

    const store = (el as any).store as Store;
    await store.init();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const sr = el.shadowRoot as ShadowRoot;
    const toggle = sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement;
    toggle.click();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const overlay = sr.querySelector('.overlay') as HTMLElement;
    expect(overlay).toBeTruthy();

    const overlayAddBtn = overlay.querySelector('.ov-header .btn-add') as HTMLButtonElement;
    expect(overlayAddBtn).toBeTruthy();
    expect(overlayAddBtn.classList.contains('btn-add')).toBe(true);

    overlayAddBtn.click();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const dialog = sr.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: any };
    expect(dialog.open).toBe(true);
    expect(dialog.item).toBe(null);
  });

  it('opens dialog in create mode when + button clicked', async () => {
    // Add button should open dialog with no item (create mode)
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [] });
    (el as any).hass = hass;
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const sr = el.shadowRoot as ShadowRoot;
    const addBtn = sr.querySelector('button[aria-label="Add item"]') as HTMLButtonElement;
    expect(addBtn).toBeTruthy();

    addBtn.click();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const dialog = sr.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: any };
    expect(dialog.open).toBe(true);
    expect(dialog.item).toBe(null);
  });

  it('opens dialog with item data when edit event received', async () => {
    // Edit event from inventory list should open dialog with item data
    const testItem = makeItem({ id: 'item-1', name: 'Test Item', quantity: 5 });
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [testItem] });
    (el as any).hass = hass;

    // Wait for store to initialize
    const store = (el as any).store as Store;
    await store.init();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const sr = el.shadowRoot as ShadowRoot;
    const list = sr.querySelector('hv-inventory-list') as HTMLElement;

    // Dispatch edit event
    list.dispatchEvent(new CustomEvent('edit', { detail: { itemId: 'item-1' }, bubbles: true, composed: true }));
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const dialog = sr.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: any };
    expect(dialog.open).toBe(true);
    expect(dialog.item?.id).toBe('item-1');
    expect(dialog.item?.name).toBe('Test Item');
  });

  it('calls store.adjustQuantity when increment event received', async () => {
    // Increment events should trigger store's adjustQuantity method
    const testItem = makeItem({ id: 'item-1', name: 'Test', quantity: 10 });
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [testItem] });
    (el as any).hass = hass;

    const store = (el as any).store as Store;
    await store.init();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    // Spy on adjustQuantity
    let adjustCalled = false;
    let adjustArgs: any[] = [];
    const originalAdjust = store.adjustQuantity.bind(store);
    store.adjustQuantity = async (...args: any[]) => {
      adjustCalled = true;
      adjustArgs = args;
      return originalAdjust(...(args as Parameters<typeof originalAdjust>));
    };

    const sr = el.shadowRoot as ShadowRoot;
    const list = sr.querySelector('hv-inventory-list') as HTMLElement;

    // Dispatch increment event
    list.dispatchEvent(new CustomEvent('increment', { detail: { itemId: 'item-1' }, bubbles: true, composed: true }));

    await new Promise((r) => setTimeout(r, 10));
    expect(adjustCalled).toBe(true);
    expect(adjustArgs[0]).toBe('item-1');
    expect(adjustArgs[1]).toBe(1); // increment by 1
  });

  it('calls store.checkOut when toggle-checkout event received for non-checked-out item', async () => {
    // Toggle checkout on non-checked-out item should call checkOut
    const testItem = makeItem({ id: 'item-1', name: 'Test', checked_out: false });
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [testItem] });
    (el as any).hass = hass;

    const store = (el as any).store as Store;
    await store.init();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    // Spy on checkOut
    let checkOutCalled = false;
    let checkOutItemId: string | null = null;
    const originalCheckOut = store.checkOut.bind(store);
    store.checkOut = async (itemId: string, ...args: any[]) => {
      checkOutCalled = true;
      checkOutItemId = itemId;
      return originalCheckOut(itemId, ...args);
    };

    const sr = el.shadowRoot as ShadowRoot;
    const list = sr.querySelector('hv-inventory-list') as HTMLElement;

    // Dispatch toggle-checkout event
    list.dispatchEvent(new CustomEvent('toggle-checkout', { detail: { itemId: 'item-1' }, bubbles: true, composed: true }));

    await new Promise((r) => setTimeout(r, 10));
    expect(checkOutCalled).toBe(true);
    expect(checkOutItemId).toBe('item-1');
  });

  it('updates store filters when search bar emits change', async () => {
    // Search bar change event should update store filters
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [] });
    (el as any).hass = hass;
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const sr = el.shadowRoot as ShadowRoot;
    const searchBar = sr.querySelector('hv-search-bar') as HTMLElement;
    const store = (el as any).store as Store;

    // Dispatch change event with filter update
    searchBar.dispatchEvent(new CustomEvent('change', { detail: { checkedOutOnly: true }, bubbles: true, composed: true }));

    await new Promise((r) => setTimeout(r, 50));
    expect(store.state.value.filters.checkedOutOnly).toBe(true);
  });

  it('uses custom title from config', async () => {
    // setConfig should allow custom title
    const el = document.createElement('haventory-card') as HTMLElement & {
      updateComplete?: Promise<unknown>;
      setConfig: (cfg: any) => void;
      requestUpdate: () => void;
    };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    el.setConfig({ title: 'My Custom Inventory' });
    el.requestUpdate();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const sr = el.shadowRoot as ShadowRoot;
    expect(sr.textContent || '').toContain('My Custom Inventory');
  });

  it('resets dialog to create mode when Add item clicked after editing', async () => {
    // After editing an item and closing dialog, clicking Add item should reset dialog.item to null
    const testItem = makeItem({ id: 'item-1', name: 'Existing Item', quantity: 5 });
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [testItem] });
    (el as any).hass = hass;

    const store = (el as any).store as Store;
    await store.init();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    const sr = el.shadowRoot as ShadowRoot;
    const dialog = sr.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: any };

    // Edit the item (simulate edit event)
    const list = sr.querySelector('hv-inventory-list') as HTMLElement;
    list.dispatchEvent(new CustomEvent('edit', { detail: { itemId: 'item-1' }, bubbles: true, composed: true }));
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    // Verify dialog is in edit mode with the item
    expect(dialog.open).toBe(true);
    expect(dialog.item?.id).toBe('item-1');

    // Close the dialog (simulate cancel/close)
    dialog.open = false;
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    // The dialog.item still holds the old item reference after close
    expect(dialog.item?.id).toBe('item-1');

    // Click Add item button (compact view)
    const addBtn = sr.querySelector('button[aria-label="Add item"]') as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    addBtn.click();
    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }

    // Verify dialog is now in create mode (item should be null, not the old item)
    expect(dialog.open).toBe(true);
    expect(dialog.item).toBe(null);
  });

  it('exposes stub config and registers customCards metadata', async () => {
    // getStubConfig returns a Lovelace stub pointing to this card
    const cfg = getStubConfig();
    expect(cfg.type).toBe('custom:haventory-card');

    // customCards registration
    const before = (window as any).customCards ? [...(window as any).customCards] : [];
    // Re-require index to trigger registration
    await import('./index');
    const cards = (window as any).customCards || [];
    expect(cards.some((c: any) => c.type === 'haventory-card')).toBe(true);

    // Restore original state to avoid side-effects on other tests
    (window as any).customCards = before;
  });
});
