/**
 * 프레임 지문 (SCENARIO.md §5.13 (E) 부분 렌더).
 *
 * "이 프레임이 지난번과 같은가"를 문자열 하나로 답한다. 같으면 그때 그린 그림을 다시
 * 쓰고, 다르면 다시 그린다. 4분짜리에서 자막 한 줄을 고쳤을 때 4분을 다시 기다리지
 * 않게 하는 장치다.
 *
 * 지문에 무엇을 넣는지가 전부다 — 적게 넣으면 바뀐 프레임을 재사용해 **엉뚱한 그림이
 * 조용히 나오고**, 많이 넣으면 안 바뀐 프레임까지 다시 그려 캐시가 무의미해진다.
 * 그래서 "그 시각에 실제로 그려지는 것"만 정확히 넣는다.
 */

import { hashItem, stableHash } from '../hashItem.js';
import type { ResolvedTimeline, VideoDoc } from '../types.js';
import { buildDrawList } from './drawList.js';

/**
 * 시각 t 프레임의 지문.
 *
 * 아이템의 선언 해시에 더해 **그 아이템의 지역 프레임 번호**를 넣는다. 같은 씬이라도
 * 시작한 지 3프레임째와 40프레임째는 다른 그림이기 때문이다. 절대 시각이 아니라
 * 지역 프레임을 쓰므로, 아이템을 통째로 뒤로 밀어도 캐시가 그대로 산다.
 */
export function frameSignature(doc: VideoDoc, timeline: ResolvedTimeline, t: number, fps: number): string {
  const ops = buildDrawList(doc, timeline, t);
  if (ops.length === 0) return stableHash(`empty|${doc.size.width}x${doc.size.height}`);

  const parts = ops.map((op) => {
    const itemHash = hashItem(op.resolved.item, doc.assets, op.resolved.duration);
    const localFrame = Math.round(op.localTime * fps);
    // 자막은 같은 아이템 안에서도 지금 보이는 줄이 달라진다.
    const cueKey = op.cues.length === 0 ? '' : op.cues.map((c) => `${c.start}:${c.text}`).join('|');
    return `${op.z}:${op.itemId}:${itemHash}:${localFrame}:${cueKey}`;
  });

  return stableHash(`${doc.size.width}x${doc.size.height}@${fps}|${parts.join(';')}`);
}

/**
 * 문서 전체의 프레임 수.
 *
 * 마지막 프레임을 잃지 않도록 올림한다 — 내림하면 끝부분이 잘려 나가고, 그건 렌더가
 * 끝난 뒤에야 알아채는 종류의 손실이다.
 */
export function totalFrames(durationSec: number, fps: number): number {
  if (durationSec <= 0 || fps <= 0) return 0;
  return Math.max(1, Math.ceil(durationSec * fps));
}
