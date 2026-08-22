import { copyText } from './clipboard';

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
