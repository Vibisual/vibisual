/**
 * §9 **UI 텍스트 가독 하한 — 플러그인 쪽 집행.**
 *
 * 플러그인 UI 는 호스트 화면 위에 그대로 그려지므로 같은 바닥을 지켜야 한다. 클라이언트 본체는
 * `packages/client/src/typographyFloor.test.ts` 가 막고, 여기는 그 규칙이 플러그인 폴더로
 * 새는 것을 막는다(플러그인은 자립 규약상 자기 폴더 안에서 완결되므로 검사도 여기 둔다).
 *
 * 한글은 라틴이 멀쩡한 크기에서 먼저 무너진다 — 9px 에서는 획 폭이 1픽셀보다 얇아져 어떤 픽셀도
 * 지정한 색에 도달하지 못한다. 실측 근거와 배경은 클라이언트 쪽 같은 이름 테스트의 머리글 참조.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** 가독 하한(px). §9 · docs/rules/coding.md · 클라이언트 쪽 같은 테스트와 같은 값이어야 한다. */
const FLOOR_PX = 12;

const SRC = path.resolve(__dirname);

function walk(p: string): string[] {
  return fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)]));
}

const SOURCES = walk(SRC)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ path: path.relative(SRC, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }))
  .sort((a, b) => a.path.localeCompare(b.path));

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

describe('§9 UI 텍스트 가독 하한 (plugins)', () => {
  it('스캔이 실제로 소스를 읽는다', () => {
    // 빈 스캔이면 아래 검사들이 조용히 통과해 집행이 사라진다.
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it(`Tailwind 글꼴 크기가 ${FLOOR_PX}px 미만이 아니다`, () => {
    const violations: string[] = [];
    for (const { path: rel, text } of SOURCES) {
      const re = /text-\[(\d+(?:\.\d+)?)px\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (Number(m[1]) < FLOOR_PX) violations.push(`${rel}:${lineOf(text, m.index)}  ${m[0]}`);
      }
    }
    expect(violations, `${FLOOR_PX}px 미만 글꼴은 한글 획이 무너져 읽히지 않습니다(§9).`).toEqual([]);
  });

  it('Tailwind 글꼴 크기에 소수점 px 을 쓰지 않는다', () => {
    const violations: string[] = [];
    for (const { path: rel, text } of SOURCES) {
      const re = /text-\[(\d+\.\d+)px\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) violations.push(`${rel}:${lineOf(text, m.index)}  ${m[0]}`);
    }
    expect(violations, '소수점 px 은 같은 값의 정수 px 보다 흐려집니다(§9).').toEqual([]);
  });
});
