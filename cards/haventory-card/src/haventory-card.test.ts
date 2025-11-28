import './index';
import { makeMockHass, makeItem } from './test.utils';
import { Store } from './store/store';

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
    // Overlay root should exist and contain content
    const root = document.getElementById('haventory-overlay-root') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.textContent || '').toContain('HAventory');

    // Inject a conflict to render banner
    const store = (el as any).store as Store;
    store['pushError']({ code: 'conflict', message: 'conflict', context: {} }, { itemId: '1', changes: { name: 'B' } } as any);
    // Re-render overlay with banners
    ;(el as any)['_renderOverlay']();
    expect(root.textContent || '').toContain('conflict');

    // Send Esc key to close overlay
    const overlay = root.querySelector('.overlay') as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // Toggle should regain focus
    expect(document.activeElement === toggle || (sr.activeElement === toggle)).toBeTruthy();
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
      return originalAdjust(...args);
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
});
