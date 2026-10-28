/**
 * §5.5 #17-13 ⑤-3 — CLI 가 한 쌍으로 보내는 `task_started`·`task_notification` 을 시작 줄 하나로 접는다(이름은 시작, 결과·소요는 끝).
 * 시작 줄 id·자리를 그대로 써 키가 안 흔들린다. Sub 탭·메인 탭이 같은 함수를 쓰고, 모양이 달라 읽기·쓰기를 인자로 받는다.
 */
import {
  parseSystemSubtype,
  parseSystemTaskInfo,
  formatSystemChip,
  foldTaskBookend,
  TASK_CHIP_START_SUBTYPE,
  TASK_CHIP_END_SUBTYPE,
  type StreamTaskInfo,
} from '@vibisual/shared';

/**
 * 작업 칩의 시작·끝을 한 줄로 접는다.
 *
 * @param items    표시 직전의 아이템 배열.
 * @param readChip system 칩이면 그 content 문자열, 아니면 null(= 접기 대상 아님).
 * @param writeChip 합쳐진 content 로 갈아 끼운 **새 아이템**을 만든다(원본을 변형하지 말 것).
 * @returns 접을 게 없으면 입력 배열 **그대로**(참조 보존 — 불필요한 재렌더 방지).
 */
export function foldTaskChips<T>(
  items: T[],
  readChip: (item: T) => string | null,
  writeChip: (item: T, content: string) => T,
): T[] {
  // 1) 어느 자리가 시작/끝 칩인지 훑는다. payload 없는 옛 칩(`[task_started]`)은 접을 근거가 없어 건너뛴다.
  const chips = new Array<{ subtype: string; info: StreamTaskInfo } | null>(items.length).fill(null);
  const startsById = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    const content = readChip(items[i]!);
    if (content === null) continue;
    const subtype = parseSystemSubtype(content);
    if (subtype !== TASK_CHIP_START_SUBTYPE && subtype !== TASK_CHIP_END_SUBTYPE) continue;
    const info = parseSystemTaskInfo(content);
    if (!info) continue;
    chips[i] = { subtype, info };
    if (subtype !== TASK_CHIP_START_SUBTYPE) continue;
    const seen = startsById.get(info.id);
    if (seen) seen.push(i);
    else startsById.set(info.id, [i]);
  }

  // 2) 끝 칩마다 **앞쪽의 아직 안 쓰인 가장 이른 시작**과 짝짓는다(같은 id 가 재사용돼도 뒤엉키지 않게).
  const foldedInto = new Map<number, StreamTaskInfo>();
  const removed = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const chip = chips[i];
    if (!chip || chip.subtype !== TASK_CHIP_END_SUBTYPE) continue;
    const waiting = startsById.get(chip.info.id);
    // 짝 없는 끝(시작이 복원 예산 밖으로 밀린 경우)은 홀로 남아 `summary` 를 라벨로 쓴다.
    if (!waiting || waiting.length === 0 || waiting[0]! > i) continue;
    const startIndex = waiting.shift()!;
    foldedInto.set(startIndex, foldTaskBookend(chips[startIndex]!.info, chip.info));
    removed.add(i);
  }

  if (foldedInto.size === 0) return items;

  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (removed.has(i)) continue;
    const merged = foldedInto.get(i);
    out.push(merged ? writeChip(items[i]!, formatSystemChip(TASK_CHIP_START_SUBTYPE, merged)) : items[i]!);
  }
  return out;
}
