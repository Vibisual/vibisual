import * as THREE from 'three';
import { VIBI3D_API_PREFIX } from '@vibisual/shared';
import type { InspectorPickLevel, InspectorPickLevels, InspectorPickPoint } from '../../utils/inspectorPick.js';
import { firstModelPick, selectionModelBounds } from './modelBounds.js';

/**
 * §5.4 #15 (C) — Alt 인스펙터가 3D 화면 안의 물체를 집는다. 뷰포트는 WebGL 캔버스 한 장이라 브라우저는 판만 안다 — 그래서
 * 클릭 선택과 **같은 광선 판정**(`Raycaster` → 모델 뿌리)으로 커서 아래 물체를 찾고, 그 물체 → 부모들 → 모델 전체를 칸으로
 * 답한다. 상자는 그 물체의 월드 경계 상자를 화면에 투영한 것이다. 복사 글은 받는 AI 가 바로 고칠 수 있게 노드의 안정 id
 * (`userData.vibi3dId` — 명령·원본이 쓰는 id)와 고치는 길(열린 장면의 다리 · 저장된 원본)을 싣는다.
 */

export interface ModelInspectScene {
  readonly camera: THREE.Camera;
  /** 집을 수 있는 것 — 모델 뿌리(격자·기즈모·스튜디오 조명은 밖에 있다). */
  readonly root: THREE.Object3D;
  /** 안정 id — 없는 노드는 칸이 되지 않는다. */
  readonly idOf: (object: THREE.Object3D) => string | null;
}

/** 무엇을 보고 있나 — 열린 편집 장면, 또는 시안 비교의 한쪽. */
export type ModelInspectSubject =
  | {
    readonly kind: 'scene';
    readonly projectId: string;
    readonly fileName: string;
    readonly revision: number;
    /** 다리가 이어져 있을 때만 — 에이전트가 열린 장면을 바로 고치는 길. */
    readonly liveSessionId: string | null;
    readonly source: { readonly id: string; readonly revision: number } | null;
    readonly unsaved: boolean;
  }
  | {
    readonly kind: 'review';
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceRevision: number;
    /** 시안(제안) 쪽이면 그 id, 지금 원본 쪽이면 null. */
    readonly candidateId: string | null;
  };

/** `userData.vibi3dId` — 저장된 원본과 시안이 들고 다니는 안정 id. */
export function storedModelId(object: THREE.Object3D): string | null {
  const id: unknown = object.userData['vibi3dId'];
  return typeof id === 'string' && id ? id : null;
}

const quote = (text: string): string => JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
const num = (value: number): string => String(Math.round(value * 1000) / 1000);
const vec = (v: THREE.Vector3): string => `[${num(v.x)}, ${num(v.y)}, ${num(v.z)}]`;
const nameOf = (object: THREE.Object3D): string => object.name || object.type;

/** 경계 상자를 화면에 투영한 판 안의 사각형. 카메라 뒤로 넘어간 꼭짓점이 있으면 투영이 뒤집히므로 판 전체로 둔다. */
function screenRect(box: THREE.Box3, camera: THREE.Camera, at: InspectorPickPoint): InspectorPickLevel['rect'] | null {
  if (box.isEmpty()) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const corner = new THREE.Vector3();
  const view = new THREE.Vector3();
  for (let i = 0; i < 8; i += 1) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    view.copy(corner).applyMatrix4(camera.matrixWorldInverse);
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera && view.z >= 0) return { x: 0, y: 0, width: at.width, height: at.height };
    corner.project(camera);
    const x = (corner.x + 1) / 2 * at.width;
    const y = (1 - corner.y) / 2 * at.height;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const left = Math.max(0, minX); const top = Math.max(0, minY);
  const right = Math.min(at.width, maxX); const bottom = Math.min(at.height, maxY);
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 뿌리에서 그 노드까지의 이름 길 — `Product › Car › Wheel_FL`. */
function pathOf(node: THREE.Object3D, root: THREE.Object3D): string {
  const names: string[] = [];
  for (let cur: THREE.Object3D | null = node; cur; cur = cur.parent) {
    names.unshift(nameOf(cur));
    if (cur === root) break;
  }
  return names.join(' › ');
}

function describeNode(node: THREE.Object3D, id: string, root: THREE.Object3D, box: THREE.Box3): string {
  const size = box.getSize(new THREE.Vector3());
  return `object ${quote(nameOf(node))} id "${id}" (${node.type}, path ${quote(pathOf(node, root))}, position ${vec(node.position)} local,`
    + ` size ${vec(size)} world${node.userData['vibi3dLocked'] ? ', locked' : ''})`;
}

/** 복사 글 세 줄 — 무엇을 보고 있나 · 가리킨 것 · 고치는 길(이 장면의 실제 주소). */
export function buildModelPickClipboard(subject: ModelInspectSubject, pointed: string): string {
  const project = encodeURIComponent(subject.projectId);
  const guide = 'guide: GET $VIBISUAL_BASE/api/app/creation/guide';
  if (subject.kind === 'review') {
    const doc = `$VIBISUAL_BASE/api/app/creation/docs/${encodeURIComponent(subject.sourceId)}`;
    const head = subject.candidateId
      ? `[3D] proposal "${subject.candidateId}" for source "${subject.sourceId}" (based on revision ${subject.sourceRevision}) in project ${quote(subject.projectId)} — preview, not adopted`
      : `[3D] source "${subject.sourceId}" revision ${subject.sourceRevision} in project ${quote(subject.projectId)} — the "before" side of a proposal review`;
    const read = subject.candidateId
      ? `GET ${doc}/candidates/${encodeURIComponent(subject.candidateId)}?projectId=${project} reads this proposal`
      : `GET ${doc}?projectId=${project} reads this source`;
    return [
      head,
      `[Pointed] ${pointed}`,
      `[Hint] This is 3D model data, not app code. ${read}; change it by proposing again with POST ${doc}/candidates (the user adopts proposals — never accept one yourself; ${guide}).`,
    ].join('\n');
  }
  const facts = [
    `revision ${subject.revision}`,
    subject.source ? `saved source "${subject.source.id}" revision ${subject.source.revision}` : 'no saved source yet',
    subject.unsaved ? 'unsaved changes in the viewer' : '',
  ].filter(Boolean).join(', ');
  const ways: string[] = [];
  if (subject.liveSessionId) {
    const live = `$VIBISUAL_BASE${VIBI3D_API_PREFIX}/sessions/${encodeURIComponent(subject.liveSessionId)}`;
    ways.push(`while it is open, GET ${live} (latest snapshot — use node ids from it) and POST ${live}/commands`);
  }
  if (subject.source) {
    ways.push(`the saved source is GET $VIBISUAL_BASE/api/app/creation/docs/${encodeURIComponent(subject.source.id)}?projectId=${project} (${guide})`);
  }
  return [
    `[3D] scene ${quote(subject.fileName)} open in Vibi3D in project ${quote(subject.projectId)} (${facts})`,
    `[Pointed] ${pointed}`,
    `[Hint] This is 3D scene data, not app code.${ways.length ? ` ${ways.join('; ')}.` : ' Ask the user to save the source in Vibi3D first.'}`,
  ].join('\n');
}

/**
 * 커서 아래 물체 → 그 부모들 → 모델 뿌리. 숨긴 물체는 지나간다(보이는 것을 집는다). 맞은 것이 없으면 빈 답 — 판이 그대로
 * DOM 으로 집힌다. 카메라의 행렬은 그리는 쪽이 매 프레임 갱신한다고 본다.
 */
export function modelInspectLevels(scene: ModelInspectScene, subject: ModelInspectSubject, at: InspectorPickPoint): InspectorPickLevels {
  if (at.width <= 0 || at.height <= 0) return [];
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(at.x / at.width * 2 - 1, -(at.y / at.height) * 2 + 1), scene.camera);
  const hit = firstModelPick(scene.root, raycaster.intersectObject(scene.root, true));
  if (!hit) return [];
  const levels: InspectorPickLevel[] = [];
  for (let cur: THREE.Object3D | null = hit; cur; cur = cur.parent) {
    const id = scene.idOf(cur);
    if (id) {
      const box = selectionModelBounds(scene.root, cur);
      const rect = screenRect(box, scene.camera, at);
      if (rect) {
        levels.push({
          rect,
          label: nameOf(cur),
          text: cur.parent && cur !== scene.root ? `${cur.type} · ${nameOf(cur.parent)}` : cur.type,
          clipboard: buildModelPickClipboard(subject, describeNode(cur, id, scene.root, box)),
        });
      }
    }
    if (cur === scene.root) break;
  }
  return levels;
}
