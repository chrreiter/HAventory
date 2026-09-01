import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { COPIED_MS, CopyFlash, copyText } from './clipboard';

/**
 * jsdom ships neither half of the browser's clipboard: `navigator.clipboard` is
 * absent and `document.execCommand` is unimplemented. So each case installs the
 * shape it is about and the teardown takes it away again — which also makes the
 * bare environment the honest "no clipboard at all" case.
 */
function withClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: spy },
    configurable: true,
  });
  return spy;
}

function withExecCommand(result: boolean) {
  const selected: string[] = [];
  const spy = vi.fn((command: string) => {
    // What the browser copies is the current selection, so the value under test
    // is the one on the element this helper put in the document — not the
    // argument, which is only ever the word "copy".
    if (command === 'copy') selected.push(document.querySelector('textarea')?.value ?? '');
    return result;
  });
  Object.defineProperty(document, 'execCommand', { value: spy, configurable: true });
  return { spy, selected };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

describe('copyText', () => {
  it('writes through the async clipboard where there is one', async () => {
    const writeText = withClipboard(async () => undefined);
    const { spy } = withExecCommand(true);

    expect(await copyText('0f2c-4a11')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('0f2c-4a11');
    // The deprecated path steals the selection and moves focus; it is the
    // fallback, not a belt-and-braces second write.
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when the async API refuses', async () => {
    // The refusal every install over plain http:// hits, plus a denied
    // permission and an unfocused document: all of them land here.
    withClipboard(async () => {
      throw new Error('NotAllowedError');
    });
    const { selected } = withExecCommand(true);

    expect(await copyText('0f2c-4a11')).toBe(true);
    expect(selected).toEqual(['0f2c-4a11']);
  });

  it('falls back when the browser exposes no async clipboard at all', async () => {
    const { selected } = withExecCommand(true);

    expect(await copyText('shelf-b')).toBe(true);
    expect(selected).toEqual(['shelf-b']);
  });

  it('reports failure when neither route exists', async () => {
    // A caller that says "Copied" here would be naming whatever was on the
    // clipboard before, which is worse than saying nothing.
    expect(await copyText('shelf-b')).toBe(false);
  });

  it('reports failure when execCommand declines the copy', async () => {
    withExecCommand(false);

    expect(await copyText('shelf-b')).toBe(false);
  });

  it('leaves nothing of its own in the document', async () => {
    withExecCommand(true);

    await copyText('shelf-b');
    expect(document.querySelector('textarea')).toBe(null);
  });

  it('gives focus back to whatever had it', async () => {
    withExecCommand(true);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    await copyText('shelf-b');
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

/**
 * The half of a Lit host a controller reaches for: it collects what is added to
 * it, counts the redraws it is asked for, and disconnects the way
 * `ReactiveElement` does.
 */
class Host implements ReactiveControllerHost {
  readonly controllers: ReactiveController[] = [];
  updates = 0;

  addController(controller: ReactiveController): void {
    this.controllers.push(controller);
  }

  removeController(controller: ReactiveController): void {
    const at = this.controllers.indexOf(controller);
    if (at >= 0) this.controllers.splice(at, 1);
  }

  requestUpdate(): void {
    this.updates += 1;
  }

  get updateComplete(): Promise<boolean> {
    return Promise.resolve(true);
  }

  disconnect(): void {
    for (const controller of [...this.controllers]) controller.hostDisconnected?.();
  }
}

describe('CopyFlash', () => {
  it('offers the copy until one has happened', () => {
    expect(new CopyFlash(new Host()).copied).toBe(false);
  });

  it('says so once the copy is confirmed, and asks its host to draw it', async () => {
    withClipboard(async () => undefined);
    const host = new Host();
    const flash = new CopyFlash(host);

    await flash.copy('shelf-b');

    expect(flash.copied).toBe(true);
    expect(host.updates).toBe(1);
  });

  // Home Assistant on the LAN over plain http:// is not a secure context, and
  // an old browser there has no fallback either. "Copied" would name whatever
  // was on the clipboard before, so the value stays on screen and unclaimed.
  it('claims nothing when neither route copied it', async () => {
    const host = new Host();
    const flash = new CopyFlash(host);

    await flash.copy('shelf-b');

    expect(flash.copied).toBe(false);
    expect(host.updates).toBe(0);
  });

  it('goes back to offering the copy a couple of seconds later', async () => {
    withClipboard(async () => undefined);
    const flash = new CopyFlash(new Host());
    vi.useFakeTimers();
    try {
      await flash.copy('shelf-b');
      await vi.advanceTimersByTimeAsync(COPIED_MS - 1);
      expect(flash.copied).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      expect(flash.copied).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a second copy a window of its own', async () => {
    withClipboard(async () => undefined);
    const flash = new CopyFlash(new Host());
    vi.useFakeTimers();
    try {
      await flash.copy('shelf-b');
      await vi.advanceTimersByTimeAsync(COPIED_MS - 1);
      await flash.copy('shelf-b');

      // The first copy's timer would land here, on a label the second one put
      // up a moment ago.
      await vi.advanceTimersByTimeAsync(1);
      expect(flash.copied).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the label back when the surface moves to another id', async () => {
    withClipboard(async () => undefined);
    const host = new Host();
    const flash = new CopyFlash(host);
    await flash.copy('shelf-b');

    flash.reset();

    expect(flash.copied).toBe(false);
    expect(host.updates).toBe(2);
  });

  it('asks for nothing when there was no label to take back', () => {
    const host = new Host();
    new CopyFlash(host).reset();

    expect(host.updates).toBe(0);
  });

  it('leaves no timer behind on a host that went away', async () => {
    withClipboard(async () => undefined);
    const host = new Host();
    const flash = new CopyFlash(host);
    vi.useFakeTimers();
    try {
      await flash.copy('shelf-b');
      host.disconnect();
      expect(flash.copied).toBe(false);

      const asked = host.updates;
      await vi.advanceTimersByTimeAsync(COPIED_MS);
      expect(host.updates).toBe(asked);
    } finally {
      vi.useRealTimers();
    }
  });
});
