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
 * The part of the `hass` object this card uses, structurally.
 *
 * Structural rather than an import of Home Assistant's own type: the frontend
 * publishes no package a card can depend on, and naming only what is used means
 * a field the card never reads cannot break it.
 */
export interface HassLike {
  /** Home Assistant's `callWS` returns the `result` part of the message. */
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  /**
   * The language the user reads Home Assistant in, as a BCP-47 tag (`de`,
   * `de-CH`, `en-GB`). Optional because this interface is structural and
   * because a `hass` object handed over before the profile has loaded may not
   * carry one yet; the card resolves anything it cannot answer to English.
   */
  language?: string;
  /**
   * `fetch` with the user's auth header attached — the only way to POST to
   * core's `/api/file_upload`, which is how attachment bytes reach the server
   * without crossing the WebSocket. Optional because this interface is
   * structural: a caller that never uploads need not provide it.
   */
  fetchWithAuth?(path: string, init?: RequestInit): Promise<Response>;
  connection: {
    /**
     * Home Assistant delivers the *inner* event payload to the callback (the
     * `event` field of the `{id, type:'event', event}` wire frame), not the
     * whole envelope. A mock that delivered the envelope once kept the unit
     * suite green while the card had stopped reflecting live changes, which is
     * why `e2e/live-updates.smoke.mjs` exists.
     */
    subscribeMessage(
      cb: (event: AnyEventPayload) => void,
      msg: Record<string, unknown>,
    ): Unsubscribe | Promise<Unsubscribe>;
    /**
     * Connection lifecycle. `disconnected` fires when the socket closes, before
     * Home Assistant starts reconnecting; `ready` fires once it is back and HA
     * has re-issued the subscriptions it was holding, so a listener runs with
     * the watches already live again. Optional because the interface is
     * structural: a caller may pass a connection that only sends messages.
     */
    addEventListener?(event: 'ready' | 'disconnected', cb: () => void): void;
    removeEventListener?(event: 'ready' | 'disconnected', cb: () => void): void;
  };
}

/** Send one command over Home Assistant's WebSocket and take its `result`. */
export function callWS<T>(hass: HassLike, msg: Record<string, unknown>): Promise<T> {
  return hass.callWS<T>(msg);
}

/**
 * Open one subscription over the same socket.
 *
 * Home Assistant returns either the unsubscribe function or a promise of one,
 * depending on how far the connection has got, so the caller has to handle both
 * — this hands back exactly what HA gave rather than papering over it, since a
 * component that awaited unconditionally would leak a subscription it never
 * managed to close.
 */
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
 * Advertise a card to Home Assistant's picker.
 *
 * The list is shared with every other custom card on the instance, so it is
 * appended to rather than replaced, and an entry is added only once — the
 * bundle can be evaluated twice on one page, and a second entry would show the
 * card twice in the picker.
 *
 * Does nothing outside a browser, so importing the bundle in a test or a build
 * step is not a registration.
 */
export function registerCustomCard(meta: CustomCardMeta): void {
  if (typeof window === 'undefined') return;
  window.customCards = window.customCards || [];
  if (window.customCards.some((c) => c?.type === meta.type)) return;
  window.customCards.push(meta);
}

/**
 * The Home Assistant theme variables the card binds, and the only ones.
 *
 * Every one is read with a fallback of its own, so a variable Home Assistant
 * renames costs that binding and not the card — the token falls back to its
 * literal and the card keeps its own palette. That is the whole reason this
 * list can be a note rather than a worry.
 *
 * `ha-contract.test.ts` sweeps every source file for a `var(--…)` that is not
 * one of the card's own `--hv-*`, so a binding added anywhere without a line
 * here fails rather than going unrecorded.
 */
export const HA_THEME_VARS = [
  // Surfaces, text, lines and the accent — bound in `ui/tokens`, one `--hv-*`
  // token each.
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
  // The two the card and the sidebar panel set their own body type from, so a
  // host page's text metrics do not decide the card's.
  '--mdc-typography-body2-font-size',
  '--mdc-typography-body2-line-height',
] as const;

/**
 * The subset that describes the surface the card is drawn on, most specific
 * first — the ones `--hv-surface` binds to, and the ones `ui/theme` reads back
 * to decide which `color-scheme` the card is living in.
 */
export const SURFACE_VARS = [
  '--card-background-color',
  '--ha-card-background',
  '--primary-background-color',
] as const;
