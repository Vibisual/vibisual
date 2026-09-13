/**
 * §7.22 — 도메인 버블 웹 이력 목록·상세 팝업이 지켜야 할 것을 원문에 고정한다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더 대신 **소스 원문**을 읽는다 — 여기서 고정하는
 * 것은 픽셀이 아니라 **되돌아가면 안 되는 결정들**이고, 그 결정들은 전부 원문에 자국이 남는다.
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./{WebEntryList,WebEntryDetailPopup}.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function sourceOf(name: string): string {
  const key = Object.keys(sources).find((k) => k.endsWith(`/${name}.tsx`));
  const src = key === undefined ? undefined : sources[key];
  if (src === undefined) throw new Error(`source not found: ${name}`);
  return src;
}

const list = sourceOf('WebEntryList');
const popup = sourceOf('WebEntryDetailPopup');

describe('§7.22 목록 — 훑는 자리', () => {
  it('줄을 누르면 상세 팝업이 열린다(인라인 펼침으로 되돌아가지 않는다)', () => {
    expect(list).toContain('WebEntryDetailPopup');
    // 종전의 인라인 펼침 — 260px 안에서 목록을 밀어내면서도 읽히지 않았다.
    expect(list).not.toContain('<pre');
    expect(list).not.toMatch(/\bexpanded\b/);
  });

  it('지우기는 항상 꺼진 체크박스가 아니라 버튼이다', () => {
    // `checked={false}` 인 체크박스는 "고르는 칸"으로 읽히는데 실제 행동은 제거였다.
    expect(list).not.toContain('type="checkbox"');
    expect(list).toContain('TrashGlyph');
  });

  it('지우는 창구는 그대로다 — 서버 계약을 바꾸지 않았다', () => {
    expect(list).toContain('/api/domain-entries/check');
    expect(list).toContain('/api/domain-entries/clear');
    expect(list).toContain('/api/domain-entries/max');
  });

  it('상한 편집은 §7.5 와 같은 팝업을 쓴다(같은 일에 창을 두 벌 만들지 않는다)', () => {
    expect(list).toContain('SatelliteMaxPopup');
    expect(list).toContain('WEB_ENTRY_MAX_BOUNDS');
  });

  it('열어 둔 항목이 사라지면 창도 닫는다 — 유령 창을 남기지 않는다', () => {
    expect(list).toMatch(/setDetailId\(null\)/);
    expect(list).toContain('entries.find');
  });
});

describe('§7.22 팝업 — 읽는 자리', () => {
  it('닫기 배선을 새로 만들지 않는다(공통 훅 + Esc)', () => {
    expect(popup).toContain('useBackdropDismiss');
    expect(popup).toContain("e.key === 'Escape'");
  });

  it('표제를 줄이지 않는다 — 목록이 줄인 것을 여기서 푼다', () => {
    expect(popup).not.toContain('middleEllipsis');
    expect(popup).toContain('break-words');
  });

  it('못 읽은 결과를 0 으로 채우지 않는다(§5.23)', () => {
    expect(popup).toContain('detailNoResult');
  });

  it('밖으로 여는 길은 앱에 하나뿐인 window.open 이다(§5.23 경계)', () => {
    expect(popup).toContain("window.open(url, '_blank'");
    expect(popup).not.toContain('<iframe');
  });

  it('실패한 호출도 보여 준다 — "왜 못 읽었나"가 정보다', () => {
    expect(popup).toContain('entry.error');
  });
});

describe('§7.22 두 화면이 함께 지키는 것', () => {
  it('사용자 가시 문자열은 전부 t() 를 거친다', () => {
    for (const [name, src] of [
      ['WebEntryList', list],
      ['WebEntryDetailPopup', popup],
    ] as const) {
      // title/aria-label 에 날문자열이 박히면 12개 로케일이 한꺼번에 틀어진다.
      expect(src, name).not.toMatch(/(?:title|aria-label|placeholder)="[^{"]+"/);
    }
  });

  it('아이콘은 이모지가 아니라 stroke SVG 다', () => {
    for (const [name, src] of [
      ['WebEntryList', list],
      ['WebEntryDetailPopup', popup],
    ] as const) {
      expect(src, name).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('한글 가독 하한 12px — 그보다 작은 글자를 두지 않는다', () => {
    for (const [name, src] of [
      ['WebEntryList', list],
      ['WebEntryDetailPopup', popup],
    ] as const) {
      const tooSmall = src.match(/text-\[(\d+)px\]/g)?.filter((m) => {
        const n = Number(/(\d+)/.exec(m)?.[1] ?? '99');
        return n < 12;
      });
      expect(tooSmall ?? [], name).toEqual([]);
      expect(src, name).not.toMatch(/\btext-(?:xs|\[0\.\d+rem\])\b/);
    }
  });
});
