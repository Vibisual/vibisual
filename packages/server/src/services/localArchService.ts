/**
 * localArchService.ts — §5.19 (E) "받기 목록에 되는 것만 올린다".
 *
 * **문제**: 허깅페이스의 GGUF 를 전부 내놓으면 **이 엔진이 못 돌리는 모델**까지 받힌다.
 * 사용자는 수 GB 를 받고 프롬프트를 친 뒤에야 그 사실을 안다. 올라마가 "되는 것만" 보여주는
 * 자리를 우리는 비워 두고 있었다.
 *
 * **해법 두 줄**:
 *  1. 받기 전에 **파일 머리만** 읽어 구조(`general.architecture`)를 안다 — GGUF 는 그 값을
 *     맨 앞에 두므로 수십 바이트면 충분하다(실측 70바이트). 수 GB 를 받아 볼 필요가 없다.
 *  2. 그 구조가 이 엔진에서 되는지는 **우리가 실제로 돌려 본 결과**로 판정한다(§5.19 (E)
 *     받은 뒤 점검). 하드코딩한 화이트리스트가 아니라 실측 장부이므로, 엔진이 새 빌드에서
 *     그 구조를 지원하게 되면 다음 실측이 판정을 스스로 뒤집는다.
 *
 * **⚠ 파일 하나가 깨진 것을 구조 탓으로 돌리지 마라 (2026-08-21 오판 정정)**: `qwen35` 를
 * "이 엔진이 못 돌리는 구조"로 씨앗에 올린 적이 있다. 근거는 `Qwen3.5-9B-IQ4_XS.gguf` 한
 * 파일이 세 빌드·두 백엔드·올라마에서까지 뜻 없는 글자만 뱉은 것이었다. 그러나 같은 구조의
 * `Qwen3.8-27B-UD-Q4_K_M`(공식 unsloth 양자화)은 같은 빌드(b10509)에서 40.6 tok/s 로 멀쩡히
 * 답한다 — 깨진 것은 **구조가 아니라 그 비공식 IQ4_XS 양자화 파일**이었다. 그 오판이 사는
 * 동안 트렌드 1위 계열(Qwen3.8 · Ornith-1.5 · Qwen-AgentWorld)이 통째로 목록에서 가려졌다.
 * 그래서 씨앗의 자격은 **여러 양자화에서 재현된 실패**이고, 한 파일의 실패는 그 파일의
 * 판정(`.output-check.json`)으로만 남긴다.
 *
 * 한 저장소의 GGUF 들은 같은 모델의 양자화 갈래라 **구조가 같다** — 그래서 조회는
 * 저장소당 한 번이면 된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LOCAL_MODEL_DIR_NAME } from '@vibisual/shared';
import { logger } from '../logger.js';

/** 구조 이름을 읽는 데 필요한 앞부분. 실측 70바이트지만 넉넉히 잡아도 공짜에 가깝다. */
const HEAD_BYTES = 65536;

/**
 * 우리가 **직접 돌려 보고** 안 된다고 확인한 구조들. 판정 장부의 씨앗이다.
 *
 * 화이트리스트가 아니라 **측정 기록**이라는 점이 중요하다 — 새로 설치한 사용자가 같은 벽에
 * 부딪히지 않게 하되, 실제 측정이 이 값을 언제든 덮어쓴다.
 *
 * **올리는 기준은 "여러 양자화에서 재현된 실패"다.** 한 파일이 깨진 것은 그 파일의 문제일
 * 확률이 훨씬 높고(비공식 양자화는 흔히 깨진다), 구조를 막으면 그 계열 **전부**가 목록에서
 * 사라진다 — 머리말의 `qwen35` 오판이 그 대가를 보여 준다. 한 파일의 실패는 구조가 아니라
 * 그 파일의 판정(`.output-check.json`)으로 남긴다.
 *
 * 지금은 비어 있다 — 그 조건을 만족한 구조가 아직 없다는 뜻이지, 이 그물이 없다는 뜻이 아니다.
 */
export const MEASURED_BROKEN: Readonly<Record<string, string>> = {};

export type ArchVerdict = 'ok' | 'broken' | 'unknown';

// ─── 판정 장부 ───

interface VerdictFile {
  /** 엔진 빌드마다 따로 둔다 — 새 빌드가 지원하기 시작하면 옛 판정은 남의 이야기다. */
  [build: string]: Record<string, 'ok' | 'broken'>;
}

function verdictPath(): string {
  return path.join(os.homedir(), '.vibisual', LOCAL_MODEL_DIR_NAME, '.arch-verdicts.json');
}

function readVerdicts(): VerdictFile {
  try {
    const j = JSON.parse(fs.readFileSync(verdictPath(), 'utf8')) as VerdictFile;
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/** 실제로 돌려 본 결과를 장부에 남긴다. 실패해도 조용히 넘어간다(표시용 정보다). */
export function recordArchVerdict(build: string, arch: string, verdict: 'ok' | 'broken'): void {
  if (!arch) return;
  try {
    const all = readVerdicts();
    const forBuild = all[build] ?? {};
    forBuild[arch] = verdict;
    all[build] = forBuild;
    fs.mkdirSync(path.dirname(verdictPath()), { recursive: true });
    fs.writeFileSync(verdictPath(), JSON.stringify(all), 'utf8');
    logger.info(`[localArch] ${arch} -> ${verdict} (build ${build})`);
  } catch (err) {
    logger.warn('[localArch] verdict record failed', err);
  }
}

/**
 * 이 구조가 이 엔진에서 되는가. 실측 장부가 먼저고, 없으면 씨앗을 본다.
 * 아무것도 모르면 `unknown` — **모르면 막지 않는다.**
 */
export function getArchVerdict(build: string, arch: string | null): ArchVerdict {
  if (!arch) return 'unknown';
  const measured = readVerdicts()[build]?.[arch];
  if (measured) return measured;
  if (arch in MEASURED_BROKEN) return 'broken';
  return 'unknown';
}

/** 왜 안 되는지 한 줄(있으면). 없으면 빈 문자열. */
export function archBrokenReason(arch: string | null): string {
  if (!arch) return '';
  return MEASURED_BROKEN[arch] ?? '';
}

// ─── 구조 읽기 ───

/** GGUF 머리에서 우리가 쓰는 것들. 못 읽은 칸은 `null`(모르면 단정하지 않는다). */
export interface GgufMeta {
  architecture: string | null;
  /**
   * 이 모델이 **학습된 문맥 길이**(`<arch>.context_length`).
   *
   * 이걸 모르면 사용자가 창을 아무리 크게 잡아도 소용이 없다 — 엔진이 조용히 학습 문맥으로
   * 깎으면서(`the slot context (%d) exceeds the training context of the model (%d) - capping`)
   * 화면 숫자와 실제가 어긋난다. 값이 사실이어야 게이지도 사실이 된다.
   */
  contextLength: number | null;
}

/**
 * GGUF 앞부분을 훑어 우리가 쓰는 값을 뽑는다. 못 읽으면 그 칸만 `null`.
 * 값 종류는 GGUF 규약 그대로 — 문자열/배열/숫자를 건너뛰며 앞에서부터 읽는다.
 */
export function parseGgufMeta(buf: Buffer): GgufMeta {
  const out: GgufMeta = { architecture: null, contextLength: null };
  try {
    if (buf.length < 24 || buf.toString('latin1', 0, 4) !== 'GGUF') return out;
    let p = 4;
    const u32 = (): number => {
      const v = buf.readUInt32LE(p);
      p += 4;
      return v;
    };
    const u64 = (): number => {
      const v = Number(buf.readBigUInt64LE(p));
      p += 8;
      return v;
    };
    const str = (): string => {
      const n = u64();
      if (p + n > buf.length) throw new Error('short');
      const s = buf.toString('utf8', p, p + n);
      p += n;
      return s;
    };
    const width: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
    /** 숫자 칸을 **읽어서** 돌려준다(종전에는 폭만큼 건너뛰기만 했다). */
    const num = (type: number): number | null => {
      const at = p;
      p += width[type] ?? 4;
      if (at + (width[type] ?? 4) > buf.length) return null;
      switch (type) {
        case 0: return buf.readUInt8(at);
        case 1: return buf.readInt8(at);
        case 2: return buf.readUInt16LE(at);
        case 3: return buf.readInt16LE(at);
        case 4: return buf.readUInt32LE(at);
        case 5: return buf.readInt32LE(at);
        case 10: return Number(buf.readBigUInt64LE(at));
        case 11: return Number(buf.readBigInt64LE(at));
        default: return null;
      }
    };

    u32(); // version
    u64(); // tensor count
    const kvCount = u64();
    for (let i = 0; i < kvCount; i += 1) {
      const key = str();
      const type = u32();
      if (type === 8) {
        const value = str();
        if (key === 'general.architecture') out.architecture = value;
      } else if (type === 9) {
        const elemType = u32();
        const n = u64();
        if (elemType === 8) {
          for (let j = 0; j < n; j += 1) str();
        } else {
          p += (width[elemType] ?? 4) * n;
        }
      } else {
        const value = num(type);
        // 키는 `<arch>.context_length` 라 구조 이름을 몰라도 꼬리로 알아본다.
        if (key.endsWith('.context_length') && value !== null && value > 0) out.contextLength = value;
      }
      // 둘 다 찾았으면 더 볼 것이 없다 — 머리 64KB 를 끝까지 훑지 않는다.
      if (out.architecture !== null && out.contextLength !== null) return out;
      if (p > buf.length) return out;
    }
    return out;
  } catch {
    return out; // 앞부분만 받아서 못 읽었을 뿐이다 — 틀렸다고 말하지 않는다
  }
}

/**
 * GGUF 앞부분에서 `general.architecture` 를 뽑는다. 못 읽으면 `null`(단정하지 않는다).
 * 판정은 `parseGgufMeta` 한 곳에 있고 여기서는 그 한 칸만 꺼낸다.
 */
export function parseArchitecture(buf: Buffer): string | null {
  return parseGgufMeta(buf).architecture;
}

/** 받아 둔 파일에서 머리를 읽는다 — 구조와 학습 문맥을 한 번에. */
export function readLocalGgufMeta(file: string): GgufMeta {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return parseGgufMeta(buf.subarray(0, read));
  } catch {
    return { architecture: null, contextLength: null };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 이미 닫혔으면 그만 */
      }
    }
  }
}

/** 받아 둔 파일에서 읽는다. */
export function readLocalArchitecture(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return parseArchitecture(buf.subarray(0, read));
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 이미 닫혔으면 그만 */
      }
    }
  }
}

/** 같은 저장소를 다시 물으면 그때 받아 둔 답을 준다(조회는 저장소당 한 번이면 된다). */
const remoteCache = new Map<string, string | null>();

/**
 * 내려받기 **전에** 원격 파일의 구조를 읽는다 — 앞 64KB 만 `Range` 로 받는다.
 * 실패하면 `null`(모르면 막지 않는다).
 */
export async function probeRemoteArchitecture(url: string, cacheKey: string): Promise<string | null> {
  const cached = remoteCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'vibisual', range: `bytes=0-${String(HEAD_BYTES - 1)}` },
    });
    if (!res.ok) {
      remoteCache.set(cacheKey, null);
      return null;
    }
    const arch = parseArchitecture(Buffer.from(await res.arrayBuffer()));
    remoteCache.set(cacheKey, arch);
    return arch;
  } catch (err) {
    logger.warn(`[localArch] remote probe failed: ${cacheKey}`, err);
    remoteCache.set(cacheKey, null);
    return null;
  }
}
