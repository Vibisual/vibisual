/**
 * §4 (상태바 모델 칸 ③⑤) — `claude --help` 의 `--model` 설명에서 CLI 가 bare 로 받는 별칭을 읽는 순수 판정부. 2.1.300 출력(줄바꿈됨):
 *   `--model <model>   Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name.`
 * 도움말은 "e.g." 라 전부를 적지 않는다 — 읽는 쪽이 `CLI_NATIVE_MODEL_ALIASES_FALLBACK` 과 합친다(`listNativeModelAliases`). spawn 은 호출자 몫 — 세 OS 출력 문구를 단위 시험하려고.
 * 치환 여부를 가르는 유일한 실측이다: 여기 든 별칭은 bare 로 나가 CLI 가 자기 latest 로 해소하고, 밖의 별칭은 레지스트리 latest 풀ID 로 바뀐다.
 */

/**
 * `--model <…>` 옵션 블록 — 줄 머리의 옵션 토큰부터, 다음 옵션 줄(`  -x, --yyy` / `  --yyy`)이나 빈 줄 앞까지.
 * 다른 옵션 설명 안에 끼어 있는 `--model` 글자(줄 머리가 아닌 것)는 잡지 않는다.
 */
const MODEL_OPTION_BLOCK_RE = /^[ \t]*(?:-[a-zA-Z],[ \t]*)?--model(?=[\s<])[^\n]*(?:\n(?![ \t]*-{1,2}[a-zA-Z]|\s*\n|\s*$)[^\n]*)*/m;
/** 설명 안의 홑따옴표 토큰. 별칭은 소문자 영숫자(`opus`)뿐 — 풀ID 예시(`claude-sonnet-4-5-20250929`)·`opus[1m]` 은 모양으로 떨어진다. */
const QUOTED_ALIAS_RE = /'([a-z][a-z0-9]*)'/g;

/** 도움말 전문 → `--model` 설명이 인용한 별칭(등장 순, 중복 없음). `--model` 옵션이 없거나 인용이 없으면 빈 배열. */
export function parseNativeModelAliasesFromHelp(help: string): string[] {
  if (typeof help !== 'string' || help.length === 0) return [];
  const block = MODEL_OPTION_BLOCK_RE.exec(help)?.[0];
  if (!block) return [];
  const out: string[] = [];
  for (const m of block.matchAll(QUOTED_ALIAS_RE)) {
    const alias = m[1]!;
    if (!out.includes(alias)) out.push(alias);
  }
  return out;
}
