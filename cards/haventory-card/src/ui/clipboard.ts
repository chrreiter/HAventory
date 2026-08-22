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
