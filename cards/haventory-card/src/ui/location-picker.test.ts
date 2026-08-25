import { html, render } from 'lit';
import { LocationPicker } from './location-picker';
import type { ReactiveControllerHost } from 'lit';
import type { LocationPickerOptions } from './location-picker';

/**
 * A host in miniature: it does what a `LitElement` does with a
 * `requestUpdate` — draw again — and nothing else.
 */
function mount(opts: LocationPickerOptions = {}) {
  const box = document.createElement('div');
  document.body.append(box);
  let renders = 0;
  const host = {
    requestUpdate: () => draw(),
    addController: () => undefined,
    removeController: () => undefined,
    updateComplete: Promise.resolve(true),
  } as unknown as ReactiveControllerHost;
  const picker = new LocationPicker(host, opts);
  function draw() {
    renders += 1;
    render(
      picker.render(
        {
          triggerClass: 'field-button',
          testid: 'where',
          title: 'Garage',
          holderId: 'where-holder',
          trigger: html`<span class="value">Garage</span>`,
        },
        () => html`<span data-testid="tree">tree</span>`,
      ),
      box,
    );
  }
  draw();
  return {
    picker,
    box,
    trigger: () => box.querySelector('[data-testid="where"]') as HTMLButtonElement,
    holder: () => box.querySelector('#where-holder') as HTMLElement,
    tree: () => box.querySelector('[data-testid="tree"]'),
    renders: () => renders,
  };
}

/** What the tree sends when a row is picked; `select-area` carries no location. */
function pick(holder: HTMLElement, detail: Record<string, unknown>, name = 'select') {
  holder.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('LocationPicker', () => {
  it('wears the dressing the host form gave it', () => {
    const { trigger } = mount();
    expect(trigger().className).toBe('field-button');
    expect(trigger().getAttribute('title')).toBe('Garage');
    expect(trigger().querySelector('.value')?.textContent).toBe('Garage');
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened is what aria-controls answers, and it has to resolve in both states.
  it('names the holder it discloses, open or shut', () => {
    const { trigger, holder, tree } = mount();
    expect(trigger().getAttribute('aria-controls')).toBe('where-holder');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(holder()).toBeTruthy();
    expect(holder().hasAttribute('hidden')).toBe(true);
    expect(tree()).toBe(null);

    trigger().click();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe('where-holder');
    expect(holder().hasAttribute('hidden')).toBe(false);
    expect(tree()).toBeTruthy();
  });

  it('opens and shuts from the trigger', () => {
    const { picker, trigger } = mount();
    trigger().click();
    expect(picker.open).toBe(true);
    trigger().click();
    expect(picker.open).toBe(false);
  });

  it('shuts on a pick, which is what the trigger was opened for', () => {
    const { picker, trigger, holder } = mount();
    trigger().click();
    pick(holder(), { locationId: 'garage' });
    expect(picker.open).toBe(false);
  });

  // A filter narrows by a set, so adding to it means picking again.
  it('stays open while a set is being picked, and shuts when it is cleared', () => {
    const { picker, trigger, holder } = mount({ keepOpenOnSelect: true });
    trigger().click();
    pick(holder(), { locationId: 'garage' });
    expect(picker.open).toBe(true);
    pick(holder(), { locationId: null });
    expect(picker.open).toBe(false);
  });

  // An area heads the top level rather than sitting in it, so picking one is a
  // pick — and it carries no location, which is the same shape as clearing.
  it('shuts on an area, whichever way it treats a location', () => {
    for (const opts of [{}, { keepOpenOnSelect: true }]) {
      const { picker, trigger, holder } = mount(opts);
      trigger().click();
      pick(holder(), { areaId: 'kitchen' }, 'select-area');
      expect(picker.open).toBe(false);
      document.body.innerHTML = '';
    }
  });

  it('draws nothing again for a close that changes nothing', () => {
    const { picker, renders } = mount();
    const before = renders();
    picker.close();
    expect(renders()).toBe(before);
  });
});
