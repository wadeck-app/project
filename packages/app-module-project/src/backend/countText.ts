import type { RelatedPanel } from '@wadeck-app/project-sdk';

/**
 * The Count column of the Related table. A count means something only with its label ("3 open"). Without a label the provider's `count` is
 * ambiguous (flow and queue send what needs attention while `items` are the recent history), so it is never shown: the number of items is,
 * "recent" when a link to the full list tells that they are a window onto it.
 */
export function countTextOf(panel: Pick<RelatedPanel, 'items'> & Partial<RelatedPanel>): string {
  const shown = panel.items.length;
  if (panel.countLabel !== undefined) {
    return `${panel.count ?? shown} ${panel.countLabel}`;
  }
  if (shown === 0) {
    return 'none';
  }
  const recent = panel.moreUrl === undefined ? '' : 'recent ';
  return `${shown} ${recent}${shown === 1 ? 'item' : 'items'}`;
}
