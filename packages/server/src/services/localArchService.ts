/**
 * §5.19 (E) — 받기 목록에 되는 것만. 받기 전 GGUF 머리만 읽어 `general.architecture` 를 알고(실측 70바이트), 되는지는 실측 장부로 판정한다.
 * ⚠ **파일 하나가 깨진 것을 구조 탓으로 돌리지 마라** — 2026-08-21: 비공식 `Qwen3.5-9B-IQ4_XS` 만 깨졌고 같은 구조 `Qwen3.8-27B-UD-Q4_K_M` 은 b10509 에서 40.6 tok/s. 구조를 막으면 계열 전체가 사라진다.
 * 씨앗은 여러 양자화에서 재현된 실패만, 한 파일은 `.output-check.json` 으로. 저장소 하나는 구조가 같아 한 번만 조회한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LOCAL_MODEL_DIR_NAME } from '@vibisual/shared';
import { logger } from '../logger.js';

/** 구조 이름을 읽는 데 필요한 앞부분. 실측 70바이트지만 넉넉히 잡아도 공짜에 가깝다. */
const HEAD_BYTES = 65536;

/** 직접 돌려 확인한 고장 구조 — 장부 씨앗(측정 기록이라 실측이 덮는다). **기준은 여러 양자화에서 재현된 실패**(머리말 `qwen35`). 비어 있음 = 아직 해당 없음. */
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
  // Legacy automatic checks promoted one file's failure to a whole model family.
  // A successful run proves support; those negative entries have no such evidence.
  if (measured === 'ok') return measured;
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
  /** 학습 문맥 길이(`<arch>.context_length`). 엔진이 조용히 이 값으로 깎아(`the slot context (%d) exceeds the training context of the model (%d) - capping`) 게이지가 거짓이 된다. */
  contextLength: number | null;
  /**
   * §5.25 (G-2) — 모델 파일이 권하는 온도(`general.sampling.temp`). 엔진은 요청에 온도가 없으면
   * 이 값을 쓴다 — 설정 창이 빈 온도 칸에 "지금 쓰이는 값"을 적는 두 번째 근거다.
   */
  samplingTemp: number | null;
}

/**
 * GGUF 앞부분을 훑어 우리가 쓰는 값을 뽑는다. 못 읽으면 그 칸만 `null`.
 * 값 종류는 GGUF 규약 그대로 — 문자열/배열/숫자를 건너뛰며 앞에서부터 읽는다.
 */
export function parseGgufMeta(buf: Buffer): GgufMeta {
  const out: GgufMeta = { architecture: null, contextLength: null, samplingTemp: null };
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
        case 6: return buf.readFloatLE(at);
        case 12: return buf.readDoubleLE(at);
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
        // float32 로 적혀 0.7 이 0.699999988 로 읽힌다 — 사람이 적은 자릿수로 되돌린다.
        if (key === 'general.sampling.temp' && value !== null && Number.isFinite(value) && value >= 0) {
          out.samplingTemp = Number(value.toFixed(4));
        }
      }
      // 셋 다 찾았으면 더 볼 것이 없다 — 머리 64KB 를 끝까지 훑지 않는다.
      if (out.architecture !== null && out.contextLength !== null && out.samplingTemp !== null) return out;
      if (p > buf.length) return out;
    }
    return out;
  } catch {
    return out; // 앞부분만 받아서 못 읽었을 뿐이다 — 틀렸다고 말하지 않는다
  }
}

/** `general.architecture` 만 꺼낸다(판정은 `parseGgufMeta` 한 곳). 못 읽으면 `null` — 단정하지 않는다. */
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
    return { architecture: null, contextLength: null, samplingTemp: null };
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
