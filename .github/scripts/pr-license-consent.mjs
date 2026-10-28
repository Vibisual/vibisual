#!/usr/bin/env node
/**
 * PR 본문의 라이선스 동의 확인란(1. Sign-off · 2. Additional License Grant)이 둘 다 체크됐는지 검사해 병합을 막는다(DCO 서명은 재라이선스 동의가 아니다).
 * 소유자(author_association=OWNER)의 PR 은 통과 — 자기에게 받을 허락이 없다.
 * ⚠️ 정규식은 리터럴로만 — new RegExp('...\\[...') 는 heredoc 을 거치며 백슬래시가 한 겹 사라져 조용히 뜻이 바뀐다.
 * 사용: --selftest · PR_BODY=... AUTHOR_ASSOCIATION=... node .github/scripts/pr-license-consent.mjs
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * 확인란 두 줄. 굵게(**) 는 있어도 없어도 되고, 불릿은 - 와 * 둘 다 받는다.
 * 기여자가 문구를 조금 손봐도 통과하되, 줄 자체가 사라지면 잡히는 선.
 */
const BOXES = [
  {
    label: 'Sign-off (DCO)',
    re: /^[ \t]*[-*][ \t]*\[([ xX])\][ \t]*\*{0,2}Sign-off\b/im,
  },
  {
    label: 'Additional License Grant',
    re: /^[ \t]*[-*][ \t]*\[([ xX])\][ \t]*\*{0,2}Additional License Grant\b/im,
  },
];

/** HTML 주석 안의 확인란은 세지 않는다 — 템플릿 안내문이 통째로 주석이라 오탐이 난다. */
function stripComments(body) {
  return String(body).replace(/<!--[\s\S]*?-->/g, '');
}

export function evaluate({ body, association }) {
  if (String(association).toUpperCase() === 'OWNER') {
    return { ok: true, owner: true, empty: false, results: [] };
  }
  const text = String(body ?? '');
  if (!text.trim()) {
    return { ok: false, owner: false, empty: true, results: [] };
  }
  const stripped = stripComments(text);
  const results = BOXES.map((b) => {
    const m = stripped.match(b.re);
    return {
      label: b.label,
      present: Boolean(m),
      checked: Boolean(m) && m[1].toLowerCase() === 'x',
    };
  });
  return {
    ok: results.every((r) => r.present && r.checked),
    owner: false,
    empty: false,
    results,
  };
}

function summary(lines) {
  const out = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
    } catch {
      /* 요약은 표시용 — 실패해도 판정에 영향 없다 */
    }
  }
  console.log(out);
}

/* ------------------------------- selftest -------------------------------- */

const TICKED = [
  '- [x] **Sign-off.** Every commit carries a Signed-off-by line.',
  '- [x] **Additional License Grant.** I have read and agree to the grant.',
].join('\n');

const CASES = [
  ['둘 다 체크 → 통과', { body: TICKED, association: 'CONTRIBUTOR' }, true],
  ['대문자 X 도 체크로 본다', { body: TICKED.replace(/\[x\]/g, '[X]'), association: 'CONTRIBUTOR' }, true],
  ['별표 불릿도 받는다', { body: TICKED.replace(/^- /gm, '* '), association: 'CONTRIBUTOR' }, true],
  ['들여쓰기가 있어도 받는다', { body: TICKED.replace(/^/gm, '   '), association: 'CONTRIBUTOR' }, true],
  ['굵게 표시가 없어도 받는다', { body: TICKED.replace(/\*\*/g, ''), association: 'CONTRIBUTOR' }, true],
  ['본문에 다른 내용이 섞여도 찾는다', { body: '## What\n\nfix a crash\n\n## Licensing\n\n' + TICKED, association: 'CONTRIBUTOR' }, true],
  ['하나만 체크 → 막는다', { body: TICKED.replace('[x] **Additional', '[ ] **Additional'), association: 'CONTRIBUTOR' }, false],
  ['둘 다 미체크 → 막는다', { body: TICKED.replace(/\[x\]/g, '[ ]'), association: 'CONTRIBUTOR' }, false],
  ['확인란을 지운 본문 → 막는다', { body: 'fixed a typo', association: 'CONTRIBUTOR' }, false],
  ['빈 본문 → 막는다', { body: '', association: 'CONTRIBUTOR' }, false],
  ['본문 없음(null) → 막는다', { body: null, association: 'CONTRIBUTOR' }, false],
  ['주석 안의 체크는 세지 않는다', { body: '<!--\n' + TICKED + '\n-->', association: 'CONTRIBUTOR' }, false],
  ['소유자 PR 은 미체크여도 통과', { body: TICKED.replace(/\[x\]/g, '[ ]'), association: 'OWNER' }, true],
  ['소유자 판정은 대소문자를 가리지 않는다', { body: '', association: 'owner' }, true],
];

function selftest() {
  let bad = 0;
  for (const [name, input, want] of CASES) {
    const got = evaluate(input).ok;
    if (got === want) {
      console.log('  ok    ' + name);
    } else {
      bad++;
      console.log('  FAIL  ' + name + '  (기대 ' + want + ', 실제 ' + got + ')');
    }
  }
  console.log('');
  console.log(CASES.length + ' 건 중 ' + bad + ' 건 실패');
  process.exit(bad === 0 ? 0 : 1);
}

/* --------------------------------- main ---------------------------------- */

/**
 * ⚠️ 직접 실행일 때만 돈다. merged-pr-audit.mjs 가 `evaluate` 를 import 하는데, 아래를
 *    최상위에 두면 그 import 만으로 이 스크립트의 판정이 돌고 process.exit() 까지 나서
 *    감사 쪽이 시작도 못 한다.
 */
function main() {
  if (process.argv.includes('--selftest')) selftest();

  const verdict = evaluate({
    body: process.env.PR_BODY,
    association: process.env.AUTHOR_ASSOCIATION,
  });

  if (verdict.owner) {
    summary([
      '### Licensing consent — skipped',
      '',
      'The pull request author is the repository owner. The Additional License Grant is a',
      'grant *to* the owner, so there is nothing to collect on this pull request.',
    ]);
    process.exit(0);
  }

  if (verdict.ok) {
    summary([
      '### Licensing consent — ok',
      '',
      '| Item | State |',
      '|---|---|',
      ...verdict.results.map((r) => '| ' + r.label + ' | confirmed |'),
      '',
      'The sign-off itself is verified commit by commit in the **DCO** check.',
    ]);
    process.exit(0);
  }

  const rows = verdict.empty
    ? ['| (whole template) | missing — the pull request body is empty |']
    : verdict.results.map((r) => {
        const state = !r.present
          ? 'missing — the checkbox line was removed'
          : r.checked
            ? 'confirmed'
            : '**not ticked**';
        return '| ' + r.label + ' | ' + state + ' |';
      });

  summary([
    '### Licensing consent — blocked',
    '',
    '| Item | State |',
    '|---|---|',
    ...rows,
    '',
    '**Do not merge this pull request until both boxes are ticked.**',
    '',
    'Why this blocks: the Additional License Grant in `CONTRIBUTING.md` is what lets this',
    'project dual-license, move to a source-available license, or ship a paid edition later.',
    'One contribution merged without it locks the module it touches — permanently, unless the',
    'contributor is tracked down years later or the code is torn out.',
    '',
    'To fix: edit the pull request description, restore the **Licensing** section from',
    '`.github/PULL_REQUEST_TEMPLATE.md`, and tick both boxes.',
  ]);

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
