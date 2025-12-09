import { describe, it, expect, vi } from 'vitest';
import './hv-location-selector';
import type { Location } from '../store/types';

function makeLocation(id: string, name: string, path?: string): Location {
  return {
    id,
    parent_id: null,
    name,
    area_id: null,
    path: {
      id_path: [id],
      name_path: [name],
      display_path: path || name,
      sort_key: name.toLowerCase(),
    },
  };
}

describe('hv-location-selector', () => {
  describe('creation mode', () => {
    // Note: createMode must be set AFTER open is set and element updated,
    // because the willUpdate hook resets createMode when open changes to true.

    it('renders create form when createMode is true', async () => {
      const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
      (el as any).open = true;
      (el as any).locations = [];
      document.body.appendChild(el);
      await customElements.whenDefined('hv-location-selector');
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      // Set createMode after open is set and element updated
      (el as any).createMode = true;
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const sr = el.shadowRoot as ShadowRoot;
      const input = sr.querySelector('.create-section input[type="text"]');
      expect(input).toBeTruthy();
    });

    it('dispatches create-location event on create', async () => {
      const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
      (el as any).open = true;
      (el as any).locations = [];
      document.body.appendChild(el);
      await customElements.whenDefined('hv-location-selector');
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      // Set createMode after open is set and element updated
      (el as any).createMode = true;
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const events: CustomEvent[] = [];
      el.addEventListener('create-location', (e) => events.push(e as CustomEvent));

      const sr = el.shadowRoot as ShadowRoot;
      const input = sr.querySelector('.create-section input[type="text"]') as HTMLInputElement;
      input.value = 'New Loc';
      input.dispatchEvent(new Event('input'));
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const createBtn = sr.querySelector('.create-section button:last-child') as HTMLButtonElement;
      createBtn.click();

      expect(events.length).toBe(1);
      expect(events[0].detail.name).toBe('New Loc');
    });

    it('disables Create button when name is empty', async () => {
      const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
      (el as any).open = true;
      (el as any).locations = [];
      document.body.appendChild(el);
      await customElements.whenDefined('hv-location-selector');
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      // Set createMode after open is set and element updated
      (el as any).createMode = true;
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const sr = el.shadowRoot as ShadowRoot;
      // Find the Create button in actions
      const createBtn = Array.from(sr.querySelectorAll('.create-section button'))
        .find((b) => b.textContent?.includes('Create')) as HTMLButtonElement;
      expect(createBtn).toBeTruthy();
      // Button should be disabled when name is empty
      expect(createBtn.disabled).toBe(true);
    });
  });

  it('does not render when open is false', async () => {
    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = false;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const backdrop = sr.querySelector('.backdrop');
    expect(backdrop).toBe(null);
  });

  it('renders dialog when open is true', async () => {
    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = true;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const backdrop = sr.querySelector('.backdrop');
    const panel = sr.querySelector('.panel');

    expect(backdrop).toBeTruthy();
    expect(panel).toBeTruthy();
  });

  it('renders list of locations from locations property', async () => {
    const locations = [
      makeLocation('loc1', 'Shelf A', 'Home / Garage / Shelf A'),
      makeLocation('loc2', 'Pantry', 'Home / Kitchen / Pantry'),
      makeLocation('loc3', 'Drawer 2', 'Home / Office / Drawer 2'),
    ];

    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = true;
    (el as any).locations = locations;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const listItems = sr.querySelectorAll('li');

    expect(listItems.length).toBe(3);
    const text = sr.textContent || '';
    expect(text).toContain('Home / Garage / Shelf A');
    expect(text).toContain('Home / Kitchen / Pantry');
    expect(text).toContain('Home / Office / Drawer 2');
  });

  it('filters locations based on search query', async () => {
    const locations = [
      makeLocation('loc1', 'Shelf A', 'Home / Garage / Shelf A'),
      makeLocation('loc2', 'Pantry', 'Home / Kitchen / Pantry'),
      makeLocation('loc3', 'Drawer 2', 'Home / Office / Drawer 2'),
    ];

    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = true;
    (el as any).locations = locations;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const searchInput = sr.querySelector('input[type="search"]') as HTMLInputElement;

    // Search for "kitchen"
    searchInput.value = 'kitchen';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const listItems = sr.querySelectorAll('li');
    expect(listItems.length).toBe(1);
    expect(sr.textContent || '').toContain('Pantry');
  });

  it('emits select event with locationId and includeSubtree when Select is clicked', async () => {
    const locations = [makeLocation('loc1', 'Shelf A', 'Home / Garage / Shelf A')];

    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = true;
    (el as any).locations = locations;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('select', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;

    // Select location via radio
    const radio = sr.querySelector('input[type="radio"]') as HTMLInputElement;
    radio.click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Toggle include subtree
    const checkbox = sr.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.click();
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    // Click Select button
    const selectBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Select');
    selectBtn?.click();

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.locationId).toBe('loc1');
    expect(eventDetail.includeSubtree).toBe(false); // Was toggled from default true
    expect((el as any).open).toBe(false);
  });

  it('emits cancel event when Cancel button is clicked', async () => {
    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = true;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let cancelEmitted = false;
    el.addEventListener('cancel', () => {
      cancelEmitted = true;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const cancelBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Cancel');
    cancelBtn?.click();

    expect(cancelEmitted).toBe(true);
  });

  it('closes dialog when Escape key is pressed', async () => {
    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = true;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let cancelEmitted = false;
    el.addEventListener('cancel', () => {
      cancelEmitted = true;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const panel = sr.querySelector('.panel') as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(cancelEmitted).toBe(true);
  });

  it('closes when backdrop is clicked', async () => {
    const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).open = true;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-location-selector');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let cancelEmitted = false;
    el.addEventListener('cancel', () => {
      cancelEmitted = true;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const backdrop = sr.querySelector('.backdrop') as HTMLElement;
    backdrop.click();

    expect(cancelEmitted).toBe(true);
  });

  it('closes even if select handler throws', async () => {
    const el = document.createElement('hv-location-selector') as HTMLElement & { onSelect?: () => void };
    (el as any).open = true;

    const err = new Error('boom');
    const spy = vi.fn(() => {
      throw err;
    });
    // Force dispatchEvent to throw synchronously
    (el as any).dispatchEvent = spy;

    expect(() => (el as any).onSelect()).toThrow(err);
    expect((el as any).open).toBe(false);
  });

  describe('edit mode', () => {
    it('shows edit form when edit button is clicked', async () => {
      const locations = [makeLocation('loc1', 'Shelf A', 'Home / Garage / Shelf A')];

      const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
      (el as any).open = true;
      (el as any).locations = locations;
      document.body.appendChild(el);
      await customElements.whenDefined('hv-location-selector');
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const sr = el.shadowRoot as ShadowRoot;
      const editBtn = sr.querySelector('.btn-edit') as HTMLButtonElement;
      editBtn.click();
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const editForm = sr.querySelector('.edit-form');
      expect(editForm).toBeTruthy();
    });

    it('dispatches update-location event on save', async () => {
      const locations = [makeLocation('loc1', 'Shelf A', 'Home / Garage / Shelf A')];

      const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
      (el as any).open = true;
      (el as any).locations = locations;
      document.body.appendChild(el);
      await customElements.whenDefined('hv-location-selector');
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const events: CustomEvent[] = [];
      el.addEventListener('update-location', (e) => events.push(e as CustomEvent));

      const sr = el.shadowRoot as ShadowRoot;

      // Click edit button
      const editBtn = sr.querySelector('.btn-edit') as HTMLButtonElement;
      editBtn.click();
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      // Change the name
      const input = sr.querySelector('.edit-form input[type="text"]') as HTMLInputElement;
      input.value = 'New Name';
      input.dispatchEvent(new Event('input'));
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      // Click save
      const saveBtn = sr.querySelector('.btn-save') as HTMLButtonElement;
      saveBtn.click();

      expect(events.length).toBe(1);
      expect(events[0].detail.locationId).toBe('loc1');
      expect(events[0].detail.name).toBe('New Name');
    });
  });
});
