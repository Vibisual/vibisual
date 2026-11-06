import { localLinkTargets, type SubAgentStreamEvent } from '@vibisual/shared';
import { codexImageBasename, isCodexImageFile } from './codexStreamMap.js';

/** Only explicit local raster links in assistant prose; never tool output or code examples. */
export function linkedImageEvents(event: SubAgentStreamEvent, platform: NodeJS.Platform): SubAgentStreamEvent[] {
  if (event.eventType !== 'text' || event.imagePath || typeof event.content !== 'string') return [];
  // The image route opens absolute paths only; relative links stay links (they still become canvas bubbles).
  const paths = localLinkTargets(event.content, platform)
    .filter((target) => !target.relative && isCodexImageFile(target.path))
    .map((target) => target.path);
  return paths.map((imagePath, i) => ({
    ...event, id: `${event.id}:image:${i}`, content: codexImageBasename(imagePath), imagePath,
  }));
}

/** Read-time recovery also handles conversations saved before linked images were supported. */
export function restoreLinkedImages(events: SubAgentStreamEvent[], platform: NodeJS.Platform): SubAgentStreamEvent[] {
  const ids = new Set(events.map((event) => event.id));
  return events.flatMap((event) => [event, ...linkedImageEvents(event, platform).filter((image) => !ids.has(image.id))]);
}
