import { html } from 'lit';
import './hv-list';
import type { HVList } from './hv-list';
import { makeItem, mountComponent } from '../test.utils';

async function mount(props: Partial<HVList> = {}) {
  const { el } = await mountComponent<HVList>('hv-list', {
    items: [makeItem({ id: 'a', name: 'A' }), makeItem({ id: 'b', name: 'B' })],
    ...props,
  });
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

// Infinite scroll on the standard card hangs off this one event: the list
// reports how far down the scroller is and the shell decides whether to fetch
// the next page. Nothing else in the card asserts the ratio it reports.
describe('hv-list: paging', () => {
  it('reports how far down the scroller has moved', async () => {
    const el = await mount();
    const scroller = el.shadowRoot?.querySelector('[data-testid="list-rows"]') as HTMLElement;
    expect(scroller).toBeTruthy();

    let ratio = 0;
    el.addEventListener('near-end', (e) => {
      ratio = (e as CustomEvent).detail.ratio;
    });

    Object.defineProperty(scroller, 'scrollTop', { value: 700, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    scroller.dispatchEvent(new Event('scroll'));

    expect(ratio).toBeCloseTo(0.9, 2);
  });
});

describe('hv-list: editing', () => {
  // The row list is capped so the card stays compact, but the inline editor
  // renders inside that same scroller. A ~720px form in a 420px window left
  // Save, Cancel, Delete and the whole custom-fields group below the fold.
  it('marks itself as editing while a row is expanded', async () => {
    const el = await mount({ editorTemplate: () => 'editor', editingItemId: 'a' });
    expect(el.hasAttribute('editing')).toBe(true);
  });

  it('marks itself as editing while adding a new item', async () => {
    const el = await mount({ editorTemplate: () => 'editor', addingNew: true });
    expect(el.hasAttribute('editing')).toBe(true);
  });

  it('is not editing when no editor is open', async () => {
    const el = await mount();
    expect(el.hasAttribute('editing')).toBe(false);
  });

  it('drops the editing flag again when the editor closes', async () => {
    const el = await mount({ editorTemplate: () => 'editor', editingItemId: 'a' });
    el.editingItemId = null;
    await el.updateComplete;
    expect(el.hasAttribute('editing')).toBe(false);
  });

  // The template is a stable callback, so Lit re-runs it only when one of this
  // component's own properties changes. The token is how a host says its editor
  // needs redrawing for a reason nothing here binds.
  it('re-runs the editor template when the opaque token changes', async () => {
    let runs = 0;
    const el = await mount({
      editingItemId: 'a',
      editorTemplate: () => {
        runs += 1;
        return html`<div data-testid="stub-editor">${runs}</div>`;
      },
    });
    expect(runs).toBe(1);

    el.editorEpoch = 2;
    await el.updateComplete;
    expect(runs).toBe(2);
    expect(el.shadowRoot?.querySelector('[data-testid="stub-editor"]')?.textContent).toBe('2');
  });

  it('does not treat the token as an editing signal', async () => {
    const el = await mount({ editorEpoch: 7 });
    expect(el.hasAttribute('editing')).toBe(false);
  });

});

// The three render branches are mutually exclusive and only the row branch was
// covered. The third is the subtle one: an "add item" expander over an empty
// list must not also draw the empty state telling the user there is nothing yet.
describe('hv-list: which branch renders', () => {
  it('draws skeletons while the first page is still loading', async () => {
    const el = await mount({ items: [], loading: true });
    expect(el.shadowRoot?.querySelector('[data-testid="list-skeleton"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="empty-state"]')).toBe(null);
    expect(el.shadowRoot?.querySelector('[data-testid="list-rows"]')).toBe(null);
  });

  it('keeps the rows while a refresh is in flight', async () => {
    // `loading` alone is not enough — the skeletons only replace an empty list.
    const el = await mount({ loading: true });
    expect(el.shadowRoot?.querySelector('[data-testid="list-rows"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="list-skeleton"]')).toBe(null);
  });

  // The kept rows are the honest display only if they are labelled as stale.
  it('marks the kept rows busy and shows the refresh signal', async () => {
    const el = await mount({ loading: true });
    const rows = el.shadowRoot?.querySelector('[data-testid="list-rows"]') as HTMLElement;
    expect(rows.getAttribute('aria-busy')).toBe('true');
    expect(el.shadowRoot?.querySelector('[data-testid="list-refreshing"]')).toBeTruthy();
  });

  it('drops the busy marks once the refresh lands', async () => {
    const el = await mount({ loading: false });
    const rows = el.shadowRoot?.querySelector('[data-testid="list-rows"]') as HTMLElement;
    expect(rows.getAttribute('aria-busy')).toBe('false');
    expect(el.shadowRoot?.querySelector('[data-testid="list-refreshing"]')).toBe(null);
  });

  // A filter can legitimately exclude the row being edited. Unmounting the form
  // there discards whatever was typed into it, so the row is pinned instead.
  it('pins the edited row when the list stops carrying it', async () => {
    const pinned = makeItem({ id: 'a', name: 'A' });
    const el = await mount({
      editingItemId: 'a',
      pinnedItem: pinned,
      editorTemplate: (id) => html`<div data-testid="stub-editor">${id}</div>`,
    });
    el.items = [makeItem({ id: 'b', name: 'B' })];
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('[data-testid="stub-editor"]')?.textContent).toBe('a');
    expect(el.shadowRoot?.querySelector('[data-testid="pinned-editor-hint"]')?.textContent).toContain(
      'No longer matches the current filters',
    );
  });

  it('draws no pin hint while the edited row is still listed', async () => {
    const el = await mount({
      editingItemId: 'a',
      editorTemplate: (id) => html`<div data-testid="stub-editor">${id}</div>`,
    });
    expect(el.shadowRoot?.querySelector('[data-testid="stub-editor"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="pinned-editor-hint"]')).toBe(null);
  });

  it('keeps a pinned editor instead of falling back to the empty state', async () => {
    const el = await mount({
      items: [],
      loading: false,
      editingItemId: 'a',
      pinnedItem: makeItem({ id: 'a', name: 'A' }),
      editorTemplate: (id) => html`<div data-testid="stub-editor">${id}</div>`,
    });
    expect(el.shadowRoot?.querySelector('[data-testid="stub-editor"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="empty-state"]')).toBe(null);
  });

  it('keeps a pinned editor instead of falling back to the skeleton', async () => {
    const el = await mount({
      items: [],
      loading: true,
      editingItemId: 'a',
      pinnedItem: makeItem({ id: 'a', name: 'A' }),
      editorTemplate: (id) => html`<div data-testid="stub-editor">${id}</div>`,
    });
    expect(el.shadowRoot?.querySelector('[data-testid="stub-editor"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="list-skeleton"]')).toBe(null);
  });

  it('names the empty situation once loading has finished', async () => {
    const el = await mount({ items: [], loading: false, emptyKind: 'no-matches' });
    const empty = el.shadowRoot?.querySelector('[data-testid="empty-state"]') as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.dataset.kind).toBe('no-matches');
  });

  it('suppresses the empty state while the add-item expander is open', async () => {
    const el = await mount({
      items: [],
      loading: false,
      addingNew: true,
      editorTemplate: () => html`<div data-testid="stub-editor"></div>`,
    });

    expect(el.shadowRoot?.querySelector('[data-testid="stub-editor"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="empty-state"]')).toBe(null);
  });

  it('passes the empty state a location name to say where nothing is filed', async () => {
    const el = await mount({
      items: [],
      loading: false,
      emptyKind: 'empty-location',
      emptyLocationName: 'Garage',
    });
    expect(el.shadowRoot?.querySelector('[data-testid="empty-state"]')?.textContent).toContain('Garage');
  });
});
