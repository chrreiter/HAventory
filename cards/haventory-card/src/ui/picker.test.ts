import { html, render } from 'lit';
import { Picker } from './picker';
import type { ReactiveControllerHost } from 'lit';
import type { PickerOptions } from './picker';

/**
 * A host in miniature: it does what a `LitElement` does with a
 * `requestUpdate` — draw again — and nothing else.
 */
function mount(opts: PickerOptions = {}, chrome: { disabled?: boolean } = {}) {
  const box = document.createElement('div');
  document.body.append(box);
  let renders = 0;
  const host = {
    requestUpdate: () => draw(),
    addController: () => undefined,
    removeController: () => undefined,
    updateComplete: Promise.resolve(true),
  } as unknown as ReactiveControllerHost;
  const picker = new Picker(host, opts);
  function draw() {
    renders += 1;
    render(
      picker.render(
        {
          triggerClass: 'control grow',
          testid: 'target',
          holderId: 'target-holder',
          disabled: chrome.disabled,
          trigger: html`<span class="value">Nothing picked</span>`,
        },
        () => html`<button data-testid="option">battery</button>`,
      ),
      box,
    );
  }
  draw();
  return {
    picker,
    trigger: () => box.querySelector('[data-testid="target"]') as HTMLButtonElement,
    holder: () => box.querySelector('#target-holder') as HTMLElement,
    option: () => box.querySelector('[data-testid="option"]'),
    renders: () => renders,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Picker', () => {
  it('wears the dressing the host form gave it', () => {
    const { trigger } = mount();
    expect(trigger().className).toBe('control grow');
    expect(trigger().querySelector('.value')?.textContent).toBe('Nothing picked');
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened is what aria-controls answers, and it has to resolve in both states.
  it('names the holder it discloses, open or shut', () => {
    const { trigger, holder, option } = mount();
    expect(trigger().getAttribute('aria-controls')).toBe('target-holder');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(holder().hasAttribute('hidden')).toBe(true);
    expect(option()).toBe(null);

    trigger().click();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(holder().hasAttribute('hidden')).toBe(false);
    expect(option()).toBeTruthy();
  });

  it('opens and shuts from the trigger', () => {
    const { picker, trigger } = mount();
    trigger().click();
    expect(picker.open).toBe(true);
    trigger().click();
    expect(picker.open).toBe(false);
  });

  // A box with nothing in it to pick would open on an empty list and say
  // nothing about why.
  it('stays shut while the host has nothing to offer', () => {
    const { picker, trigger, holder } = mount({}, { disabled: true });
    expect(trigger().disabled).toBe(true);
    trigger().click();
    expect(picker.open).toBe(false);
    expect(holder().hasAttribute('hidden')).toBe(true);
  });

  // What a host keeps inside the box — a filter over the choices — is not
  // wanted again on the next open.
  it('tells the host when the box shuts, once per shut', () => {
    let closes = 0;
    const { picker, trigger } = mount({
      onClose: () => {
        closes += 1;
      },
    });
    trigger().click();
    expect(closes).toBe(0);
    trigger().click();
    expect(closes).toBe(1);
    picker.close();
    expect(closes).toBe(1);
  });

  it('draws nothing again for a close that changes nothing', () => {
    const { picker, renders } = mount();
    const before = renders();
    picker.close();
    expect(renders()).toBe(before);
  });
});
