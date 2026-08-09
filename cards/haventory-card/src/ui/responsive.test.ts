import { MOBILE_BREAKPOINT, NARROW_QUERY, ResponsiveController } from './responsive';

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

  it('honours a forced mode and restores measurement when cleared', () => {
    const host = makeHost();
    const c = new ResponsiveController(host as never);
    c.setWidth(900);

    c.setForced(true);
    expect(c.mobile).toBe(true);
    expect(host.updates).toBe(1);

    c.setForced(true); // idempotent
    expect(host.updates).toBe(1);

    c.setForced(null);
    expect(c.mobile).toBe(false);
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
