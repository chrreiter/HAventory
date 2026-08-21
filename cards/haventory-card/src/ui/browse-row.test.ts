import { describe, expect, it } from 'vitest';
import { browseRow } from './browse-row';

import '../components/hv-full-view';
import '../components/hv-location-tree';
import { sheetsOf } from '../test.utils';

/**
 * The two shadow roots that draw a row you browse by. They render one under the
 * other in the sidebar's single column, so the metrics have to come from the
 * one fragment rather than being written out on each side — which is how they
 * drifted 4px of height and 22px of label inset apart.
 */
const BROWSERS = ['hv-full-view', 'hv-location-tree'];

describe('ui/browse-row: one row in two shadow roots', () => {
  it('reaches both roots that draw one', () => {
    for (const tag of BROWSERS) expect(sheetsOf(tag), tag).toContain(browseRow);
  });

});
