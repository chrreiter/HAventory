import { describe, it, expect } from 'vitest';
import { editorErrorText } from './editor-error';
import type { ErrorEntry } from '../store/types';

const entry = (patch: Partial<ErrorEntry>): ErrorEntry => ({
  id: 'e1',
  code: 'storage_error',
  message: 'the store is read-only',
  ...patch,
});

describe('editorErrorText', () => {
  it('passes an ordinary failure through in the words the store used', () => {
    expect(editorErrorText(entry({}))).toBe('the store is read-only');
  });

  // A conflict's own message names version numbers, which say nothing to
  // someone looking at a form; the banner already frames the case in words.
  it('reframes a conflict without naming versions', () => {
    const text = editorErrorText(
      entry({ kind: 'conflict', code: 'conflict', message: 'version conflict: expected 1, actual 2' }),
    );
    expect(text).toBe('Someone else changed this item.');
    expect(text).not.toMatch(/\d/);
  });
});
