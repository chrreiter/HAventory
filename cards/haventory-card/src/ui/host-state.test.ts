import { describe, it, expect, vi } from 'vitest';
import type { ReactiveControllerHost } from 'lit';
import { HostState } from './host-state';

function fakeHost() {
  const requestUpdate = vi.fn<() => void>();
  const host: ReactiveControllerHost = {
    addController: () => undefined,
    removeController: () => undefined,
    requestUpdate,
    updateComplete: Promise.resolve(true),
  };
  return Object.assign(host, { requestUpdate });
}

describe('HostState', () => {
  it('asks the host to render on every change', () => {
    const host = fakeHost();
    const ui = new HostState(host, { open: false, label: '' });

    ui.set({ open: true });
    ui.set({ label: 'Garage' });

    expect(ui.value).toEqual({ open: true, label: 'Garage' });
    expect(host.requestUpdate).toHaveBeenCalledTimes(2);
  });

  // `syncPinnedItem` runs on every render; a write that changes nothing must
  // not book another one.
  it('stays quiet for a patch that changes nothing', () => {
    const host = fakeHost();
    const pinned = { id: '1' };
    const ui = new HostState<{ pinned: { id: string } | null }>(host, { pinned });

    ui.set({ pinned });
    expect(host.requestUpdate).not.toHaveBeenCalled();
    ui.set({ pinned: null });
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
  });

  it('replaces the value rather than writing into it', () => {
    const ui = new HostState(fakeHost(), { open: false });
    const before = ui.value;
    ui.set({ open: true });
    expect(before.open).toBe(false);
    expect(ui.value).not.toBe(before);
  });
});
