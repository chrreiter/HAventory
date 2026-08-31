import { DialogFocus, deepActiveElement, deepFocusables, focusStranded } from './dialog-focus';

function panel(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  document.body.appendChild(el);
  return el;
}

describe('deepActiveElement', () => {
  it('returns the focused element in the document', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    expect(deepActiveElement()).toBe(btn);
    btn.remove();
  });

  it('descends into shadow roots to find the real target', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('button');
    root.appendChild(inner);
    inner.focus();
    expect(deepActiveElement()).toBe(inner);
    host.remove();
  });
});

describe('DialogFocus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus into the surface when it opens', () => {
    const p = panel();
    new DialogFocus().sync(true, () => p);
    expect(document.activeElement).toBe(p);
  });

  it('makes the surface programmatically focusable without stealing tab order', () => {
    const p = panel();
    new DialogFocus().sync(true, () => p);
    expect(p.getAttribute('tabindex')).toBe('-1');
  });

  it('leaves an author-supplied tabindex alone', () => {
    const p = panel();
    p.setAttribute('tabindex', '0');
    new DialogFocus().sync(true, () => p);
    expect(p.getAttribute('tabindex')).toBe('0');
  });

  it('only focuses on the open transition, not on every render', () => {
    const p = panel();
    const other = document.createElement('button');
    document.body.appendChild(other);
    const f = new DialogFocus();

    f.sync(true, () => p);
    other.focus(); // the user tabs somewhere inside
    f.sync(true, () => p); // a re-render must not yank focus back
    expect(document.activeElement).toBe(other);
  });

  it('hands focus back to the opener when the surface closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const p = panel();
    const f = new DialogFocus();
    f.sync(true, () => p);
    expect(document.activeElement).toBe(p);

    f.sync(false, () => p);
    expect(document.activeElement).toBe(trigger);
  });

  it('survives a surface that has not rendered yet', () => {
    const f = new DialogFocus();
    expect(() => f.sync(true, () => null)).not.toThrow();
    // and still restores on close
    expect(() => f.sync(false, () => null)).not.toThrow();
  });

  // A surface whose content arrives over the connection draws nothing on the
  // update that opened it — the lightbox has no image URL until the signature
  // comes back. Focus has to land when the panel appears, not be given up on.
  it('waits for a surface that appears an update later', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const f = new DialogFocus();
    let p: HTMLElement | null = null;
    f.sync(true, () => p);
    expect(document.activeElement).toBe(trigger);

    p = panel();
    f.sync(true, () => p);
    expect(document.activeElement).toBe(p);

    f.sync(false, () => p);
    expect(document.activeElement).toBe(trigger);
  });

  // The opener is read on the first "open", so one that never drew must not
  // leave it behind for whatever opens next.
  it('forgets the opener of a surface that closed before it drew', () => {
    const first = document.createElement('button');
    const second = document.createElement('button');
    document.body.append(first, second);

    const f = new DialogFocus();
    first.focus();
    f.sync(true, () => null);
    f.sync(false, () => null);

    second.focus();
    const p = panel();
    f.sync(true, () => p);
    expect(document.activeElement).toBe(p);
    f.sync(false, () => p);
    expect(document.activeElement).toBe(second);
  });

  it('does nothing while the surface stays closed', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    const f = new DialogFocus();
    f.sync(false, () => panel());
    expect(document.activeElement).toBe(btn);
  });

  // A surface can close because the thing that opened it was deleted. Focus is
  // on the panel being removed, so leaving it there drops it on <body>.
  it('asks the caller where focus goes when the opener is gone', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const p = panel();
    const f = new DialogFocus();
    f.sync(true, () => p);

    trigger.remove();
    p.remove();
    const rescue = vi.fn();
    f.sync(false, () => p, rescue);
    expect(rescue).toHaveBeenCalledOnce();
  });

  it('leaves the fallback alone when the opener is still there', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const p = panel();
    const f = new DialogFocus();
    f.sync(true, () => p);

    const rescue = vi.fn();
    f.sync(false, () => p, rescue);
    expect(document.activeElement).toBe(trigger);
    expect(rescue).not.toHaveBeenCalled();
  });

  // A hover-revealed opener is still connected but no longer drawn once the
  // pointer sits on the dialog it opened, and a real browser silently refuses
  // to focus it. jsdom performs no layout and accepts any focus, so the
  // refusal is modelled by stubbing the opener's `focus`.
  it('rescues focus when a connected opener refuses the return', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const p = panel();
    const f = new DialogFocus();
    f.sync(true, () => p);

    trigger.focus = () => undefined;
    p.remove();
    const rescue = vi.fn();
    f.sync(false, () => p, rescue);
    expect(rescue).toHaveBeenCalledOnce();
  });

  it('leaves a refused return alone when the user already moved on', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const p = panel();
    const f = new DialogFocus();
    f.sync(true, () => p);

    trigger.focus = () => undefined;
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    const rescue = vi.fn();
    f.sync(false, () => p, rescue);
    expect(rescue).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(elsewhere);
  });

  // Closing a dialog whose opener is gone is not on its own a reason to move
  // focus: the user may already be typing somewhere else entirely.
  it('does not yank focus away from wherever it already went', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const p = panel();
    const f = new DialogFocus();
    f.sync(true, () => p);

    trigger.remove();
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    const rescue = vi.fn();
    f.sync(false, () => p, rescue);
    expect(rescue).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('deepFocusables', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** `<button id>` per label; `host:<id>` opens a shadow root for what follows. */
  function build(spec: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = spec;
    document.body.appendChild(root);
    for (const host of [...root.querySelectorAll('[data-shadow]')]) {
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = host.getAttribute('data-shadow') ?? '';
    }
    return root;
  }

  const ids = (root: HTMLElement) => deepFocusables(root).map((el) => el.id);

  it('finds the controls a flat query stops at the shadow boundary of', () => {
    const root = build(`<button id="a"></button><div data-shadow="<button id='b'></button>"></div>`);
    expect(root.querySelectorAll('button')).toHaveLength(1);
    expect(ids(root)).toEqual(['a', 'b']);
  });

  it('keeps tab order, so first and last are the ends of the trap', () => {
    const root = build(`
      <button id="a"></button>
      <div data-shadow="<button id='b'></button><button id='c'></button>"></div>
      <button id="d"></button>
    `);
    expect(ids(root)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nests through as many roots as it takes', () => {
    // The sidebar tree draws its rows inside a component that the full view
    // draws inside another one; one level of descent is not enough.
    const root = document.createElement('div');
    document.body.appendChild(root);
    let node: HTMLElement = root;
    for (let depth = 0; depth < 3; depth++) {
      const host = document.createElement('div');
      node.appendChild(host);
      node = document.createElement('div');
      host.attachShadow({ mode: 'open' }).appendChild(node);
    }
    node.appendChild(Object.assign(document.createElement('button'), { id: 'deep' }));
    expect(ids(root)).toEqual(['deep']);
  });

  it('takes a host element and the content slotted into it', () => {
    // The full view's table renders its rows itself and takes its empty state
    // as light DOM, so a walk that stopped at either would miss half the trap.
    const root = build(`<div data-shadow="<button id='own'></button><slot></slot>">
      <button id="slotted"></button>
    </div>`);
    expect(ids(root)).toEqual(['own', 'slotted']);
  });

  it('leaves out light DOM that no slot is showing', () => {
    // The expanded view hands its whole empty state to the table as light DOM,
    // and the table only slots it in when it has no rows. Written but not
    // rendered is not focusable, and a trap that ended on a Clear all button
    // parked beside 50 rows would be pointing at nothing on screen.
    const root = build(`<div data-shadow="<button id='own'></button>">
      <button id="unslotted"></button>
    </div>`);
    expect(ids(root)).toEqual(['own']);
  });

  it('leaves out what the tab key would skip', () => {
    const root = build(`
      <button id="a"></button>
      <button id="off" disabled></button>
      <button id="untabbable" tabindex="-1"></button>
      <span id="spanner"></span>
      <div hidden><button id="collapsed"></button></div>
      <div aria-hidden="true"><button id="masked"></button></div>
      <span id="tabbable" tabindex="0"></span>
    `);
    expect(ids(root)).toEqual(['a', 'tabbable']);
  });

  it('leaves out what the browser is not drawing', () => {
    // The table's row actions sit in the layout at `visibility: hidden` until
    // their row is hovered or focused, and `.focus()` on one is a silent no-op
    // — a trap ending there leaves focus on its sentinel and never wraps.
    // jsdom lays nothing out and implements no `checkVisibility`, so the two
    // states have to be stood in for.
    const root = build(`<button id="drawn"></button><button id="painted-over"></button>`);
    const hidden = root.querySelector('#painted-over') as HTMLElement & { checkVisibility: () => boolean };
    hidden.checkVisibility = () => false;
    expect(ids(root)).toEqual(['drawn']);
  });

  it('takes everything when the browser cannot be asked', () => {
    // Without a layout there is no answer to give, and treating every control
    // as drawn is what a plain `querySelectorAll` would have said anyway.
    const root = build(`<button id="a"></button>`);
    expect('checkVisibility' in (root.querySelector('#a') as HTMLElement)).toBe(false);
    expect(ids(root)).toEqual(['a']);
  });

  it('survives a surface that has not rendered yet', () => {
    expect(deepFocusables(null)).toEqual([]);
    expect(deepFocusables(undefined)).toEqual([]);
  });
});

describe('focusStranded', () => {
  it('says nothing is stranded while a real control holds focus', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    expect(focusStranded()).toBe(false);
    btn.remove();
  });

  // What the browser does when the element holding focus leaves the document:
  // it drops focus on the body, out of reach of whatever is still on screen.
  it('sees focus dropped on the document when its holder goes', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    btn.remove();
    expect(focusStranded()).toBe(true);
  });
});
