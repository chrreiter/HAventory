import './hv-lightbox';
import { componentCss, makeAttachment, makeItem, makeMediaBindings, mountComponent, q, settle } from '../test.utils';
import type { HVLightbox } from './hv-lightbox';
import type { Item } from '../store/types';

const shots = (n: number) => Array.from({ length: n }, (_, i) => makeAttachment({ id: `att-${i + 1}` }));

async function mount(item: Partial<Item>, index: number | null = null) {
  const { el } = await mountComponent<HVLightbox>(
    'hv-lightbox',
    { item: makeItem(item), media: makeMediaBindings(), index },
    { renders: 2 },
  );
  return el;
}

const panel = (el: HVLightbox) => q(el, '[data-testid="lightbox"]');
const shown = (el: HVLightbox) => (q(el, 'img') as HTMLImageElement | null)?.getAttribute('alt');
const counter = (el: HVLightbox) => q(el, '[data-testid="lightbox-counter"]')?.textContent?.trim();

const press = async (el: HVLightbox, key: string) => {
  panel(el)?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await settle(el);
};

const tap = async (el: HVLightbox, testid: string) => {
  (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
  await settle(el);
};

const lightboxCss = () => {
  return componentCss('hv-lightbox');
};

/** Photos at full size, shared by the phone sheet and the edit form's strip. */
describe('hv-lightbox: opening and closing', () => {
  it('draws nothing until a host names a photo', async () => {
    const el = await mount({ id: 'i-1', attachments: shots(2) });
    expect(panel(el)).toBe(null);
  });

  it('opens on the photo it was given', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(3) }, 1);
    expect(panel(el)?.getAttribute('aria-label')).toBe('Drill — photo 2 of 3');
    expect(shown(el)).toBe('Drill — photo 2 of 3');
  });

  it.each(['close button', 'backdrop', 'escape'] as const)('reports a close from the %s', async (how) => {
    const el = await mount({ id: 'i-1', attachments: shots(2) }, 0);
    let closes = 0;
    el.addEventListener('close', () => {
      closes += 1;
    });

    if (how === 'close button') q(el, '[data-testid="lightbox-close"]')?.click();
    else if (how === 'backdrop') panel(el)?.click();
    else await press(el, 'Escape');
    await el.updateComplete;

    expect(closes).toBe(1);
    expect(panel(el)).toBe(null);
  });

  // The surface under it closes on Escape too; without stopping the event the
  // photo and the whole item would go at once.
  it('keeps the closing Escape to itself', async () => {
    const el = await mount({ id: 'i-1', attachments: shots(2) }, 0);
    let escaped = 0;
    const count = () => {
      escaped += 1;
    };
    document.addEventListener('keydown', count);
    try {
      await press(el, 'Escape');
      expect(escaped).toBe(0);
    } finally {
      document.removeEventListener('keydown', count);
    }
  });

  // The URL is signed over the connection, so the update that opens this draws
  // nothing at all; focus has to land once the photo is there. Waiting for one
  // update only would compare a null panel against a null activeElement and
  // pass while nothing was focused.
  it('takes focus so Escape reaches it, and hands it back on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const el = await mount({ id: 'i-1', attachments: shots(2) });
    el.index = 0;
    await settle(el);
    expect(panel(el)).not.toBe(null);
    expect(el.shadowRoot?.activeElement).toBe(panel(el));

    await press(el, 'Escape');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // Focus was on the panel that has just gone, so the browser drops it on
  // <body> — outside whatever surface is still on screen, and out of reach of
  // its Escape. Only the host knows where it belongs instead.
  it('asks the host where focus goes when the opener went with the photo', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(1) }, 0);
    let rescued = 0;
    el.onOpenerGone = () => {
      rescued += 1;
    };

    // The photo and the thumbnail that opened it go together.
    opener.remove();
    el.item = makeItem({ id: 'i-1', name: 'Drill', attachments: [] });
    await settle(el);

    expect(panel(el)).toBe(null);
    expect(rescued).toBe(1);
  });

  // Setting a cover or removing another photo re-broadcasts the same item; the
  // photo on screen has no reason to go with it.
  it('survives a same-item refresh, and falls back when the strip shrinks', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', version: 3, attachments: shots(2) }, 1);

    el.item = makeItem({ id: 'i-1', name: 'Drill', version: 4, attachments: shots(2) });
    await settle(el);
    expect(shown(el)).toBe('Drill — photo 2 of 2');

    el.item = makeItem({ id: 'i-1', name: 'Drill', version: 5, attachments: shots(1) });
    await settle(el);
    expect(shown(el)).toBe('Photo of Drill');
  });
});

describe('hv-lightbox: navigation', () => {
  it('counts the photo out of the strip it belongs to', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(3) }, 1);
    expect(counter(el)).toBe('2 of 3');
    // Announced rather than only drawn: the dialog's label changes with the
    // photo, and a changed label is not re-read.
    expect(q(el, '[data-testid="lightbox-counter"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('steps forward and back from the tap-edge buttons', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(3) }, 0);

    await tap(el, 'lightbox-next');
    expect(shown(el)).toBe('Drill — photo 2 of 3');

    await tap(el, 'lightbox-prev');
    expect(shown(el)).toBe('Drill — photo 1 of 3');
  });

  it('wraps at both ends rather than stopping', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(3) }, 0);

    await tap(el, 'lightbox-prev');
    expect(shown(el)).toBe('Drill — photo 3 of 3');

    await tap(el, 'lightbox-next');
    expect(shown(el)).toBe('Drill — photo 1 of 3');
  });

  // The next photo's URL is signed over the connection, so there is an update
  // with nothing to draw. Standing the surface down for it would flash the page
  // underneath and drop focus on <body>, which takes Escape with it.
  it('stays up, and keeps focus, while the next photo is still being signed', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(3) }, 0);
    const before = panel(el);

    (q(el, '[data-testid="lightbox-next"]') as HTMLButtonElement).click();
    await el.updateComplete; // the signature has not come back yet

    expect(panel(el)).toBe(before);
    expect(el.shadowRoot?.activeElement).toBe(before);
    expect(q(el, 'img')).toBe(null);

    await settle(el);
    expect(shown(el)).toBe('Drill — photo 2 of 3');
    expect(panel(el)).toBe(before);
  });

  it('does not close when a nav button is pressed', async () => {
    const el = await mount({ id: 'i-1', attachments: shots(3) }, 0);
    let closes = 0;
    el.addEventListener('close', () => {
      closes += 1;
    });

    await tap(el, 'lightbox-next');

    expect(panel(el)).toBeTruthy();
    expect(closes).toBe(0);
  });

  it('moves with the arrow keys', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(3) }, 0);

    await press(el, 'ArrowRight');
    expect(shown(el)).toBe('Drill — photo 2 of 3');
    await press(el, 'ArrowLeft');
    expect(shown(el)).toBe('Drill — photo 1 of 3');
  });

  it('offers no navigation for a single photo', async () => {
    const el = await mount({ id: 'i-1', attachments: shots(1) }, 0);
    expect(q(el, '[data-testid="lightbox-prev"]')).toBe(null);
    expect(q(el, '[data-testid="lightbox-next"]')).toBe(null);
    expect(q(el, '[data-testid="lightbox-counter"]')).toBe(null);
  });

  it('still closes on Escape with the navigation on screen', async () => {
    const el = await mount({ id: 'i-1', attachments: shots(3) }, 1);
    await press(el, 'Escape');
    expect(panel(el)).toBe(null);
  });
});

// The chrome floats on the photo, so a white frame is the worst case its scrim
// has to survive: the counter is 13px text and wants 4.5:1 against whatever it
// lands on, which the chevrons beside it do not.
describe('hv-lightbox: chrome over any photo', () => {
  it('keeps the controls readable over a white photo', () => {
    const alpha = Number(/--hv-lightbox-scrim: rgba\(0, 0, 0, ([\d.]+)\)/.exec(lightboxCss())?.[1]);
    expect(alpha).toBeGreaterThan(0);

    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    // The scrim over a pure white frame, which is what the white ink sits on.
    const backing = channel(255 * (1 - alpha));
    expect(1.05 / (backing + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('backs every control with that one scrim', () => {
    const css = lightboxCss();
    for (const selector of ['\\.lightbox \\.close', '\\.lightbox \\.nav', '\\.lightbox \\.counter']) {
      const rule = new RegExp(`${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(rule).toContain('background: var(--hv-lightbox-scrim)');
    }
  });

  // Fixed to the viewport from inside whatever opened it — a bottom sheet, an
  // expanded view — so it has to stack above that rather than inside it.
  it('takes a stacking layer of its own when it opens', async () => {
    const el = await mount({ id: 'i-1', attachments: shots(1) }, 0);
    expect(Number(panel(el)?.style.zIndex)).toBeGreaterThan(0);
  });
});

/**
 * The tiles that open this refuse to open a picture whose file is gone, so this
 * covers the file that goes missing while the photo is on screen — and any host
 * that opens the lightbox by index without looking.
 */
describe('hv-lightbox: a picture whose file is gone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function failed(probe: () => unknown) {
    vi.stubGlobal('fetch', probe);
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots(1) }, 0);
    q(el, 'img')?.dispatchEvent(new Event('error'));
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await settle(el);
    }
    return el;
  }

  it('says the file is missing rather than filling the frame with a broken glyph', async () => {
    const el = await failed(vi.fn(async () => new Response(null, { status: 404 })));

    expect(q(el, '[data-testid="lightbox-missing"]')?.textContent).toContain('File missing');
    expect(q(el, 'img')).toBeNull();
    // Still a dialog: closing it is how the user gets back, and the controls
    // that do that are outside the frame.
    expect(panel(el)).toBeTruthy();
    expect(q(el, '[data-testid="lightbox-close"]')).toBeTruthy();
  });

  it('keeps the photo when the probe cannot say the file is gone', async () => {
    const el = await failed(
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    expect(q(el, '[data-testid="lightbox-missing"]')).toBeNull();
    expect(shown(el)).toBe('Photo of Drill');
  });
});
