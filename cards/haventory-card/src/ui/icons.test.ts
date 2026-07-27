import { render } from 'lit';
import { ICONS, icon } from './icons';

function renderIcon(...args: Parameters<typeof icon>) {
  const host = document.createElement('div');
  render(icon(...args), host);
  return host.querySelector('svg') as SVGElement;
}

describe('icons', () => {
  it('every glyph carries usable path data', () => {
    const names = Object.keys(ICONS) as (keyof typeof ICONS)[];
    expect(names.length).toBeGreaterThan(25);
    for (const name of names) {
      const d = ICONS[name];
      expect(d.startsWith('M'), `${name} should start with a moveto`).toBe(true);
      expect(d.length, `${name} should be real path data`).toBeGreaterThan(10);
    }
  });

  it('renders an inline svg that inherits colour and is decorative by default', () => {
    const svg = renderIcon('plus');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('aria-label')).toBe(false);
    expect(svg.getAttribute('data-icon')).toBe('plus');
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(ICONS.plus);
  });

  it('honours the requested size', () => {
    const svg = renderIcon('magnify', 34);
    expect(svg.getAttribute('width')).toBe('34');
    expect(svg.getAttribute('height')).toBe('34');
  });

  it('becomes an accessible image when given a label', () => {
    const svg = renderIcon('alert', 18, 'Low stock');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-hidden')).toBe('false');
    expect(svg.getAttribute('aria-label')).toBe('Low stock');
  });
});
