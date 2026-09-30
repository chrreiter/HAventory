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
 * The visual editor HA opens from the card picker: one title field, the card's
 * own input rather than `ha-form` (see `ha-contract`). The pill choice belongs
 * to the integration's options flow, which the sidebar panel also reads.
 * Registered through `defineCardElement` because HA creates it by tag name
 * after swapping `window.customElements`.
 */
export class HAventoryCardEditor extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      /* The gap HA's own editor dialog stacks its rows with. */
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

  /** `hass` is a plain property here, so the language is picked up on its update. */
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
   * Spread the existing config so keys this form does not edit survive. An
   * emptied title is dropped, handing the heading back to the integration.
   */
  private _onInput(event: Event): void {
    const title = (event.target as HTMLInputElement).value;
    const config: HAventoryCardConfig = { ...this._config };
    if (title.trim() !== '') config.title = title;
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
