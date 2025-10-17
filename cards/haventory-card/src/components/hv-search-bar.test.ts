import { describe, it, expect, vi } from 'vitest';
import './hv-search-bar';

describe('hv-search-bar', () => {
  it('renders all filter controls with default values', async () => {
    const el = document.createElement('hv-search-bar') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-search-bar');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;

    // Search input
    const searchInput = sr.querySelector('input[type="search"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    expect(searchInput.placeholder).toBe('Search');

    // Area and Location selects
    const selects = sr.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(3); // Area, Location, Sort

    // Checkboxes
    const checkboxes = sr.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(3); // Include sublocations, Checked-out only, Low-stock first
  });

  it('debounces search input and emits change event after 200ms', async () => {
    const el = document.createElement('hv-search-bar') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-search-bar');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const searchInput = sr.querySelector('input[type="search"]') as HTMLInputElement;

    let changeDetail: any = null;
    el.addEventListener('change', (e: any) => {
      changeDetail = e.detail;
    });

    // Simulate typing
    searchInput.value = 'test';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Should not emit immediately
    await new Promise((r) => setTimeout(r, 100));
    expect(changeDetail).toBe(null);

    // Should emit after 200ms
    await new Promise((r) => setTimeout(r, 150));
    expect(changeDetail).toBeTruthy();
    expect(changeDetail.q).toBe('test');
  });

  it('emits change event when area selection changes', async () => {
    const areas = [{ id: 'area1', name: 'Garage' }, { id: 'area2', name: 'Kitchen' }];
    const el = document.createElement('hv-search-bar') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).areas = areas;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-search-bar');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const areaSelect = sr.querySelector('select[aria-label="Area"]') as HTMLSelectElement;

    let changeDetail: any = null;
    el.addEventListener('change', (e: any) => {
      changeDetail = e.detail;
    });

    // Should have options populated
    const options = areaSelect.querySelectorAll('option');
    expect(options.length).toBe(3); // "All" + 2 areas

    // Change selection
    areaSelect.value = 'area1';
    areaSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(changeDetail).toBeTruthy();
    expect(changeDetail.areaId).toBe('area1');
  });

  it('emits change event when location selection changes', async () => {
    const locations = [
      { id: 'loc1', name: 'Shelf A', path: { display_path: 'Home / Garage / Shelf A' } },
      { id: 'loc2', name: 'Pantry', path: { display_path: 'Home / Kitchen / Pantry' } },
    ];
    const el = document.createElement('hv-search-bar') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).locations = locations;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-search-bar');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const locSelect = sr.querySelector('select[aria-label="Location"]') as HTMLSelectElement;

    let changeDetail: any = null;
    el.addEventListener('change', (e: any) => {
      changeDetail = e.detail;
    });

    // Should have options populated
    const options = locSelect.querySelectorAll('option');
    expect(options.length).toBe(3); // "Root" + 2 locations

    // Change selection
    locSelect.value = 'loc1';
    locSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(changeDetail).toBeTruthy();
    expect(changeDetail.locationId).toBe('loc1');
  });

  it('emits change event when checkboxes are toggled', async () => {
    const el = document.createElement('hv-search-bar') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-search-bar');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const checkboxes = Array.from(sr.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];

    let changeDetail: any = null;
    el.addEventListener('change', (e: any) => {
      changeDetail = e.detail;
    });

    // Toggle "Include sublocations"
    const includeSubtree = checkboxes.find((cb) => cb.parentElement?.textContent?.includes('Include sublocations'));
    expect(includeSubtree).toBeTruthy();
    includeSubtree!.click();
    expect(changeDetail.includeSubtree).toBe(false); // Was true by default

    // Toggle "Checked-out only"
    const checkedOutOnly = checkboxes.find((cb) => cb.parentElement?.textContent?.includes('Checked-out only'));
    expect(checkedOutOnly).toBeTruthy();
    checkedOutOnly!.click();
    expect(changeDetail.checkedOutOnly).toBe(true);

    // Toggle "Low-stock first"
    const lowStockFirst = checkboxes.find((cb) => cb.parentElement?.textContent?.includes('Low-stock first'));
    expect(lowStockFirst).toBeTruthy();
    lowStockFirst!.click();
    expect(changeDetail.lowStockFirst).toBe(true);
  });

  it('emits change event when sort selection changes', async () => {
    const el = document.createElement('hv-search-bar') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-search-bar');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const sortSelect = sr.querySelector('select[aria-label="Sort"]') as HTMLSelectElement;

    let changeDetail: any = null;
    el.addEventListener('change', (e: any) => {
      changeDetail = e.detail;
    });

    // Change to Name
    sortSelect.value = 'name';
    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(changeDetail).toBeTruthy();
    expect(changeDetail.sort.field).toBe('name');
    expect(changeDetail.sort.order).toBe('desc'); // Preserves existing order
  });
});
