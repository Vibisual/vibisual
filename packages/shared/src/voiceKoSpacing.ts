/**
 * voiceKoSpacing.ts — **§5.5 #17-38 ⑱ 붙어 나온 한국어를 띄운다.**
 *
 * ⑫ 가 데려온 엔진(sherpa-onnx + nemotron streaming RNNT)은 **띄어쓰기·문장부호를 내지 않는다**.
 * `sherpa-onnx-online-websocket-server --help` 실측(2026-09-04): spacing·punctuation 관련 옵션이
 * **하나도 없다** — `--rule-fsts`(역텍스트정규화)는 숫자·단위용이라 이 일을 못 하고, 별도
 * punctuation 모델은 우리가 받는 자산에 들어 있지 않다(682MB 위에 하나를 더 얹는 일이다).
 * 그래서 결과가 `이게컴퓨터의소리까지전부다마이크에들어가니까` 처럼 통째로 붙어 나온다.
 * 읽을 수는 있어도 **에이전트에게 주는 지시**로는 토큰이 엉켜 뜻이 흐려진다.
 *
 * ### 왜 사전이 아니라 규칙인가
 * 제대로 하려면 형태소 분석이 필요하고 그건 사전(수 MB)과 모델을 하나 더 들이는 일이다.
 * 여기서 노리는 것은 **완벽한 맞춤법이 아니라 읽고 고칠 수 있는 글**이다 — 결과는 입력창의
 * draft 로 들어가 사람이 손볼 수 있고(①), 에이전트도 붙은 글보다 조사 단위로 끊긴 글을 훨씬
 * 잘 읽는다. 사전이 없으니 어느 판올림에서도 같은 결과가 나온다.
 *
 * ### 왜 왼쪽부터 탐욕적으로 끊지 않는가 (첫 판을 갈아엎은 이유)
 * 처음에는 왼쪽에서 오른쪽으로 훑다 꼬리를 만나면 곧바로 끊었다. 실측에서 **세 가지가 한꺼번에
 * 무너졌다**(2026-09-04):
 *  - `없을까` 가 `없을 까` 로 갈렸다 — `을` 이 먼저 걸려서 뒤에 오는 `까` 를 못 봤다.
 *  - `그리고띄어쓰기가…` 가 통째로 안 끊겼다 — 머리말이 **맨 앞**에 있어 "앞 조각이 2자 이상"
 *    조건에 막혔다.
 *  - `것같은데` 가 `것같은 데` 가 됐다 — 끊고 **남는 조각**이 말이 되는지 아무도 안 봤다.
 * 공통 원인은 하나다: **끊는 자리를 그 자리만 보고 정했다.** 그래서 판정을 뒤집었다 —
 * 후보 자리를 전부 모아 두고 **끊었을 때 양쪽 조각이 둘 다 성립하는 자리만** 고른다.
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
 * 이미 사람이 읽을 만큼 띄어져 있는가 — 그러면 손대지 않는다.
 *
 * 엔진이 판올림되어 공백을 내기 시작하면 우리 규칙이 **두 번 띄우는** 쪽으로 망가진다.
 * 가장 긴 한글 덩어리가 짧으면(= 이미 끊겨 있으면) 그대로 둔다.
 *
 * ⚠ **이 판정과 `splitHangulRun` 의 입구 조건은 같은 값(`KO_RUN_MAX`)이어야 한다.** 둘이
 * 어긋나면 결과가 **불안정해진다**: 한 번 돌린 결과를 다시 넣었을 때 "전체로는 이미 띄어졌다"고
 * 판정하면서도 개별 덩어리는 더 끊는 자리가 생겨, 같은 말이 몇 번 지나갔느냐에 따라 달라진다.
 * 실측에서 잡았다(2026-09-04) — 받아쓰기는 토막을 이어 붙이는 일이라 이 불안정이 곧바로
 * 사용자 눈에 보인다.
 */
function alreadySpaced(text: string): boolean {
  const runs = text.match(/[가-힣]+/g);
  if (runs === null || runs.length === 0) return true;
  let longest = 0;
  for (const run of runs) longest = Math.max(longest, run.length);
  return longest <= KO_RUN_MAX;
}

/**
 * 어절 끝으로 삼을 꼬리들 — 조사와 어미.
 *
 * 담는 기준은 "이 꼬리 **뒤에서** 끊으면 대체로 맞는가" 하나다. **긴 것이 항상 이긴다**
 * (`했습니다` 를 `다` 로 끊지 않게 — 아래 `longestTailAt`). 그래도 한 글자짜리 조사는
 * 위험하다: `가방`의 `가`, `도구`의 `도` 처럼 **다른 낱말의 첫 글자**가 되기 쉽다. 그래서
 * 한 글자는 `KO_TAILS_RISKY` 로 따로 두고 **더 엄한 조건**을 건다(아래 `canSplit`).
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

/**
 * **한 글자 조사** — 경계일 확률이 높지만 낱말 안에 묻히기도 쉽다.
 *
 * `를`·`을`·`은`·`는`·`의`·`와`·`과`. 이것들 **뒤에서** 끊는 것 자체는 대개 맞지만,
 * `없을까`처럼 뒤에 어미가 더 붙는 자리에서는 틀린다. 그래서 이쪽은 "뒤에 남는 조각이
 * 홀로 설 수 있을 때만" 끊는다(`canSplit`).
 */
const KO_TAILS_RISKY: readonly string[] = ['를', '을', '은', '는', '의', '와', '과', '도'];

/**
 * 어절 첫머리로 삼을 머리들 — 이 앞에서 끊으면 대체로 맞다.
 *
 * 접속부사·지시어·부사는 **앞말과 붙을 이유가 거의 없다.** 꼬리 규칙이 못 잡는 자리를 이쪽이
 * 메운다(`…들어가니까문제가` 의 `문제` 처럼 앞이 어미로 끝나지 않는 경우).
 */
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
 * **끊은 자리 바로 뒤가 조사·어미로 시작하는가** — 그렇다면 그 자리는 틀린 자리다.
 *
 * 두 번째 실측(2026-09-04)에서 남은 결함이 전부 이 모양이었다:
 *  - `가져와서화면에` → `가져와` + `서화면에` (`와` 로 끊어 `서` 를 앞말에서 떼어냈다)
 *  - `작업에서는서버` → `작업에서` + `는서버` (`에서` 로 끊어 `는` 을 떼어냈다)
 * 어절은 **조사로 시작하지 않는다.** 오른쪽 조각의 첫 글자가 조사·어미의 첫 글자면 우리가
 * 낱말 한가운데를 자른 것이므로, 그 자리는 버리고 더 오른쪽 자리를 본다.
 *
 * 판정은 **첫 글자 하나**로 한다. 조사가 붙는 자리는 어차피 한 음절부터 시작하고, 목록 전체를
 * 접두 검사하면 `서버`·`도구`처럼 조사로 시작하는 **멀쩡한 낱말**까지 막아 버린다.
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
 * **이 자리에서 끊어도 되는가** — 끊고 나서 생기는 **두 조각을 둘 다** 본다.
 *
 * 첫 판이 무너진 그 자리다: `없을까` 를 `없을`+`까` 로 가르면 왼쪽은 그럴듯한데 오른쪽이
 * 한 글자다. 조각 하나만 보고 정하면 이런 것을 절대 못 막는다.
 *
 * @param leftLen  끊었을 때 **왼쪽 조각**의 길이(= 지금까지 모은 글자 수).
 * @param rightLen 끊었을 때 **오른쪽에 남는** 글자 수.
 * @param risky    한 글자 조사로 끊는 것인가 — 그렇다면 더 엄하게 본다.
 */
function canSplit(leftLen: number, rightLen: number, risky: boolean): boolean {
  if (leftLen < KO_MIN_PIECE) return false;
  // 오른쪽에 아무것도 안 남으면 끊어 봐야 결과가 같다.
  if (rightLen < KO_MIN_PIECE) return false;
  // 한 글자 조사는 **뒤에 온전한 어절이 남을 때만** — `없을까` 의 `까` 를 떼어내지 않는다.
  if (risky && rightLen < KO_MIN_PIECE + 1) return false;
  return true;
}

/**
 * 한 덩어리를 어절 단위로 끊는다.
 *
 * 왼쪽에서 오른쪽으로 **한 번만** 훑는다(역추적 ❌ — 길이에 선형이고 같은 입력은 항상 같은
 * 결과다). 다만 각 자리에서 **가장 긴** 꼬리·머리를 보고, 끊었을 때 **양쪽 조각이 둘 다
 * 성립할 때만** 끊는다. 그 두 가지가 첫 판과 다른 전부다.
 */
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

/**
 * 인식 결과 한 토막의 띄어쓰기를 복원한다. 한글이 없거나 이미 띄어져 있으면 **그대로** 돌려준다.
 *
 * 숫자·영문·기호는 건드리지 않고 지나간다 — 한글 덩어리만 골라 끊는다. 그래서
 * `API를호출한다` 에서 `API` 는 그대로 남는다.
 *
 * ⚠ **영문 바로 뒤에 붙은 조사는 떼지 않는다** — `API를` 을 `API 를` 로 만들면 조사가 홀로
 * 떠서 오히려 못 읽는다. 한글 덩어리 안에서만 끊으므로 이 문제는 구조적으로 안 생긴다.
 */
export function respaceKorean(text: string): string {
  if (text.length === 0) return text;
  if (!hasHangul(text)) return text;
  if (alreadySpaced(text)) return text;

  /**
   * **안정될 때까지 돌린다** — 한 번으로는 모자란 자리가 있다.
   *
   * 덩어리를 끊고 나면 그 조각들은 더 짧아지고, 짧아진 조각에서 **비로소 보이는 경계**가 있다
   * (`전부다마이크에…` 의 `전부` 는 앞이 잘린 뒤에야 덩어리 맨 앞에 온다). 한 번만 돌리면
   * `respace(respace(x)) !== respace(x)` 가 되어, 받아쓰기처럼 토막을 이어 붙이는 자리에서
   * **같은 말이 몇 번 지나갔느냐에 따라 다르게** 보인다.
   *
   * 규칙은 **끊기만 하고 붙이지 않으므로** 조각 수는 단조 증가하고 글자 수를 넘을 수 없다 —
   * 반드시 멎는다. 그래도 상한을 둔다: 규칙을 잘못 손봐 진동하는 판이 생겨도 여기서 멎지,
   * 사용자 입력창이 멈추지는 않게.
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
