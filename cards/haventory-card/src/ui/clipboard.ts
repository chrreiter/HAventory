import { css } from 'lit';
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Copying one short string, on the installs Home Assistant actually runs on.
 *
 * `navigator.clipboard` is exposed only in a secure context, and a Home
 * Assistant reached over plain `http://` on the LAN is not one — which is most
 * installs. So the async API is tried first and a detached `<textarea>` plus
 * the deprecated `document.execCommand('copy')` stands behind it: on those
 * browsers it is the only route there is.
 *
 * The boolean is the whole contract. A caller may say "Copied" only when this
 * returns `true`; announcing a copy that never happened names whatever was on
 * the clipboard before, which is worse than announcing nothing and leaving the
 * value on screen to be selected by hand.
 */
/**
 * How long a copy button says "Copied" before it offers the copy again.
 *
 * The label has to come back: left standing it reads as the name of what the
 * button does, and the next copy then looks like a press that did nothing.
 */
export const COPIED_MS = 2000;

export async function copyText(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // A denied permission, a document the browser does not consider focused,
      // or an API present but refused outside a secure context. Every one of
      // them still leaves the selection route below open.
    }
  }
  return selectionCopy(text);
}

/**
 * The pre-`navigator.clipboard` route: put the text somewhere selectable,
 * select it, and ask the document to copy the selection.
 *
 * Off-screen rather than hidden — `display: none` and `visibility: hidden` are
 * both unselectable, and a selection is the only thing `execCommand` can copy.
 * `readonly` keeps a mobile keyboard from opening over the surface that asked.
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
    // Selecting moved the caret out of the surface that asked for the copy;
    // inside a dialog that would drop focus on the document body, where Escape
    // no longer reaches the thing the user is looking at.
    previous?.focus?.();
  }
}

/**
 * What a "Copy" button knows: whether it has just copied, for as long as it may
 * say so.
 *
 * The flash is raised only on a copy the browser confirmed — the button is the
 * only feedback there is, so it must not announce a clipboard that still holds
 * something else. It belongs to the id it was raised on rather than to the
 * surface: a surface that moves to another id, or closes over the one it was
 * showing, calls {@link reset}, and disconnecting does it too.
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
    // A second copy inside the window starts the window again, rather than
    // reverting the label part-way through it on the first one's timer.
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
    // Nothing to redraw for a button already offering the copy — this runs on
    // every move to another id, not only on the ones that had copied.
    if (!this.flashing) return;
    this.flashing = false;
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    this.reset();
  }
}

/**
 * An id printed in full beside the button that copies it.
 *
 * The id is not read, it is pasted: `user-select: all` takes the whole uuid
 * from a single click or long-press, which is the copy route left when the
 * browser has no clipboard API. A uuid carries no space to break at, so it is
 * allowed to break anywhere rather than push the button out of its row.
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
