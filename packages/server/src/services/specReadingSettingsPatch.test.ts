import { describe, expect, it } from 'vitest';
import { withSpecReadingScope } from '@vibisual/shared';
import { patchSpecReadingPreferences } from './specReadingSettingsPatch.js';

describe('정독 환경설정 부분 저장', () => {
  it('정독을 켠 뒤 강도를 바꿔도 켬/끔·면제·다른 환경설정을 유지한다', () => {
    const enabled = withSpecReadingScope({ strength: 'observe', roots: ['docs'], waived: ['REQ-1'], stopRetries: 2 }, 'project', null, true);
    const changed = patchSpecReadingPreferences(enabled, { strength: 'enforce' });
    expect(changed).toMatchObject({ enabledProject: true, strength: 'enforce', roots: ['docs'], waived: ['REQ-1'], stopRetries: 2 });
    expect(enabled.strength).toBe('observe');
  });

  it('두 창이 서로 다른 필드를 저장하고 중간에 세션 설정이 바뀌어도 누적한다', () => {
    const roots = patchSpecReadingPreferences({ strength: 'observe' }, { roots: ['planning'] })!;
    const scope = withSpecReadingScope(roots, 'session', 'sub-1', false);
    const latest = patchSpecReadingPreferences(scope, { strength: 'warn' });
    expect(latest).toMatchObject({ roots: ['planning'], strength: 'warn', enabledSessions: { 'sub-1': false } });
  });

  it('뿌리를 명시적으로 비울 수 있고 생략한 필드는 삭제하지 않는다', () => {
    const cleared = patchSpecReadingPreferences({ strength: 'enforce', roots: ['docs'], enabledProject: true }, { roots: [] });
    expect(cleared).not.toHaveProperty('roots');
    expect(cleared).toMatchObject({ strength: 'enforce', enabledProject: true });
  });

  it.each([null, [], {}, { enabledProject: false }, { strength: 'wrong' }, { roots: 'docs' }, { roots: [3] }])(
    '관련 없는 필드나 잘못된 입력은 설정을 덮지 않는다: %j', (patch) => {
      expect(patchSpecReadingPreferences({ strength: 'enforce' }, patch)).toBeNull();
    },
  );
});
