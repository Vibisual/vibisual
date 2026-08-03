/**
 * §5.11 v4.29 — 카드 격리 고정 테스트.
 *
 * 111장 중 한 장이 그리다 던지면 앱 전체가 내려가던 상태였다. 이 함수가 그 한 장을 그 자리에 가둔다.
 * 규칙이 흔들리면 다시 흰 화면이 되므로 여기서 못 박는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryBuild, reportPluginFailure, resetPluginFailureLog } from './isolate.js';

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPluginFailureLog();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe('카드 격리', () => {
  it('성공하면 만든 값을 그대로 돌려준다', () => {
    expect(tryBuild('a', () => 'ok')).toBe('ok');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('던지면 null 을 돌려주고 위로 새지 않는다 — 여기서 새면 호스트가 통째로 무너진다', () => {
    expect(() => tryBuild('a', () => { throw new Error('boom'); })).not.toThrow();
    expect(tryBuild('b', () => { throw new Error('boom'); })).toBeNull();
  });

  it('"안 붙는다"(null)와 "실패했다"를 같은 값으로 돌려준다 — 호스트는 둘 다 건너뛴다', () => {
    expect(tryBuild('a', () => null)).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();   // 안 붙는 것은 실패가 아니다
  });

  it('한 카드가 계속 실패해도 로그는 한 번만 — 매 렌더마다 콘솔을 채우면 진짜 오류가 묻힌다', () => {
    for (let i = 0; i < 20; i++) tryBuild('noisy', () => { throw new Error('boom'); });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('카드마다 따로 센다 — 한 장이 시끄럽다고 다른 장의 첫 실패를 삼키면 안 된다', () => {
    tryBuild('one', () => { throw new Error('x'); });
    tryBuild('two', () => { throw new Error('y'); });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('로그에 어느 카드인지 담는다 — 111장 중 어느 것인지 못 찾으면 고칠 수 없다', () => {
    reportPluginFailure('lethal-trifecta', new Error('x'));
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('lethal-trifecta');
  });

  it('던진 것이 Error 가 아니어도 삼킨다 — 플러그인이 무엇을 던질지 우리가 정하지 않는다', () => {
    expect(tryBuild('odd', () => { throw 'just a string'; })).toBeNull();
    expect(tryBuild('odd2', () => { throw undefined; })).toBeNull();
  });
});
