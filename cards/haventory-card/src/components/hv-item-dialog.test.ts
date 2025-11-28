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

    // Check-out toggles due date
    const check = sr.querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
    const date = sr.querySelector('input[type="date"]') as HTMLInputElement;
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
});
