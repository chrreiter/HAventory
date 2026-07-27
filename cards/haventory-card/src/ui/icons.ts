import { html, svg } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';

/**
 * Material Design Icons path data, inlined.
 *
 * The design handoff specifies `<ha-icon icon="mdi:…">`, but `ha-icon` only
 * resolves inside the Home Assistant frontend: in Vitest/jsdom it is an
 * unresolved custom element that renders nothing, and it leaves the card
 * silently icon-less anywhere HA has not loaded its icon set. Inlining the
 * ~30 glyphs the design uses keeps the same artwork, renders everywhere and
 * is assertable in tests, at a cost of well under 3 kB.
 *
 * Path data is Material Design Icons (Pictogrammers), Apache License 2.0 —
 * the same licence as this repository.
 */
export const ICONS = {
  plus: 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z',
  minus: 'M19,13H5V11H19V13Z',
  close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
  check: 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z',
  checkCircle: 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M10,17L5,12L6.41,10.58L10,14.17L17.59,6.58L19,8L10,17Z',
  chevronDown: 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z',
  chevronRight: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z',
  chevronUp: 'M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z',
  dotsVertical: 'M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z',
  magnify: 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
  tune: 'M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z',
  arrowExpand: 'M10,21V19H6.41L10.91,14.5L9.5,13.09L5,17.59V14H3V21H10M14.5,10.91L19,6.41V10H21V3H14V5H17.59L13.09,9.5L14.5,10.91Z',
  openInNew: 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z',
  pencil: 'M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z',
  del: 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z',
  mapMarker: 'M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z',
  calendar: 'M19,19H5V8H19M16,1V3H8V1H6V3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3H18V1',
  account: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z',
  home: 'M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z',
  alert: 'M13,14H11V9H13M13,18H11V16H13M1,21H23L12,2L1,21Z',
  alertCircle: 'M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z',
  viewColumn: 'M4,5V19H8V5H4M10,5V19H14V5H10M16,5V19H20V5H16Z',
  download: 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z',
  upload: 'M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z',
  refresh: 'M17.65,6.35A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 19.73,14H17.65A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z',
  callMerge: 'M17,20.41L18.41,19L15,15.59L13.59,17M7.5,8H11V13.59L5.59,19L7,20.41L13,14.41V8H16.5L12,3.5',
  arrowLeft: 'M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z',
  arrowRight: 'M4,11V13H16L10.5,18.5L11.92,19.92L19.84,12L11.92,4.08L10.5,5.5L16,11H4Z',
  select: 'M9,9H15V15H9M11,7H13V9H11M9,17H15V19H9M17,9H19V15H17M5,9H7V15H5M11,17H13V19H11M11,3H13V5H11Z',
  wifiOff: 'M2.28,3L1,4.27L2.47,5.74C1.53,6.5 0.72,7.43 0,8.5C3,12.11 6.6,14 12,14C13.16,14 14.25,13.9 15.28,13.71L17.5,15.93L18.78,14.66L2.28,3M12,10C9.79,10 8,8.21 8,6C8,5.72 8.03,5.45 8.08,5.19L12.81,9.92C12.55,9.97 12.28,10 12,10Z',
  clock: 'M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12.5,7H11V13L15.75,15.85L16.5,14.62L12.5,12.25V7Z',
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Render an MDI glyph as an inline SVG sized `size` px, inheriting the current
 * text colour. Decorative by default — pass a `label` only when the icon is the
 * sole content of an interactive element that has no other accessible name.
 */
export function icon(name: IconName, size = 18, label?: string): TemplateResult {
  const path = ICONS[name];
  return html`<svg
    class="hv-icon"
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    part="icon"
    fill="currentColor"
    aria-hidden=${label ? 'false' : 'true'}
    role=${label ? 'img' : 'presentation'}
    aria-label=${ifDefined(label)}
    data-icon=${name}
  >
    ${svg`<path d=${path}></path>`}
  </svg>`;
}
