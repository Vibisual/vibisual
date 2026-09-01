#!/usr/bin/env node
/**
 * merged-pr-audit.mjs — 병합이 끝난 PR 을 되짚어, 동의 없이 들어온 것이 있으면 알린다.
 *
 * ⚠️ 왜 병합 전 검사만으로 부족한가(2026-09-01) — required status check 는 저장소
 *    관리자가 우회할 수 있다. 실제로 이 저장소는 "Changes must be made through a pull
 *    request" 규칙이 걸려 있는데도 소유자 권한으로 main 에 직접 푸시된 적이 있다
 *    (GitHub 이 `Bypassed rule violations` 로 답했다). 즉 앞단은 남을 막을 뿐, 우리
 *    자신은 못 막는다.
 *
 *    동의 없는 기여가 병합되면 그 모듈은 이중 라이선스도 유료 전환도 못 하게 되는데,
 *    그 사실은 **몇 년 뒤 인수 실사에서** 드러난다. 그때는 기여자를 찾아 사후 동의를
 *    받거나 코드를 들어내는 수밖에 없다. 이 감사는 그 시차를 며칠로 줄인다 — 막지는
 *    못해도, **조용히 지나가지는 않게** 한다.
 *
 * 검사 두 가지:
 *   1. PR 본문의 동의 확인란 두 개 (pr-license-consent.mjs 의 판정을 그대로 재사용)
 *   2. 병합 커밋을 뺀 모든 커밋에 `Signed-off-by:` 줄이 있는지
 *      (주소 대조까지는 DCO 워크플로가 한다 — 여기는 알람이라 존재 여부만 본다)
 *
 * ⚠️ 보고서에 기여자 **이메일을 넣지 않는다.** 공개 이슈로 열리기 때문에, 커밋 주소를
 *    그대로 적으면 우리가 남의 개인정보를 공개하는 셈이 된다. SHA 와 제목만 적는다.
 *
 * 사용:
 *   node .github/scripts/merged-pr-audit.mjs --selftest
 *   gh api repos/OWNER/REPO/pulls/N/commits | PR_NUMBER=N PR_BODY=... \
 *     AUTHOR_ASSOCIATION=... node .github/scripts/merged-pr-audit.mjs
 *
 * 종료 코드: 0 = 문제 없음, 1 = 문제 있음(워크플로가 이슈를 연다).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate } from './pr-license-consent.mjs';

/** 병합 커밋은 뺀다 — 서명의 주체가 없고, 서명은 원 커밋에 붙어 있다. */
export function unsignedCommits(commits) {
  return (Array.isArray(commits) ? commits : [])
    .filter((c) => ((c && c.parents) || []).length < 2)
    .filter((c) => !/^[ \t]*signed-off-by:/im.test(String((c.commit && c.commit.message) || '')))
    .map((c) => ({
      sha: String(c.sha || '').slice(0, 7),
      subject: String((c.commit && c.commit.message) || '').split('\n')[0],
    }));
}

export function audit({ commits, body, association }) {
  const consent = evaluate({ body, association });
  const unsigned = unsignedCommits(commits);
  return { ok: consent.ok && unsigned.length === 0, consent, unsigned };
}

function report({ number, result }) {
  const lines = [
    'A pull request was merged without the checks that keep this project relicensable.',
    '',
    'Merged: #' + number,
    '',
  ];

  if (!result.consent.ok) {
    lines.push('### Missing licensing consent', '');
    if (result.consent.empty) {
      lines.push('The pull request body was empty — the Licensing section was never filled in.');
    } else {
      lines.push('| Item | State |', '|---|---|');
      for (const r of result.consent.results) {
        const state = !r.present ? 'missing' : r.checked ? 'confirmed' : '**not ticked**';
        lines.push('| ' + r.label + ' | ' + state + ' |');
      }
    }
    lines.push('');
  }

  if (result.unsigned.length > 0) {
    lines.push('### Commits with no `Signed-off-by` line', '');
    for (const c of result.unsigned) lines.push('- `' + c.sha + '` ' + c.subject);
    lines.push('');
  }

  lines.push(
    '### Why this matters',
    '',
    'The Additional License Grant in `CONTRIBUTING.md` is what lets this project',
    'dual-license, move to a source-available license, or ship a paid edition later.',
    'Code merged without it cannot be relicensed. The module these commits touch is',
    'now pinned to Apache-2.0 unless this is resolved.',
    '',
    '### How to resolve',
    '',
    '1. Ask the contributor to confirm the Additional License Grant in a comment on',
    '   the merged pull request, in their own words. A written confirmation on the',
    '   record is enough; a new pull request is not needed.',
    '2. If they do not reply, or decline, revert the merge and rebuild the change',
    '   from the issue description instead.',
    '3. Close this issue only after one of the two is done — not just because the',
    '   code works.',
  );

  return lines.join('\n');
}

/* ------------------------------- selftest -------------------------------- */

const OK_BODY = [
  '- [x] **Sign-off.** signed',
  '- [x] **Additional License Grant.** agreed',
].join('\n');

const signed = (sha, subject) => ({
  sha,
  parents: [{}],
  commit: { message: subject + '\n\nSigned-off-by: A Name <someone@example.invalid>' },
});
const unsigned = (sha, subject) => ({ sha, parents: [{}], commit: { message: subject } });
const merge = (sha) => ({ sha, parents: [{}, {}], commit: { message: 'Merge branch main' } });

const CASES = [
  ['동의 O · 서명 O → 조용히 지나간다',
    { commits: [signed('aaaaaaa1', 'fix: a')], body: OK_BODY, association: 'CONTRIBUTOR' }, true],
  ['동의 X → 잡는다',
    { commits: [signed('aaaaaaa1', 'fix: a')], body: OK_BODY.replace(/\[x\]/g, '[ ]'), association: 'CONTRIBUTOR' }, false],
  ['서명 없는 커밋 → 잡는다',
    { commits: [unsigned('bbbbbbb2', 'fix: b')], body: OK_BODY, association: 'CONTRIBUTOR' }, false],
  ['둘 다 없음 → 잡는다',
    { commits: [unsigned('bbbbbbb2', 'fix: b')], body: '', association: 'CONTRIBUTOR' }, false],
  ['병합 커밋은 서명을 요구하지 않는다',
    { commits: [merge('ccccccc3'), signed('aaaaaaa1', 'fix: a')], body: OK_BODY, association: 'CONTRIBUTOR' }, true],
  ['소유자 PR 은 동의를 묻지 않되 서명은 본다',
    { commits: [signed('aaaaaaa1', 'fix: a')], body: '', association: 'OWNER' }, true],
  ['소유자 PR 이어도 서명 없는 커밋은 잡는다',
    { commits: [unsigned('bbbbbbb2', 'fix: b')], body: '', association: 'OWNER' }, false],
  ['커밋이 비어 있어도 터지지 않는다',
    { commits: [], body: OK_BODY, association: 'CONTRIBUTOR' }, true],
  ['커밋이 배열이 아니어도 터지지 않는다',
    { commits: null, body: OK_BODY, association: 'CONTRIBUTOR' }, true],
  ['Signed-off-by 대소문자를 가리지 않는다',
    { commits: [{ sha: 'ddd', parents: [{}], commit: { message: 'fix\n\nSIGNED-OFF-BY: X <x@example.invalid>' } }], body: OK_BODY, association: 'CONTRIBUTOR' }, true],
];

function selftest() {
  let bad = 0;
  for (const [name, input, want] of CASES) {
    const got = audit(input).ok;
    if (got === want) {
      console.log('  ok    ' + name);
    } else {
      bad++;
      console.log('  FAIL  ' + name + '  (기대 ' + want + ', 실제 ' + got + ')');
    }
  }
  // 보고서가 이메일을 흘리지 않는지 — 공개 이슈로 열리므로 이것도 회귀로 고정한다.
  const leaky = report({
    number: 1,
    result: audit({ commits: [unsigned('bbbbbbb2', 'fix: b')], body: '', association: 'CONTRIBUTOR' }),
  });
  if (/@/.test(leaky)) {
    bad++;
    console.log('  FAIL  보고서에 이메일로 보이는 문자열이 있다');
  } else {
    console.log('  ok    보고서에 이메일이 들어가지 않는다');
  }
  console.log('');
  console.log(CASES.length + 1 + ' 건 중 ' + bad + ' 건 실패');
  process.exit(bad === 0 ? 0 : 1);
}

/* --------------------------------- main ---------------------------------- */

if (process.argv.includes('--selftest')) selftest();

let commits = [];
try {
  commits = JSON.parse(readFileSync(0, 'utf8') || '[]');
} catch {
  console.error('커밋 목록을 읽지 못했다 — 표준입력이 JSON 배열이어야 한다.');
  process.exit(1);
}

const result = audit({
  commits,
  body: process.env.PR_BODY,
  association: process.env.AUTHOR_ASSOCIATION,
});

if (result.ok) {
  console.log('병합된 PR #' + (process.env.PR_NUMBER || '?') + ' — 동의와 서명 모두 확인됨.');
  process.exit(0);
}

const body = report({ number: process.env.PR_NUMBER || '?', result });
if (process.env.REPORT_PATH) writeFileSync(process.env.REPORT_PATH, body);
console.log(body);
process.exit(1);
