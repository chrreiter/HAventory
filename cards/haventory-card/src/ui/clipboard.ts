import { css } from 'lit';
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** How long a copy button says "Copied" before it offers the copy again. */
export const COPIED_MS = 2000;

/**
 * Copy one short string; `true` only when it got there, so a caller never
 * announces a copy that did not happen. `navigator.clipboard` needs a secure
 * context, which a HA reached over plain `http://` is not, so `execCommand`
 * stands behind it.
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Denied or refused; the selection route below may still work.
    }
  }
  return selectionCopy(text);
}

/**
 * Select the text in an off-screen `<textarea>` (a hidden one is unselectable)
 * and copy the selection; `readonly` keeps a mobile keyboard closed.
 */
function selectionCopy(text: string): boolean {
  const exec = (document as Document & { execCommand?: (command: string) => boolean }).execCommand;
  if (typeof exec !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  const previous = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return exec.call(document, 'copy');
  } catch {
    return false;
  } finally {
    area.remove();
    // Selecting took focus; inside a dialog Escape would no longer reach it.
    previous?.focus?.();
  }
}

/**
 * Whether a "Copy" button has just copied, for `COPIED_MS`. It belongs to the id
 * it was raised on: a surface that moves to another id calls {@link reset}.
 *
 * Usage: `private readonly _copyFlash = new CopyFlash(this);`, then
 * `.copy(id)` from the button and `.copied` in its label.
 */
export class CopyFlash implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private timer?: ReturnType<typeof setTimeout>;
  private flashing = false;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  /** True while the button says "Copied" rather than offering the copy. */
  get copied(): boolean {
    return this.flashing;
  }

  /** Put `text` on the clipboard, and say so only if it got there. */
  async copy(text: string): Promise<void> {
    if (!(await copyText(text))) return;
    // A second copy restarts the window.
    clearTimeout(this.timer);
    this.flashing = true;
    this.host.requestUpdate();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flashing = false;
      this.host.requestUpdate();
    }, COPIED_MS);
  }

  /** Back to offering the copy, and nothing left running. */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.flashing) return;
    this.flashing = false;
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    this.reset();
  }
}

/**
 * An id printed in full beside the button that copies it. `user-select: all`
 * takes the whole uuid in one click when there is no clipboard API, and it may
 * break anywhere rather than push the button out of its row.
 *
 * Usage: `static styles = [tokens, base, idRow, css\`...\`]`, with `id-row` on
 * the row, a `<code>` for the id and a text button beside it.
 */
export const idRow = css`
  .id-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .id-row code {
    min-width: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    color: var(--hv-text-secondary);
    overflow-wrap: anywhere;
    -webkit-user-select: all;
    user-select: all;
  }
`;
