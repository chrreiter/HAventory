import { describe, it, expect, vi, afterEach } from 'vitest';
import './components/hv-banner';
import {
  all,
  componentCss,
  makeItem,
  makeMockHass,
  mountComponent,
  mountStore,
  ownCss,
  q,
  settle,
} from './test.utils';
import type { HVBanner } from './components/hv-banner';
import type { Item } from './store/types';

// Fixtures must not order themselves off the wall clock: the default sort is
// `updated_at` descending with an id-ascending tie-break, so a stamp that moves
// between two constructions silently reverses the list a spec asserts on.
describe('makeItem fixtures', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps every default fixture identically however much time passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
    const first = makeItem({ id: '1' });
    vi.setSystemTime(new Date('2026-08-02T10:00:00.001Z'));
    const second = makeItem({ id: '2' });

    expect(second.updated_at).toBe(first.updated_at);
    expect(second.created_at).toBe(first.created_at);
  });

  it('gives anonymous fixtures distinct ids in construction order', () => {
    const first = makeItem();
    const second = makeItem();

    expect(first.id).not.toBe(second.id);
    expect(first.id < second.id).toBe(true);
  });

  it('takes an explicit stamp when a spec needs one', () => {
    const pinned = makeItem({ id: '1', updated_at: '2026-07-04T00:00:00.000Z' });

    expect(pinned.updated_at).toBe('2026-07-04T00:00:00.000Z');
  });

  it('lists two default fixtures in id order across a clock tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
    const one = makeItem({ id: '1', name: 'Wood Glue' });
    vi.setSystemTime(new Date('2026-08-02T10:00:00.001Z'));
    const two = makeItem({ id: '2', name: 'Clamps' });
    vi.useRealTimers();

    const hass = makeMockHass({ items: [two, one] });
    const page = await hass.callWS<{ items: Item[] }>({
      type: 'haventory/item/list',
      sort: { field: 'updated_at', order: 'desc' },
    });

    expect(page.items.map((i) => i.id)).toEqual(['1', '2']);
  });
});

// The harness decides what a component test is able to check, so the properties
// the 22 component files lean on are pinned here rather than inferred from them.
describe('component-test harness', () => {
  it('assigns properties before connecting, so the first render sees them', async () => {
    const { el, sr } = await mountComponent<HVBanner>('hv-banner', { kind: 'error' });

    expect(el.isConnected).toBe(true);
    expect(sr).toBeTruthy();
    // A property applied after connection would have needed a second render.
    expect(q(el, '.banner')?.classList.contains('error')).toBe(true);
  });

  it('places light-DOM content where a slot can pick it up', async () => {
    const { el } = await mountComponent<HVBanner>(
      'hv-banner',
      {},
      { light: '<span id="slotted">boom</span>' },
    );

    expect(el.querySelector('#slotted')?.textContent).toBe('boom');
  });

  it('reads a shadow root through the element or through the root itself', async () => {
    const { el, sr } = await mountComponent<HVBanner>('hv-banner', {}, { light: '<b>a</b><b>b</b>' });

    expect(q(el, '.banner')).toBe(q(sr, '.banner'));
    expect(all(el, 'slot')).toHaveLength(all(sr, 'slot').length);
    expect(q(el, '.no-such-thing')).toBe(null);
    expect(all(el, '.no-such-thing')).toEqual([]);
  });

  it('forwards the whole MockConfig to the store it builds', async () => {
    const { hass, store } = await mountStore({
      items: [makeItem({ id: '1', name: 'Hammer' })],
      areas: [{ id: 'area-garage', name: 'Garage' }],
      statuses: [{ slug: 'lent_out', label: 'Lent out', order: 40, color: 'blue' }],
    });

    // Statuses and areas are the two a per-file mount used to drop.
    expect(store.state.value.areasCache?.areas.map((a) => a.id)).toEqual(['area-garage']);
    expect(store.state.value.statuses?.map((s) => s.slug)).toContain('lent_out');
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Hammer']);
    expect(hass.callWS).toBeTypeOf('function');
  });

  it('tells a component block apart from the fragments ahead of it', () => {
    const whole = componentCss('hv-banner');
    const own = ownCss('hv-banner');

    expect(whole).toContain(own);
    expect(own.length).toBeLessThan(whole.length);
    // Both are whitespace-normalized, so a rule reads as one line either way.
    expect(whole).not.toMatch(/\n/);
    expect(() => componentCss('hv-not-a-component')).toThrow(/no styles/);
  });

  it('settles a render that another render queued', async () => {
    const { el } = await mountComponent<HVBanner>('hv-banner', { kind: 'info' });

    el.kind = 'warning';
    await settle(el);

    expect(q(el, '.banner')?.classList.contains('warning')).toBe(true);
  });
});
