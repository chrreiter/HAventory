import { describe, expect, it } from 'vitest';
import type { StatusDefinition } from '../store/types';
import {
  BUILT_IN_STATUSES,
  DEFAULT_STATUS,
  itemStatus,
  statusIconName,
  statusLabel,
  statusList,
  statusToneClass,
} from './status';

const CUSTOM: StatusDefinition[] = [
  { slug: 'ok', label: 'Fine', order: 0, color: 'green', icon: 'check' },
  { slug: 'lent_out', label: 'Lent out', order: 1, color: 'blue_strong', icon: 'hand' },
];

describe('ui/status: the vocabulary', () => {
  it('falls back to the built-ins until the backend has answered', () => {
    expect(statusList(null)).toBe(BUILT_IN_STATUSES);
    expect(statusList(undefined)).toBe(BUILT_IN_STATUSES);
    expect(statusList([])).toBe(BUILT_IN_STATUSES);
  });

  it('prefers the backend copy even for the built-in slugs', () => {
    // A household can rename "OK"; the local copy must not win over that.
    expect(statusLabel('ok', CUSTOM)).toBe('Fine');
  });

  it('reads an absent status as the default', () => {
    expect(itemStatus({ status: undefined })).toBe(DEFAULT_STATUS);
    expect(itemStatus({ status: 'lent_out' })).toBe('lent_out');
  });
});

describe('ui/status: rendering a slug', () => {
  it('labels a custom status from the definitions', () => {
    expect(statusLabel('lent_out', CUSTOM)).toBe('Lent out');
  });

  // Reachable today: an import can define a status, and another client can
  // create one after this card last read haventory/config.
  it('falls back to the slug for a status it has not been told about', () => {
    expect(statusLabel('mystery', CUSTOM)).toBe('mystery');
    expect(statusLabel('mystery', null)).toBe('mystery');
  });

  it('maps a stored colour onto the chip modifier, underscores and all', () => {
    expect(statusToneClass('lent_out', CUSTOM)).toBe('tone-blue-strong');
    expect(statusToneClass('ok', CUSTOM)).toBe('tone-green');
  });

  it('paints an unknown slug neutral rather than leaving it unstyled', () => {
    expect(statusToneClass('mystery', CUSTOM)).toBe('tone-neutral');
  });

  it('resolves a glyph the bundle carries', () => {
    expect(statusIconName('lent_out', CUSTOM)).toBe('hand');
  });

  it('returns null for a glyph the bundle does not carry', () => {
    // The chip keeps its label and colour; only the mark is missing.
    const exotic: StatusDefinition[] = [
      { slug: 'x', label: 'X', order: 0, color: 'red', icon: 'not-a-glyph' },
    ];
    expect(statusIconName('x', exotic)).toBeNull();
    expect(statusIconName('mystery', CUSTOM)).toBeNull();
  });
});
