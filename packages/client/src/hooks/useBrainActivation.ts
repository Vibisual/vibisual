/**
 * §5.10 v2 (H) — **두뇌 활성화(클라 쪽).**
 *
 * 판정은 서버와 **같은 함수**(`@vibisual/shared` 의 `isBrainEnabled`·`isBrainAxisEnabled`)를 쓴다 —
 * 화면이 "켜졌다"고 보여주는데 서버는 꺼진 것으로 아는 어긋남을 만들지 않기 위해서다.
 *
 * 활성 상태의 진실은 `UserDefaults.brainByProject` 이고, 그건 이미 `GraphSnapshot` 에 실려
 * 스토어에 들어와 있다 — **새 스냅샷 필드를 만들지 않는다.**
 *
 * **키가 두 벌이라는 점이 이 훅의 전부다.** 서버 REST 는 프로젝트를 **표시명**으로 받아
 * (`resolveBrainRoot` → `getProjectByName`) 자기 쪽에서 루트 경로로 바꿔 저장하고,
 * `brainByProject` 의 키는 그 **절대경로**다. 그래서 보내는 쪽은 표시명, 읽는 쪽은 경로다 —
 * 둘을 섞으면 서버가 적어 둔 `enabled`·`promptedAt` 을 화면이 영영 못 찾는다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BRAIN_AXIS_IDS,
  isBrainAxisEnabled,
  isBrainEnabled,
  resolveBrainActivation,
  type BrainActivation,
  type BrainAxisId,
} from '@vibisual/shared';
import { selectActiveBrainProjectPath, useGraphStore } from '../stores/graphStore';
import { clientPathPlatform } from '../utils/platform.js';

export interface BrainActivationApi {
  /** 지금 프로젝트의 **루트 절대경로**(= 활성화 저장 키). 없으면 null. */
  projectPath: string | null;
  /** 마스터 스위치. */
  enabled: boolean;
  activation: BrainActivation | undefined;
  /** 축별 현재값(미지정 축은 권장 조합이 적용된 결과). */
  axes: { id: BrainAxisId; enabled: boolean }[];
  /** 잠들어 있는 카드 수(꺼져 있어도 세어 둔 값). */
  sleepingCardCount: number;
  setEnabled: (next: boolean) => Promise<void>;
  setAxis: (axis: BrainAxisId, next: boolean) => Promise<void>;
}

async function put(body: Record<string, unknown>): Promise<void> {
  try {
    await fetch('/api/brain/activation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* 표시 전용 경로 — 실패해도 화면은 다음 스냅샷에서 진실로 되돌아온다 */
  }
}

export function useBrainActivation(): BrainActivationApi {
  const byProject = useGraphStore((s) => s.userDefaults?.brainByProject);
  /** REST 로 보낼 값 — 서버가 프로젝트를 찾는 이름이다(경로를 보내면 엉뚱한 프로젝트로 떨어진다). */
  const projectName = useGraphStore((s) => s.activeProject);
  /** 활성화를 조회할 값 — `brainByProject` 의 키와 같은 절대경로. */
  const storePath = useGraphStore(selectActiveBrainProjectPath);

  /**
   * 꺼져 있으면 스냅샷에 brain 요약이 실리지 않는다(게이트 ③) — 그런데 켜는 두 입구(설정 창
   * `Project Brain` 탭 · 캔버스 우클릭)는 "N장이 잠들어 있습니다"를 말해야 하므로 장수를 알아야 한다.
   * 그 하나 때문에 게이트를 뚫지 않고, **게이트가 예외로 열어 둔 활성화 조회**에서 받아 온다.
   *
   * 같은 응답의 `root` 도 붙들어 둔다 — 스토어에 아직 프로젝트가 하이드레이트되기 전에는
   * 경로를 알 수 없어, 그 짧은 사이에 두뇌가 "꺼짐"으로 잘못 보이기 때문이다.
   */
  const [sleepingCardCount, setSleepingCardCount] = useState(0);
  const [serverRoot, setServerRoot] = useState<string | null>(null);
  useEffect(() => {
    if (!projectName) { setSleepingCardCount(0); setServerRoot(null); return; }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/brain/activation?project=${encodeURIComponent(projectName)}`);
        if (!res.ok) return;
        const j = (await res.json()) as { sleepingCardCount?: number; root?: string | null };
        if (!alive) return;
        if (typeof j.sleepingCardCount === 'number') setSleepingCardCount(j.sleepingCardCount);
        setServerRoot(typeof j.root === 'string' ? j.root : null);
      } catch {
        /* 조회 실패 = 안내를 띄우지 않는다(0장이면 묻지 않는 규칙과 같은 결과) */
      }
    })();
    return () => { alive = false; };
  }, [projectName, byProject]);

  const projectPath = storePath ?? serverRoot;
  const enabled = isBrainEnabled(byProject, projectPath, clientPathPlatform());
  const activation = resolveBrainActivation(byProject, projectPath, clientPathPlatform());

  const axes = useMemo(
    () => BRAIN_AXIS_IDS.map((id) => ({ id, enabled: isBrainAxisEnabled(byProject, projectPath, id, clientPathPlatform()) })),
    [byProject, projectPath],
  );

  const setEnabled = useCallback(async (next: boolean) => {
    if (!projectName) return;
    await put({ project: projectName, enabled: next });
  }, [projectName]);

  const setAxis = useCallback(async (axis: BrainAxisId, next: boolean) => {
    if (!projectName) return;
    await put({ project: projectName, axes: { [axis]: next } });
  }, [projectName]);


  return {
    projectPath,
    enabled,
    activation,
    axes,
    sleepingCardCount,
    setEnabled,
    setAxis,
  };
}
