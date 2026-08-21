import { describe, expect, it } from 'vitest';
import { chip } from './chip';

import '../components/hv-card-shell';
import '../components/hv-chip-input';
import '../components/hv-data-table';
import '../components/hv-detail-sheet';
import '../components/hv-filter-chips';
import '../components/hv-filter-panel';
import '../components/hv-full-view';
import '../components/hv-item-editor';
import '../components/hv-list-row';
import '../components/hv-location-tree';
import '../components/hv-organize-dialog';
import { sheetsOf } from '../test.utils';

/** Every surface that marks something with a chip. */
const CHIPPED = [
  'hv-card-shell',
  'hv-chip-input',
  'hv-data-table',
  'hv-detail-sheet',
  'hv-filter-chips',
  'hv-filter-panel',
  'hv-full-view',
  'hv-item-editor',
  'hv-list-row',
  'hv-location-tree',
  'hv-organize-dialog',
];

describe('ui/chip: the shared fragment', () => {
  it('reaches every surface that draws a chip', () => {
    for (const tag of CHIPPED) {
      expect(sheetsOf(tag), tag).toContain(chip);
    }
  });

});
