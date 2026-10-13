import { describe, expect, it } from 'vitest';
import { APP_BUBBLE_PAST_FILE_MAX, pushPastFile } from '@vibisual/shared';

/**
 * §5.4 #36 (H) ③ — 지난 결과 쌓기(shared `pushPastFile`). 결과 전달이 `file` 을 바꾸기 **전** 파일을 앞에 쌓는다.
 * 경로 비교는 `pathKey` — 플랫폼을 인자로 받으므로 세 OS 를 여기서 모두 본다(멀티플랫폼 1축).
 */

describe('§5.4 #36 (H) ③ 지난 결과', () => {
  it('바뀌기 전 파일을 맨 앞에, 그때의 결과 버전과 함께', () => {
    const past = pushPastFile([{ file: 'out/a.png', at: 1 }], { file: 'out/b.png', at: 2 }, 'out/c.png', 'linux');
    expect(past).toEqual([{ file: 'out/b.png', at: 2 }, { file: 'out/a.png', at: 1 }]);
  });

  it('같은 파일을 다시 보낸 것은 쌓지 않는다 — 그 파일은 방금 덮였다', () => {
    expect(pushPastFile(undefined, { file: 'out/a.png', at: 1 }, 'out/a.png', 'linux')).toEqual([]);
  });

  it('처음 담는 결과면(앞 파일 없음) 쌓을 것이 없다', () => {
    expect(pushPastFile(undefined, {}, 'out/a.png', 'win32')).toEqual([]);
  });

  it('이미 목록에 있는 파일은 앞으로 올린다(중복 ❌), 이번에 담긴 파일은 목록에서 뺀다', () => {
    const past = pushPastFile(
      [{ file: 'out/c.png', at: 3 }, { file: 'out/b.png', at: 2 }],
      { file: 'out/b.png', at: 5 },
      'out/c.png',
      'linux',
    );
    expect(past).toEqual([{ file: 'out/b.png', at: 5 }]);
  });

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    const many = Array.from({ length: APP_BUBBLE_PAST_FILE_MAX }, (_, i) => ({ file: `out/${i}.png` }));
    const past = pushPastFile(many, { file: 'out/new.png' }, 'out/next.png', 'linux');
    expect(past).toHaveLength(APP_BUBBLE_PAST_FILE_MAX);
    expect(past[0]).toEqual({ file: 'out/new.png' });
    expect(past.some((p) => p.file === `out/${APP_BUBBLE_PAST_FILE_MAX - 1}.png`)).toBe(false);
  });

  it('win·mac 은 대소문자를 접어 같은 파일로 보고, linux 는 다른 파일로 본다', () => {
    expect(pushPastFile(undefined, { file: 'Out/A.png' }, 'out/a.png', 'win32')).toEqual([]);
    expect(pushPastFile(undefined, { file: 'Out/A.png' }, 'out/a.png', 'darwin')).toEqual([]);
    expect(pushPastFile(undefined, { file: 'Out/A.png' }, 'out/a.png', 'linux')).toEqual([{ file: 'Out/A.png' }]);
  });

  it('모양이 틀린 칸(빈 파일·문자열 아닌 값)은 버린다 — 손으로 고친 체크포인트가 구슬 줄을 깨지 않게', () => {
    const broken = [{ file: '' }, { file: 42 as unknown as string }, { file: 'out/ok.png' }];
    expect(pushPastFile(broken, {}, 'out/next.png', 'linux')).toEqual([{ file: 'out/ok.png' }]);
  });
});
