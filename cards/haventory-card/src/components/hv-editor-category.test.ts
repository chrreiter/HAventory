import { t } from '../i18n';
import './hv-editor-category';
import { all, componentCss, mountComponent, q } from '../test.utils';
import type { HVEditorCategory } from './hv-editor-category';

/**
 * The field as the editor holds it: every `change` is written back as
 * `.value`, which is what the list narrows on.
 */
async function mount(props: Partial<HVEditorCategory> = {}) {
  const { el } = await mountComponent<HVEditorCategory>('hv-editor-category', {
    suggestions: ['Hardware', 'Tools'],
    ...props,
  });
  const changes: string[] = [];
  el.addEventListener('change', (e) => {
    const value = (e as CustomEvent<{ category: string }>).detail.category;
    changes.push(value);
    el.value = value;
  });
  return { el, changes };
}

const input = (el: HVEditorCategory) => q(el, '[data-testid="editor-category"]') as HTMLInputElement;

const options = (el: HVEditorCategory) =>
  all(el, '[data-testid="editor-category-option"]').map((o) => o.dataset.value);

async function type(el: HVEditorCategory, value: string) {
  input(el).value = value;
  input(el).dispatchEvent(new Event('input'));
  await el.updateComplete;
}

async function focusCategory(el: HVEditorCategory) {
  input(el).focus();
  await el.updateComplete;
  return input(el);
}

const key = async (el: HVEditorCategory, k: string) => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
  input(el).dispatchEvent(event);
  await el.updateComplete;
  return event;
};

/**
 * The listbox is the element the combobox names, so it stays put and empties
 * out instead of leaving — shut means hidden with nothing in it, not gone.
 */
function expectListShut(el: HVEditorCategory) {
  const list = q<HTMLElement>(el, '[data-testid="editor-category-list"]');
  expect(list).toBeTruthy();
  expect(list?.hidden).toBe(true);
  expect(list?.children).toHaveLength(0);
}

describe('hv-editor-category', () => {
  // A listbox is announced by its name when focus moves into it, and it has
  // no text of its own to fall back on.
  it('names the listbox and its combobox after the field label', async () => {
    const { el } = await mount();
    const label = el.shadowRoot?.querySelector('label[for="editor-category"]');
    const labelId = label?.id ?? '';

    expect(labelId).not.toBe('');
    expect(label?.textContent?.trim()).toBe(t('hv.field.category'));
    expect(q(el, '[data-testid="editor-category-list"]')?.getAttribute('aria-labelledby')).toBe(labelId);
    expect(input(el).getAttribute('aria-labelledby')).toBe(labelId);
  });

  it('shows every existing category on focus, before a single keystroke', async () => {
    const { el } = await mount();
    expectListShut(el);

    await focusCategory(el);
    expect(options(el)).toEqual(['Hardware', 'Tools']);
    expect(el.open).toBe(true);
  });

  // The list belongs to the field above it, so it opens under that field and
  // pushes the form down, the same disclosure the location tree is. Placed
  // against the viewport it would drift off its own input whenever the
  // surface behind it scrolled.
  it('opens the list in flow under its input, like the location tree', async () => {
    const { el } = await mount();
    await focusCategory(el);

    const list = q(el, '[data-testid="editor-category-list"]');
    expect(list?.classList.contains('floating')).toBe(false);
    expect(list?.getAttribute('style')).toBeNull();

    const css = componentCss('hv-editor-category');
    expect(css).not.toMatch(/position: fixed/);
    expect(css).toMatch(/\.tree-holder,\s*\.list-holder \{[^}]*margin-top: 6px/);
  });

  it('names a listbox that is there whether or not it is showing', async () => {
    const { el } = await mount();
    const id = 'editor-category-list';

    expect(input(el).getAttribute('aria-controls')).toBe(id);
    expect(input(el).getAttribute('aria-expanded')).toBe('false');
    expect(el.shadowRoot?.getElementById(id), 'listbox shut').toBeTruthy();
    expectListShut(el);

    await focusCategory(el);

    expect(input(el).getAttribute('aria-expanded')).toBe('true');
    expect(input(el).getAttribute('aria-controls')).toBe(id);
    const open = el.shadowRoot?.getElementById(id);
    expect(open?.getAttribute('role'), 'the popup itself, not a wrapper').toBe('listbox');
    expect(open?.hidden).toBe(false);
    expect(options(el)).toEqual(['Hardware', 'Tools']);
  });

  it('narrows the list while typing, and reports each keystroke', async () => {
    const { el, changes } = await mount();
    await focusCategory(el);

    await type(el, 'too');
    expect(options(el)).toEqual(['Tools']);
    expect(changes).toEqual(['too']);
  });

  it('reopens the full list from the arrow, whatever is typed', async () => {
    const { el } = await mount();
    await type(el, 'too');
    expect(options(el)).toEqual(['Tools']);

    (q(el, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(options(el)).toEqual(['Hardware', 'Tools']);

    // The same button closes it again.
    (q(el, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expectListShut(el);
  });

  it('sends a picked option and shuts the list', async () => {
    const { el, changes } = await mount();
    await focusCategory(el);

    (all(el, '[data-testid="editor-category-option"]')[1] as HTMLButtonElement).click();
    await el.updateComplete;

    expect(changes).toEqual(['Tools']);
    expect(input(el).value).toBe('Tools');
    expectListShut(el);
  });

  it('picks with the arrows and Enter, and Escape shuts the list and stops there', async () => {
    const { el, changes } = await mount();
    await focusCategory(el);

    await key(el, 'ArrowDown');
    await key(el, 'ArrowDown');
    expect(input(el).getAttribute('aria-activedescendant')).toBe('editor-category-option-1');
    const enter = await key(el, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(changes).toEqual(['Tools']);

    (q(el, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    let heard = 0;
    el.addEventListener('keydown', () => {
      heard += 1;
    });
    await key(el, 'Escape');
    expectListShut(el);
    // Stopped inside, so the form's own Escape does not discard the edit.
    expect(heard).toBe(0);
  });

  // Shut, Escape belongs to the form: it must not be swallowed here.
  it('lets Escape through while the list is shut', async () => {
    const { el } = await mount();
    let heard = 0;
    el.addEventListener('keydown', () => {
      heard += 1;
    });
    const event = await key(el, 'Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toBe(1);
  });

  it('opens on the arrow key from a shut list, with the first option active', async () => {
    const { el } = await mount();
    await key(el, 'ArrowDown');
    expect(el.open).toBe(true);
    expect(input(el).getAttribute('aria-activedescendant')).toBe('editor-category-option-0');
  });

  it('shuts on Tab and on blur, and when the editor asks', async () => {
    const { el } = await mount();
    await focusCategory(el);
    await key(el, 'Tab');
    expectListShut(el);

    await focusCategory(el);
    input(el).blur();
    await el.updateComplete;
    expectListShut(el);

    (q(el, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.open).toBe(true);
    el.close();
    await el.updateComplete;
    expectListShut(el);
  });

  it('says so when what you typed is a brand new category', async () => {
    const { el } = await mount();
    await type(el, 'Camping');
    expect(options(el)).toEqual([]);
    expect(q(el, '[data-testid="editor-category-empty"]')?.textContent).toContain('Camping');
  });

  it('drops the arrow when there is nothing to list yet', async () => {
    const { el } = await mount({ suggestions: [] });
    expect(q(el, '[data-testid="editor-category-toggle"]')).toBe(null);
    await focusCategory(el);
    expectListShut(el);
  });

  it('gives the arrow a finger-sized target on a phone', async () => {
    await mount({ mobile: true });
    expect(componentCss('hv-editor-category')).toMatch(
      /:host\(\[mobile\]\) \.combo-arrow \{[^}]*width: var\(--hv-tap-min, 32px\)/,
    );
  });
});
