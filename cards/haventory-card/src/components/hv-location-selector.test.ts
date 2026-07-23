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

  it('emits select event with locationId when Select is clicked', async () => {
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

    // Click Select button
    const selectBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Select');
    selectBtn?.click();

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.locationId).toBe('loc1');
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
    const el = document.createElement('hv-location-selector') as unknown as HTMLElement & { onSelect?: () => void };
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

  describe('delete and move', () => {
    function makeTree(): Location[] {
      const root: Location = {
        id: 'root1', parent_id: null, name: 'Garage', area_id: null,
        path: { id_path: ['root1'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
      };
      const child: Location = {
        id: 'child1', parent_id: 'root1', name: 'Shelf', area_id: null,
        path: { id_path: ['root1', 'child1'], name_path: ['Garage', 'Shelf'], display_path: 'Garage / Shelf', sort_key: 'garage / shelf' },
      };
      const other: Location = {
        id: 'other1', parent_id: null, name: 'Attic', area_id: null,
        path: { id_path: ['other1'], name_path: ['Attic'], display_path: 'Attic', sort_key: 'attic' },
      };
      return [root, child, other];
    }

    async function mount(locations: Location[]) {
      const el = document.createElement('hv-location-selector') as HTMLElement & { updateComplete?: Promise<unknown> };
      (el as any).open = true;
      (el as any).locations = locations;
      document.body.appendChild(el);
      await customElements.whenDefined('hv-location-selector');
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
      return el;
    }

    it('renders a delete button per row and emits delete-location', async () => {
      const el = await mount(makeTree());
      const sr = el.shadowRoot as ShadowRoot;

      const events: CustomEvent[] = [];
      el.addEventListener('delete-location', (e) => events.push(e as CustomEvent));

      const deleteBtns = sr.querySelectorAll('.btn-delete');
      expect(deleteBtns.length).toBe(3);

      (deleteBtns[0] as HTMLButtonElement).click();
      expect(events.length).toBe(1);
      expect(events[0].detail).toEqual({ locationId: 'root1', name: 'Garage' });
    });

    it('shows an action error banner via setActionError and clears on re-open', async () => {
      const el = await mount(makeTree());
      const sr = el.shadowRoot as ShadowRoot;

      (el as any).setActionError("'Garage' still contains items. Move or delete them first.");
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const banner = sr.querySelector('.error-banner[role="alert"]');
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toContain('Move or delete them first');

      // Re-opening resets the banner
      (el as any).open = false;
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
      (el as any).open = true;
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
      expect(sr.querySelector('.error-banner[role="alert"]')).toBeFalsy();
    });

    it('edit form offers a parent select excluding self and descendants', async () => {
      const el = await mount(makeTree());
      const sr = el.shadowRoot as ShadowRoot;

      // Edit the root: its subtree (root1, child1) must not be offered as parents
      const editBtns = sr.querySelectorAll('.btn-edit');
      (editBtns[0] as HTMLButtonElement).click();
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const parentSelect = sr.querySelector('.edit-form select[aria-label="Parent location"]') as HTMLSelectElement;
      expect(parentSelect).toBeTruthy();
      const values = Array.from(parentSelect.querySelectorAll('option')).map((o) => o.value);
      expect(values).toContain(''); // top level
      expect(values).toContain('other1');
      expect(values).not.toContain('root1');
      expect(values).not.toContain('child1');
    });

    it('save includes newParentId only when the parent changed', async () => {
      const el = await mount(makeTree());
      const sr = el.shadowRoot as ShadowRoot;

      const events: CustomEvent[] = [];
      el.addEventListener('update-location', (e) => events.push(e as CustomEvent));

      // Edit the child (parent root1) and move it under other1
      const editBtns = sr.querySelectorAll('.btn-edit');
      (editBtns[1] as HTMLButtonElement).click();
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const parentSelect = sr.querySelector('.edit-form select[aria-label="Parent location"]') as HTMLSelectElement;
      parentSelect.value = 'other1';
      parentSelect.dispatchEvent(new Event('change'));
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const saveBtn = sr.querySelector('.btn-save') as HTMLButtonElement;
      saveBtn.click();

      expect(events.length).toBe(1);
      expect(events[0].detail.locationId).toBe('child1');
      expect(events[0].detail.newParentId).toBe('other1');

      // Save again without touching the parent → no newParentId in the detail
      (el as any).setEditSuccess();
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
      const editBtnsAfter = sr.querySelectorAll('.btn-edit');
      (editBtnsAfter[1] as HTMLButtonElement).click();
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;
      (sr.querySelector('.btn-save') as HTMLButtonElement).click();
      expect(events.length).toBe(2);
      expect(events[1].detail.newParentId).toBeUndefined();
    });

    it('moving to top level sends newParentId null', async () => {
      const el = await mount(makeTree());
      const sr = el.shadowRoot as ShadowRoot;

      const events: CustomEvent[] = [];
      el.addEventListener('update-location', (e) => events.push(e as CustomEvent));

      const editBtns = sr.querySelectorAll('.btn-edit');
      (editBtns[1] as HTMLButtonElement).click(); // child1 (parent root1)
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      const parentSelect = sr.querySelector('.edit-form select[aria-label="Parent location"]') as HTMLSelectElement;
      parentSelect.value = '';
      parentSelect.dispatchEvent(new Event('change'));
      if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

      (sr.querySelector('.btn-save') as HTMLButtonElement).click();
      expect(events.length).toBe(1);
      expect(events[0].detail.newParentId).toBeNull();
    });
  });
});
