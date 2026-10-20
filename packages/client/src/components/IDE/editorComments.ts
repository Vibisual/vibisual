import { languageSpec } from './codeLanguages.js';
import type { CommentTokens } from './editorLineOps.js';

/**
 * editorComments.ts — §5.5 #17-27 ⑲ 줄 주석·블록 주석에 쓸 **기호 표**(config).
 *
 * 기본은 언어 사양 표(`codeLanguages.ts`)의 첫 주석 기호다. 그런데 그 표는 **색칠용**이라 가까운 언어로
 * 묶어 둔 확장자가 있다 — lua 는 python 색으로 칠하지만 주석은 `#` 이 아니라 `--` 이고, 언리얼 `.ini` 는
 * `;` 이다. 색이 조금 틀리면 보기만 어색하지만 주석 기호가 틀리면 **코드가 깨진다**. 그래서 그런 확장자만
 * 여기 한 줄씩 적어 바로잡는다(로직 분기 ❌ — 새 확장자 = 이 표에 한 줄, §3.3).
 */

const EXTENSION_COMMENTS: Record<string, Partial<CommentTokens>> = {
  // 색은 python 으로 칠하지만 주석 문법이 다르다.
  lua: { line: '--', block: ['--[[', ']]'] },
  // 언리얼 설정(.ini)은 `;` 로 주석을 단다. (.env·.gitignore 같은 ini 묶음의 나머지는 `#` 그대로.)
  ini: { line: ';' },
  // 순수 CSS 에는 줄 주석이 없다 — 줄 주석 켜기는 블록 기호로 줄마다 감싼다(scss·less 는 `//` 그대로).
  css: { line: null },
  // 윈도우 배치 파일 — 색은 셸로 칠하지만 `#` 은 주석이 아니다.
  bat: { line: '@REM', block: null },
  cmd: { line: '@REM', block: null },
  // PowerShell 블록 주석.
  ps1: { block: ['<#', '#>'] },
  // 마크다운은 HTML 주석을 쓴다(언어 표에는 주석 규칙이 없다).
  md: { line: null, block: ['<!--', '-->'] },
  markdown: { line: null, block: ['<!--', '-->'] },
  mdx: { line: null, block: ['<!--', '-->'] },
  // 루비·펄·R 은 python 색이지만 블록 주석이 없다(삼중따옴표는 그쪽에서 문자열이다).
  rb: { block: null },
  pl: { block: null },
  r: { block: null },
};

/** 경로의 확장자(소문자, 점 없이). 없으면 빈 문자열. */
function extensionOf(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** 이 파일에서 쓸 주석 기호. 언어 표에 없고 확장자 표에도 없으면 둘 다 `null`(주석 켜기 = 할 일 없음). */
export function commentTokensFor(path: string | null | undefined, languageId: string): CommentTokens {
  const spec = languageSpec(languageId);
  const base: CommentTokens = {
    line: spec.lineComments[0] ?? null,
    block: spec.blockComments[0] ?? null,
  };
  const override = path ? EXTENSION_COMMENTS[extensionOf(path)] : undefined;
  return override ? { ...base, ...override } : base;
}
