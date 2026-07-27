import { html } from 'lit';
import './hv-list';
import type { HVList } from './hv-list';
import { makeItem } from '../test.utils';

async function mount(props: Partial<HVList> = {}) {
  const el = document.createElement('hv-list') as HVList;
  el.items = [makeItem({ id: 'a', name: 'A' }), makeItem({ id: 'b', name: 'B' })];
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
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

  it('gives the scroller more room while editing', () => {
    const css = (customElements.get('hv-list') as typeof HVList).styles;
    const text = (Array.isArray(css) ? css : [css]).map((s) => String(s.cssText)).join('\n');
    // the compact cap still exists...
    expect(text).toContain('--hv-list-max-height');
    // ...and a taller one applies while an editor is open
    expect(text).toContain('--hv-list-editing-max-height');
    expect(text).toMatch(/:host\(.*\[editing\].*\)\s*\.scroller/);
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
