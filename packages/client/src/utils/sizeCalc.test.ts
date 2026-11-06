/**
 * §2.3 · §5.1 #2-1 (A) — 파일 지름의 용량 눈금 고정 시험(상대 크기이되 하나가 갑자기 너무 커지지 않게).
 * ① 몇 바이트 차이로 지름이 갈리지 않는다(같은 그림 40장, 실측 184~186B → 같은 지름) ② 큰 파일 하나가 나머지를 누르지 않는다 — 로그 눈금(실측 57MB wav)
 * ③ 같은 크기면 정확히 가운데 · 크기 정보가 없으면 최소 ④ 같은 화면의 원 둘레 파일끼리 범위를 잰다(`withScreenFileRange`, 같은 범위는 같은 객체)
 * ⑤ 묶음 버블은 용량·활동과 무관한 고정 지름 · 폴더 안 `Root→` 는 활동으로 크지 않는다(배치가 같은 자를 쓴다).
 * ⑥ §5.1 「앱 버블 지름」 — 명령 앱은 같은 화면의 앱끼리 사용 횟수를 자릿수로 견준다(`withCommandAppUsageRange`) · 상한은 활동량 자 상한의 2/3.
 */
import { describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { BUNDLE_BUBBLE, COMMAND_APP_SIZE, FILE_MAX_SIZE, FILE_MIN_SIZE, NODE_MAX_SIZE } from '@vibisual/shared';

import { calcBubbleSize, calcFileSizeRange, stableSizeRange, withCommandAppUsageRange, withScreenFileRange } from './sizeCalc.js';

function code(id: string, fileSize: number | undefined): BubbleData {
  return { id, label: `${id}.ts`, bubbleType: 'file', path: `src/${id}.ts`, status: 'idle', activity: 1, ...(fileSize !== undefined ? { fileSize } : {}) };
}

const MID = Math.round((FILE_MIN_SIZE + FILE_MAX_SIZE) / 2);

describe('calcBubbleSize — 파일 용량 눈금', () => {
  it('몇 바이트 차이로는 지름이 갈리지 않는다(같은 그림 40장 184~186B)', () => {
    const files = [184, 185, 186].map((n, i) => code(`p${i}`, n));
    const range = calcFileSizeRange(files);
    const sizes = files.map((f) => calcBubbleSize(f, range));
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    for (const s of sizes) expect(Math.abs(s - MID)).toBeLessThanOrEqual(1);
  });

  it('큰 파일 하나가 나머지를 바닥에 누르지 않는다 — 자릿수로 잰다', () => {
    const files = [code('empty', 0), code('mp3', 30_000), code('wav', 350_000), code('long', 57_600_078)];
    const range = calcFileSizeRange(files);
    const [empty, mp3, wav, long] = files.map((f) => calcBubbleSize(f, range));
    expect(long).toBe(FILE_MAX_SIZE);
    expect(empty).toBe(FILE_MIN_SIZE);
    // 종전 정비례였다면 30KB · 350KB 는 둘 다 바닥(40)에 붙었다 — 이제 자릿수만큼 위에 선다.
    expect(mp3!).toBeGreaterThan(FILE_MIN_SIZE + (FILE_MAX_SIZE - FILE_MIN_SIZE) * 0.4);
    expect(wav!).toBeGreaterThan(mp3!);
    expect(long! - wav!).toBeLessThan(wav! - FILE_MIN_SIZE);
  });

  it('지름은 용량 차이를 따라 이어진다(문턱에서 튀지 않는다)', () => {
    const base = 1_000;
    let prev = -1;
    for (let ratio = 1; ratio <= 64; ratio *= 2) {
      const files = [code('a', base), code('b', base * ratio)];
      const range = calcFileSizeRange(files);
      const big = calcBubbleSize(files[1]!, range);
      expect(big).toBeGreaterThanOrEqual(prev);
      prev = big;
    }
    expect(prev).toBe(FILE_MAX_SIZE);
  });

  it('같은 크기면 정확히 가운데, 크기를 모르면 최소(종전 그대로)', () => {
    const same = [code('a', 500), code('b', 500)];
    expect(calcBubbleSize(same[0]!, calcFileSizeRange(same))).toBe(MID);
    expect(calcBubbleSize(code('x', undefined), { min: 0, max: 10 })).toBe(FILE_MIN_SIZE);
    expect(calcBubbleSize(code('y', 100), undefined)).toBe(FILE_MIN_SIZE);
  });
});

describe('withScreenFileRange — 같은 화면의 원 둘레 파일끼리', () => {
  it('파일에만 같은 범위를 싣고, 같은 범위는 같은 객체다', () => {
    const folderBubble: BubbleData = { id: 'd', label: 'd', bubbleType: 'internal_folder', path: 'd', status: 'idle', activity: 3 };
    const out = withScreenFileRange([folderBubble, code('a', 10), code('b', 2_000)]);
    expect(out[0]).toBe(folderBubble);
    const ra = (out[1] as unknown as { _localRange?: unknown })._localRange;
    const rb = (out[2] as unknown as { _localRange?: unknown })._localRange;
    expect(ra).toEqual({ min: 10, max: 2_000 });
    expect(ra).toBe(rb);
    expect(ra).toBe(stableSizeRange(10, 2_000));
  });

  it('크기를 아는 파일이 없으면 그대로 돌려준다', () => {
    const list = [code('a', undefined)];
    expect(withScreenFileRange(list)).toBe(list);
  });
});

describe('calcBubbleSize — 고정 지름', () => {
  it('묶음 버블은 용량·활동과 무관하게 BUNDLE_BUBBLE.size', () => {
    const bundle: BubbleData = { id: 'bundle-f', label: 'teaser', bubbleType: 'bundle', path: '', status: 'active', activity: 99, fileSize: 9e9 };
    expect(calcBubbleSize(bundle)).toBe(BUNDLE_BUBBLE.size);
  });

  it('폴더 안 Root→ 는 ← Back 과 같은 활동(1)이라 활동량으로 크지 않다', () => {
    const back: BubbleData = { id: '__root_back__', label: '← Back', bubbleType: 'back', path: '', status: 'idle', activity: 1 };
    const home: BubbleData = { id: '__root_home__', label: 'sound', bubbleType: 'root', path: 'sound', status: 'idle', activity: back.activity };
    expect(calcBubbleSize(home)).toBe(calcBubbleSize(back));
  });
});

describe('calcBubbleSize — 명령 앱 지름은 같은 화면의 앱끼리 사용 횟수로', () => {
  const app = (id: string, activity: number): BubbleData => ({
    id, label: id, bubbleType: 'bash', path: `__special__commandapp__${id}`, status: 'idle', activity,
    commandApp: { id, name: id, detection: 'command' },
  });
  const APP_MID = Math.round((COMMAND_APP_SIZE.min + COMMAND_APP_SIZE.max) / 2);
  const rangeOf = (b: BubbleData | undefined): unknown => (b as unknown as { _appUsageRange?: unknown })._appUsageRange;

  it('상한은 활동량 자 상한의 2/3 — 아무리 많이 써도 넘지 않는다', () => {
    expect(COMMAND_APP_SIZE.max).toBe(Math.round((NODE_MAX_SIZE * 2) / 3));
    const [huge] = withCommandAppUsageRange([app('npm', 10_000), app('git', 1)]);
    expect(calcBubbleSize(huge!)).toBe(COMMAND_APP_SIZE.max);
  });

  it('가장 적게 쓴 앱이 최소, 가장 많이 쓴 앱이 최대이고 그 사이는 자릿수로 선다', () => {
    const shown = withCommandAppUsageRange([app('zip', 2), app('jq', 4), app('python', 10), app('curl', 34), app('npm', 132)]);
    expect(shown.map((b) => calcBubbleSize(b))).toEqual([COMMAND_APP_SIZE.min, 65, 78, 97, COMMAND_APP_SIZE.max]);
  });

  it('비슷하게 쓴 무리는 가운데 둘레에 모인다 — 3회와 4회가 최소·최대로 갈리지 않는다', () => {
    const [a, b] = withCommandAppUsageRange([app('a', 3), app('b', 4)]).map((x) => calcBubbleSize(x));
    expect(b! - a!).toBeLessThan((COMMAND_APP_SIZE.max - COMMAND_APP_SIZE.min) / 4);
    expect(Math.abs((a! + b!) / 2 - APP_MID)).toBeLessThanOrEqual(1);
  });

  it('혼자 선 앱 · 모두 같은 횟수 · 범위가 안 실린 데이터는 정확히 가운데', () => {
    expect(calcBubbleSize(withCommandAppUsageRange([app('solo', 7)])[0]!)).toBe(APP_MID);
    expect(withCommandAppUsageRange([app('a', 5), app('b', 5)]).map((x) => calcBubbleSize(x))).toEqual([APP_MID, APP_MID]);
    expect(calcBubbleSize(app('raw', 500))).toBe(APP_MID);
  });

  it('작업 중이면 커지되 앱 상한을 넘지 않는다', () => {
    const [low, top] = withCommandAppUsageRange([app('a', 1), app('b', 200)]);
    expect(calcBubbleSize({ ...low!, status: 'active' })).toBeGreaterThan(calcBubbleSize(low!));
    expect(calcBubbleSize({ ...top!, status: 'active' })).toBe(COMMAND_APP_SIZE.max);
  });

  it('앱에만 범위를 싣는다 — 앱이 없으면 그대로, 같은 범위는 같은 객체', () => {
    const folder: BubbleData = { id: 'd', label: 'd', bubbleType: 'internal_folder', path: 'd', status: 'idle', activity: 3 };
    const shell: BubbleData = { id: 'sh', label: 'bash', bubbleType: 'bash', path: 'sh', status: 'idle', activity: 9 };
    const none = [folder, shell];
    expect(withCommandAppUsageRange(none)).toBe(none);
    const out = withCommandAppUsageRange([folder, app('a', 2), shell, app('b', 9)]);
    expect(out[0]).toBe(folder);
    expect(out[2]).toBe(shell);
    expect(rangeOf(out[1])).toBe(stableSizeRange(2, 9));
    expect(rangeOf(out[3])).toBe(rangeOf(out[1]));
  });

  it('앱이 아닌 Bash 버블은 종전 활동량 자 그대로', () => {
    const shell: BubbleData = { id: 'sh', label: 'bash', bubbleType: 'bash', path: 'sh', status: 'idle', activity: 50 };
    expect(calcBubbleSize(shell)).toBe(NODE_MAX_SIZE);
  });
});
