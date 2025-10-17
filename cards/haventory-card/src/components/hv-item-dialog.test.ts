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
});
