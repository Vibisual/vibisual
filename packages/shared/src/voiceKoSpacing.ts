/**
 * §5.5 #17-38 ⑱ — 붙어 나온 한국어를 띄운다. ⑫ 엔진은 띄어쓰기·문장부호를 내지 않고 관련 옵션·모델도 없다(`--help` 실측 2026-09-04).
 * 사전이 아니라 규칙이다 — 목표는 맞춤법이 아니라 사람이 손볼 draft·에이전트가 읽기 좋은 조사 단위 글이고, 같은 입력은 늘 같은 결과다.
 * 끊는 자리를 그 자리만 보고 정하지 않는다(탐욕적으로 끊으면 `없을까`→`없을 까`·`것같은데`→`것같은 데`) — 양쪽 조각이 둘 다 성립하는 자리만 고른다.
 */

/** 이 토막에 한글 음절이 들어 있는가. 없으면 띄어쓰기 복원을 시도하지 않는다. */
export function hasHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}

/**
 * 공백 없이 이어지는 한글 덩어리가 이만큼을 넘으면 **붙어 나온 것**으로 본다.
 * 한국어 어절은 조사까지 붙어도 대개 이 안에 들어온다.
 */
const KO_RUN_MAX = 6;

/**
 * 이미 띄어져 있으면(가장 긴 한글 덩어리가 짧으면) 손대지 않는다 — 엔진이 공백을 내기 시작해도 두 번 띄우지 않게.
 * ⚠ `splitHangulRun` 의 입구 조건과 같은 값(`KO_RUN_MAX`)이어야 한다 — 어긋나면 결과를 다시 넣을 때 더 끊겨 불안정해진다(실측 2026-09-04).
 */
function alreadySpaced(text: string): boolean {
  const runs = text.match(/[가-힣]+/g);
  if (runs === null || runs.length === 0) return true;
  let longest = 0;
  for (const run of runs) longest = Math.max(longest, run.length);
  return longest <= KO_RUN_MAX;
}

/**
 * 어절 끝 꼬리(조사·어미) — 이 뒤에서 끊으면 대체로 맞는 것. 긴 것이 이긴다(`했습니다` 를 `다` 로 끊지 않게, `longestTailAt`).
 * 한 글자 조사는 낱말 첫 글자(`가방`·`도구`)가 되기 쉬워 `KO_TAILS_RISKY` 로 따로 두고 더 엄하게 본다.
 */
const KO_TAILS: readonly string[] = [
  // ── 종결 어미 — 여기서 끊으면 문장이 갈린다. 가장 확실한 자리다.
  '겠습니다', '했습니다', '입니다', '습니다', '됩니다', '합니다', '십시오',
  '이에요', '예요', '에요', '어요', '아요', '해요', '지요', '네요', '군요',
  '세요', '주세요', '봅니다', '드립니다',
  // ── 연결 어미 — 문장 안에서 마디를 가른다.
  '자마자', '때문에', '위해서', '으로써', '는데도',
  '니까', '는데', '지만', '어서', '아서', '와서', '가서', '려고', '면서', '거나', '든지',
  '도록', '게끔', '더니', '길래', '느라', '로서', '해서', '하고', '한데',
  // ── 조사(두 글자 이상) — 여기가 한국어 어절 경계의 대부분이다.
  '이라고', '이라는', '에서는', '으로는', '까지는',
  '라고', '라는', '이란', '에서', '에게', '한테', '으로', '까지', '부터',
  '보다', '처럼', '만큼', '마다', '조차', '밖에', '에는', '에도',
  '와의', '과의', '으로도', '이라도',
  // ── 관형형 어미 — 뒤에 명사가 온다. `있는|것`·`고치는|중` 처럼 어절이 갈리는 자리다.
  '하는', '되는', '있는', '없는', '같은', '많은', '작은', '좋은',
];

/** 한 글자 조사 — `없을까` 처럼 뒤에 어미가 더 붙으면 틀리므로 뒤 조각이 홀로 설 수 있을 때만 끊는다(`canSplit`). */
const KO_TAILS_RISKY: readonly string[] = ['를', '을', '은', '는', '의', '와', '과', '도'];

/** 어절 첫머리(접속부사·지시어·부사) — 앞말과 붙을 이유가 거의 없어 이 앞에서 끊는다. 꼬리 규칙이 못 잡는 자리(`…들어가니까문제가`)를 메운다. */
const KO_HEADS: readonly string[] = [
  '왜냐하면', '그러니까', '그러면서', '그리고', '그래서', '그런데', '하지만', '그러면',
  '어떻게', '무엇을', '이게', '저게', '그게', '이거', '저거', '그거', '이런', '저런', '그런',
  '여기', '저기', '거기', '이번', '저번', '지난', '다음',
  '전부', '모두', '다시', '지금', '아직', '아마', '역시', '결국', '만약',
  '정말', '진짜', '너무', '조금', '많이', '빨리', '먼저', '나중', '항상', '자꾸',
];

/**
 * **꼬리만으로 이뤄진 조각을 만들지 않기 위한 하한.** `이 것 을` 처럼 낱글자로 흩어지면
 * 붙어 있을 때보다 읽기 어렵다.
 */
const KO_MIN_PIECE = 2;

/** 이 자리에서 끝나는 **가장 긴** 꼬리. 없으면 `null`. */
function longestTailAt(run: string, end: number): { tail: string; risky: boolean } | null {
  let best: { tail: string; risky: boolean } | null = null;
  const consider = (tail: string, risky: boolean): void => {
    if (tail.length > end) return;
    if (!run.startsWith(tail, end - tail.length)) return;
    if (best === null || tail.length > best.tail.length) best = { tail, risky };
  };
  for (const t of KO_TAILS) consider(t, false);
  for (const t of KO_TAILS_RISKY) consider(t, true);
  return best;
}

/**
 * 끊은 자리 바로 뒤가 조사·어미로 시작하면 낱말 한가운데를 자른 것이다(`가져와`+`서화면에` — 실측 2026-09-04). 그 자리는 버리고 오른쪽을 본다.
 * 첫 글자 하나로만 본다 — 목록 전체를 접두 검사하면 `서버`·`도구` 같은 멀쩡한 낱말까지 막는다.
 */
const KO_PARTICLE_HEAD_CHARS = new Set(['을', '를', '은', '는', '의', '와', '과', '도', '만', '서', '가', '이']);

function startsWithParticle(run: string, at: number): boolean {
  const ch = run.charAt(at);
  if (ch.length === 0) return false;
  if (!KO_PARTICLE_HEAD_CHARS.has(ch)) return false;
  // **머리말로 시작하면 조사가 아니다** — `이번`·`이거`·`그거` 는 어절의 시작이 맞다.
  return longestHeadAt(run, at) === null;
}

/** 이 자리에서 시작하는 **가장 긴** 머리. 없으면 `null`. */
function longestHeadAt(run: string, start: number): string | null {
  let best: string | null = null;
  for (const h of KO_HEADS) {
    if (!run.startsWith(h, start)) continue;
    if (best === null || h.length > best.length) best = h;
  }
  return best;
}

/**
 * 이 자리에서 끊어도 되는가 — 양쪽 조각을 둘 다 본다(`없을`+`까` 는 왼쪽만 보면 그럴듯하다).
 * @param leftLen  왼쪽 조각의 길이(= 지금까지 모은 글자 수).
 * @param rightLen 오른쪽에 남는 글자 수.
 * @param risky    한 글자 조사로 끊는가 — 그렇다면 더 엄하게 본다.
 */
function canSplit(leftLen: number, rightLen: number, risky: boolean): boolean {
  if (leftLen < KO_MIN_PIECE) return false;
  // 오른쪽에 아무것도 안 남으면 끊어 봐야 결과가 같다.
  if (rightLen < KO_MIN_PIECE) return false;
  // 한 글자 조사는 **뒤에 온전한 어절이 남을 때만** — `없을까` 의 `까` 를 떼어내지 않는다.
  if (risky && rightLen < KO_MIN_PIECE + 1) return false;
  return true;
}

/** 한 덩어리를 어절 단위로 끊는다 — 한 번만 훑는다(역추적 ❌, 선형·결정적). 가장 긴 꼬리·머리를 보고 양쪽 조각이 성립할 때만 끊는다. */
function splitHangulRun(run: string): string {
  if (run.length <= KO_RUN_MAX) return run;

  const out: string[] = [];
  let pieceStart = 0;

  // **덩어리 맨 앞의 머리말은 뒤에서 끊는다.** `이게컴퓨터의…` 의 `이게` 는 어절 하나인데,
  //   아래 되돌이는 "머리말 **앞**에서 끊기"라 맨 앞에서는 끊을 것이 없어 그냥 지나친다.
  //   그러면 `이게컴퓨터의` 가 통째로 한 조각이 된다 — 실측에서 그렇게 나왔다.
  const leadHead = longestHeadAt(run, 0);
  if (leadHead !== null && run.length - leadHead.length >= KO_MIN_PIECE) {
    out.push(leadHead);
    pieceStart = leadHead.length;
  }

  for (let i = pieceStart + 1; i < run.length; i += 1) {
    const leftLen = i - pieceStart;
    const rightLen = run.length - i;

    // ② **머리 앞에서 끊기** — 지금 자리에서 접속부사·지시어가 시작되면 그 앞을 자른다.
    //   먼저 본다: `…니까문제가` 처럼 앞이 어미로 끝나지 않는 자리를 이쪽만 잡는다.
    //   (덩어리 **맨 앞**의 머리말은 끊을 것이 없으므로 `leftLen` 조건이 자연히 걸러 준다.)
    const head = longestHeadAt(run, i);
    if (head !== null && canSplit(leftLen, rightLen, false)) {
      out.push(run.slice(pieceStart, i));
      pieceStart = i;
      continue;
    }

    // ⚠ **오른쪽 조각이 조사로 시작하면 그 자리는 틀렸다** — 우리가 낱말 한가운데를 잘랐다는
    //   뜻이다(`가져와|서화면`·`에서|는서버`). 버리고 더 오른쪽 자리를 본다.
    if (startsWithParticle(run, i)) continue;

    // ① **꼬리 뒤에서 끊기** — 여기서 끝나는 가장 긴 조사·어미를 찾는다.
    const tail = longestTailAt(run, i);
    if (tail === null) continue;
    // 꼬리만으로 이뤄진 조각(`을` 하나)은 만들지 않는다 — 앞말이 함께 있어야 어절이다.
    if (leftLen <= tail.tail.length) continue;
    if (!canSplit(leftLen, rightLen, tail.risky)) continue;
    out.push(run.slice(pieceStart, i));
    pieceStart = i;
  }

  out.push(run.slice(pieceStart));
  return out.join(' ');
}

/** 한 토막의 띄어쓰기를 복원한다(한글이 없거나 이미 띄어졌으면 그대로). 한글 덩어리 안에서만 끊어 `API를` 같은 영문+조사는 떼지 않는다. */
export function respaceKorean(text: string): string {
  if (text.length === 0) return text;
  if (!hasHangul(text)) return text;
  if (alreadySpaced(text)) return text;

  /**
   * 안정될 때까지 돌린다 — 끊은 뒤 짧아진 조각에서 비로소 보이는 경계가 있어, 한 번이면 `respace(respace(x)) !== respace(x)` 다.
   * 끊기만 하므로 반드시 멎지만 상한을 둔다 — 규칙을 잘못 손봐 진동해도 입력창이 멈추지 않게.
   */
  let out = text;
  for (let pass = 0; pass < RESPACE_MAX_PASSES; pass += 1) {
    const next = out.replace(/[가-힣]+/g, (run) => splitHangulRun(run));
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 위 되돌이의 상한. 실제로는 두세 번이면 멎는다 — 이건 규칙이 망가졌을 때의 안전판이다. */
const RESPACE_MAX_PASSES = 6;
