import './hv-bottom-sheet';
import type { HVBottomSheet } from './hv-bottom-sheet';

async function mount(props: Partial<HVBottomSheet> = {}) {
  const el = document.createElement('hv-bottom-sheet') as HVBottomSheet;
  Object.assign(el, { open: true, ...props });
  el.innerHTML = '<p>sheet body</p><div slot="footer">footer</div>';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('hv-bottom-sheet', () => {
  it('renders nothing when closed', async () => {
    const el = await mount({ open: false });
    expect(el.shadowRoot?.querySelector('[data-testid="bottom-sheet"]')).toBe(null);
  });

  it('renders a modal dialog with a drag handle and both slots', async () => {
    const el = await mount({ label: 'AA Batteries' });
    const sr = el.shadowRoot as ShadowRoot;
    const sheet = sr.querySelector('[data-testid="bottom-sheet"]') as HTMLElement;

    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBe('AA Batteries');
    expect(sr.querySelector('[data-testid="sheet-handle"]')).toBeTruthy();
    expect(sr.querySelector('slot[name="footer"]')).toBeTruthy();
  });

  it('can hide the handle when the content supplies its own header', async () => {
    const el = await mount({ noHandle: true });
    expect(el.shadowRoot?.querySelector('[data-testid="sheet-handle"]')).toBe(null);
  });

  it('closes and emits cancel from the scrim and from Escape', async () => {
    for (const trigger of ['scrim', 'escape'] as const) {
      const el = await mount();
      let fired = 0;
      el.addEventListener('cancel', () => {
        fired += 1;
      });
      const sr = el.shadowRoot as ShadowRoot;

      if (trigger === 'scrim') {
        (sr.querySelector('.scrim') as HTMLElement).click();
      } else {
        (sr.querySelector('[data-testid="bottom-sheet"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      }

      expect(fired, `cancel via ${trigger}`).toBe(1);
      expect(el.open).toBe(false);
      el.remove();
    }
  });

  it('caps its width and centres itself so a wide screen does not stretch the content', () => {
    const styles = (customElements.get('hv-bottom-sheet') as typeof HVBottomSheet).styles;
    const css = (Array.isArray(styles) ? styles : [styles]).map((s) => String(s.cssText)).join('\n');
    const rule = css.slice(css.indexOf('.sheet {'), css.indexOf('@keyframes')).replace(/\s+/g, ' ');

    // min() keeps a phone full-bleed and stops a 2560px desktop from spreading
    // a 48px-tall label/value row — or a pair of action buttons — edge to edge.
    expect(rule).toMatch(/width: min\(100%, var\(--hv-sheet-max-width, \d+px\)\)/);
    expect(rule).toMatch(/margin-inline: auto/);
  });

  // `vh` resolves against the viewport with the browser chrome retracted, so a
  // sheet at its cap could stand taller than the screen actually showing and
  // push its sticky footer under the URL bar.
  it('caps its height against the viewport that is really visible', () => {
    const styles = (customElements.get('hv-bottom-sheet') as typeof HVBottomSheet).styles;
    const css = (Array.isArray(styles) ? styles : [styles]).map((s) => String(s.cssText)).join('\n');
    expect(css).toMatch(/max-height: 92dvh/);
    expect(css).not.toMatch(/max-height: 92vh/);
  });

  it('stacks above previously opened surfaces', async () => {
    const first = await mount();
    const second = await mount();
    const zOf = (el: HVBottomSheet) =>
      Number((el.shadowRoot?.querySelector('.scrim') as HTMLElement).style.zIndex);
    expect(zOf(second)).toBeGreaterThan(zOf(first));
  });
});

describe('hv-bottom-sheet: drag to dismiss', () => {
  /**
   * jsdom has no PointerEvent, and the handlers only read clientY, timeStamp
   * and pointerId — MouseEvent carries the first two and the third is only
   * passed straight to setPointerCapture, which is stubbed.
   */
  async function grip(el: HVBottomSheet) {
    const node = el.shadowRoot?.querySelector('[data-testid="sheet-grip"]') as HTMLElement;
    node.setPointerCapture = () => {};
    return {
      node,
      async drag(from: number, to: number) {
        for (const [type, clientY] of [
          ['pointerdown', from],
          ['pointermove', to],
          ['pointerup', to],
        ] as const) {
          node.dispatchEvent(new MouseEvent(type, { clientY, bubbles: true }));
        }
        await el.updateComplete;
      },
    };
  }

  // The handle is the universal "drag me down" affordance, and it did nothing
  // at all: a 260px touch-drag left the sheet exactly where it was.
  it('dismisses when the sheet is dragged well down', async () => {
    const el = await mount();
    let cancelled = 0;
    el.addEventListener('cancel', () => {
      cancelled += 1;
    });

    await (await grip(el)).drag(100, 400);

    expect(cancelled).toBe(1);
    expect(el.open).toBe(false);
  });

  it('springs back from a drag too short to mean it', async () => {
    const el = await mount();
    let cancelled = 0;
    el.addEventListener('cancel', () => {
      cancelled += 1;
    });

    await (await grip(el)).drag(100, 120);

    expect(cancelled).toBe(0);
    expect(el.open).toBe(true);
    // No leftover offset once the finger is up.
    const sheet = el.shadowRoot?.querySelector('[data-testid="bottom-sheet"]') as HTMLElement;
    expect(sheet.style.transform).toBe('');
  });

  it('ignores an upward drag rather than lifting off the bottom edge', async () => {
    const el = await mount();
    const { node } = await grip(el);
    node.dispatchEvent(new MouseEvent('pointerdown', { clientY: 300, bubbles: true }));
    node.dispatchEvent(new MouseEvent('pointermove', { clientY: 100, bubbles: true }));
    await el.updateComplete;

    const sheet = el.shadowRoot?.querySelector('[data-testid="bottom-sheet"]') as HTMLElement;
    expect(sheet.style.transform).toBe('');
    expect(el.open).toBe(true);
  });

  it('follows the finger while the drag is in flight', async () => {
    const el = await mount();
    const { node } = await grip(el);
    node.dispatchEvent(new MouseEvent('pointerdown', { clientY: 100, bubbles: true }));
    node.dispatchEvent(new MouseEvent('pointermove', { clientY: 160, bubbles: true }));
    await el.updateComplete;

    const sheet = el.shadowRoot?.querySelector('[data-testid="bottom-sheet"]') as HTMLElement;
    expect(sheet.style.transform).toBe('translateY(60px)');
  });

  it('does not react to a move that no pointerdown started', async () => {
    const el = await mount();
    const { node } = await grip(el);
    node.dispatchEvent(new MouseEvent('pointermove', { clientY: 900, bubbles: true }));
    node.dispatchEvent(new MouseEvent('pointerup', { clientY: 900, bubbles: true }));
    await el.updateComplete;

    expect(el.open).toBe(true);
  });

  it('has no grip to drag when the handle is suppressed', async () => {
    const el = await mount({ noHandle: true });
    expect(el.shadowRoot?.querySelector('[data-testid="sheet-grip"]')).toBe(null);
  });

  // Pinning current behaviour, not endorsing it: unlike the six surfaces that use
  // `ui/dialog-focus`, this sheet never moves focus into itself. Its Escape
  // handler therefore only fires once focus is already inside — which it is in
  // practice, because the sheet's own content takes it. Changing this is a
  // behaviour change and belongs in its own commit.
  it('leaves focus where it was when it opens', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const el = await mount();

    expect(document.activeElement).toBe(opener);
    expect(el.shadowRoot?.activeElement).toBe(null);
    opener.remove();
  });

  it('closes on Escape raised from inside the sheet', async () => {
    const el = await mount();
    let cancels = 0;
    el.addEventListener('cancel', () => { cancels += 1; });

    (el.shadowRoot?.querySelector('[data-testid="bottom-sheet"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await el.updateComplete;

    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});
