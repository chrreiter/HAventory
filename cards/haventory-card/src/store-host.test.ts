import { vi } from 'vitest';
// The entry module registers both hosts: the Lovelace card and the sidebar panel.
import './index';
import { makeItem, makeMockHass, mountComponent, settle } from './test.utils';
import type { MockHass } from './test.utils';
import type { Store } from './store/store';

/** Both hosts, seen from a test: Home Assistant's property and Lit's promise. */
type Host = HTMLElement & { hass?: unknown; updateComplete: Promise<unknown> };

const AREA_EVENT = 'area_registry_updated';
/** Topic subscriptions one live store holds: items, stats, locations, statuses. */
const TOPICS_PER_STORE = 4;

/** `store` is protected on the shared base, and the test is about its identity. */
const storeOf = (el: HTMLElement): Store | undefined => (el as unknown as { store?: Store }).store;

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

// Home Assistant unmounts the card and the panel on every in-app navigation
// away — the sidebar, the back button, another dashboard — and instantiates a
// fresh element on the way back. The subscriptions the store opens live on the
// connection, which survives all of that, so what the element releases on the
// way out is what decides whether the socket carries one card's worth of
// traffic or one per page the user has visited.
describe.each(['haventory-card', 'haventory-panel'])('%s: the store lifecycle', (tag) => {
  async function mountHost(hass: MockHass): Promise<Host> {
    const { el } = await mountComponent<Host>(tag);
    el.hass = hass;
    await settle(el);
    return el;
  }

  it('opens one round of subscriptions once hass arrives', async () => {
    const hass = makeMockHass();
    const { el } = await mountComponent<Host>(tag);
    expect(storeOf(el)).toBeUndefined();
    expect(hass.__topicSubscriberCount()).toBe(0);

    el.hass = hass;
    await settle(el);

    expect(storeOf(el)).toBeTruthy();
    expect(hass.__topicSubscriberCount()).toBe(TOPICS_PER_STORE);
    expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(1);
  });

  it('builds one store when hass is set before the element is in the DOM', async () => {
    const hass = makeMockHass();
    const { el } = await mountComponent<Host>(tag, { hass } as Partial<Host>);
    await settle(el);

    expect(storeOf(el)).toBeTruthy();
    expect(hass.__topicSubscriberCount()).toBe(TOPICS_PER_STORE);
    expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(1);
  });

  it('releases the store, and everything it holds on the socket, when it leaves the page', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', quantity: 5 })] });
    const el = await mountHost(hass);
    const gone = storeOf(el)!;

    el.remove();
    await el.updateComplete;

    expect(storeOf(el)).toBeUndefined();
    expect(hass.__topicSubscriberCount()).toBe(0);
    expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(0);

    // Nothing the backend broadcasts afterwards has anywhere to land.
    hass.__emit('items', 'updated', { item: makeItem({ id: '1', quantity: 42, version: 2 }) });
    expect(gone.state.value.items[0].quantity).toBe(5);
  });

  it('comes back live when Home Assistant re-attaches it', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'Hammer' })] });
    const el = await mountHost(hass);
    const first = storeOf(el);

    el.remove();
    await el.updateComplete;
    document.body.appendChild(el);
    await settle(el);

    const live = storeOf(el);
    expect(live).toBeTruthy();
    expect(live).not.toBe(first);
    expect(hass.__topicSubscriberCount()).toBe(TOPICS_PER_STORE);
    expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(1);

    const redrawn = vi.spyOn(el as unknown as { requestUpdate: () => void }, 'requestUpdate');
    hass.__emit('items', 'created', { item: makeItem({ id: '2', name: 'Wrench' }) });
    await settle(el);

    expect(live!.state.value.items.some((i) => i.id === '2')).toBe(true);
    expect(redrawn).toHaveBeenCalled();
  });

  // The count on the wire is what the leak looked like: one event delivered to
  // as many item subscriptions as the page had been visited times.
  it('leaves one round open after three navigations away and back', async () => {
    const hass = makeMockHass();
    const el = await mountHost(hass);

    for (let visit = 0; visit < 3; visit++) {
      el.remove();
      await el.updateComplete;
      document.body.appendChild(el);
      await settle(el);
    }

    expect(hass.__topicSubscriberCount('items')).toBe(1);
    expect(hass.__topicSubscriberCount()).toBe(TOPICS_PER_STORE);
    expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(1);
  });
});
