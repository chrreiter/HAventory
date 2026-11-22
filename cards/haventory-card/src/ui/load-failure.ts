import { css, html } from 'lit';
import type { TemplateResult } from 'lit';
import { loaderText } from '../i18n/loader-copy';

/**
 * What a placeholder's body holds once the runtime's import has failed: a line
 * saying so, and a button that reloads the page, which is what brings an entry
 * and the chunks it names back together after an upgrade under an open tab.
 * Both hosts draw it, from the core chunk alone, so it is not focused for the
 * user: a dashboard's focus stays where it was, and the button is the next stop.
 *
 * The button draws `.hv-pill`'s primary shape itself, since that rule is in
 * the runtime's `base` sheet.
 */
export const loadFailureStyles = css`
  .load-failed {
    box-sizing: border-box;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 12px;
    height: 100%;
    padding: 16px;
    text-align: center;
  }
  .load-failed-headline {
    font-size: 14px;
    font-weight: 500;
  }
  .load-failed-reload {
    min-height: 36px;
    padding: 7px 14px;
    border: none;
    border-radius: 999px;
    background: var(--hv-primary);
    color: var(--hv-text-on-primary);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .load-failed-reload:hover {
    opacity: 0.9;
  }
  .load-failed-reload:focus-visible {
    outline: 2px solid var(--hv-primary);
    outline-offset: 2px;
  }
`;

/** The failure's line and its reload button, in the language `language` resolves to. */
export function renderLoadFailure(language: string | undefined, onReload: () => void): TemplateResult {
  return html`<div class="load-failed" role="alert">
    <span class="load-failed-headline" data-testid="placeholder-load-failed">
      ${loaderText('hv.loader.failed', language)}
    </span>
    <button type="button" class="load-failed-reload" data-testid="placeholder-reload" @click=${onReload}>
      ${loaderText('hv.loader.reload', language)}
    </button>
  </div>`;
}
