import { render } from 'lit';
import { renderDayOffsets } from './day-offsets';
import { addDays } from './relative-time';
import type { DayOffsetsOptions, DayOffsetsState } from './day-offsets';

function draw(state: Partial<DayOffsetsState>, opts: Partial<DayOffsetsOptions> = {}) {
  const picked: string[] = [];
  const custom: string[] = [];
  const typed: [number, string | null][] = [];
  const host = document.createElement('div');
  render(
    renderDayOffsets(
      { current: null, customOpen: false, customDays: 14, ...state },
      {
        prefix: 'checkout',
        onPick: (date) => picked.push(date),
        onCustom: (date) => custom.push(date),
        onDays: (days, date) => typed.push([days, date]),
        ...opts,
      },
    ),
    host,
  );
  return { host, picked, custom, typed };
}

const all = (host: HTMLElement, testid: string) =>
  [...host.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const q = (host: HTMLElement, testid: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

describe('renderDayOffsets', () => {
  it('offers the three round spans and the way past them', () => {
    const { host } = draw({});
    expect(all(host, 'checkout-offset').map((b) => b.dataset.days)).toEqual(['7', '30', '90']);
    expect(q(host, 'checkout-offset-custom')).not.toBe(null);
  });

  it('names every control after the surface drawing it', () => {
    const { host } = draw({}, { prefix: 'editor-inspection' });
    expect(all(host, 'editor-inspection-offset')).toHaveLength(3);
    expect(q(host, 'editor-inspection-offsets')).not.toBe(null);
    expect(q(host, 'editor-inspection-offset-custom')).not.toBe(null);
    expect(q(host, 'checkout-offset')).toBe(null);
  });

  it('marks the preset that computes the date the field holds', () => {
    const { host } = draw({ current: addDays(30) });
    expect(all(host, 'checkout-offset').map((b) => b.classList.contains('on'))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('hands back the date a preset stands for', () => {
    const { host, picked } = draw({});
    (all(host, 'checkout-offset')[2] as HTMLButtonElement).click();
    expect(picked).toEqual([addDays(90)]);
  });

  // The custom row is the way out for a span the presets do not cover, so it
  // takes the on state off them while it owns the date.
  it('keeps the custom box away until it is asked for, then owns the state', () => {
    const closed = draw({ current: addDays(7) });
    expect(q(closed.host, 'checkout-custom')).toBe(null);
    (q(closed.host, 'checkout-offset-custom') as HTMLButtonElement).click();
    expect(closed.custom).toEqual([addDays(14)]);

    const open = draw({ current: addDays(7), customOpen: true });
    expect(q(open.host, 'checkout-custom')).not.toBe(null);
    expect(all(open.host, 'checkout-offset').some((b) => b.classList.contains('on'))).toBe(false);
    expect(q(open.host, 'checkout-offset-custom')?.classList.contains('on')).toBe(true);
  });

  it('computes a date from the count typed into the box', () => {
    const { host, typed } = draw({ customOpen: true });
    const input = q(host, 'checkout-custom')?.querySelector('input') as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(typed).toEqual([[3, addDays(3)]]);
  });

  // An empty or nonsense box means no date yet rather than the last good one.
  it('answers a cleared box with no date at all', () => {
    const { host, typed } = draw({ customOpen: true });
    const input = q(host, 'checkout-custom')?.querySelector('input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(typed).toEqual([
      [0, null],
      [0, null],
    ]);
  });

  it('bounds the box so a date is a date and not a century', () => {
    const { host } = draw({ customOpen: true });
    const input = q(host, 'checkout-custom')?.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('3650');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });
});
