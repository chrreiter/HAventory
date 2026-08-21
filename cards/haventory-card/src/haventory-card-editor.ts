import { LitElement, css, html } from 'lit';
import type { PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { setLanguage, t } from './i18n';
import { tokens, base } from './ui/tokens';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import { defineCardElement } from './register';
import type { HassLike } from './store/types';

/** What the card reads plus whatever else the dashboard wrote. */
export interface HAventoryCardConfig {
  type: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * The visual editor Home Assistant opens from the card picker.
 *
 * One field. `setConfig` on the card reads `title` and `quick_filters`, and the
 * pill choice belongs to the integration's options flow instead — the sidebar
 * panel has no dashboard config at all, so a card editor could never reach it.
 *
 * The field is the card's own input rather than Home Assistant's `ha-form`.
 * That control is registered lazily inside HA's bundle, is not published for
 * card authors and is not versioned, so a card that renders it depends on an
 * internal that moves — and does not exist in jsdom, which means the break
 * would arrive as a user report after an upgrade rather than as a red test.
 * `ha-contract` states that rule for the whole card and `ha-contract.test.ts`
 * holds it at zero. The card's own tokens bind the dashboard's theme variables,
 * so a local field still takes the theme it is opened inside.
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
      /* HA's own editor dialog stacks its rows with this much between them, so
         a card editor that grows a second field sits in the same rhythm. */
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    `,
  ];

  @property({ attribute: false }) hass?: HassLike;

  @state() private _config: HAventoryCardConfig = { type: 'custom:haventory-card' };

  /** Lovelace hands the whole card config in, including keys the card ignores. */
  public setConfig(config: HAventoryCardConfig): void {
    this._config = { ...config };
  }

  /**
   * Home Assistant sets `hass` as a plain property here rather than through the
   * setter the card and the panel have, so the language is picked up on the
   * update it arrives on.
   */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('hass')) setLanguage(this.hass?.language);
  }

  render() {
    return html`<div class="field" data-testid="card-editor-form">
      <label class="hv-label" for="card-editor-title">${t('hv.cardEditor.title')}</label>
      <input
        id="card-editor-title"
        class="hv-input"
        type="text"
        data-testid="card-editor-title"
        .value=${typeof this._config.title === 'string' ? this._config.title : ''}
        placeholder=${DEFAULT_CARD_TITLE}
        @input=${this._onInput}
      />
    </div>`;
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
  private _onInput(event: Event): void {
    const title = (event.target as HTMLInputElement).value;
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
