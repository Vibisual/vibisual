/**
 * §4 엔진 다리 — 서버 쪽: 동봉 모드를 실을 폴더와 모드가 올린 사실. 영속하지 않는다 — 런타임 관측이다(§3.6-1 InstructionsLoaded 와 같은 성격, 재시작하면 우리가 띄운 세션도 내려간다).
 * 1. 싣기 — 동봉 모드(`out/mods/vibisual-bridge/`)를 `~/.vibisual/mods/<지문>/vibisual-bridge/` 에 제 모양(`.claude-plugin/plugin.json` + `hooks/`)으로 옮기고 `--plugin-dir` 로 준다.
 *    설치 폴더를 그대로 넘기지 않는다 — 2.1.294 이하는 `-p`·SDK 세션에서 그 폴더에 타입 파일을 써 넣고(2.1.295 수정), 인터랙티브는 폴더를 감시한다. 패키지는 점 폴더가 빠질 수 있어 매니페스트를 평평하게 싣고 여기서 세운다.
 * 2. 판단 — 옵션창 스위치(기본 켬) · 실행본 ≥ 2.1.287 · 옮기기 성공, 셋 다일 때만 싣는다. 판올림을 모르면 그 스폰엔 안 싣고 뒤에서 잰다(스폰은 동기). 아니면 인자가 붙지 않는다(다리 없는 스폰과 바이트 단위로 같다).
 * 3. 사실 — `POST /api/engine-bridge` 신고를 키(CMD = 터미널 칸, 헤드리스 = 세션 탭)마다 한 벌로 세운다. 판정(생존 판정 건너뛰기·유휴 강등 보류·CMD 상태)은 읽는 쪽.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ENGINE_BRIDGE_PLUGIN_NAME,
  ENGINE_BRIDGE_MIN_CLI_VERSION,
  ENGINE_BRIDGE_STATE_MAX,
  ENGINE_BRIDGE_ENDED_KEEP_MS,
  ENGINE_BRIDGE_STALE_MS,
  capMapSize,
  engineBridgeKeyOf,
  engineBridgeVouchesRunning,
  describeEngineBridgeForProbe,
  isEngineBridgeCliSupported,
  isEngineBridgeFresh,
  isEngineBridgeTurnRunning,
  normalizeEngineBridgeTurnEndReason,
  type EngineBridgeReport,
  type EngineBridgeState,
  type EngineBridgeStatus,
} from '@vibisual/shared';

import { getClaudeBin } from './claudeBin.js';
import { probeClaudeBinVersion } from './claudeVersionService.js';
import { userDefaultsService } from './userDefaultsService.js';
import { logger } from '../logger.js';

/** 옮겨 놓은 폴더가 다 쓰였다는 표식. 이것이 없는 폴더는 반쯤 남은 시도라 다시 쓴다. */
const COMPLETE_MARKER = '.vibisual-complete';
/** 옮기기에 실패하면 이만큼은 다시 시도하지 않는다(스폰마다 디스크를 두드리지 않게). */
const MATERIALIZE_RETRY_MS = 60_000;
/** 판올림을 못 읽었을 때 다시 재기까지의 간격. */
const VERSION_RETRY_MS = 10 * 60_000;
/** 다른 프로세스가 쓰는 중일 수 있는 임시 폴더는 이만큼 지나야 걷는다. */
const TMP_STALE_MS = 60_000;

/**
 * 동봉 파일 목록 — 원본 자리 후보(앞이 먼저)와 옮길 자리. 목록이 정해져 있어야 지문이 흔들리지 않고
 * 엉뚱한 파일이 엔진에 실리지 않는다.
 */
const MOD_FILES: ReadonlyArray<{ from: readonly string[]; to: string }> = [
  { from: ['plugin.json', path.join('.claude-plugin', 'plugin.json')], to: path.join('.claude-plugin', 'plugin.json') },
  { from: [path.join('hooks', 'hooks.json')], to: path.join('hooks', 'hooks.json') },
  { from: [path.join('hooks', 'register.js')], to: path.join('hooks', 'register.js') },
];

/** 동봉 모드를 옮겨 놓는 곳 — 사용자 레포 밖, MCP 설정·CMD 규칙 폴더와 같은 `~/.vibisual` 아래. */
export function defaultEngineBridgeModsRoot(): string {
  return path.join(os.homedir(), '.vibisual', 'mods');
}

/**
 * 동봉 모드를 `<modsRoot>/<지문>/vibisual-bridge/` 로 옮겨 놓고 그 폴더를 돌려준다.
 * 지문은 원본 내용에서 나온다 — 엔진이 써 넣는 타입 파일과 무관하게 같은 판이면 같은 폴더를 다시 쓴다. 임시 폴더 → rename 이라 반쯤 쓴 폴더를 넘기지 않는다.
 * 다른 지문의 옛 폴더는 걷되, 안 지워지면(Windows 가 쥐고 있으면) 둔다.
 * @returns 실을 폴더. 원본 파일이 하나라도 없으면 null.
 */
export function materializeEngineBridgeMod(sourceDir: string, modsRoot: string): string | null {
  const files: Array<{ to: string; data: Buffer }> = [];
  for (const f of MOD_FILES) {
    const src = f.from.map((rel) => path.join(sourceDir, rel)).find((p) => fs.existsSync(p));
    if (!src) return null;
    files.push({ to: f.to, data: fs.readFileSync(src) });
  }
  const hash = crypto.createHash('sha256');
  for (const f of files) {
    // 구분자는 OS 와 무관하게 접는다 — 같은 내용이 OS 마다 다른 지문이 되지 않게.
    hash.update(f.to.replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(f.data);
    hash.update('\0');
  }
  const stamp = hash.digest('hex').slice(0, 16);
  const versionDir = path.join(modsRoot, stamp);
  const pluginDir = path.join(versionDir, ENGINE_BRIDGE_PLUGIN_NAME);
  const marker = path.join(versionDir, COMPLETE_MARKER);
  if (fs.existsSync(marker)) return pluginDir;

  fs.mkdirSync(modsRoot, { recursive: true });
  const tmp = path.join(modsRoot, `${stamp}.tmp-${process.pid}-${Date.now()}`);
  try {
    for (const f of files) {
      const dest = path.join(tmp, ENGINE_BRIDGE_PLUGIN_NAME, f.to);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.data);
    }
    fs.writeFileSync(path.join(tmp, COMPLETE_MARKER), stamp, 'utf8');
    // 표식 없이 남은 같은 지문 폴더는 넘긴 적이 없는 반쪽짜리다 — 걷고 새로 앉힌다.
    if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true, force: true });
    fs.renameSync(tmp, versionDir);
  } catch (err) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 다음 정리 때 걷힌다 */ }
    if (fs.existsSync(marker)) return pluginDir; // 다른 쪽이 먼저 끝냈다
    throw err;
  }
  pruneEngineBridgeMods(modsRoot, stamp);
  return pluginDir;
}

/** 다른 지문의 옛 폴더와 오래된 임시 폴더를 걷는다. 실패는 무시한다(다음에 다시 걷는다). */
function pruneEngineBridgeMods(modsRoot: string, keep: string): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(modsRoot, { withFileTypes: true }); } catch { return; }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keep) continue;
    const full = path.join(modsRoot, entry.name);
    if (entry.name.includes('.tmp-')) {
      try {
        if (now - fs.statSync(full).mtimeMs < TMP_STALE_MS) continue;
      } catch { continue; }
    }
    try { fs.rmSync(full, { recursive: true, force: true }); } catch { /* 쥐고 있는 프로세스가 있으면 다음에 */ }
  }
}

/** `ingest` 의 결과 — 받은 쪽(라우트)이 화면에 반영할 가장자리. */
export interface EngineBridgeIngestResult {
  accepted: boolean;
  key: string;
  /** 이번 신고에 실린 턴·세션 가장자리(순서대로). */
  edges: Array<'turn-start' | 'turn-end' | 'clear' | 'end'>;
}

/** §2.4 생존 판정이 읽는 한 벌. */
export interface EngineBridgeSessionFacts {
  /** 묻지 않아도 된다(턴이 돌고 최근 진척이 있다). */
  vouches: boolean;
  /** 엔진이 지금 턴이 돈다고 말한다. */
  turnRunning: boolean;
  /** 판정 모델에게 실어 보낼 증거 한 줄. */
  line: string;
  /** 지금 도는 도구 이름(있으면). */
  toolInFlight?: string;
}

export class EngineBridgeService {
  private sourceDir: string | null = null;
  private pluginDir: string | null = null;
  private materializeFailedAt = 0;
  private readonly versions = new Map<string, { version: string | null; at: number }>();
  private readonly probing = new Set<string>();
  private readonly states = new Map<string, EngineBridgeState>();

  constructor(private readonly modsRoot: () => string = defaultEngineBridgeModsRoot) {}

  /** desktop main 이 동봉 폴더(`out/mods/vibisual-bridge`)를 주입한다. 지금 실행본의 판올림도 함께 재 둔다. */
  setSourceDir(dir: string): void {
    this.sourceDir = dir;
    this.pluginDir = null;
    this.materializeFailedAt = 0;
    try {
      this.probeVersion(getClaudeBin().binPath);
    } catch {
      // 실행본을 못 찾으면 첫 스폰 때 다시 본다.
    }
  }

  /** 다른 자리(부팅·CLI 갱신 때의 훅 전송 판정)가 이미 잰 판올림을 받아 둔다 — `--version` 을 두 번 띄우지 않게. */
  noteCliVersion(binPath: string | null | undefined, version: string | null | undefined): void {
    if (!binPath) return;
    this.versions.set(binPath, { version: version ?? null, at: Date.now() });
  }

  /** 옵션창 스위치. 미설정 = 켬. */
  isEnabled(): boolean {
    return userDefaultsService.get().advanced?.engineBridge !== false;
  }

  /**
   * 이번 스폰에 실을 폴더. **동기**다(스폰 인자 조립은 기다릴 수 없다) — 판올림을 모르면 null 을 주고
   * 뒤에서 잰다. 다음 스폰부터 실린다.
   */
  pluginDirForSpawn(): string | null {
    // 동봉 자리를 모르면(데스크톱이 주입하기 전·시험) 실을 것이 없다 — 판올림을 재러 실행본을 띄우지도 않는다.
    if (!this.sourceDir || !this.isEnabled()) return null;
    let binPath: string;
    try {
      binPath = getClaudeBin().binPath;
    } catch {
      return null;
    }
    const known = this.versions.get(binPath);
    if (!known || (known.version === null && Date.now() - known.at > VERSION_RETRY_MS)) this.probeVersion(binPath);
    if (!known || !isEngineBridgeCliSupported(known.version)) return null;
    return this.ensurePluginDir();
  }

  private probeVersion(binPath: string): void {
    if (!binPath || this.probing.has(binPath)) return;
    this.probing.add(binPath);
    void probeClaudeBinVersion(binPath)
      .then((r) => { this.versions.set(binPath, { version: r.version, at: Date.now() }); })
      .catch(() => { this.versions.set(binPath, { version: null, at: Date.now() }); })
      .finally(() => { this.probing.delete(binPath); });
  }

  private ensurePluginDir(): string | null {
    if (this.pluginDir) {
      // 누가 지웠으면 다시 세운다 — 없는 폴더를 넘기면 그 세션이 무엇을 할지 모른다.
      if (fs.existsSync(path.join(this.pluginDir, '.claude-plugin', 'plugin.json'))) return this.pluginDir;
      this.pluginDir = null;
    }
    if (!this.sourceDir) return null;
    if (this.materializeFailedAt && Date.now() - this.materializeFailedAt < MATERIALIZE_RETRY_MS) return null;
    try {
      const dir = materializeEngineBridgeMod(this.sourceDir, this.modsRoot());
      if (!dir) {
        this.materializeFailedAt = Date.now();
        logger.warn(`[engine-bridge] bundled mod files not found under ${this.sourceDir} — sessions start without the bridge`);
        return null;
      }
      this.pluginDir = dir;
      logger.info(`[engine-bridge] mod ready at ${dir}`);
      return dir;
    } catch (err) {
      this.materializeFailedAt = Date.now();
      logger.warn(`[engine-bridge] could not place the mod: ${err instanceof Error ? err.message : String(err)} — sessions start without the bridge`);
      return null;
    }
  }

  /** 옵션창 상태 줄. */
  status(now: number = Date.now()): EngineBridgeStatus {
    this.sweep(now);
    let cliVersion: string | null = null;
    let supported: boolean | null = null;
    try {
      const known = this.versions.get(getClaudeBin().binPath);
      if (known) {
        cliVersion = known.version;
        supported = isEngineBridgeCliSupported(known.version);
      }
    } catch {
      // 실행본을 못 찾으면 모르는 것으로 둔다.
    }
    const enabled = this.isEnabled();
    const modReady = this.sourceDir !== null && this.ensurePluginDir() !== null;
    let sessions = 0;
    for (const st of this.states.values()) if (isEngineBridgeFresh(st, now)) sessions += 1;
    return {
      enabled,
      modReady,
      cliVersion,
      supported,
      minCliVersion: ENGINE_BRIDGE_MIN_CLI_VERSION,
      active: enabled && modReady && supported === true,
      sessions,
    };
  }

  /**
   * 신고 하나를 상태에 접는다. 신원 대조(그 sub 가 살아 있나)는 부르는 쪽이 먼저 한다.
   * 같은 키에 다른 프로세스(instance) 신고가 오면: 붙음(attach)이 실렸으면 새 프로세스가 이어받고, 없으면 옛 프로세스의 늦은 신고라 버린다.
   * 사건(가장자리)을 차례로 적용한 뒤 수준 상태(snapshot)로 바로잡는다 — 사건을 놓쳐도 다음 신고가 상태를 맞춘다.
   */
  ingest(report: EngineBridgeReport, now: number = Date.now()): EngineBridgeIngestResult {
    this.sweep(now);
    const key = engineBridgeKeyOf(report.identity);
    const attaching = report.events.some((e) => e.kind === 'attach');
    let state = this.states.get(key);
    if (state && state.instance !== report.instance) {
      if (!attaching) return { accepted: false, key, edges: [] };
      state = undefined;
    }
    if (!state) {
      state = {
        key,
        instance: report.instance,
        subAgentId: report.identity.subAgentId,
        agentId: report.identity.agentId,
        termId: report.identity.termId,
        sessionId: report.identity.sessionId,
        cliVersion: report.identity.cliVersion,
        interactive: report.identity.interactive,
        attachedAt: now,
        lastSeenAt: now,
        turnState: 'unknown',
        toolsInFlight: 0,
      };
    }
    state.lastSeenAt = now;
    if (report.identity.sessionId) state.sessionId = report.identity.sessionId;
    if (report.identity.cliVersion) state.cliVersion = report.identity.cliVersion;
    if (report.identity.agentId) state.agentId = report.identity.agentId;

    const edges: EngineBridgeIngestResult['edges'] = [];
    for (const ev of report.events) {
      const at = now - ev.ageMs;
      switch (ev.kind) {
        case 'attach':
          state.attachedAt = at;
          delete state.ended;
          break;
        case 'turn-start':
          state.turnState = 'running';
          state.turnStartedAt = at;
          state.lastProgressAt = at;
          delete state.toolInFlight;
          state.toolsInFlight = 0;
          edges.push('turn-start');
          break;
        case 'turn-end':
          state.turnState = 'idle';
          delete state.turnStartedAt;
          state.lastProgressAt = at;
          delete state.toolInFlight;
          state.toolsInFlight = 0;
          state.lastTurnEnd = {
            reason: normalizeEngineBridgeTurnEndReason(ev.reason),
            at,
            ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
          };
          edges.push('turn-end');
          break;
        case 'clear':
          state.turnState = 'idle';
          delete state.turnStartedAt;
          delete state.toolInFlight;
          state.toolsInFlight = 0;
          edges.push('clear');
          break;
        case 'end':
          state.turnState = 'idle';
          delete state.turnStartedAt;
          delete state.toolInFlight;
          state.toolsInFlight = 0;
          state.ended = { reason: ev.reason ?? '', at };
          edges.push('end');
          break;
      }
    }

    // 수준 상태 — 끝난 프로세스의 마지막 스냅숏은 덮지 않는다(끝은 끝이다).
    const snap = report.snapshot;
    if (snap && !state.ended) {
      state.turnState = snap.turnState;
      if (snap.turnState === 'running') {
        if (snap.turnAgeMs !== undefined) state.turnStartedAt = now - snap.turnAgeMs;
      } else {
        delete state.turnStartedAt;
      }
      if (snap.progressAgeMs !== undefined) state.lastProgressAt = now - snap.progressAgeMs;
      state.toolsInFlight = snap.toolsInFlight;
      if (snap.toolInFlight) state.toolInFlight = { name: snap.toolInFlight.name, since: now - snap.toolInFlight.ageMs };
      else delete state.toolInFlight;
    }

    if (report.usage) {
      const u = report.usage;
      state.usage = {
        ...(u.contextPercent !== undefined ? { contextPercent: u.contextPercent } : {}),
        ...(u.contextTokens !== undefined ? { contextTokens: u.contextTokens } : {}),
        ...(u.contextWindow !== undefined ? { contextWindow: u.contextWindow } : {}),
        ...(u.costUsd !== undefined ? { costUsd: u.costUsd } : {}),
        at: now,
      };
    }

    // 최근에 소식을 준 것이 뒤로 가게 다시 넣는다 — 상한을 넘기면 가장 오래 조용한 것부터 버린다.
    this.states.delete(key);
    this.states.set(key, state);
    capMapSize(this.states, ENGINE_BRIDGE_STATE_MAX);
    return { accepted: true, key, edges };
  }

  /** 끝났거나 소식이 끊긴 지 오래된 다리를 걷는다. 따로 타이머를 두지 않고 읽고 쓸 때 함께 돈다. */
  sweep(now: number = Date.now()): void {
    for (const [key, st] of this.states) {
      const quietFor = now - st.lastSeenAt;
      const endedFor = st.ended ? now - st.ended.at : 0;
      if ((st.ended && endedFor > ENGINE_BRIDGE_ENDED_KEEP_MS) || quietFor > ENGINE_BRIDGE_ENDED_KEEP_MS + ENGINE_BRIDGE_STALE_MS) {
        this.states.delete(key);
      }
    }
  }

  private statesOf(subAgentId: string): EngineBridgeState[] {
    const out: EngineBridgeState[] = [];
    for (const st of this.states.values()) if (st.subAgentId === subAgentId) out.push(st);
    return out;
  }

  /** 엔진이 이 세션 탭의 어느 프로세스에서든 "턴이 돈다"고 말하는가(신선한 다리만). */
  isTurnRunning(subAgentId: string, now: number = Date.now()): boolean {
    return this.statesOf(subAgentId).some((st) => isEngineBridgeTurnRunning(st, now));
  }

  /**
   * §2.4 — 생존 판정을 묻지 않아도 되는가. `observedProgressAt` 는 다리 밖에서 관측한 진척 시각(대화록 마지막
   * 쓰기)이다 — 다리는 턴 가장자리만 세므로 도는 턴 안의 진척은 그쪽이 말한다(`engineBridgeVouchesRunning`).
   */
  vouchesRunning(subAgentId: string, now: number = Date.now(), observedProgressAt?: number): boolean {
    return this.statesOf(subAgentId).some((st) => engineBridgeVouchesRunning(st, now, observedProgressAt));
  }

  /** §2.4 — 판정에 싣는 엔진 사실. 이 세션 탭의 다리 중 가장 최근에 소식을 준 것을 본다. 없으면 null. */
  sessionFacts(subAgentId: string, now: number = Date.now()): EngineBridgeSessionFacts | null {
    let latest: EngineBridgeState | null = null;
    for (const st of this.statesOf(subAgentId)) if (!latest || st.lastSeenAt > latest.lastSeenAt) latest = st;
    if (!latest) return null;
    return {
      vouches: engineBridgeVouchesRunning(latest, now),
      turnRunning: isEngineBridgeTurnRunning(latest, now),
      line: describeEngineBridgeForProbe(latest, now),
      ...(latest.toolInFlight ? { toolInFlight: latest.toolInFlight.name } : {}),
    };
  }

  /** CMD 탭 — 신선한 다리가 붙어 있으면 그 탭의 status 는 엔진이 정한다(화면 감지는 blocked 만 보탠다). */
  ownsCmdStatus(subAgentId: string, now: number = Date.now()): boolean {
    return this.statesOf(subAgentId).some((st) => st.termId !== '' && isEngineBridgeFresh(st, now));
  }

  /** 진단용 — 지금 들고 있는 다리 상태(복제본). */
  list(now: number = Date.now()): EngineBridgeState[] {
    this.sweep(now);
    return [...this.states.values()].map((st) => ({ ...st }));
  }
}

export const engineBridge = new EngineBridgeService();
