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
});
