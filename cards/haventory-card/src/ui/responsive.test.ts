import { MOBILE_BREAKPOINT, NARROW_QUERY, ResponsiveController, ViewportNarrow } from './responsive';

function makeHost() {
  const el = document.createElement('div') as HTMLDivElement & {
    addController: (c: unknown) => void;
    requestUpdate: () => void;
    updates: number;
  };
  el.updates = 0;
  el.addController = () => undefined;
  el.requestUpdate = () => {
    el.updates += 1;
  };
  return el;
}

describe('ResponsiveController', () => {
  it('is desktop until a width has been measured', () => {
    const host = makeHost();
    const c = new ResponsiveController(host as never);
    expect(c.mobile).toBe(false);
  });

  it('switches on the breakpoint, inclusive', () => {
    const host = makeHost();
    const c = new ResponsiveController(host as never);

    c.setWidth(MOBILE_BREAKPOINT + 1);
    expect(c.mobile).toBe(false);

    c.setWidth(MOBILE_BREAKPOINT);
    expect(c.mobile).toBe(true);

    c.setWidth(320);
    expect(c.mobile).toBe(true);
  });

  it('only re-renders the host when the mode actually flips', () => {
    const host = makeHost();
    const c = new ResponsiveController(host as never);

    c.setWidth(900);
    expect(host.updates).toBe(0); // still desktop
    c.setWidth(400);
    expect(host.updates).toBe(1); // desktop → mobile
    c.setWidth(380);
    expect(host.updates).toBe(1); // still mobile
    c.setWidth(800);
    expect(host.updates).toBe(2); // mobile → desktop
  });

  it('accepts a custom breakpoint', () => {
    const host = makeHost();
    const c = new ResponsiveController(host as never, 420);
    c.setWidth(500);
    expect(c.mobile).toBe(false);
    c.setWidth(420);
    expect(c.mobile).toBe(true);
  });
});

// Two breakpoints, two questions: the card's own width decides in-card layout,
// the viewport decides what an overlay does. Feeding the card measurement to a
// dialog is what put the full-bleed organize page on a desktop monitor.
describe('NARROW_QUERY', () => {
  it('is a viewport query, distinct from the card-element breakpoint', () => {
    expect(NARROW_QUERY).toBe('(max-width: 700px)');
    expect(NARROW_QUERY).not.toContain(String(MOBILE_BREAKPOINT));
  });
});

describe('ViewportNarrow', () => {
  /** A matchMedia whose answer the test can change and then announce. */
  function stub(initial: boolean) {
    const listeners: ((e: MediaQueryListEvent) => void)[] = [];
    const original = window.matchMedia;
    let asked: string | null = null;
    window.matchMedia = ((media: string) => {
      asked = media;
      return {
        matches: initial,
        media,
        addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.push(fn),
        removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
          const at = listeners.indexOf(fn);
          if (at >= 0) listeners.splice(at, 1);
        },
      };
    }) as unknown as typeof window.matchMedia;
    return {
      get query() {
        return asked;
      },
      get listeners() {
        return listeners.length;
      },
      announce(matches: boolean) {
        for (const fn of [...listeners]) fn({ matches } as MediaQueryListEvent);
      },
      restore: () => {
        window.matchMedia = original;
      },
    };
  }

  it('reads the viewport query on connect and re-renders on a change', () => {
    const media = stub(true);
    try {
      const host = makeHost();
      const c = new ViewportNarrow(host as never);
      expect(c.narrow).toBe(false); // nothing asked until the host connects

      c.hostConnected();
      expect(media.query).toBe(NARROW_QUERY);
      expect(c.narrow).toBe(true);

      media.announce(false);
      expect(c.narrow).toBe(false);
      expect(host.updates).toBe(1);

      c.hostDisconnected();
      expect(media.listeners).toBe(0);
    } finally {
      media.restore();
    }
  });

  // jsdom answers no media query, and a host that cannot say how wide the window
  // is has no business claiming it is a phone.
  it('stays on the desktop answer when matchMedia is missing', () => {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: undefined }).matchMedia = undefined;
    try {
      const c = new ViewportNarrow(makeHost() as never);
      c.hostConnected();
      expect(c.narrow).toBe(false);
      expect(() => c.hostDisconnected()).not.toThrow();
    } finally {
      window.matchMedia = original;
    }
  });
});
