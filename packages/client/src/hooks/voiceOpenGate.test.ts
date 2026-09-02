import { describe, expect, it, vi } from 'vitest';

import { createVoiceOpenGate, resolveVoicePort } from './voiceOpenGate.js';

/**
 * §5.5 #17-38 — 마이크 버튼이 **누를 때마다 먹는가**, 그리고 실패했을 때 사용자에게 맞는 것을
 * 말하는가. 두 가지가 실제로 무너져 사용자 보고가 들어온 자리라 여기에 고정한다.
 *
 * ① 켜기 세대 — 종전 `opening` 참·거짓 가드는 "여는 중"이면 새 켜기를 통째로 막았다. 그 값은
 *   여는 흐름이 끝나야 거짓이 되므로(엔진 시작 한도 20초), 기다리다 껐다 다시 켜면 그동안
 *   누름이 조용히 버려졌다 — "간헐적으로 안 눌린다"의 정체.
 * ② 실패 사유 — 서버에 잠깐 못 닿은 것까지 "아직 안 받았다"로 읽혀, 650MB 를 이미 받아 둔
 *   사람에게 설치 창이 떴다.
 */

describe('createVoiceOpenGate', () => {
  it('누름은 언제나 먹는다 — 앞 켜기가 도는 중에도 begin 은 거절하지 않는다', () => {
    const gate = createVoiceOpenGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(second).not.toBe(first);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('나중 켜기만 살아남는다 — 앞 켜기는 자원을 심지 못한다(두 벌 열림 방지)', () => {
    const gate = createVoiceOpenGate();
    const stale = gate.begin();
    gate.begin();

    expect(gate.isCurrent(stale)).toBe(false);
  });

  it('abandon 뒤에는 아무 켜기도 최신이 아니다 (끄기·창 닫힘 뒤 뒤늦게 오는 흐름 차단)', () => {
    const gate = createVoiceOpenGate();
    const token = gate.begin();
    gate.abandon();

    expect(gate.isCurrent(token)).toBe(false);
  });

  it('abandon 은 다음 켜기를 막지 않는다 — 끈 직후의 누름도 그대로 먹는다', () => {
    const gate = createVoiceOpenGate();
    gate.begin();
    gate.abandon();
    const next = gate.begin();

    expect(gate.isCurrent(next)).toBe(true);
  });
});

describe('resolveVoicePort', () => {
  it('준비된 것을 이미 알면 다시 묻지 않는다 — 누름과 마이크 사이의 왕복 하나를 아낀다', async () => {
    const refresh = vi.fn(async () => true);
    const openSession = vi.fn(async () => 6006);

    await expect(resolveVoicePort({ knownReady: true, refresh, openSession }))
      .resolves.toEqual({ ok: true, port: 6006 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('아직 모르면 서버에게 묻고, 없으면 마이크를 열지 않는다 (OS 표시 깜빡임 방지)', async () => {
    const openSession = vi.fn(async () => 6006);

    await expect(resolveVoicePort({ knownReady: null, refresh: async () => false, openSession }))
      .resolves.toEqual({ ok: false, reason: 'needs-install' });
    expect(openSession).not.toHaveBeenCalled();
  });

  it('없다고 알고 있어도 서버에게 되묻는다 — 밖에서 받아 둔 사람이 막히지 않게', async () => {
    const refresh = vi.fn(async () => true);

    await expect(resolveVoicePort({ knownReady: false, refresh, openSession: async () => 6006 }))
      .resolves.toEqual({ ok: true, port: 6006 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('알던 값이 거짓말이면(폴더를 지웠으면) 실패한 자리에서 설치 안내로 돌아온다', async () => {
    // 캐시는 준비됐다고 했지만 실제 디스크에는 없다 — 판정의 정본은 끝까지 서버다.
    await expect(resolveVoicePort({ knownReady: true, refresh: async () => false, openSession: async () => null }))
      .resolves.toEqual({ ok: false, reason: 'needs-install' });
  });

  it('받아 뒀는데 엔진이 안 뜨면 설치 창이 아니라 실패 사유다', async () => {
    await expect(resolveVoicePort({ knownReady: true, refresh: async () => true, openSession: async () => null }))
      .resolves.toEqual({ ok: false, reason: 'engine-failed' });
  });

  it('서버에 못 닿아 모를 때는 설치 창으로 몰지 않는다 (받아 둔 사람에게 뜨던 그 창)', async () => {
    await expect(resolveVoicePort({ knownReady: null, refresh: async () => null, openSession: async () => null }))
      .resolves.toEqual({ ok: false, reason: 'engine-failed' });
  });

  it('상태를 못 물어봐도 일단 열어 본다 — 열리면 그대로 받아쓰기가 시작된다', async () => {
    await expect(resolveVoicePort({ knownReady: null, refresh: async () => null, openSession: async () => 6100 }))
      .resolves.toEqual({ ok: true, port: 6100 });
  });
});
