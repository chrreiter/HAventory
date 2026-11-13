import { setLanguage } from '../i18n';
import { serverErrorText } from './server-error';

describe('serverErrorText', () => {
  const conflict = {
    code: 'conflict',
    message: 'version conflict: expected 3, actual 4',
    translation_domain: 'haventory',
    translation_key: 'version_conflict',
    translation_placeholders: { expected: '3', actual: '4' },
  };

  it('words a keyed refusal in the language in force, placeholders filled', () => {
    setLanguage('de');
    expect(serverErrorText(conflict, 'fallback')).toBe(
      'Dieser Gegenstand wurde zwischenzeitlich geändert (erwartete Version 3, aktuell 4). ' +
        'Lade ihn neu und wiederhole die Änderung.',
    );
    setLanguage('en');
    expect(serverErrorText(conflict, 'fallback')).toContain('expected version 3, now 4');
  });

  it('shows the server message for a key this catalog does not know, never the key', () => {
    setLanguage('de');
    const err = { message: 'something new', translation_domain: 'haventory', translation_key: 'from_a_newer_build' };
    expect(serverErrorText(err, 'fallback')).toBe('something new');
  });

  it('does not read another integration’s key from this catalog', () => {
    setLanguage('de');
    const err = { message: 'theirs', translation_domain: 'other', translation_key: 'item_not_found' };
    expect(serverErrorText(err, 'fallback')).toBe('theirs');
  });

  it('falls back when the rejection carries neither a key nor a message', () => {
    expect(serverErrorText(new Error(''), 'fallback')).toBe('fallback');
    expect(serverErrorText(undefined, 'fallback')).toBe('fallback');
  });
});
