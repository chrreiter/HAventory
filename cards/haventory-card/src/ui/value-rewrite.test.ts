import { makeItem } from '../test.utils';
import { describeRewrite, filterForValue, rewriteOps } from './value-rewrite';

describe('filterForValue', () => {
  it('finds items by tag or by category', () => {
    expect(filterForValue('tag', 'metric')).toEqual({ tags_any: ['metric'] });
    expect(filterForValue('category', 'Tools')).toEqual({ category: 'Tools' });
  });
});

describe('rewriteOps: tags', () => {
  it('renames a tag in place, keeping the others', () => {
    const items = [makeItem({ id: '1', tags: ['batery', 'aa'], version: 3 })];
    const ops = rewriteOps('tag', items, 'batery', 'battery');

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('item_update');
    expect(ops[0].payload).toMatchObject({ item_id: '1', tags: ['aa', 'battery'], expected_version: 3 });
  });

  it('deduplicates when merging into a tag the item already has', () => {
    const items = [makeItem({ id: '1', tags: ['batery', 'battery'] })];
    expect(rewriteOps('tag', items, 'batery', 'battery')[0].payload.tags).toEqual(['battery']);
  });

  it('drops the tag entirely when the target is null', () => {
    const items = [makeItem({ id: '1', tags: ['metric', 'm4'] })];
    expect(rewriteOps('tag', items, 'metric', null)[0].payload.tags).toEqual(['m4']);
  });

  it('lowercases the new value, matching how the backend stores it', () => {
    const items = [makeItem({ id: '1', tags: ['old'] })];
    expect(rewriteOps('tag', items, 'old', '  NEW  ')[0].payload.tags).toEqual(['new']);
  });

  it('skips an item that does not carry the tag', () => {
    const items = [makeItem({ id: '1', tags: ['other'] })];
    expect(rewriteOps('tag', items, 'metric', 'metrics')).toEqual([]);
  });

  it('produces no operation when nothing would change', () => {
    const items = [makeItem({ id: '1', tags: ['metric'] })];
    expect(rewriteOps('tag', items, 'metric', 'metric')).toEqual([]);
  });

  it('gives every operation a unique id', () => {
    const items = [makeItem({ id: '1', tags: ['a'] }), makeItem({ id: '2', tags: ['a'] })];
    const ops = rewriteOps('tag', items, 'a', 'b');
    expect(new Set(ops.map((o) => o.op_id)).size).toBe(2);
  });
});

describe('rewriteOps: categories', () => {
  it('renames a category and sends the expected version', () => {
    const items = [makeItem({ id: '1', category: 'Tool', version: 7 })];
    const ops = rewriteOps('category', items, 'Tool', 'Tools');
    expect(ops[0].payload).toMatchObject({ item_id: '1', category: 'Tools', expected_version: 7 });
  });

  it('clears the category when the target is null', () => {
    const items = [makeItem({ id: '1', category: 'Tools' })];
    expect(rewriteOps('category', items, 'Tools', null)[0].payload.category).toBe(null);
  });

  it('skips an item already holding the target value', () => {
    const items = [makeItem({ id: '1', category: 'Tools' })];
    expect(rewriteOps('category', items, 'Tools', 'Tools')).toEqual([]);
  });
});

describe('describeRewrite', () => {
  it('says what a tag merge will do, in the words the mock uses', () => {
    expect(describeRewrite('tag', 3, 'batery', 'battery')).toBe('Retags 3 items, then removes "batery".');
    expect(describeRewrite('tag', 1, 'x', 'y')).toContain('1 item,');
  });

  it('says what a removal will do', () => {
    expect(describeRewrite('tag', 5, 'old', null)).toBe('Removes "old" from 5 items.');
    expect(describeRewrite('category', 2, 'Old', null)).toBe('Clears the category on 2 items.');
  });

  it('says what a category rename will do', () => {
    expect(describeRewrite('category', 4, 'Tool', 'Tools')).toBe('Recategorises 4 items as "Tools".');
  });
});
