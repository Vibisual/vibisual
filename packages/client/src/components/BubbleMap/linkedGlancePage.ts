import type { AppBubblePastFile } from '@vibisual/shared';
import type { AppLinkedItem } from '../../apps/registry.js';

export const LINKED_GLANCE_PAGE_SIZE = 6;
export type LinkedGlanceGroup = 'scene' | 'part' | 'past';

interface LinkedGlancePage {
  group: LinkedGlanceGroup;
  groups: { group: LinkedGlanceGroup; count: number }[];
  items: readonly AppLinkedItem[];
  past: readonly AppBubblePastFile[];
  total: number;
  page: number;
  pages: number;
}

export function linkedGlancePage(items: readonly AppLinkedItem[], past: readonly AppBubblePastFile[], requested: LinkedGlanceGroup, requestedPage: number): LinkedGlancePage {
  const scenes = items.filter((item) => item.group === 'scene');
  const parts = items.filter((item) => item.group === 'part');
  const groups: LinkedGlancePage['groups'] = [
    { group: 'scene', count: scenes.length }, { group: 'part', count: parts.length }, { group: 'past', count: past.length },
  ];
  const available = groups.filter((entry) => entry.count > 0);
  const group = available.find((entry) => entry.group === requested)?.group ?? available[0]?.group ?? 'scene';
  const source = group === 'scene' ? scenes : group === 'part' ? parts : [];
  const count = group === 'past' ? past.length : source.length;
  const pages = Math.max(1, Math.ceil(count / LINKED_GLANCE_PAGE_SIZE));
  const page = group !== requested ? 0 : Math.max(0, Math.min(pages - 1, Math.floor(requestedPage) || 0));
  const start = page * LINKED_GLANCE_PAGE_SIZE;
  return { group, groups: available, total: items.length + past.length, page, pages,
    items: source.slice(start, start + LINKED_GLANCE_PAGE_SIZE),
    past: group === 'past' ? past.slice(start, start + LINKED_GLANCE_PAGE_SIZE) : [] };
}
