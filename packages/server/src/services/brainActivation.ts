/**
 * §5.10 v2 (H) — **두뇌 활성화 관문.**
 *
 * 브레인은 기본 off 이고, 껐을 때 **토큰이 0** 이어야 의미가 있다. 그래서 게이트는 네 겹이다:
 * ① 수집(리플렉션 예약) ② 주입(브리핑 조립) ③ 표시(요약 = 버블) ④ REST.
 * 네 겹이 **전부 이 파일의 함수를 통과**한다 — 판정이 여러 벌이면 한 겹이 조용히 열린 채 남는다.
 *
 * 활성 상태의 진실은 `UserDefaults.brainByProject`(프로젝트별)이고, 판정 규칙 자체는
 * `@vibisual/shared` 에 있다(클라의 표시 판정과 같은 함수를 써야 화면과 동작이 어긋나지 않는다).
 *
 * **끄기는 동작 정지이지 삭제가 아니다** — 카드 파일은 디스크에 그대로 남는다(§5.11 승계).
 */
import {
  isBrainAxisEnabled,
  isBrainEnabled,
  resolveBrainActivation,
  type BrainActivation,
  type BrainAxisId,
} from '@vibisual/shared';
import { userDefaultsService } from './userDefaultsService.js';

// ⚠️ 아래 세 관문은 `brainByProject` 를 **경로 키**로 조회한다. `process.platform` 을 넘기지 않으면
//    shared 가 예전처럼 무조건 소문자로 접어, Linux 에서 케이스만 다른 두 프로젝트가 같은 칸을 본다
//    (= 한 프로젝트의 두뇌 카드가 다른 프로젝트 프롬프트에 주입된다). 인자를 빼지 마라.

/** 이 프로젝트의 활성화 레코드. 없으면 `undefined`(= 손댄 적 없음 = 꺼짐). */
export function brainActivationFor(root: string | null | undefined): BrainActivation | undefined {
  return resolveBrainActivation(userDefaultsService.get().brainByProject, root, process.platform);
}

/** 마스터 판정 — 게이트 네 겹의 공통 관문. */
export function brainEnabledFor(root: string | null | undefined): boolean {
  return isBrainEnabled(userDefaultsService.get().brainByProject, root, process.platform);
}

/**
 * 축 판정 — 마스터가 꺼져 있으면 축은 볼 것도 없이 false 다.
 * 축 하나가 켜져 있다고 마스터를 우회하지 못한다.
 */
export function brainAxisEnabledFor(root: string | null | undefined, axis: BrainAxisId): boolean {
  return isBrainAxisEnabled(userDefaultsService.get().brainByProject, root, axis, process.platform);
}
