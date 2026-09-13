// SCENARIO.md §5.26 — 컨텍스트 보험 원장.
//
// **새 수집기가 아니다.** `PreCompact`/`PostCompact` 는 §3.6 33종에 이미 등록돼 서버까지 들어오고
// 있었고(지금까지는 횟수만 세고 버렸다), 셸 쓰기의 직전 디스크 본문은 §2.1 Bash 쓰기 축이 이미 한 번
// 읽는다. 이 서비스는 **그것들이 이미 만지고 있는 것을 버리지 않고 한 저장고에 앉힐 뿐**이다.
//
// 원장이 두 배열인 이유: §5.22 가 "요청과 결정을 따로 두지 마라"고 한 것은 *같은 사건의 두 기록*을
// 가른 경우다. 압축과 파일 쓰기는 **애초에 다른 사건**이라 캡·나이·복원 수단이 전부 다르고,
// 하나로 뭉치면 캡 하나가 다른 갈래를 밀어낸다.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  CompactMarker,
  CompactOutcome,
  CompactWorkingSet,
  FilePreimage,
  InsuranceCounts,
  InsuranceRetired,
  InsuranceSessionCounts,
  ProjectInsuranceLedger,
  RetentionSettings,
} from '@vibisual/shared';
import {
  INSURANCE_MARKERS_MAX_PER_PROJECT,
  INSURANCE_PREIMAGES_MAX_PER_PROJECT,
  INSURANCE_PREIMAGE_MAX_BYTES,
  INSURANCE_SNAPSHOT_MARKERS,
  INSURANCE_SNAPSHOT_PREIMAGES,
  INSURANCE_TAIL_MAX_CHARS,
  INSURANCE_WORKING_SET_MAX,
  isExpiredByDays,
} from '@vibisual/shared';
import { pathKey } from './pathKey.js';
import { InsuranceVault, fileMtime, fileSize, hashHead } from './insuranceVault.js';
import { emptyWorkingSet } from './compactDiff.js';

/** 보존 축을 밖에서 읽어 온다 — 서비스가 앱 상태를 직접 물면 시험이 그 기계의 설정 파일에 좌우된다. */
export type InsuranceRetentionReader = () => Pick<
  RetentionSettings,
  'insuranceRetentionDays' | 'insuranceVaultMaxMB' | 'insuranceMirror'
>;

export interface CompactRecordInput {
  projectName: string;
  sessionId: string;
  agentId?: string;
  subAgentId?: string;
  trigger: 'auto' | 'manual';
  transcriptPath: string;
  contextUsed?: number;
  contextMax?: number;
  model?: string;
  workingSet?: CompactWorkingSet;
  at?: number;
}

export interface PreimageRecordInput {
  projectName: string;
  sessionId: string;
  agentId?: string;
  subAgentId?: string;
  absPath: string;
  toolName: string;
  toolUseId?: string;
  at?: number;
}

interface LedgerState {
  markers: CompactMarker[];
  markerById: Map<string, CompactMarker>;
  /** 세션별 가장 최근 마커 — (D)(E)(F) 가 매번 배열을 훑지 않게. */
  latestBySession: Map<string, CompactMarker>;
  preimages: FilePreimage[];
  preimageById: Map<string, FilePreimage>;
  retired: InsuranceRetired;
}

function emptyRetired(): InsuranceRetired {
  return { markers: 0, preimages: 0, bytes: 0 };
}

function emptyState(): LedgerState {
  return {
    markers: [],
    markerById: new Map(),
    latestBySession: new Map(),
    preimages: [],
    preimageById: new Map(),
    retired: emptyRetired(),
  };
}

export class InsuranceLedgerService {
  private ledgers = new Map<string, LedgerState>();

  constructor(
    private vault: InsuranceVault,
    private retention: InsuranceRetentionReader,
    private log: (message: string, err: unknown) => void = () => {},
  ) {}

  private state(projectName: string): LedgerState {
    let s = this.ledgers.get(projectName);
    if (!s) {
      s = emptyState();
      this.ledgers.set(projectName, s);
    }
    return s;
  }

  // ─── (B) 1단계 — 압축 직전 사본 ───

  /**
   * `PreCompact` 한 번을 원장에 앉힌다.
   *
   * **훅을 붙잡지 않는다** — 여기서 하는 디스크 접근은 `statSync` 와 앞부분 해시뿐이고,
   * 미러 복사는 호출부가 응답을 보낸 **뒤에** `mirrorFor()` 로 돌린다. JSONL 은 압축으로
   * 지워지지 않으므로(압축은 요약 항목을 덧붙인다) 뒤에 떠도 같은 바이트다.
   */
  recordCompact(input: CompactRecordInput): CompactMarker | null {
    if (!input.projectName || !input.sessionId) return null;
    const at = input.at ?? Date.now();
    const bytes = fileSize(input.transcriptPath);
    /*
     * ⚠ 기록을 못 보면 마커를 세우지 않는다.
     *
     * 마커의 값은 **바이트 오프셋**에 있다 — (D) 대조는 "이 오프셋 뒤에 붙은 것이 요약"이라는
     * 전제 위에 서 있다. 기록이 없다고 `0` 을 적어 두면, 그 파일이 나중에 나타나는 순간 대조가
     * 트랜스크립트 **전체**를 요약으로 착각해 "다 실렸다"는 거짓 결과를 만든다.
     * 압축이 있었다는 사실 자체는 §4 의 `compactCounts` 가 따로 세므로 여기서 잃는 것이 없다.
     */
    if (bytes === null) return null;
    const marker: CompactMarker = {
      id: randomUUID(),
      at,
      projectName: input.projectName,
      sessionId: input.sessionId,
      trigger: input.trigger === 'manual' ? 'manual' : 'auto',
      transcriptPath: input.transcriptPath,
      transcriptBytes: bytes,
      transcriptMtime: fileMtime(input.transcriptPath) ?? 0,
      mirrored: false,
      workingSet: capWorkingSet(input.workingSet ?? emptyWorkingSet()),
    };
    if (input.agentId) marker.agentId = input.agentId;
    if (input.subAgentId) marker.subAgentId = input.subAgentId;
    if (input.model) marker.model = input.model;
    if (Number.isFinite(input.contextUsed)) marker.contextUsed = input.contextUsed;
    if (Number.isFinite(input.contextMax)) marker.contextMax = input.contextMax;
    if (bytes > 0) {
      const head = hashHead(input.transcriptPath);
      if (head) marker.headHash = head;
    }

    const state = this.state(input.projectName);
    state.markers.unshift(marker);
    state.markerById.set(marker.id, marker);
    state.latestBySession.set(marker.sessionId, marker);
    this.trimMarkers(input.projectName, state);
    return marker;
  }

  /**
   * 미러를 뜬다 — 훅 응답 **뒤에** 부른다.
   *
   * 스위치가 꺼져 있으면 아무것도 하지 않고 `mirrored` 는 `false` 로 남는다. 화면이
   * "색인만"이라고 정직하게 말하는 것이 없는 사본을 있다고 적는 것보다 낫다.
   */
  mirrorFor(markerId: string, projectName: string): boolean {
    if (!this.retention().insuranceMirror) return false;
    const marker = this.ledgers.get(projectName)?.markerById.get(markerId);
    if (!marker) return false;
    const size = this.vault.mirrorTranscript(
      projectName,
      marker.sessionId,
      marker.transcriptPath,
      marker.transcriptBytes,
    );
    if (size === null) return false;
    marker.mirrored = true;
    this.enforceVaultBudget(projectName);
    return marker.mirrored;
  }

  // ─── (D) 2단계 — 압축 전후 대조 ───

  /** 아직 결과가 안 적힌 마커들 — 스윕이 이것만 훑는다(전량 재파싱 ❌). */
  pendingOutcomes(): CompactMarker[] {
    const out: CompactMarker[] = [];
    for (const state of this.ledgers.values()) {
      for (const m of state.markers) {
        if (!m.outcome) out.push(m);
      }
    }
    return out;
  }

  /**
   * 결과를 **덮어쓴다.** (G) 되살리기 측정 전용이다.
   *
   * `attachOutcome` 은 이미 붙은 결과를 지키지만(대조는 한 번뿐이다), 되살리기 측정은 그보다
   * **나중에 일어난 더 강한 사실**이다 — "이 세션은 지금 그 문맥을 갖고 있지 않다"를 방금 쟀다.
   * 그래서 이 한 자리에서만 덮어쓸 수 있게 열어 둔다.
   */
  replaceOutcome(projectName: string, markerId: string, outcome: CompactOutcome): boolean {
    const marker = this.ledgers.get(projectName)?.markerById.get(markerId);
    if (!marker) return false;
    marker.outcome = outcome;
    return true;
  }

  attachOutcome(projectName: string, markerId: string, outcome: CompactOutcome): boolean {
    const marker = this.ledgers.get(projectName)?.markerById.get(markerId);
    if (!marker || marker.outcome) return false;
    marker.outcome = outcome;
    return true;
  }

  /** 그 세션의 가장 최근 마커. (E) 브리핑과 (F) 감시가 함께 쓴다. */
  latestMarker(projectName: string, sessionId: string): CompactMarker | undefined {
    return this.ledgers.get(projectName)?.latestBySession.get(sessionId);
  }

  /** 어느 프로젝트든 그 세션의 최근 마커(프로젝트를 모르는 훅 경로용). */
  findLatestMarker(sessionId: string): CompactMarker | undefined {
    let best: CompactMarker | undefined;
    for (const state of this.ledgers.values()) {
      const m = state.latestBySession.get(sessionId);
      if (m && (!best || m.at > best.at)) best = m;
    }
    return best;
  }

  /**
   * `PostCompact` 도착을 그 세션의 **아직 결과가 안 붙은** 최근 마커에 새긴다.
   *
   * 결과가 이미 붙은 마커는 건너뛴다 — 대조가 끝난 뒤에 온 완료 훅은 그 마커의 것이 아니라
   * 다음 압축의 것이거나 중복이다. 마커가 없으면(우리가 `PreCompact` 를 놓친 세션) 아무 일도
   * 하지 않는다. 지어낸 마커를 세우면 오프셋이 없어 (D) 가 트랜스크립트 전체를 요약으로 읽는다.
   */
  notePostCompact(sessionId: string, now: number = Date.now()): boolean {
    const marker = this.findLatestMarker(sessionId);
    if (!marker || marker.outcome || marker.postCompactAt) return false;
    marker.postCompactAt = now;
    return true;
  }

  // ─── (G) 5단계 — 되살린 뒤 "정말 실렸는가" ───

  /**
   * `--resume` 으로 되살린 직후 확인을 건다. 기준선은 마커가 적어 둔 죽기 전 `contextUsed` 다.
   *
   * 기준선이 없으면 걸지 않는다 — 비교할 수가 없는데 표식만 걸어 두면 스윕이 영영 매 회차
   * 그 세션의 트랜스크립트를 여는 일만 한다.
   */
  armResumeCheck(sessionId: string, now: number = Date.now()): boolean {
    const m = this.findLatestMarker(sessionId);
    if (!m?.contextUsed) return false;
    m.resumeArmedAt = now;
    delete m.resumeCheckedAt;
    delete m.resumeShortfall;
    return true;
  }

  /** 아직 확인이 안 끝난 마커들. 스윕이 이것만 훑는다. */
  armedResumeChecks(): CompactMarker[] {
    const out: CompactMarker[] = [];
    for (const state of this.ledgers.values()) {
      for (const m of state.markers) {
        if (m.resumeArmedAt && !m.resumeCheckedAt) out.push(m);
      }
    }
    return out;
  }

  /**
   * 확인 결과를 적는다. **문맥이 안 실렸으면 브리핑 표식을 푼다** — 이미 한 번 브리핑한
   * 마커라도 다시 싣는다. 되살아난 세션은 그 브리핑을 받은 적이 없는 새 문맥이기 때문이다.
   */
  settleResumeCheck(markerId: string, shortfall: boolean, now: number = Date.now()): boolean {
    for (const state of this.ledgers.values()) {
      const m = state.markerById.get(markerId);
      if (!m) continue;
      m.resumeCheckedAt = now;
      if (shortfall) {
        m.resumeShortfall = true;
        delete m.briefedAt;
      }
      return true;
    }
    return false;
  }

  // ─── (E) 3단계 — 복원 브리핑은 한 번만 ───

  /**
   * 아직 브리핑하지 않은, 결과가 있고 잃은 것이 있는 마커를 집어 **그 자리에서 표식을 건다**.
   *
   * 집는 것과 표식을 거는 것이 한 동작인 이유: 두 번 실으면 그 글이 다음 압축을 앞당긴다.
   * 실제로 프롬프트에 실렸는지는 호출부가 알 수 없으므로(조립 실패·주입원 끔) **집어 간 순간**을
   * 기준으로 삼는다 — 한 번 더 싣는 쪽보다 한 번 덜 싣는 쪽이 안전하다.
   */
  takeBriefing(sessionId: string, now: number = Date.now()): CompactMarker | undefined {
    const m = this.peekBriefing(sessionId);
    if (!m) return undefined;
    m.briefedAt = now;
    return m;
  }

  /**
   * 같은 고르기를 **못 박지 않고** 한다.
   *
   * ⚠ 이 짝이 반드시 필요하다 — 프롬프트 조립 함수는 실제 주입뿐 아니라 **주입원 표를 재는 데도**
   *   불린다(§5.5 #17-28: 표와 프롬프트가 어긋날 수 없게 같은 함수를 쓴다). 표를 여는 것만으로
   *   `briefedAt` 이 찍히면, 사용자가 창 한 번 열었다는 이유로 그 세션의 브리핑이 영영 사라진다.
   */
  peekBriefing(sessionId: string): CompactMarker | undefined {
    for (const state of this.ledgers.values()) {
      const m = state.latestBySession.get(sessionId);
      if (!m || m.briefedAt || !m.outcome) continue;
      return m;
    }
    return undefined;
  }

  /**
   * §5.26 (E) — 브리핑을 **실제로 보낸 뒤** 못 박는다.
   *
   * `peekBriefing` 으로 고른 것을 조립만 하고 못 박지 않는 경로(프롬프트 조립 = 부작용 없음)를
   * 위한 짝이다. 이미 찍혀 있으면 `false` — 두 주입 지점이 동시에 물어도 한 번만 나간다.
   */
  markBriefed(projectName: string, markerId: string, now: number = Date.now()): boolean {
    const m = this.ledgers.get(projectName)?.markerById.get(markerId);
    if (!m || m.briefedAt) return false;
    m.briefedAt = now;
    return true;
  }

  // ─── (C) ② 파일 사본 ───

  /**
   * 쓰기 직전 파일 본문을 앉힌다. **세 갈래 전부 기록된다** —
   * 없던 파일 · 너무 큰 파일 · 읽기 실패. 조용히 건너뛰지 않는 것이 규율이다.
   */
  recordPreimage(input: PreimageRecordInput): FilePreimage | null {
    if (!input.projectName || !input.absPath) return null;
    const result = this.vault.capturePreimage(input.projectName, input.absPath, INSURANCE_PREIMAGE_MAX_BYTES);
    const row: FilePreimage = {
      id: randomUUID(),
      at: input.at ?? Date.now(),
      projectName: input.projectName,
      path: input.absPath,
      pathKey: pathKey(input.absPath),
      size: result.blob?.size ?? 0,
      sessionId: input.sessionId,
      toolName: input.toolName,
    };
    if (input.agentId) row.agentId = input.agentId;
    if (input.subAgentId) row.subAgentId = input.subAgentId;
    if (input.toolUseId) row.toolUseId = input.toolUseId;
    if (result.blob) row.sha256 = result.blob.sha256;
    if (result.skipped) row.skipped = result.skipped;

    const state = this.state(input.projectName);
    // 같은 도구 호출이 Pre/Post 두 길로 오면 한 줄로 합친다(원장이 두 배가 되지 않게).
    if (row.toolUseId) {
      const dup = state.preimages.find((p) => p.toolUseId === row.toolUseId && p.pathKey === row.pathKey);
      if (dup) return dup;
    }
    state.preimages.unshift(row);
    state.preimageById.set(row.id, row);
    this.trimPreimages(input.projectName, state);
    this.enforceVaultBudget(input.projectName);
    return row;
  }

  /**
   * 사본으로 되돌린다. **되돌리기 직전 내용도 한 벌 뜬다** — 이것이 없으면 잘못 누른 복원이
   * 진짜 손실이 된다(§5.26 (C)).
   */
  restorePreimage(projectName: string, id: string, now: number = Date.now()): { ok: boolean; undoId?: string } {
    const state = this.ledgers.get(projectName);
    const row = state?.preimageById.get(id);
    if (!state || !row) return { ok: false };
    if (row.skipped) return { ok: false }; // 뜨지 못한 사본으로는 되돌릴 수 없다

    const undo = this.recordPreimage({
      projectName,
      sessionId: row.sessionId,
      absPath: row.path,
      toolName: 'InsuranceRestore',
      at: now,
      ...(row.agentId ? { agentId: row.agentId } : {}),
      ...(row.subAgentId ? { subAgentId: row.subAgentId } : {}),
    });
    const ok = this.vault.restoreFile(projectName, row.path, row.sha256);
    if (!ok) return { ok: false };
    row.restoredAt = now;
    return undo ? { ok: true, undoId: undo.id } : { ok: true };
  }

  getPreimage(projectName: string, id: string): FilePreimage | undefined {
    return this.ledgers.get(projectName)?.preimageById.get(id);
  }

  // ─── (H) 보존 정책 ───

  /**
   * 캡·나이·예산을 한 바퀴 적용한다. 바뀐 게 있으면 `true`(호출부가 저장·방송을 정한다).
   *
   * **부팅 시 한 번 도는 것이 정본 시점이다**(§3.2.3 "정리는 부팅 시 모든 프로젝트에 일괄 적용").
   * 종전에는 이 함수를 부르는 곳이 `PUT /api/retention-settings` **하나뿐**이라, 사용자가 옵션창에서
   * 보존 값을 손으로 바꾸지 않는 한 나이 만료(14일)와 고아 회수가 **영영 돌지 않았다.**
   */
  applyRetention(now: number = Date.now()): boolean {
    const days = this.retention().insuranceRetentionDays;
    let changed = false;
    for (const [projectName, state] of this.ledgers) {
      // 한 바퀴의 시작에서 크기 캐시를 버린다 — 이 자리가 유일하게 "천천히 표류했을 수 있다"를
      // 아는 순간이다(바깥에서 폴더를 지웠거나 휴지통을 비웠을 수 있다).
      this.vault.invalidateMeasure(projectName);
      const liveSessions = this.liveSessions?.() ?? new Set<string>();
      const beforeM = state.markers.length;
      const beforeP = state.preimages.length;
      // 살아 있는 세션의 마커는 나이와 무관하게 남긴다(§3.2.3 규칙 2).
      state.markers = state.markers.filter((m) => {
        if (liveSessions.has(m.sessionId)) return true;
        return !isExpiredByDays(m.at, days, now);
      });
      state.preimages = state.preimages.filter((p) => !isExpiredByDays(p.at, days, now));
      if (state.markers.length !== beforeM || state.preimages.length !== beforeP) {
        state.retired.markers += beforeM - state.markers.length;
        state.retired.preimages += beforeP - state.preimages.length;
        this.reindex(state);
        changed = true;
      }
      // ⚠ `||` 로 묶으면 앞이 참일 때 뒤가 아예 안 돈다 — 마커가 밀려난 회차에 사본 캡이 건너뛰어진다.
      const trimmedM = this.trimMarkers(projectName, state);
      const trimmedP = this.trimPreimages(projectName, state);
      if (trimmedM || trimmedP) changed = true;
      if (this.enforceVaultBudget(projectName)) changed = true;
      if (this.pruneOrphans(projectName, state)) changed = true;
    }
    return changed;
  }

  /**
   * "지금 화면에 떠 있는 세션" 을 알려 주는 함수 — 없으면 나이만으로 판정한다.
   * 주입으로 받는 이유는 §5.22 가 상한 해석기를 주입으로 받은 것과 같다(시험이 실제 그래프를 물지 않게).
   */
  liveSessions?: () => ReadonlySet<string>;

  /**
   * ⚠ **줄을 버리면 그 바이트도 같이 버린다.**
   *
   * 종전에는 줄만 잘라 내고 미러·blob 은 디스크에 남겼다. 그것을 걷어 내는 자리는 `pruneOrphans`
   * 하나였는데, 그건 ① `applyRetention`(아무도 안 불렀다) ② 예산 초과 분기 안에만 있었다 —
   * 즉 **예산(256MB)에 닿기 전까지는 회수가 한 번도 일어나지 않았다.** 실측(2026-09-09): 사본 줄은
   * 상한 500 을 지키고 있는데 디스크 blob 은 513개였고 그중 **177개 22.5MB 가 고아**였다.
   *
   * 걷어 내는 자리를 여기로 옮긴 이유는 **여기가 "무엇이 밀려났는지" 를 아는 유일한 자리**이기
   * 때문이다. 폴더를 훑지 않고 밀려난 것만 표적으로 놓으므로, 캡에 닿아 매 쓰기마다 한 줄씩
   * 밀려나는 상태에서도 비용이 줄 수에 비례하지 않는다.
   */
  private trimMarkers(projectName: string, state: LedgerState): boolean {
    const cap = INSURANCE_MARKERS_MAX_PER_PROJECT;
    if (cap <= 0 || state.markers.length <= cap) return false;
    const dropped = state.markers.splice(cap);
    for (const m of dropped) {
      state.markerById.delete(m.id);
      if (state.latestBySession.get(m.sessionId)?.id === m.id) state.latestBySession.delete(m.sessionId);
    }
    state.retired.markers += dropped.length;
    state.retired.bytes += this.releaseDroppedMirrors(projectName, state, dropped);
    return true;
  }

  private trimPreimages(projectName: string, state: LedgerState): boolean {
    const cap = INSURANCE_PREIMAGES_MAX_PER_PROJECT;
    if (cap <= 0 || state.preimages.length <= cap) return false;
    const dropped = state.preimages.splice(cap);
    for (const p of dropped) state.preimageById.delete(p.id);
    state.retired.preimages += dropped.length;
    state.retired.bytes += this.releaseDroppedBlobs(projectName, state, dropped);
    return true;
  }

  /**
   * 밀려난 사본 줄의 blob 을 놓는다 — **남은 줄이 아직 가리키는 해시는 건드리지 않는다.**
   * 내용 주소 지정이라 같은 파일을 두 번 고쳐도 내용이 같으면 한 벌이고, 그 한 벌을 두 줄이
   * 가리킨다. 한 줄이 밀려났다고 지우면 살아 있는 다른 줄의 되돌리기가 조용히 죽는다.
   */
  private releaseDroppedBlobs(
    projectName: string,
    state: LedgerState,
    dropped: readonly FilePreimage[],
  ): number {
    const candidates = new Set<string>();
    for (const p of dropped) if (p.sha256) candidates.add(p.sha256);
    if (candidates.size === 0) return 0;
    for (const p of state.preimages) if (p.sha256) candidates.delete(p.sha256);
    let freed = 0;
    for (const sha of candidates) freed += this.vault.releaseBlob(projectName, sha);
    return freed;
  }

  /**
   * 밀려난 마커의 미러를 놓는다 — **같은 세션의 다른 마커가 남아 있으면 건드리지 않는다.**
   * 미러는 세션 하나에 한 벌이고 마커는 압축마다 서므로, 한 세션에 마커가 여럿일 수 있다.
   */
  private releaseDroppedMirrors(
    projectName: string,
    state: LedgerState,
    dropped: readonly CompactMarker[],
  ): number {
    const candidates = new Set<string>();
    for (const m of dropped) if (m.mirrored) candidates.add(m.sessionId);
    if (candidates.size === 0) return 0;
    for (const m of state.markers) candidates.delete(m.sessionId);
    let freed = 0;
    for (const sessionId of candidates) freed += this.vault.dropMirror(projectName, sessionId);
    return freed;
  }

  /**
   * 총 바이트 예산 — 넘치면 **미러부터** LRU 로 버리고 마커는 남긴다.
   * 마커는 수백 바이트이고, 마커만 있어도 압축 실패·요약 부실·resume 문맥 소실 셋은
   * 옛 JSONL 로 복구된다(§5.26 (B) 마지막 항목).
   */
  private enforceVaultBudget(projectName: string): boolean {
    const maxMB = this.retention().insuranceVaultMaxMB;
    if (!Number.isFinite(maxMB) || maxMB <= 0) return false; // 0 = 무제한(§3.2.3)
    const budget = maxMB * 1024 * 1024;
    let used = this.vault.measure(projectName);
    if (used <= budget) return false;
    const state = this.ledgers.get(projectName);
    if (!state) return false;
    let changed = false;
    // 오래된 마커의 미러부터 — 최신 마커의 미러가 가장 쓸모 있다.
    for (let i = state.markers.length - 1; i >= 0 && used > budget; i -= 1) {
      const m = state.markers[i];
      if (!m?.mirrored) continue;
      const freed = this.vault.dropMirror(projectName, m.sessionId);
      m.mirrored = false;
      state.retired.bytes += freed;
      used -= freed;
      changed = true;
    }
    // 그래도 넘치면 사본 blob 을 오래된 것부터 놓는다(줄은 `skipped: 'budget'` 으로 남는다).
    for (let i = state.preimages.length - 1; i >= 0 && used > budget; i -= 1) {
      const p = state.preimages[i];
      if (!p?.sha256) continue;
      state.retired.bytes += p.size;
      used -= p.size;
      delete p.sha256;
      p.skipped = 'budget';
      changed = true;
    }
    if (changed) this.pruneOrphans(projectName, state);
    return changed;
  }

  /**
   * 참조되지 않는 **바이트**를 지운다 — 삭제 후보는 고아뿐이다(§5.26 (H)).
   *
   * 폴더를 통째로 훑는 길이라 **`applyRetention`(부팅 한 번)과 예산 초과 때만** 부른다. 평소의
   * 회수는 `trimMarkers`/`trimPreimages` 가 밀려난 것만 표적으로 놓는다 — 이 길은 그 표적 회수가
   * 놓친 것(옛 판본이 남긴 것·바깥에서 어긋난 것)을 걷어 내는 그물이다.
   *
   * **blob 과 미러 둘 다 본다.** 종전에는 blob 만 봐서, 마커가 밀려난 세션의 `.jsonl` 은 아무도
   * 열 수 없는데 디스크에는 영영 남았다(부활 후보 목록이 `markers` 를 돌기 때문에 마커가 없으면
   * 그 미러에는 닿을 길이 아예 없다).
   */
  private pruneOrphans(projectName: string, state: LedgerState): boolean {
    const referenced = new Set<string>();
    for (const p of state.preimages) {
      if (p.sha256) referenced.add(p.sha256);
    }
    const blobs = this.vault.pruneOrphanBlobs(projectName, referenced);
    if (blobs.removed > 0) state.retired.bytes += blobs.bytes;

    // 살아 있는 세션의 미러는 마커가 아직 없어도 남긴다 — 압축이 이제 막 시작된 세션의
    // 사본을 우리가 먼저 지우면, 그 세션이 죽었을 때 되살릴 것이 없다(§3.2.3 규칙 2).
    const sessions = new Set<string>(this.liveSessions?.() ?? []);
    for (const m of state.markers) sessions.add(m.sessionId);
    const mirrors = this.vault.pruneOrphanMirrors(projectName, sessions);
    if (mirrors.removed > 0) state.retired.bytes += mirrors.bytes;

    return blobs.removed > 0 || mirrors.removed > 0;
  }

  private reindex(state: LedgerState): void {
    state.markerById.clear();
    state.latestBySession.clear();
    for (const m of state.markers) {
      state.markerById.set(m.id, m);
      const cur = state.latestBySession.get(m.sessionId);
      if (!cur || m.at > cur.at) state.latestBySession.set(m.sessionId, m);
    }
    state.preimageById.clear();
    for (const p of state.preimages) state.preimageById.set(p.id, p);
  }

  // ─── 영속 4지점 (§3.2) ───

  /** 전선용 — 최근 몫만 싣는다(§9). 집계는 **자르기 전 전체**에서 접으므로 숫자는 그대로다. */
  getSnapshot(now: number = Date.now()): ProjectInsuranceLedger[] {
    const out: ProjectInsuranceLedger[] = [];
    for (const [projectName, state] of this.ledgers) {
      out.push(this.build(
        projectName, state, now,
        INSURANCE_SNAPSHOT_MARKERS, INSURANCE_SNAPSHOT_PREIMAGES,
        // §5.26 (I) — 상태바가 자기 세션 것만 그리려면 이 집계가 **전선에** 실려야 한다.
        //   잘린 목록으로 클라가 다시 세면 서버가 아는 수와 어긋난다(§3.1 · §7.23).
        true,
      ));
    }
    return out;
  }

  /**
   * 디스크 포맷 — **여기서 빠지면 껐다 켤 때 색인이 통째로 사라지고 blobs 는 고아가 된다.**
   * 이 절에서 가장 조용히 깨질 자리다(§5.26 (A)).
   */
  toCheckpoint(projectName: string, now: number = Date.now()): ProjectInsuranceLedger | undefined {
    const state = this.ledgers.get(projectName);
    if (!state) return undefined;
    if (state.markers.length === 0 && state.preimages.length === 0 && state.retired.markers === 0
      && state.retired.preimages === 0 && state.retired.bytes === 0) {
      return undefined; // 빈 필드로 체크포인트를 늘리지 않는다
    }
    return this.build(projectName, state, now);
  }

  /** 파생(`watch`/`resurrectable`)은 여기서 만들지 않는다 — 호출부가 스냅샷에 얹는다. */
  private build(
    projectName: string,
    state: LedgerState,
    now: number,
    markerLimit?: number,
    preimageLimit?: number,
    withSessionCounts: boolean = false,
  ): ProjectInsuranceLedger {
    const markers = markerLimit === undefined ? state.markers : state.markers.slice(0, markerLimit);
    const preimages = preimageLimit === undefined ? state.preimages : state.preimages.slice(0, preimageLimit);
    const ledger: ProjectInsuranceLedger = {
      projectName,
      markers: markers.map(cloneMarker),
      preimages: preimages.map((p) => ({ ...p })),
      counts: this.foldCounts(projectName, state),
      updatedAt: Math.max(state.markers[0]?.at ?? 0, state.preimages[0]?.at ?? 0) || now,
    };
    // §5.26 (I) — 파생이라 **디스크 포맷(`toCheckpoint`)에는 넣지 않는다**(`watch` 와 같은 규율).
    //   껐다 켜면 같은 마커에서 같은 답이 다시 나오므로 저장할 이유가 없고, 세션 키는 무한히
    //   늘어나는 축이라 체크포인트에 앉히면 §3.2.4 G축(무제한 증가)을 건드린다.
    if (withSessionCounts) {
      const sessionCounts = foldSessionCounts(state.markers);
      if (sessionCounts.length > 0) ledger.sessionCounts = sessionCounts;
    }
    if (state.retired.markers > 0 || state.retired.preimages > 0 || state.retired.bytes > 0) {
      ledger.retired = { ...state.retired };
    }
    return ledger;
  }

  private foldCounts(projectName: string, state: LedgerState): InsuranceCounts {
    let failed = 0;
    for (const m of state.markers) {
      if (m.outcome?.failed) failed += 1;
    }
    let restorable = 0;
    for (const p of state.preimages) {
      if (!p.skipped) restorable += 1;
    }
    return {
      markers: state.markers.length,
      preimages: state.preimages.length,
      vaultBytes: this.vault.measure(projectName),
      failedCompacts: failed,
      restorable,
    };
  }

  /** 체크포인트 복원 — 없으면 빈 원장으로 시작(옛 체크포인트 호환 — §3.2.1-5). */
  restore(ledger: ProjectInsuranceLedger | undefined): void {
    if (!ledger?.projectName) return;
    const state = emptyState();
    state.retired = ledger.retired ? { ...ledger.retired } : emptyRetired();
    for (const raw of ledger.markers ?? []) {
      if (!raw?.id || !raw.sessionId) continue;
      state.markers.push(sanitizeMarker(raw));
    }
    for (const raw of ledger.preimages ?? []) {
      if (!raw?.id || !raw.path) continue;
      state.preimages.push(sanitizePreimage(raw));
    }
    state.markers.sort((a, b) => b.at - a.at);
    state.preimages.sort((a, b) => b.at - a.at);
    this.reindex(state);
    this.ledgers.set(ledger.projectName, state);
    // 복원 직후 사본이 실제로 남아 있는지 대조한다 — 미러가 예산에 밀려 지워졌는데
    // `mirrored: true` 로 되살아나면 화면이 없는 사본을 있다고 말한다.
    this.reconcileMirrors(ledger.projectName, state);
  }

  /** 멀티프로젝트 부트 병합 — id 기준 합집합. 이미 있는 줄은 덮지 않는다(도는 쪽이 새것이다). */
  merge(ledger: ProjectInsuranceLedger | undefined): void {
    if (!ledger?.projectName) return;
    const state = this.state(ledger.projectName);
    if (state.markers.length === 0 && state.preimages.length === 0) {
      state.retired = ledger.retired ? { ...ledger.retired } : emptyRetired();
    }
    let added = false;
    for (const raw of ledger.markers ?? []) {
      if (!raw?.id || state.markerById.has(raw.id)) continue;
      state.markers.push(sanitizeMarker(raw));
      added = true;
    }
    for (const raw of ledger.preimages ?? []) {
      if (!raw?.id || state.preimageById.has(raw.id)) continue;
      state.preimages.push(sanitizePreimage(raw));
      added = true;
    }
    if (!added) return;
    state.markers.sort((a, b) => b.at - a.at);
    state.preimages.sort((a, b) => b.at - a.at);
    this.reindex(state);
    this.trimMarkers(ledger.projectName, state);
    this.trimPreimages(ledger.projectName, state);
    this.reconcileMirrors(ledger.projectName, state);
  }

  /** 프로젝트 이름이 바뀌면 원장도 따라간다(탭 relabel). */
  relabel(from: string, to: string): void {
    if (from === to) return;
    const state = this.ledgers.get(from);
    if (!state) return;
    // 이름이 바뀌면 크기 캐시의 주인도 바뀐다 — 옛 이름 몫을 버리지 않으면 새 이름이 남의 숫자를
    // 물려받는다. 합치는 길이든 그대로 옮기는 길이든 같으므로 갈라지기 전에 한 번 버린다.
    this.vault.invalidateMeasure(from);
    this.vault.invalidateMeasure(to);
    for (const m of state.markers) m.projectName = to;
    for (const p of state.preimages) p.projectName = to;
    this.ledgers.delete(from);
    const existing = this.ledgers.get(to);
    if (!existing) {
      this.ledgers.set(to, state);
      return;
    }
    for (const m of state.markers) {
      if (!existing.markerById.has(m.id)) existing.markers.push(m);
    }
    for (const p of state.preimages) {
      if (!existing.preimageById.has(p.id)) existing.preimages.push(p);
    }
    existing.retired.markers += state.retired.markers;
    existing.retired.preimages += state.retired.preimages;
    existing.retired.bytes += state.retired.bytes;
    existing.markers.sort((a, b) => b.at - a.at);
    existing.preimages.sort((a, b) => b.at - a.at);
    this.reindex(existing);
    this.trimMarkers(to, existing);
    this.trimPreimages(to, existing);
  }

  /** 전량 조회(REST `GET /api/insurance`). 전선에는 최근 몫만 실리므로 이 길이 따로 있다. */
  full(projectName: string, now: number = Date.now()): ProjectInsuranceLedger | undefined {
    const state = this.ledgers.get(projectName);
    // 전량 경로에도 같이 싣는다 — REST 응답과 방송 스냅샷이 **같은 모양의 원장**이어야
    //   읽는 쪽이 어느 길로 받았는지에 따라 다른 답을 보지 않는다. 자르기가 없는 길이라
    //   값도 스냅샷과 같다.
    return state ? this.build(projectName, state, now, undefined, undefined, true) : undefined;
  }

  /** 프로젝트 목록(스윕이 훑을 대상). */
  projects(): string[] {
    return [...this.ledgers.keys()];
  }

  /**
   * 디스크의 사본과 색인을 맞춘다. **없는데 있다고 적지 않기** 위한 유일한 자리다 —
   * 예산 LRU 로 미러가 지워졌거나 사용자가 폴더를 지운 뒤 되살아난 색인이 여기서 걸린다.
   */
  private reconcileMirrors(projectName: string, state: LedgerState): void {
    for (const m of state.markers) {
      if (!m.mirrored) continue;
      if (!this.vault.mirrorFile(projectName, m.sessionId)) m.mirrored = false;
    }
    for (const p of state.preimages) {
      if (!p.sha256 || p.skipped) continue;
      if (!this.vault.hasBlob(projectName, p.sha256)) {
        delete p.sha256;
        p.skipped = 'budget';
      }
    }
  }
}

// ─── 순수 헬퍼 ───

/**
 * §5.26 (B) — 훅 payload 에서 **팀원 이름으로 보이는 것**을 넓게 긁는다.
 *
 * 판본마다 자리가 다르다(`teammate` · `teammate_name` · `agent_name` · `teammates[]` ·
 * `agents[].name`). 한 모양만 고집하면 판올림 한 번에 조용히 빈 목록이 되고, 그러면 압축이
 * 팀 구성을 지웠다는 사실을 우리가 영영 모른다 — `instructionsLoadedService.extractPaths`
 * 와 같은 규율로 합집합을 만든다(§3.6-1).
 *
 * 세션 id 처럼 보이는 것은 담지 않는다 — 화면에 그대로 보이는 값이라 사람이 읽을 수 있는
 * 이름만 쓸모가 있다.
 */
/**
 * §5.26 (I) — 마커를 **세션별로** 접는다. 순수 함수라 시험이 상태만 만들어 부를 수 있다.
 *
 * **자르기 전 전체**(`state.markers`)에서 센다 — 전선 목록은 `INSURANCE_SNAPSHOT_MARKERS` 로
 * 잘려 있어 그걸 세면 서버가 아는 수와 어긋난다(§7.23 "집계는 서버가 접어서 실어 준다").
 *
 * **실패가 0 인 세션은 싣지 않는다.** 화면이 쓰는 축이 실패 배지 하나뿐이고, 압축은 겪지만
 * 실패하지 않는 세션이 대다수라 그것까지 실으면 세션 수만큼 자라는 배열을 매 방송에 얹게 된다.
 *
 * `subAgentId`/`agentId` 는 **가장 최근 마커의 것**을 쓴다 — 세션 하나가 여러 버블에 걸치는 일은
 * 없고, 옛 마커에만 있고 새 마커에는 없는 경우(훅 payload 결손)에는 있는 쪽을 살린다.
 */
export function foldSessionCounts(markers: readonly CompactMarker[]): InsuranceSessionCounts[] {
  const bySession = new Map<string, InsuranceSessionCounts>();
  // 마커 배열은 최신 순이므로 먼저 만나는 것이 가장 최근 마커다.
  for (const m of markers) {
    if (!m.sessionId) continue;
    let row = bySession.get(m.sessionId);
    if (!row) {
      row = { sessionId: m.sessionId, failedCompacts: 0, markers: 0 };
      bySession.set(m.sessionId, row);
    }
    row.markers += 1;
    if (m.outcome?.failed) row.failedCompacts += 1;
    if (!row.subAgentId && m.subAgentId) row.subAgentId = m.subAgentId;
    if (!row.agentId && m.agentId) row.agentId = m.agentId;
  }
  const out: InsuranceSessionCounts[] = [];
  for (const row of bySession.values()) {
    if (row.failedCompacts > 0) out.push(row);
  }
  // 나쁜 쪽이 위로 — 목록을 그리는 화면이 생기면 서열이 이미 서 있다(§5.26 `compactWatchRank` 대칭).
  out.sort((a, b) => b.failedCompacts - a.failedCompacts || a.sessionId.localeCompare(b.sessionId));
  return out;
}

export function extractTeammateNames(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v !== 'string') return;
    const name = v.trim();
    if (!name || name.length > 120) return;
    // uuid 모양(세션 id)은 이름이 아니다.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) return;
    out.push(name);
  };

  for (const key of ['teammate', 'teammate_name', 'teammateName', 'agent_name', 'agentName', 'name', 'label']) {
    push(payload[key]);
  }
  for (const key of ['teammates', 'teammate_names', 'agents', 'team']) {
    const v = payload[key];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        push(rec['name'] ?? rec['teammate'] ?? rec['label'] ?? rec['agent_name']);
      } else {
        push(item);
      }
    }
  }
  return Array.from(new Set(out));
}


/** `workingSet` 의 배열 축마다 상한을 건다 — 원장이 두 번째 트랜스크립트가 되지 않게. */
export function capWorkingSet(ws: CompactWorkingSet): CompactWorkingSet {
  const cap = INSURANCE_WORKING_SET_MAX;
  const out: CompactWorkingSet = {
    openFiles: (ws.openFiles ?? []).slice(0, cap),
    recentEdits: (ws.recentEdits ?? []).slice(0, cap),
    runningTasks: (ws.runningTasks ?? []).slice(0, cap),
    queuedCommands: Number.isFinite(ws.queuedCommands) ? Math.max(0, ws.queuedCommands) : 0,
    goalSteps: (ws.goalSteps ?? []).slice(0, cap),
    teammates: (ws.teammates ?? []).slice(0, cap),
  };
  if (ws.goal) out.goal = ws.goal;
  if (ws.lastTool) out.lastTool = ws.lastTool;
  if (ws.lastAssistantTail) out.lastAssistantTail = ws.lastAssistantTail.slice(0, INSURANCE_TAIL_MAX_CHARS);
  return out;
}

function cloneMarker(m: CompactMarker): CompactMarker {
  return {
    ...m,
    workingSet: capWorkingSet(m.workingSet),
    ...(m.outcome ? { outcome: { ...m.outcome, notCarried: { ...m.outcome.notCarried } } } : {}),
  };
}

/** 디스크에서 온 줄을 믿지 않는다 — 판올림 사이에 모양이 바뀌었을 수 있다. */
function sanitizeMarker(raw: CompactMarker): CompactMarker {
  const m: CompactMarker = {
    id: raw.id,
    at: Number.isFinite(raw.at) ? raw.at : 0,
    projectName: raw.projectName ?? '',
    sessionId: raw.sessionId,
    trigger: raw.trigger === 'manual' ? 'manual' : 'auto',
    transcriptPath: raw.transcriptPath ?? '',
    transcriptBytes: Number.isFinite(raw.transcriptBytes) ? raw.transcriptBytes : 0,
    transcriptMtime: Number.isFinite(raw.transcriptMtime) ? raw.transcriptMtime : 0,
    mirrored: raw.mirrored === true,
    workingSet: capWorkingSet(raw.workingSet ?? emptyWorkingSet()),
  };
  if (raw.agentId) m.agentId = raw.agentId;
  if (raw.subAgentId) m.subAgentId = raw.subAgentId;
  if (raw.headHash) m.headHash = raw.headHash;
  if (Number.isFinite(raw.contextUsed)) m.contextUsed = raw.contextUsed;
  if (Number.isFinite(raw.contextMax)) m.contextMax = raw.contextMax;
  if (raw.model) m.model = raw.model;
  if (raw.outcome) m.outcome = { ...raw.outcome };
  if (Number.isFinite(raw.briefedAt)) m.briefedAt = raw.briefedAt;
  // 완료 훅 도착 사실은 재시작을 넘어 살아야 한다 — 껐다 켠 뒤 스윕이 이 마커를 다시 집는데,
  // 그때 이 표식이 없으면 "완료 훅이 온 적 없다"로 읽어 멀쩡한 압축을 실패로 못 박는다.
  if (Number.isFinite(raw.postCompactAt)) m.postCompactAt = raw.postCompactAt;
  // 부활 확인은 재시작을 넘어 살아야 한다 — 되살리자마자 앱을 껐다 켜면 확인이 통째로 사라진다.
  if (Number.isFinite(raw.resumeArmedAt)) m.resumeArmedAt = raw.resumeArmedAt;
  if (Number.isFinite(raw.resumeCheckedAt)) m.resumeCheckedAt = raw.resumeCheckedAt;
  if (raw.resumeShortfall === true) m.resumeShortfall = true;
  return m;
}

function sanitizePreimage(raw: FilePreimage): FilePreimage {
  const p: FilePreimage = {
    id: raw.id,
    at: Number.isFinite(raw.at) ? raw.at : 0,
    projectName: raw.projectName ?? '',
    path: raw.path,
    // 옛 판본이 다른 규칙으로 접었을 수 있어 **여기서 다시 만든다**(플랫폼 규칙 한 곳 — §멀티플랫폼 1축).
    pathKey: pathKey(raw.path),
    size: Number.isFinite(raw.size) ? Math.max(0, raw.size) : 0,
    sessionId: raw.sessionId ?? '',
    toolName: raw.toolName ?? 'Bash',
  };
  if (raw.agentId) p.agentId = raw.agentId;
  if (raw.subAgentId) p.subAgentId = raw.subAgentId;
  if (raw.sha256) p.sha256 = raw.sha256;
  if (raw.toolUseId) p.toolUseId = raw.toolUseId;
  if (raw.skipped) p.skipped = raw.skipped;
  if (Number.isFinite(raw.restoredAt)) p.restoredAt = raw.restoredAt;
  return p;
}

/** 화면이 쓰는 파일명 — 경로가 길면 목록이 읽히지 않는다. */
export function preimageBaseName(p: FilePreimage): string {
  return path.basename(p.path);
}
