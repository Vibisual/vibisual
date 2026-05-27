/**
 * §5.4 #29 v1.51 — Vibisual 내부 캔버스 클립보드 훅.
 *
 * Ctrl/Cmd+C : 선택된 커스텀 에이전트 + Task Edge + Comment Box 묶음을
 *              localStorage 단일 슬롯에 직렬화 (시스템 클립보드와 분리).
 * Ctrl/Cmd+V : 활성 프로젝트 캔버스의 마우스 위치에 anchor 를 두고
 *              POST /api/canvas/paste 로 새 ID 부여하여 일괄 복원.
 *
 * - 복사 대상은 customCreated=true 에이전트, 양 끝이 모두 선택된 Task Edge,
 *   ReactFlow 에서 selected=true 인 Comment Box 노드.
 * - 메인 뷰(currentFolderId === null) + 비-INPUT/TEXTAREA 포커스에서만 동작.
 * - rulesHistory 등 런타임 데이터는 strip — 클립보드를 타고 누적되지 않도록.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';
import {
  CANVAS_CLIPBOARD_STORAGE_KEY,
  CANVAS_CLIPBOARD_SCHEMA_VERSION,
  CANVAS_CLIPBOARD_DEFAULT_PASTE_OFFSET,
} from '@vibisual/shared';
import type {
  AgentConfig,
  CanvasClipboardPayload,
  CanvasClipboardAgentEntry,
  CanvasClipboardTaskEdgeEntry,
  CanvasClipboardCommentBoxEntry,
  CanvasPasteResponse,
  TaskEdge,
  CommentBox,
  BubbleData,
} from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../stores/graphStore.js';

interface Params {
  rfRef: RefObject<ReactFlowInstance | null>;
  rfContainerRef: RefObject<HTMLDivElement | null>;
  flowNodesRef: RefObject<Node[]>;
  flowEdgesRef: RefObject<Edge[]>;
  activeProject: string | null;
  currentFolderId: string | null;
  onToast: (message: string, kind: 'success' | 'error') => void;
  /** i18n 메시지 빌더 — `${count}` placeholder 치환은 호출자에서. */
  messages: {
    copySuccess: (count: number) => string;
    copyEmpty: string;
    pasteSuccess: (count: number) => string;
    pasteEmpty: string;
    pasteFailed: string;
    pasteInvalidVersion: string;
  };
}

function readPayload(): CanvasClipboardPayload | null {
  try {
    const raw = window.localStorage.getItem(CANVAS_CLIPBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as CanvasClipboardPayload;
  } catch {
    return null;
  }
}

function stripAgentConfig(config: AgentConfig | undefined): Omit<AgentConfig, 'rulesHistory'> {
  if (!config) {
    // 안전 기본값(최소 필드만 채움) — 페이스트 시 서버는 필드를 그대로 적용하므로
    // 빈 도구·기본 모드로 폴백
    return {
      model: 'sonnet',
      tools: [],
      permissionMode: 'default',
      skills: [],
    };
  }
  // rulesHistory 만 제거. 나머지 필드(rules / customMode / 색상 / maxTurns 등) 전부 보존.
  const { rulesHistory: _omit, ...rest } = config;
  return rest;
}

export function useCanvasClipboard({
  rfRef,
  rfContainerRef,
  flowNodesRef,
  flowEdgesRef,
  activeProject,
  currentFolderId,
  onToast,
  messages,
}: Params): void {
  // 마지막 마우스 위치 — paste 시 anchor 결정에 사용
  const lastMouseRef = useRef<{ clientX: number; clientY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      lastMouseRef.current = { clientX: e.clientX, clientY: e.clientY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return true;
      return false;
    }

    function handleCopy(): void {
      const flowNodes = flowNodesRef.current ?? [];
      const flowEdges = flowEdgesRef.current ?? [];
      const store = useGraphStore.getState();

      const selectedBubbleNodes = flowNodes.filter(
        (n) => n.selected && n.type === 'bubble',
      );
      const selectedCommentBoxNodes = flowNodes.filter(
        (n) => n.selected && n.type === 'commentBox',
      );

      // 커스텀 에이전트만 — Hook 에이전트/파일/폴더/Bash/iframe/conti 등은 strip.
      // flowBuilder 가 `data: { ...bubbleData }` 로 spread 했으므로 n.data 자체가 BubbleData.
      const customAgentNodes = selectedBubbleNodes.filter((n) => {
        const bubble = n.data as Partial<BubbleData> | undefined;
        return bubble?.bubbleType === 'agent' && bubble.customCreated === true;
      });

      // 단독 commentBox 선택도 허용 — Comment Box 만 복사
      if (customAgentNodes.length === 0 && selectedCommentBoxNodes.length === 0) {
        onToast(messages.copyEmpty, 'error');
        return;
      }

      // anchor = 선택 셋의 좌상단(원본 캔버스 좌표).
      // 에이전트와 commentBox 둘 다 좌상단 기준으로 묶는다.
      let minX = Infinity;
      let minY = Infinity;
      for (const n of customAgentNodes) {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
      }
      for (const n of selectedCommentBoxNodes) {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        minX = 0;
        minY = 0;
      }

      const includedAgentIds = new Set(customAgentNodes.map((n) => n.id));

      // 에이전트 항목 빌드 — config 는 store.agentConfigs 에서 가져옴
      const agents: CanvasClipboardAgentEntry[] = customAgentNodes.map((n) => {
        const bubble = n.data as Partial<BubbleData> | undefined;
        const cfg = store.agentConfigs[n.id];
        return {
          oldId: n.id,
          label: bubble?.label ?? n.id,
          relPosition: { x: n.position.x - minX, y: n.position.y - minY },
          config: stripAgentConfig(cfg),
        };
      });

      // Task Edge 항목 — 양 끝이 모두 customAgentNodes 안에 있는 것만
      // bundleRole='auto-artifact' / 'auto-rework' 자매 엣지는 제외(서버가 paste 시 자동 재생성)
      const allEdges: TaskEdge[] = Object.values(store.taskEdges);
      const taskEdges: CanvasClipboardTaskEdgeEntry[] = [];
      for (const edge of allEdges) {
        if (!includedAgentIds.has(edge.sourceAgentId)) continue;
        if (!includedAgentIds.has(edge.targetAgentId)) continue;
        if (edge.bundleRole === 'auto-artifact' || edge.bundleRole === 'auto-rework') continue;
        const entry: CanvasClipboardTaskEdgeEntry = {
          sourceOldId: edge.sourceAgentId,
          targetOldId: edge.targetAgentId,
          command: edge.command,
          forwardMode: edge.forwardMode,
          templateId: edge.templateId,
          ...(edge.kind !== undefined && { kind: edge.kind }),
          ...(edge.messageFormat !== undefined && { messageFormat: edge.messageFormat }),
          ...(edge.messageSchema !== undefined && { messageSchema: edge.messageSchema }),
          ...(edge.returnFormat !== undefined && { returnFormat: edge.returnFormat }),
          ...(edge.timeoutMs !== undefined && { timeoutMs: edge.timeoutMs }),
          ...(edge.retryCount !== undefined && { retryCount: edge.retryCount }),
          ...(edge.cacheEnabled !== undefined && { cacheEnabled: edge.cacheEnabled }),
          ...(edge.priority !== undefined && { priority: edge.priority }),
          ...(edge.delegationPolicy !== undefined && { delegationPolicy: edge.delegationPolicy }),
          ...(edge.critiqueTiming !== undefined && { critiqueTiming: edge.critiqueTiming }),
          ...(edge.critiqueAuthority !== undefined && { critiqueAuthority: edge.critiqueAuthority }),
          ...(edge.maxReworkCount !== undefined && { maxReworkCount: edge.maxReworkCount }),
          ...(edge.commandMode !== undefined && { commandMode: edge.commandMode }),
        };
        taskEdges.push(entry);
      }

      // 또한 ReactFlow 측 selected=true 인 task edge 도 명시적으로 포함 검증
      // (위 로직이 이미 모든 inter-selected 엣지를 잡지만 사용자가 일부 엣지만 선택한 경우는
      //  현재 전부 포함 — 묶음 단위 복사가 자연스러움)
      void flowEdges;

      const commentBoxesAll: CommentBox[] = store.commentBoxes;
      const selectedBoxIds = new Set(selectedCommentBoxNodes.map((n) => n.id));
      const commentBoxes: CanvasClipboardCommentBoxEntry[] = [];
      for (const box of commentBoxesAll) {
        if (!selectedBoxIds.has(box.id)) continue;
        commentBoxes.push({
          relX: box.x - minX,
          relY: box.y - minY,
          width: box.width,
          height: box.height,
          text: box.text,
          color: box.color,
          ...(box.textColor !== undefined && { textColor: box.textColor }),
          ...(box.fontSize !== undefined && { fontSize: box.fontSize }),
          ...(box.opacity !== undefined && { opacity: box.opacity }),
          // 같은 페이로드 안에 들어온 노드만 매핑 가능 — 외부는 drop
          childOldIds: box.childNodeIds.filter((cid) => includedAgentIds.has(cid)),
        });
      }

      const payload: CanvasClipboardPayload = {
        schemaVersion: CANVAS_CLIPBOARD_SCHEMA_VERSION,
        copiedAt: Date.now(),
        origin: { projectName: activeProject ?? '' },
        anchor: { x: minX, y: minY },
        agents,
        taskEdges,
        commentBoxes,
      };

      try {
        window.localStorage.setItem(CANVAS_CLIPBOARD_STORAGE_KEY, JSON.stringify(payload));
        const total = agents.length + taskEdges.length + commentBoxes.length;
        onToast(messages.copySuccess(total), 'success');
      } catch {
        onToast(messages.copyEmpty, 'error');
      }
    }

    async function handlePaste(): Promise<void> {
      if (!activeProject) {
        onToast(messages.pasteEmpty, 'error');
        return;
      }
      const payload = readPayload();
      if (!payload) {
        onToast(messages.pasteEmpty, 'error');
        return;
      }
      if (payload.schemaVersion !== CANVAS_CLIPBOARD_SCHEMA_VERSION) {
        onToast(messages.pasteInvalidVersion, 'error');
        return;
      }
      const totalIncoming =
        (payload.agents?.length ?? 0) +
        (payload.taskEdges?.length ?? 0) +
        (payload.commentBoxes?.length ?? 0);
      if (totalIncoming === 0) {
        onToast(messages.pasteEmpty, 'error');
        return;
      }

      // anchor 결정: 마지막 마우스 위치를 캔버스 좌표로 환산. 컨테이너 밖이면 viewport 중심,
      // rfRef 미가용이면 원본 anchor + offset 폴백.
      let anchor = {
        x: payload.anchor.x + CANVAS_CLIPBOARD_DEFAULT_PASTE_OFFSET,
        y: payload.anchor.y + CANVAS_CLIPBOARD_DEFAULT_PASTE_OFFSET,
      };
      const rect = rfContainerRef.current?.getBoundingClientRect();
      const mouse = lastMouseRef.current;
      if (rfRef.current && rect && mouse) {
        const inside =
          mouse.clientX >= rect.left &&
          mouse.clientX <= rect.right &&
          mouse.clientY >= rect.top &&
          mouse.clientY <= rect.bottom;
        if (inside) {
          anchor = rfRef.current.screenToFlowPosition({ x: mouse.clientX, y: mouse.clientY });
        } else {
          anchor = rfRef.current.screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        }
      }

      try {
        const res = await fetch(`/api/canvas/paste`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: activeProject, anchor, payload }),
        });
        if (!res.ok) {
          onToast(messages.pasteFailed, 'error');
          return;
        }
        const data = (await res.json()) as CanvasPasteResponse | { ok: false; error?: string };
        if (!('ok' in data) || data.ok !== true) {
          onToast(messages.pasteFailed, 'error');
          return;
        }
        const newAgentCount = Object.keys(data.idMap.agents).length;
        const newEdgeCount = Object.keys(data.idMap.edges).length;
        const newBoxCount = Object.keys(data.idMap.commentBoxes).length;
        onToast(messages.pasteSuccess(newAgentCount + newEdgeCount + newBoxCount), 'success');
      } catch {
        onToast(messages.pasteFailed, 'error');
      }
    }

    function handleKey(e: KeyboardEvent): void {
      if (currentFolderId !== null) return; // 메인 뷰 전용
      // IDE 오버레이 모달이 열려 있으면 캔버스 클립보드 비활성 —
      // 출력 영역(div/span/pre) 텍스트 선택 후 Ctrl+C 가 네이티브 복사로 가도록 보존.
      // selectIDEOverlay 는 활성 탭의 IDE 슬롯만 반환하므로 다른 탭 IDE 는 영향 X.
      if (selectIDEOverlay(useGraphStore.getState()).agentId) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      // 실제 텍스트가 선택돼 있으면(코멘트박스 등 비-INPUT 영역) 네이티브 복사 우선.
      if ((window.getSelection()?.toString() ?? '').trim().length > 0) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        e.preventDefault();
        handleCopy();
      } else if (key === 'v') {
        e.preventDefault();
        void handlePaste();
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    rfRef,
    rfContainerRef,
    flowNodesRef,
    flowEdgesRef,
    activeProject,
    currentFolderId,
    onToast,
    messages,
  ]);
}
