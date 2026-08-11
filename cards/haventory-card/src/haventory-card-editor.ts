import { LitElement, css, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { tokens, base } from './ui/tokens';
import { defineCardElement } from './register';
import type { HassLike } from './store/types';

/** What the card reads plus whatever else the dashboard wrote. */
export interface HAventoryCardConfig {
  type: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * One field. `setConfig` on the card reads `title` and `quick_filters`, and the
 * pill choice belongs to the integration's options flow instead — the sidebar
 * panel has no dashboard config at all, so a card editor could never reach it.
 */
const SCHEMA = [{ name: 'title', selector: { text: {} } }];

/**
 * The visual editor Home Assistant opens from the card picker.
 *
 * `ha-form` rather than a local input: it is the frontend's own control, so it
 * takes the dashboard's theming and its layout without this card re-deriving
 * either. The element is not defined here — HA defines it — so nothing in this
 * module may depend on it existing.
 *
 * Registered through `defineCardElement` rather than the decorator the `hv-*`
 * components use, because HA instantiates this element by tag name after the
 * frontend has swapped `window.customElements`. See `register.ts`.
 */
export class HAventoryCardEditor extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property({ attribute: false }) hass?: HassLike;

  @state() private _config: HAventoryCardConfig = { type: 'custom:haventory-card' };

  /** Lovelace hands the whole card config in, including keys the card ignores. */
  public setConfig(config: HAventoryCardConfig): void {
    this._config = { ...config };
  }

  render() {
    return html`<ha-form
      data-testid="card-editor-form"
      .hass=${this.hass}
      .data=${this._config}
      .schema=${SCHEMA}
      .computeLabel=${this._label}
      @value-changed=${this._onValueChanged}
    ></ha-form>`;
  }

  private _label(): string {
    return 'Title';
  }

  /**
   * Spread the existing config rather than rebuilding it: the card ignores
   * unknown keys instead of rejecting them, so a dashboard's `quick_filters` —
   * or a key from a version this build has never seen — has to survive a trip
   * through this form untouched.
   *
   * An emptied title is dropped rather than written as "", which is what hands
   * the heading back to the integration-wide option.
   */
  private _onValueChanged(event: CustomEvent<{ value?: { title?: unknown } }>): void {
    event.stopPropagation();
    const title = event.detail?.value?.title;
    const config: HAventoryCardConfig = { ...this._config };
    if (typeof title === 'string' && title.trim() !== '') config.title = title;
    else delete config.title;

    this._config = config;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

defineCardElement('haventory-card-editor', HAventoryCardEditor);
