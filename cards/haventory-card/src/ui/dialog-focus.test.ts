import { DialogFocus, deepActiveElement, deepFocusables } from './dialog-focus';

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

  it('does nothing while the surface stays closed', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    const f = new DialogFocus();
    f.sync(false, () => panel());
    expect(document.activeElement).toBe(btn);
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
