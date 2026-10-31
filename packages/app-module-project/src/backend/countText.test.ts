import { describe, expect, it } from 'vitest';
import { countTextOf } from './countText.js';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `i${i}`, url: `/modules/x/${i}` }));

describe('countTextOf (what the Related table shows in the Count column)', () => {
  it('writes the count with its label when the provider gives one: "3 open"', () => {
    expect(countTextOf({ title: 'T', count: 3, countLabel: 'open', items: items(1) })).toBe('3 open');
  });

  it('a label without a count counts the items it has', () => {
    expect(countTextOf({ title: 'T', countLabel: 'open', items: items(2) })).toBe('2 open');
  });

  it('without a label, shows the number of items, never the bare count', () => {
    expect(countTextOf({ title: 'T', count: 0, items: items(10) })).toBe('10 items');
    expect(countTextOf({ title: 'T', items: items(4) })).toBe('4 items');
  });

  it('says "recent" when there is a link to the full list (the items are a window onto it)', () => {
    expect(countTextOf({ title: 'T', count: 0, items: items(10), moreUrl: '/modules/flow/executions?project=1' })).toBe('10 recent items');
  });

  it('does not show a count without a label that differs from the number of items: it is ambiguous (flow and queue send what needs attention)', () => {
    expect(countTextOf({ title: 'T', count: 51, items: items(10) })).toBe('10 items');
    expect(countTextOf({ title: 'T', count: 0, items: items(3) })).toBe('3 items');
  });

  it('a count without a label that equals the number of items is the same thing as the number of items', () => {
    expect(countTextOf({ title: 'T', count: 6, items: items(6) })).toBe('6 items');
  });

  it('uses the singular for one item, and says "none" for no item', () => {
    expect(countTextOf({ title: 'T', items: items(1) })).toBe('1 item');
    expect(countTextOf({ title: 'T', items: items(1), moreUrl: '/modules/x' })).toBe('1 recent item');
    expect(countTextOf({ title: 'T', count: 0, items: [] })).toBe('none');
    expect(countTextOf({ title: 'T', count: 0, countLabel: 'open', items: [] })).toBe('0 open');
  });
});
