/**
 * Everything this card asks of Home Assistant, in one file.
 *
 * The rest of the card does not talk to Home Assistant. It renders its own
 * elements, styles them from its own `--hv-*` tokens, and reaches the backend
 * through the client in `store/ws`, which reaches Home Assistant through the
 * two functions below. So when an upgrade breaks the card, this is the file to
 * open: whatever moved is named here or the card was not using it.
 *
 * The whole surface:
 *
 * | what | why it is safe to depend on |
 * | --- | --- |
 * | `hass.callWS` | the frontend's own command channel, unchanged for years |
 * | `hass.language` | the user's profile language, read once to pick a dictionary |
 * | `hass.connection.subscribeMessage` | the same channel's subscription half |
 * | `hass.fetchWithAuth` | the only way to POST attachment bytes to core's `/api/file_upload` |
 * | `window.customCards` | how every custom card has advertised itself to the picker |
 * | `setConfig` / the `hass` setter | the Lovelace card lifecycle itself |
 * | the theme variables below | read with a fallback each, so a rename costs the binding and not the card |
 *
 * And one row that is deliberately empty:
 *
 * **The card renders no `ha-*` element.** Home Assistant's frontend components
 * — `ha-form`, `ha-dialog`, `ha-selector`, `ha-data-table` — are registered
 * lazily inside HA's own bundle, are not published for card authors to import,
 * and are not versioned. A card that renders one depends on an internal that
 * moves, and it breaks after an upgrade rather than in CI: `ha-form` does not
 * exist in jsdom, so the unit suite would stay green while the card was broken
 * in the browser. Every glyph the card draws is inlined in `ui/icons` and
 * `ui/brand-icon` for the same reason, which also makes icons assertable in
 * Vitest. `ha-contract.test.ts` sweeps the sources and fails on a match, and
 * `CONTRIBUTING.md` carries the rule.
 */

import type { AnyEventPayload, Unsubscribe } from './store/types';

export type { Unsubscribe };

/**
 * The part of the `hass` object this card uses, structurally: HA publishes no
 * package a card can depend on, and a field the card never reads cannot break it.
 */
export interface HassLike {
  /** Resolves to the `result` part of the answer. */
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  /** A BCP-47 tag; absent before the profile loads, which resolves to English. */
  language?: string;
  /** `fetch` with the user's auth header, for POSTing attachment bytes. */
  fetchWithAuth?(path: string, init?: RequestInit): Promise<Response>;
  connection: {
    /**
     * Delivers the inner `event` of the `{id, type:'event', event}` frame, not
     * the envelope; `e2e/live-updates.smoke.mjs` checks that against a real HA.
     */
    subscribeMessage(
      cb: (event: AnyEventPayload) => void,
      msg: Record<string, unknown>,
    ): Unsubscribe | Promise<Unsubscribe>;
    /**
     * `disconnected` fires when the socket closes; `ready` once it is back and
     * HA has re-issued the subscriptions it was holding.
     */
    addEventListener?(event: 'ready' | 'disconnected', cb: () => void): void;
    removeEventListener?(event: 'ready' | 'disconnected', cb: () => void): void;
  };
}

/** Send one command over Home Assistant's WebSocket and take its `result`. */
export function callWS<T>(hass: HassLike, msg: Record<string, unknown>): Promise<T> {
  return hass.callWS<T>(msg);
}

/** Open one subscription; HA answers with the unsubscribe function or a promise of one. */
export function subscribeMessage(
  hass: HassLike,
  cb: (event: AnyEventPayload) => void,
  msg: Record<string, unknown>,
): Unsubscribe | Promise<Unsubscribe> {
  return hass.connection.subscribeMessage(cb, msg);
}

/** One entry in Home Assistant's card picker. */
export interface CustomCardMeta {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  /** The picker entry's "documentation" link. */
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardMeta[];
  }
}

/**
 * Advertise a card to HA's picker. The list is shared with every custom card,
 * and the bundle can be evaluated twice on one page, so an entry is added once.
 */
export function registerCustomCard(meta: CustomCardMeta): void {
  if (typeof window === 'undefined') return;
  window.customCards = window.customCards || [];
  if (window.customCards.some((c) => c?.type === meta.type)) return;
  window.customCards.push(meta);
}

/**
 * The HA theme variables the card binds, each read with a fallback so a rename
 * costs that binding only. `ha-contract.test.ts` fails on any other `var(--…)`
 * that is not one of the card's own `--hv-*`.
 */
export const HA_THEME_VARS = [
  // Surfaces, text, lines and the accent, bound in `ui/tokens`.
  '--card-background-color',
  '--ha-card-background',
  '--primary-background-color',
  '--primary-text-color',
  '--secondary-text-color',
  '--text-primary-color',
  '--divider-color',
  '--primary-color',
  '--error-color',
  '--input-fill-color',
  // Shape and type, so the card sits in a theme's own card geometry.
  '--ha-card-border-radius',
  '--ha-card-font-family',
  '--paper-font-body1_-_font-family',
  // The card's and the panel's own body type.
  '--mdc-typography-body2-font-size',
  '--mdc-typography-body2-line-height',
] as const;

/** The surface variables, most specific first: `--hv-surface` binds them and `ui/theme` reads them back. */
export const SURFACE_VARS = [
  '--card-background-color',
  '--ha-card-background',
  '--primary-background-color',
] as const;
