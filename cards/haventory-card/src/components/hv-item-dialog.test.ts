import { describe, it, expect } from 'vitest';
import './hv-item-dialog';

describe('hv-item-dialog', () => {
  it('validates required name and enables due date when checked out', async () => {
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
    const sr = el.shadowRoot as ShadowRoot;

    // Name required
    const saveBtn = sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement;
    saveBtn.click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
    expect((sr.textContent || '').toLowerCase()).toContain('name is required');

    // Check-out button toggles due date enabled state
    const toggle = sr.querySelector('button[aria-label="Toggle checked-out"]') as HTMLButtonElement;
    const date = sr.querySelector('input[type="date"]') as HTMLInputElement;
    expect(date.disabled).toBe(true);
    toggle.click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
    expect(date.disabled).toBe(false);
  });

  it('has read-only location input that opens selector on click', async () => {
    // Location input should be read-only to prevent invalid location IDs
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
    const sr = el.shadowRoot as ShadowRoot;

    // Find the location input (it's the one with placeholder "None")
    const locationInput = Array.from(sr.querySelectorAll('input[type="text"]'))
      .find((inp) => (inp as HTMLInputElement).placeholder === 'None') as HTMLInputElement;
    expect(locationInput).toBeTruthy();
    expect(locationInput.readOnly).toBe(true);

    // Click should emit open-location-selector event
    let selectorOpened = false;
    el.addEventListener('open-location-selector', () => { selectorOpened = true; });
    locationInput.click();
    expect(selectorOpened).toBe(true);
  });

  it('shows Clear button when location is set and clears on click', async () => {
    // Clear button allows removing location assignment
    const el = document.createElement('hv-item-dialog') as HTMLElement & {
      updateComplete?: Promise<unknown>;
      setLocation: (id: string | null) => void;
    };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Initially no Clear button (no location set)
    let sr = el.shadowRoot as ShadowRoot;
    let clearBtn = sr.querySelector('button[aria-label="Clear location"]');
    expect(clearBtn).toBe(null);

    // Set a location
    el.setLocation('loc-123');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Now Clear button should appear
    sr = el.shadowRoot as ShadowRoot;
    clearBtn = sr.querySelector('button[aria-label="Clear location"]');
    expect(clearBtn).toBeTruthy();

    // Click Clear should remove location
    (clearBtn as HTMLButtonElement).click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Clear button should be gone
    sr = el.shadowRoot as ShadowRoot;
    clearBtn = sr.querySelector('button[aria-label="Clear location"]');
    expect(clearBtn).toBe(null);
  });

  it('includes description in save payload', async () => {
    // Description field should be included when saving
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
    const sr = el.shadowRoot as ShadowRoot;

    // Find the textarea for description
    const descTextarea = sr.querySelector('textarea') as HTMLTextAreaElement;
    expect(descTextarea).toBeTruthy();

    // Fill in name (required) and description
    const nameInput = sr.querySelector('input[type="text"]') as HTMLInputElement;
    nameInput.value = 'Test Item';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    descTextarea.value = 'A detailed description';
    descTextarea.dispatchEvent(new Event('input', { bubbles: true }));

    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Capture save event
    let saveDetail: any = null;
    el.addEventListener('save', (e: any) => { saveDetail = e.detail; });

    const saveBtn = sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement;
    saveBtn.click();

    expect(saveDetail).toBeTruthy();
    expect(saveDetail.name).toBe('Test Item');
    expect(saveDetail.description).toBe('A detailed description');
  });

  it('pre-populates description from item prop', async () => {
    // When editing an item, description should be pre-filled
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');

    // Set item with description
    (el as any).item = {
      id: '1',
      name: 'Existing Item',
      description: 'Existing description',
      quantity: 5,
      checked_out: false,
      due_date: null,
      location_id: null,
      tags: [],
      category: null,
      low_stock_threshold: null,
      custom_fields: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
      location_path: { id_path: [], name_path: [], display_path: '', sort_key: '' },
    };
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const descTextarea = sr.querySelector('textarea') as HTMLTextAreaElement;
    expect(descTextarea.value).toBe('Existing description');
  });

  it('shows validation error for negative quantity', async () => {
    // Quantity must be >= 0
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;

    // Fill in name
    const nameInput = sr.querySelector('input[type="text"]') as HTMLInputElement;
    nameInput.value = 'Test Item';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Set negative quantity
    const qtyInput = sr.querySelector('input[type="number"]') as HTMLInputElement;
    qtyInput.value = '-5';
    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));

    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Try to save
    const saveBtn = sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement;
    saveBtn.click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    expect((sr.textContent || '').toLowerCase()).toContain('quantity');
  });

  it('shows validation error for negative low-stock threshold', async () => {
    // Low-stock threshold must be >= 0 or empty
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;

    // Fill in name
    const nameInput = sr.querySelector('input[type="text"]') as HTMLInputElement;
    nameInput.value = 'Test Item';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Set negative threshold (second number input)
    const numberInputs = sr.querySelectorAll('input[type="number"]');
    const thresholdInput = numberInputs[1] as HTMLInputElement;
    thresholdInput.value = '-3';
    thresholdInput.dispatchEvent(new Event('input', { bubbles: true }));

    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Try to save
    const saveBtn = sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement;
    saveBtn.click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    expect((sr.textContent || '').toLowerCase()).toContain('low-stock threshold');
  });

  it('parses comma-separated tags correctly', async () => {
    // Tags should be split by comma and trimmed
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;

    // Fill in name
    const nameInput = sr.querySelector('input[type="text"]') as HTMLInputElement;
    nameInput.value = 'Test Item';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Find tags input (has "Tags" label)
    const textInputs = sr.querySelectorAll('input[type="text"]');
    // Name is first, tags should be after category
    const tagsInput = Array.from(textInputs).find((inp) => {
      const label = inp.closest('label');
      return label?.textContent?.includes('Tags');
    }) as HTMLInputElement;

    tagsInput.value = 'tag1, tag2,  tag3  , , tag4';
    tagsInput.dispatchEvent(new Event('input', { bubbles: true }));

    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let saveDetail: any = null;
    el.addEventListener('save', (e: any) => { saveDetail = e.detail; });

    const saveBtn = sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement;
    saveBtn.click();

    expect(saveDetail.tags).toEqual(['tag1', 'tag2', 'tag3', 'tag4']);
  });

  it('emits delete-item event when delete button clicked', async () => {
    // Delete button should emit event with item details
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');

    // Set item (delete button only shows when editing)
    (el as any).item = {
      id: 'item-123',
      name: 'Item To Delete',
      description: null,
      quantity: 1,
      checked_out: false,
      due_date: null,
      location_id: null,
      tags: [],
      category: null,
      low_stock_threshold: null,
      custom_fields: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
      location_path: { id_path: [], name_path: [], display_path: '', sort_key: '' },
    };
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let deleteDetail: any = null;
    el.addEventListener('delete-item', (e: any) => { deleteDetail = e.detail; });

    const sr = el.shadowRoot as ShadowRoot;
    const deleteBtn = sr.querySelector('button[aria-label="Delete item"]') as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    deleteBtn.click();

    expect(deleteDetail).toBeTruthy();
    expect(deleteDetail.itemId).toBe('item-123');
    expect(deleteDetail.name).toBe('Item To Delete');
  });

  it('emits cancel event and closes when Cancel clicked', async () => {
    // Cancel button should emit event and close dialog
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let cancelEmitted = false;
    el.addEventListener('cancel', () => { cancelEmitted = true; });

    const sr = el.shadowRoot as ShadowRoot;
    const cancelBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement;
    cancelBtn.click();

    expect(cancelEmitted).toBe(true);
    expect((el as any).open).toBe(false);
  });

  it('closes dialog when Escape key pressed', async () => {
    // Escape key should close dialog and emit cancel
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let cancelEmitted = false;
    el.addEventListener('cancel', () => { cancelEmitted = true; });

    const sr = el.shadowRoot as ShadowRoot;
    const dialog = sr.querySelector('.dialog') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(cancelEmitted).toBe(true);
    expect((el as any).open).toBe(false);
  });

  it('closes dialog when backdrop clicked', async () => {
    // Clicking backdrop should close dialog
    const el = document.createElement('hv-item-dialog') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    (el as any).open = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let cancelEmitted = false;
    el.addEventListener('cancel', () => { cancelEmitted = true; });

    const sr = el.shadowRoot as ShadowRoot;
    const backdrop = sr.querySelector('.backdrop') as HTMLElement;
    backdrop.click();

    expect(cancelEmitted).toBe(true);
    expect((el as any).open).toBe(false);
  });
});
