import { DialogFocus, deepActiveElement } from './dialog-focus';

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
