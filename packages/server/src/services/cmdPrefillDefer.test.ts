import { describe, it, expect } from 'vitest';
import { cmdPrefillDelay, CMD_PREFILL_DELAY_MS, CMD_PREFILL_MAX_DEFER_MS } from '@vibisual/shared';

/**
 * §4 (CMD) — 셸 입력줄 채우기(prefill)를 **크기가 멎은 뒤로** 미루는 창구의 산술.
 *
 * 증상은 "CMD 버블을 처음 열면 자동으로 적어 둔 명령이 지워진다/줄어든다" 였다. ConPTY 는
 * 리사이즈마다 보이는 화면을 통째로 다시 그리는데(`CMD_RESIZE_REPAINT_MS` 참조), 그때 셸
 * 입력줄에 글자가 들어 있으면 새 폭에 맞춰 다시 배치되며 잘려 나간다. 그래서 리사이즈가 오면
 * 아직 안 쓴 prefill 의 예약을 되감는데 — 창을 계속 끌고 있어도 **영영 안 채워지지는 않아야**
 * 하므로 최초 예약 때 정한 한도(deadline) 안에서만 되감는다.
 */
describe('cmdPrefillDelay', () => {
  const now = 1_700_000_000_000;

  it('한도가 멀면 평소 지연을 그대로 쓴다 — 셸 배너가 먼저 그려질 틈', () => {
    expect(cmdPrefillDelay(now, now + CMD_PREFILL_MAX_DEFER_MS)).toBe(CMD_PREFILL_DELAY_MS);
  });

  it('한도가 평소 지연보다 가까우면 남은 시간만큼만 미룬다', () => {
    expect(cmdPrefillDelay(now, now + 120)).toBe(120);
  });

  it('한도를 이미 넘겼으면 더 미루지 않는다 — 창을 계속 끌어도 명령은 결국 채워진다', () => {
    expect(cmdPrefillDelay(now, now - 1)).toBe(0);
    expect(cmdPrefillDelay(now, now - 10_000)).toBe(0);
  });

  it('되감기를 반복해도 총 지연은 한도를 넘지 않는다', () => {
    const deadline = now + CMD_PREFILL_MAX_DEFER_MS;
    // 리사이즈가 100ms 마다 계속 들어오는 상황 — 매번 되감아도 실행 시각은 한도를 못 넘는다.
    for (let t = now; t < deadline; t += 100) {
      expect(t + cmdPrefillDelay(t, deadline)).toBeLessThanOrEqual(deadline);
    }
    // 한도를 지난 뒤의 되감기 요청은 지연 0 — 다음 차례에 바로 채워진다.
    expect(cmdPrefillDelay(deadline + 100, deadline)).toBe(0);
  });

  it('한도는 평소 지연보다 넉넉하다 — 아니면 되감기가 처음부터 무의미하다', () => {
    expect(CMD_PREFILL_MAX_DEFER_MS).toBeGreaterThan(CMD_PREFILL_DELAY_MS);
  });
});
