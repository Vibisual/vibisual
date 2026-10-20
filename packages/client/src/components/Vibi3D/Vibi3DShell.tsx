import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/controls/TransformControls.js';
import type { CreationCandidate, CreationDoc, CreationLink, CreationValue, Vibi3DCommand, Vibi3DCommandRequest, Vibi3DSnapshot, Vibi3DVec3, Vibi3DCaptureCommand, Vibi3DDraft, Vibi3DStats } from '@vibisual/shared';
import { resolveVibi3DCameraFov } from '@vibisual/shared';
import { vibi3dViewSize } from './vibi3dViewSize.js';
import { MODEL_BACKGROUNDS as BACKGROUNDS, MODEL_VIEW_FOV, createModelGrid, frameModelCamera, modelFrame } from './modelViewport.js';
import { openAppWindow } from '../../apps/appWindows.js';
import type { AppShellProps } from '../../apps/registry.js';
import { useAppWindowCloseGuard } from '../../apps/appWindowCloseGuard.js';
import { useAppWindowCloseRetention } from '../../apps/appWindowCloseRetention.js';
import { useAppWindowShown } from '../../apps/appWindowVisibility.js';
import { confirmDialog } from '../../utils/appDialog.js';
import { updateAppWindowTarget, useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { useAppBoxTier } from '../../hooks/useBoxTier.js';
import { registerInspectorPicker } from '../../utils/inspectorPick.js';
import { shortcutLabel } from '../../utils/platform.js';
import { editedMediaPath, writeWorkspaceMedia } from '../../utils/workspaceMedia.js';
import { CreationApiError, acceptCreationCandidate, readCreationRevision, recordCreationOutput, restoreCreationDoc } from '../Creation/creationApi.js';
import { CreationUiError, creationErrorText } from '../Creation/creationErrors.js';
import { registerDurableFlush } from '../../utils/persistFlush.js';
import { SourceConnections } from '../Creation/SourceConnections.js';
import { applyStudioEnvironment, createStudioLights, planStudioLights, releaseStudioEnvironment, renderStudioView, type StudioLights } from '../Creation/studioLighting.js';
import { useCreationHead } from '../Creation/useCreationHead.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { compareModelSources } from './modelComparison.js';
import { modelInspectLevels, type ModelInspectSubject } from './modelInspect.js';
import { ModelEditor, type ModelApplyOptions } from './modelEditor.js';
import { prepareLocalGraphicTexture } from './modelLocalTexture.js';
import { modelSceneStats } from './modelSceneStats.js';
import { createModelCanvasMirrorPublisher, modelCanvasMirrorTarget, type ModelCanvasMirrorPublisher } from './modelCanvasMirror.js';
import { firstModelPick, updateSelectionBox } from './modelBounds.js';
import { commitModelTexture, imageHasAlpha, prepareModelTexture, readTextureSource, renderTextureSource } from './modelImageLink.js';
import { modelTextureReferences, modelTextureSlot } from './modelTextureReferences.js';
import { needsPreparedVibi3DCommands, prepareVibi3DCommands } from './prepareVibi3DCommands.js';
import { Vibi3DSourceProject } from './Vibi3DImageSourceField.js';
import { disposeModel, exportModelGlb, loadLocalModel, loadWorkspaceModel, type LoadedModel } from './modelIO.js';
import { loadModelSource, openModelDocument, readModelDocument, saveModelDocument, serializeModelSource } from './modelSource.js';
import { captureVibi3DViews } from './vibi3dCapture.js';
import { rememberVibi3DDocument, vibi3DOwnerId } from './vibi3dWorkflow.js';
import { useVibi3DBridge, type Vibi3DExecutionContext, type Vibi3DExecutionResult } from './useVibi3DBridge.js';
import { Vibi3DAgentPanel } from './Vibi3DAgentPanel.js';
import { Vibi3DCandidates } from './Vibi3DCandidates.js';
import { Vibi3DCodePanel } from './Vibi3DCodePanel.js';
import { Vibi3DImageSources } from './Vibi3DImageSources.js';
import { Vibi3DInspector } from './Vibi3DInspector.js';
import { Vibi3DWorkflowPanel } from './Vibi3DWorkflowPanel.js';
import { ModelAgentDraft } from './modelAgentDraft.js';
import { ModelDraftAutosave } from './modelDraftAutosave.js';
import { discardModelDraft, listModelDrafts, ModelDraftApiError, readModelDraft, type ModelDraftInput, type ModelDraftScope } from './modelDraftApi.js';
import { Vibi3DDraftPanel, Vibi3DDraftStatus } from './Vibi3DDraftPanel.js';

/** User and agent models have independent editing history and durable draft lanes. */
const degrees = (object: THREE.Object3D): [number, number, number] => {
  const r = new THREE.Euler().setFromQuaternion(object.quaternion, 'XYZ');
  return [r.x, r.y, r.z].map(THREE.MathUtils.radToDeg) as [number, number, number];
};
function ToolButton({ onClick, active, disabled, title, children }: {
  onClick: () => void; active?: boolean; disabled?: boolean; title?: string; children: React.ReactNode;
}): React.JSX.Element {
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} title={title}
    className={`shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:py-2 ${active ? 'bg-violet-500/25 text-violet-200' : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]'}`}>{children}</button>;
}

export function Vibi3DShell({ params }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const tRef = useRef(t); tRef.current = t;
  const errorText = useCallback((error: unknown): string => creationErrorText(tRef.current, error), []);
  const root = params['projectId'] ?? '';
  const initialPath = params['file'] ?? '';
  const initialSource = params['modelId'] ?? params['ref'] ?? '';
  const routeScope = JSON.stringify([root, initialSource, initialPath]);
  const routeScopeRef = useRef(routeScope); routeScopeRef.current = routeScope;
  const sourceDocRef = useRef<CreationDoc | null>(null);
  const humanDraftLinksRef = useRef<CreationLink[] | null>(null);
  const sourceConflictRef = useRef(false);
  const humanEditsRef = useRef(false);
  const humanBaselineRef = useRef({ saved: false, persisted: false });
  const applyingAgentRef = useRef(false);
  const ownerId = useRef(vibi3DOwnerId()).current;
  const [sourceDoc, setSourceDoc] = useState<CreationDoc | null>(null);
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  const shown = useAppWindowShown();
  const shownRef = useRef(shown); shownRef.current = shown;
  const mountRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<ModelEditor | null>(null);
  const agentRef = useRef<ModelAgentDraft | null>(null);
  const agentSceneRef = useRef<THREE.Scene | null>(null);
  const agentLightsRef = useRef<StudioLights | null>(null);
  const agentBusyRef = useRef(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentSnapshot, setAgentSnapshot] = useState<Vibi3DSnapshot | null>(null);
  const [viewActor, setViewActor] = useState<'human' | 'agent'>('human');
  const viewActorRef = useRef(viewActor); viewActorRef.current = viewActor;
  const quiescingRef = useRef(false);
  const [quiescing, setQuiescing] = useState(false);
  const [autosave] = useState(() => new ModelDraftAutosave());
  const [, setDraftRefresh] = useState(0);
  const draftKeyRef = useRef('');
  const [draftKey, setDraftKey] = useState('');
  const draftReadyRef = useRef(false);
  const conflictBackupRef = useRef<{ scope: string; key: string } | null>(null);
  const lastDraftRef = useRef({ human: '', agent: '' });
  const queueDraftRef = useRef<(actor: 'human' | 'agent', force?: boolean) => void>(() => {});
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const mirrorContextLostRef = useRef(false);
  const mirrorRef = useRef<ModelCanvasMirrorPublisher | null>(null);
  const mirrorRouteRef = useRef({ projectId: root, workRef: initialSource, file: initialPath });
  mirrorRouteRef.current = { projectId: root, workRef: initialSource, file: initialPath };
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const boxRef = useRef<THREE.BoxHelper | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const lightsRef = useRef<StudioLights | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const clipRef = useRef(0);
  const playingRef = useRef(false);
  const playTimeRef = useRef(0);
  const snapshotRef = useRef<Vibi3DSnapshot | null>(null);
  const busyRef = useRef(false);
  const loadingRef = useRef(false);
  const dragRef = useRef<{ object: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 } | null>(null);
  /** §5.4 #15 (C) — Alt 인스펙터가 묻는 순간의 장면 정보(다리·원본·저장 여부는 그때그때 바뀐다). 아래 다리 뒤에서 채운다. */
  const inspectSubjectRef = useRef<() => ModelInspectSubject | null>(() => null);
  const sourcePathRef = useRef('');
  const persistedRef = useRef({ path: '', revision: -1 });
  const loadSequence = useRef(0);
  const mounted = useRef(true);
  const [snapshot, setSnapshot] = useState<Vibi3DSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [contextLost, setContextLost] = useState(false);
  const [savedRevision, setSavedRevision] = useState(-1);
  const savedRevisionRef = useRef(savedRevision); savedRevisionRef.current = savedRevision;
  const [savedPath, setSavedPath] = useState('');
  const [mode, setMode] = useState<TransformControlsMode>('translate');
  // 속성 칸 — 넓은 창은 기본으로 열고, 폰 폭(box-narrow)은 무대가 먼저라 기본으로 접는다. [속성] 단추를 한 번 누르면 그 선택을 따른다.
  const boxTier = useAppBoxTier();
  const [inspectorChoice, setInspectorChoice] = useState<boolean | null>(null);
  const inspector = inspectorChoice ?? boxTier !== 'narrow';
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [spin, setSpin] = useState(false);
  const [bg, setBg] = useState<'dark' | 'light'>('dark');
  const [playing, setPlaying] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);
  const [playTime, setPlayTime] = useState(0);
  const [stats, setStats] = useState({ triangles: 0, vertices: 0 });
  const [sceneStats, setSceneStats] = useState<Vibi3DStats>();
  const [missingTextures, setMissingTextures] = useState<string[]>([]);
  const dirty = !!snapshot && snapshot.revision !== savedRevision;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useAppWindowTarget(params, snapshot ? { ref: sourceDoc?.id, file: savedPath || undefined, draftKey: draftKey || undefined } : null);
  // Closing the view is not an agent command to dispose its scene or terminate its bridge.
  useAppWindowCloseRetention(params, () => !!editorRef.current || loadingRef.current);
  useAppWindowCloseGuard(params, async () => {
    if (dragRef.current || busyRef.current) return false;
    try { queueDraftRef.current('human'); await autosave.flush(); return true; }
    catch { setError(tRef.current('panel.vibi3d.drafts.closeFailed')); return false; }
  });
  const draftScope = useCallback((actor: 'human' | 'agent'): ModelDraftScope => ({ projectId: root, key: draftKeyRef.current, actor }), [root]);
  queueDraftRef.current = (actor, force = false): void => {
    const agent = agentRef.current;
    const editor = actor === 'human' ? editorRef.current : agent?.editor;
    if (!draftReadyRef.current || !editor || !draftKeyRef.current) return;
    const doc = actor === 'human' ? sourceDocRef.current : agent?.document;
    const signature = JSON.stringify([draftKeyRef.current, editor.sessionId, editor.revision, doc?.id, doc?.revision]);
    if (!force && lastDraftRef.current[actor] === signature) return;
    const scope = draftScope(actor);
    try {
      if (!root) throw new Error('draft-project-required');
      const payload = serializeModelSource(editor.object, editor.clips, doc?.payload) as unknown as CreationValue;
      autosave.set(scope, { fileName: editor.fileName, ...(doc ? { documentId: doc.id, baseRevision: doc.revision } : {}),
        payload, links: actor === 'agent' ? agent!.links() : modelTextureReferences(editor.object, humanDraftLinksRef.current ?? doc?.links ?? []) });
      lastDraftRef.current[actor] = signature;
    } catch (failure) { autosave.fail(scope, failure); }
  };
  useEffect(() => autosave.subscribe(() => { if (mounted.current) setDraftRefresh(value => value + 1); }), [autosave]);
  useEffect(() => { if (!busy) queueDraftRef.current('human'); }, [busy, snapshot?.revision, sourceDoc?.id, sourceDoc?.revision]);
  useEffect(() => registerDurableFlush(async () => {
    if (dragRef.current) return false;
    quiescingRef.current = true; setQuiescing(true);
    // Let an accepted command finish before taking the final snapshots. New commands are gated.
    const deadline = Date.now() + 12_000;
    while (busyRef.current || agentBusyRef.current) {
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    try {
      if (editorRef.current && !draftReadyRef.current) return false;
      queueDraftRef.current('human'); queueDraftRef.current('agent');
      await autosave.flush(); return true;
    } catch { return false; }
  }, () => { quiescingRef.current = false; if (mounted.current) setQuiescing(false); }), [autosave]);
  // §5.13 (R-10) — a few bytes every couple of seconds; the document is read again only when its revision moved.
  const head = useCreationHead(root, sourceDoc?.id, { enabled: !!sourceDoc });

  const render = useCallback((): void => {
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      const mount = mountRef.current, renderer = rendererRef.current, camera = cameraRef.current;
      const agentView = viewActorRef.current === 'agent' && !!agentRef.current;
      const viewed = agentView ? agentRef.current!.editor.snapshot() : snapshotRef.current;
      if (mount?.clientWidth && mount.clientHeight) {
        const view = viewed?.camera, size = vibi3dViewSize(mount.clientWidth, mount.clientHeight, view?.aspect);
        const key = `${size.width}:${size.height}:${size.left}:${size.top}`;
        if (renderer.domElement.dataset && renderer.domElement.dataset['viewSize'] !== key) {
          renderer.domElement.dataset['viewSize'] = key; renderer.setSize(size.width, size.height, true);
          Object.assign(renderer.domElement.style, { position: 'absolute', left: `${size.left}px`, top: `${size.top}px` });
        }
        camera.aspect = size.width / size.height;
        if (view?.lens !== undefined || view?.fov !== undefined) camera.fov = resolveVibi3DCameraFov(view, camera.aspect, camera.fov);
        camera.updateProjectionMatrix();
      }
      const scene = agentView ? agentSceneRef.current : sceneRef.current;
      if (!scene) return;
      scene.background = sceneRef.current.background;
      renderStudioView(scene, rendererRef.current, cameraRef.current, {
        object: agentView ? agentRef.current!.editor.object : editorRef.current?.object ?? null, mode: scene.overrideMaterial ? 'wire' : 'lit',
      });
      const installed = snapshotRef.current;
      mirrorRef.current?.publish(modelCanvasMirrorTarget(mirrorRouteRef.current, installed ? {
        projectId: installed.projectId, workRef: sourceDocRef.current?.id, file: persistedRef.current.path || sourcePathRef.current,
      } : null, loadingRef.current || sourceConflictRef.current || mirrorContextLostRef.current), renderer.domElement);
    }
  }, []);
  const sync = useCallback((): Vibi3DSnapshot => {
    const editor = editorRef.current;
    if (!editor) throw new CreationUiError('model-not-open');
    const next = editor.snapshot(); snapshotRef.current = next; setSnapshot(next);
    const measured = modelSceneStats(editor.object, editor.revision); setSceneStats(measured);
    let vertices = 0;
    editor.object.traverseVisible((object) => {
      const g = (object as THREE.Mesh).geometry; const p = g?.attributes['position'];
      if (p) vertices += p.count * (object instanceof THREE.InstancedMesh ? object.count : 1);
    });
    setStats({ vertices, triangles: measured.triangles });
    const selected = next.selectedId ? editor.findObject(next.selectedId) : null;
    if (selected && !actionRef.current && viewActorRef.current === 'human') transformRef.current?.attach(selected); else transformRef.current?.detach();
    if (boxRef.current) updateSelectionBox(boxRef.current, editor.object, selected);
    const level = next.lighting ?? 1;
    // (11) The same studio light as candidate previews, video model scenes and product stills.
    if (lightsRef.current) planStudioLights(lightsRef.current, editor.object, level);
    if (sceneRef.current && rendererRef.current) applyStudioEnvironment(sceneRef.current, rendererRef.current, level);
    if (!busyRef.current) queueDraftRef.current('human');
    // A hidden or just-opened app window may not receive animation frames yet.
    render();
    return next;
  }, [render]);
  /** (8) The saved camera moves the view only when the model opens or a camera command sets it — never on other edits. */
  const applySavedView = useCallback((): boolean => {
    const view = viewActorRef.current === 'agent' ? agentRef.current?.editor.snapshot().camera : snapshotRef.current?.camera;
    const camera = cameraRef.current; const controls = controlsRef.current;
    if (!view || !camera || !controls || actionRef.current) return false;
    camera.position.fromArray(view.position); controls.target.fromArray(view.target); controls.update();
    camera.fov = resolveVibi3DCameraFov(view, camera.aspect, camera.fov); camera.updateProjectionMatrix();
    render();
    return true;
  }, [render]);
  const stopPlayback = useCallback((): void => {
    mixerRef.current?.stopAllAction(); actionRef.current = null; playingRef.current = false; playTimeRef.current = 0;
    setPlaying(false); setPlayTime(0); if (editorRef.current) sync();
  }, [sync]);
  const beginHumanEdit = useCallback((editor: ModelEditor): boolean => {
    const started = editor.beginHumanEdits();
    if (started) humanBaselineRef.current = { saved: editor.revision === savedRevisionRef.current,
      persisted: editor.revision === persistedRef.current.revision };
    return started;
  }, []);
  const apply = useCallback((commands: Vibi3DCommand[], expectedRevision?: number, options: ModelApplyOptions = {}): Vibi3DSnapshot => {
    const editor = editorRef.current;
    if (!editor) throw new CreationUiError('model-not-open');
    if (busyRef.current || dragRef.current || quiescingRef.current || viewActorRef.current !== 'human') throw new CreationUiError('model-busy');
    const previousCamera = JSON.stringify(editor.snapshot().camera);
    stopPlayback();
    const started = commands.some(command => command.type !== 'select' && command.type !== 'stats') && beginHumanEdit(editor);
    try { editor.apply(commands, expectedRevision ?? editor.revision, options); }
    finally {
      if (started && !editor.hasHumanEdits) editor.discardHumanEdits();
      humanEditsRef.current = editor.hasHumanEdits;
    }
    setError(''); setNotice('');
    const next = sync();
    if (commands.some((command) => command.type === 'camera' || command.type === 'cameraMotion') || previousCamera !== JSON.stringify(next.camera)) applySavedView();
    return next;
  }, [stopPlayback, sync, applySavedView, beginHumanEdit]);
  const applyRef = useRef(apply); applyRef.current = apply;
  const userCommand = useCallback((command: Vibi3DCommand, options?: ModelApplyOptions): void => {
    if (needsPreparedVibi3DCommands([command])) {
      void (async () => {
        const editor = editorRef.current, document = sourceDocRef.current, scope = routeScopeRef.current;
        if (!editor || busyRef.current || dragRef.current || sourceConflictRef.current || quiescingRef.current || viewActorRef.current !== 'human') throw new CreationUiError('model-busy');
        stopPlayback(); const revision = editor.revision; busyRef.current = true; setBusy(true);
        let prepared: Awaited<ReturnType<typeof prepareVibi3DCommands>> | undefined;
        try {
          prepared = await prepareVibi3DCommands(root, document, [command], crypto.randomUUID(), editor.object,
            modelTextureReferences(editor.object, document?.links ?? []));
          const assertActive = (): void => {
            if (!mounted.current || routeScopeRef.current !== scope || editorRef.current !== editor || sourceConflictRef.current) throw new CreationUiError('scene-changed');
          };
          assertActive();
          const started = beginHumanEdit(editor);
          try { await editor.applyAsync(prepared.commands, revision, { ...options, ...prepared, assertActive }); }
          finally {
            if (started && !editor.hasHumanEdits) editor.discardHumanEdits();
            humanEditsRef.current = editor.hasHumanEdits;
          }
          setError(''); setNotice(''); sync();
        } finally { prepared?.dispose(); busyRef.current = false; if (mounted.current) setBusy(false); }
      })().catch(err => { if (mounted.current) setError(errorText(err)); });
      return;
    }
    try { apply([command], undefined, options); } catch (err) { setError(errorText(err)); }
  }, [apply, errorText, root, stopPlayback, sync, beginHumanEdit]);
  const frameModel = useCallback((): void => {
    const object = (viewActorRef.current === 'agent' ? agentRef.current?.editor : editorRef.current)?.object;
    const camera = cameraRef.current; const controls = controlsRef.current;
    if (!object || !camera || !controls) return;
    const { center, radius } = modelFrame(object);
    controls.target.copy(center); frameModelCamera(camera, center, radius); controls.update();
    render();
  }, [render]);
  const readView = useCallback(() => {
    const camera = cameraRef.current; const controls = controlsRef.current;
    const saved = snapshotRef.current?.camera;
    return camera && controls ? { position: camera.position.toArray() as Vibi3DVec3, target: controls.target.toArray() as Vibi3DVec3,
      ...(saved?.lens !== undefined ? { lens: saved.lens } : { fov: camera.fov }), ...(saved?.aspect ? { aspect: saved.aspect } : {}) } : null;
  }, []);

  useEffect(() => {
    mounted.current = true; busyRef.current = false;
    const mount = mountRef.current; if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setError(errorText(new CreationUiError('model-renderer-unavailable'))); return; }
    const mirror = createModelCanvasMirrorPublisher(); mirrorRef.current = mirror; mirrorContextLostRef.current = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'block'; mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(BACKGROUNDS.dark);
    const camera = new THREE.PerspectiveCamera(MODEL_VIEW_FOV, 1, 0.01, 5000); camera.position.set(2.5, 2, 3.5);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const transform = new TransformControls(camera, renderer.domElement); transform.setSize(0.8); scene.add(transform.getHelper());
    const grid = createModelGrid(); scene.add(grid);
    const lights = createStudioLights(); scene.add(lights.ambient, lights.key);
    applyStudioEnvironment(scene, renderer, 1);
    const box = new THREE.BoxHelper(new THREE.Object3D(), 0xa78bfa); box.visible = false; scene.add(box);
    sceneRef.current = scene; cameraRef.current = camera; rendererRef.current = renderer; controlsRef.current = controls;
    transformRef.current = transform; gridRef.current = grid; boxRef.current = box; lightsRef.current = lights;
    // A lost context comes back empty: three re-uploads the scene, the prefiltered environment is made again.
    const lost = (): void => { mirrorContextLostRef.current = true; mirror.clear(); setContextLost(true); };
    const restored = (): void => {
      releaseStudioEnvironment(renderer); applyStudioEnvironment(scene, renderer, snapshotRef.current?.lighting ?? 1);
      mirrorContextLostRef.current = false;
      setContextLost(false); render();
    };
    renderer.domElement.addEventListener('webglcontextlost', lost); renderer.domElement.addEventListener('webglcontextrestored', restored);
    transform.addEventListener('mouseDown', () => {
      const object = transform.object; if (!object || quiescingRef.current || viewActorRef.current !== 'human') return;
      dragRef.current = { object, position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone() }; controls.enabled = false;
    });
    transform.addEventListener('mouseUp', () => {
      const start = dragRef.current; dragRef.current = null; controls.enabled = true; if (!start) return;
      const id = editorRef.current?.getId(start.object);
      const command: Vibi3DCommand = { type: 'update', id: id ?? '', position: start.object.position.toArray(), rotation: degrees(start.object), scale: start.object.scale.toArray() };
      // Restore the start before committing: one drag, one undo, one revision.
      start.object.position.copy(start.position); start.object.rotation.copy(start.rotation); start.object.scale.copy(start.scale); start.object.updateMatrixWorld(true);
      if (id) { try { applyRef.current([command]); } catch (err) { setError(errorText(err)); } }
    });
    const raycaster = new THREE.Raycaster(); let pointerStart = { x: 0, y: 0, gizmo: false };
    const down = (event: PointerEvent): void => { pointerStart = { x: event.clientX, y: event.clientY, gizmo: transform.axis !== null }; };
    const up = (event: PointerEvent): void => {
      const editor = editorRef.current;
      if (!editor || event.button !== 0 || busyRef.current || pointerStart.gizmo || actionRef.current || quiescingRef.current || viewActorRef.current !== 'human') return;
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = firstModelPick(editor.object, raycaster.intersectObject(editor.object, true));
      editor.select(hit ? editor.getId(hit) : null); sync();
    };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    // §5.4 #15 (C) — Alt 인스펙터가 캔버스 안의 물체를 집는다(위 클릭 선택과 같은 광선 판정).
    const unpick = registerInspectorPicker(renderer.domElement, (at) => {
      const editor = editorRef.current; const subject = inspectSubjectRef.current();
      return editor && subject ? modelInspectLevels({ camera, root: editor.object, idOf: (object) => editor.getId(object) }, subject, at) : [];
    });
    let width = 0; let height = 0;
    const resize = (): void => {
      if (!mount.clientWidth || !mount.clientHeight || (width === mount.clientWidth && height === mount.clientHeight)) return;
      width = mount.clientWidth; height = mount.clientHeight;
      // CSS dimensions must stay in logical pixels even when the backing buffer uses a higher DPR.
      renderer.setSize(width, height, true); if (renderer.domElement.dataset) delete renderer.domElement.dataset['viewSize'];
      camera.aspect = width / height; camera.updateProjectionMatrix(); render();
    };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    let raf = 0; let previous = performance.now(); let lastReadout = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      // Agent commands render explicitly in sync()/capture(); hidden views need no continuous GPU draw.
      if (!shownRef.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) { previous = now; return; }
      if (playingRef.current && mixerRef.current) {
        mixerRef.current.update(Math.min((now - previous) / 1000, 0.1)); playTimeRef.current = actionRef.current?.time ?? 0;
        if (now - lastReadout > 100) { lastReadout = now; setPlayTime(playTimeRef.current); }
      }
      previous = now; controls.update();
      if (actionRef.current && editorRef.current) {
        editorRef.current.object.traverse((child) => {
          if (child instanceof THREE.PerspectiveCamera && child.userData['vibi3dViewCamera']) { child.getWorldPosition(camera.position); child.getWorldQuaternion(camera.quaternion); }
        });
      }
      if (box.visible) box.update(); render();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      mirror.dispose(); if (mirrorRef.current === mirror) mirrorRef.current = null;
      mounted.current = false; loadSequence.current += 1; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); transform.dispose();
      autosave.cancelScheduled();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up); unpick();
      renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.removeEventListener('webglcontextrestored', restored);
      mixerRef.current?.stopAllAction();
      if (editorRef.current) { editorRef.current.disposeHistory(); disposeModel(editorRef.current.object); }
      agentRef.current?.dispose(); agentRef.current = null; agentSceneRef.current = null;
      editorRef.current = null; snapshotRef.current = null; dragRef.current = null;
      grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); box.geometry.dispose(); (box.material as THREE.Material).dispose();
      scene.overrideMaterial?.dispose(); releaseStudioEnvironment(renderer); renderer.dispose(); renderer.domElement.remove();
      sceneRef.current = null; rendererRef.current = null; lightsRef.current = null;
    };
  }, [sync, render, errorText, autosave]);

  const syncAgent = useCallback((): void => {
    const agent = agentRef.current; const scene = agentSceneRef.current;
    if (!agent || !scene) return;
    // Resume can replace the model while keeping the bridge identity.
    scene.children.filter(child => !(child instanceof THREE.Light)).forEach(child => scene.remove(child));
    scene.add(agent.editor.object);
    const next = agent.snapshot(ownerId); setAgentSnapshot(next);
    if (agentLightsRef.current) planStudioLights(agentLightsRef.current, agent.editor.object, next.lighting ?? 1);
    if (rendererRef.current) applyStudioEnvironment(scene, rendererRef.current, next.lighting ?? 1);
    queueDraftRef.current('agent');
    if (viewActorRef.current === 'agent') { transformRef.current?.detach(); render(); }
  }, [ownerId, render]);
  const installAgent = useCallback((loaded: LoadedModel, document: CreationDoc | null, dirty = false, links?: CreationLink[]): void => {
    agentRef.current?.dispose();
    agentRef.current = new ModelAgentDraft(root, loaded, document, crypto.randomUUID(), dirty, links);
    const scene = new THREE.Scene(); const lights = createStudioLights();
    scene.add(lights.ambient, lights.key); agentSceneRef.current = scene; agentLightsRef.current = lights;
    syncAgent();
  }, [root, syncAgent]);
  const chooseView = useCallback((actor: 'human' | 'agent'): void => {
    if (dragRef.current) return;
    stopPlayback(); viewActorRef.current = actor; setViewActor(actor);
    sync(); if (!applySavedView()) frameModel(); render();
  }, [stopPlayback, sync, applySavedView, frameModel, render]);

  const installModel = useCallback((loaded: LoadedModel, sourcePath: string, continuity?: { sessionId: string; revision: number }): void => {
    const scene = sceneRef.current;
    if (!scene) { disposeModel(loaded.object); throw new CreationUiError('model-stage-closed'); }
    const next = new ModelEditor(loaded.object, loaded.clips, { projectId: root, fileName: loaded.fileName, ...continuity });
    humanEditsRef.current = false;
    stopPlayback(); transformRef.current?.detach();
    if (editorRef.current) { scene.remove(editorRef.current.object); editorRef.current.disposeHistory(); disposeModel(editorRef.current.object); }
    editorRef.current = next; scene.add(next.object); sourcePathRef.current = sourcePath;
    sourceConflictRef.current = false;
    persistedRef.current = { path: sourcePath, revision: sourcePath ? next.revision : -1 }; setSavedPath(sourcePath);
    mixerRef.current = new THREE.AnimationMixer(next.object); clipRef.current = 0; setClipIndex(0);
    setMissingTextures(loaded.missingTextures ?? []); next.select(next.getId(next.object));
    frameModel(); sync(); applySavedView(); setSavedRevision(sourcePath ? 0 : -1); setNotice(''); setError('');
  }, [root, stopPlayback, sync, frameModel, applySavedView]);
  const load = useCallback(async (loader: () => Promise<LoadedModel>, sourcePath = '', editableSource = false, recoveryKey?: string, recover = true): Promise<void> => {
    if (busyRef.current || agentBusyRef.current || quiescingRef.current || dragRef.current) return;
    const sequence = ++loadSequence.current; busyRef.current = true; loadingRef.current = true; setBusy(true); setError('');
    const disposable = new Set<LoadedModel>();
    try {
      queueDraftRef.current('human'); queueDraftRef.current('agent'); await autosave.flush();
      const loaded = await loader();
      disposable.add(loaded);
      const base = editableSource ? (loaded as LoadedModel & { document?: CreationDoc }).document ?? null : null;
      let key = recoveryKey || (base ? `doc:${base.id}` : sourcePath ? `file:${sourcePath.replaceAll('\\', '/')}` : `local:${crypto.randomUUID()}`);
      const scope = (actor: 'human' | 'agent'): ModelDraftScope => ({ projectId: root, key, actor });
      let receipts = root ? await Promise.all([readModelDraft(scope('human')), readModelDraft(scope('agent'))])
        : [{ draft: null, version: 0 }, { draft: null, version: 0 }];
      if (root && base && recover && !recoveryKey && !receipts.some(receipt => receipt.draft)) {
        const retained = (await listModelDrafts(root)).drafts.filter(draft => draft.documentId === base.id)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (retained) { key = retained.key; receipts = await Promise.all([readModelDraft(scope('human')), readModelDraft(scope('agent'))]); }
      }
      const [humanReceipt, agentReceipt] = receipts;
      const humanDraft = recover ? humanReceipt!.draft : null, agentDraft = recover ? agentReceipt!.draft : null;
      const baseFor = async (draft: Vibi3DDraft | null): Promise<CreationDoc | null> => {
        if (!draft?.documentId || draft.baseRevision === undefined) return base;
        if (base?.id === draft.documentId && base.revision === draft.baseRevision) return base;
        return readCreationRevision(root, draft.documentId, draft.baseRevision);
      };
      const [humanBase, agentBase] = await Promise.all([baseFor(humanDraft), baseFor(agentDraft)]);
      const human = humanDraft ? await loadModelSource(humanDraft.payload, humanDraft.fileName, root) : loaded;
      disposable.add(human);
      // Serialize/load creates owned geometry, materials and history for each lane, including source-less imports.
      const agent = await loadModelSource(agentDraft?.payload ?? serializeModelSource(loaded.object, loaded.clips, base?.payload),
        agentDraft?.fileName ?? loaded.fileName, root); disposable.add(agent);
      if (!mounted.current || sequence !== loadSequence.current) return;
      if (!autosave.hydrate(scope('human'), humanReceipt!) || !autosave.hydrate(scope('agent'), agentReceipt!)) throw new Error('draft-version-conflict');
      draftReadyRef.current = false; draftKeyRef.current = key; setDraftKey(key); lastDraftRef.current = { human: '', agent: '' };
      sourceDocRef.current = humanBase; humanDraftLinksRef.current = humanDraft?.links ?? null; setSourceDoc(humanBase);
      installModel(human, sourcePath); disposable.delete(human);
      installAgent(agent, agentBase, !!agentDraft && JSON.stringify(agentDraft.payload) !== JSON.stringify(agentBase?.payload), agentDraft?.links); disposable.delete(agent);
      const sourceSaved = humanBase ? !humanDraft || JSON.stringify(humanDraft.payload) === JSON.stringify(humanBase.payload)
        : !humanDraft && !!sourcePath;
      savedRevisionRef.current = sourceSaved ? 0 : -1; setSavedRevision(savedRevisionRef.current);
      humanEditsRef.current = !sourceSaved;
      draftReadyRef.current = true;
      for (const actor of ['human', 'agent'] as const) {
        const receipt = actor === 'human' ? humanReceipt : agentReceipt;
        const editor = actor === 'human' ? editorRef.current! : agentRef.current!.editor;
        const doc = actor === 'human' ? humanBase : agentBase;
        if (recover && receipt!.draft) lastDraftRef.current[actor] = JSON.stringify([key, editor.sessionId, editor.revision, doc?.id, doc?.revision]);
        else queueDraftRef.current(actor);
      }
      if (humanDraft || agentDraft) setNotice(tRef.current('panel.vibi3d.drafts.savedRecoveryHint'));
      chooseView(agentDraft && !humanDraft ? 'agent' : 'human');
      await updateAppWindowTarget(params, { ref: humanBase?.id, file: sourcePath || undefined, draftKey: key });
    } catch (err) { if (mounted.current && sequence === loadSequence.current) setError(errorText(err)); }
    finally {
      disposable.forEach(item => disposeModel(item.object));
      if (sequence === loadSequence.current) { busyRef.current = false; loadingRef.current = false; setBusy(false); }
    }
  }, [installModel, installAgent, chooseView, errorText, autosave, root, params]);
  useEffect(() => {
    if (!root || !initialPath || initialSource) return;
    // Publishing a just-saved path updates host params; keep this live editor and its undo history.
    if (editorRef.current && snapshotRef.current?.projectId === root && persistedRef.current.path === initialPath) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const openRequestedFile = (): void => {
      // A file request arriving during export waits until export owns no mutable scene state.
      if (busyRef.current) { timer = setTimeout(openRequestedFile, 100); return; }
      started = true;
      void load(() => loadWorkspaceModel(root, initialPath), initialPath, false, params['draftKey']);
    };
    openRequestedFile();
    return () => {
      if (timer) clearTimeout(timer);
      if (started && loadingRef.current) {
        loadSequence.current += 1; loadingRef.current = false; busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    };
  }, [root, initialPath, initialSource, load]);
  useEffect(() => {
    if (!root || !initialSource || sourceDocRef.current?.id === initialSource) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const open = (): void => {
      if (busyRef.current) { timer = setTimeout(open, 100); return; }
      started = true;
      void load(async () => openModelDocument(root, await readModelDocument(root, initialSource)), '', true, params['draftKey']);
    };
    open();
    return () => {
      if (timer) clearTimeout(timer);
      if (started && loadingRef.current) { loadSequence.current++; loadingRef.current = false; busyRef.current = false; if (mounted.current) setBusy(false); }
    };
  }, [root, initialSource, load]);
  useEffect(() => {
    const key = params['draftKey'];
    if (!root || initialSource || initialPath || !key || draftKeyRef.current === key) return;
    void load(async () => { const object = new THREE.Group(); object.name = 'Model'; return { object, clips: [], fileName: 'model' }; }, '', false, key);
  }, [root, initialSource, initialPath, params['draftKey'], load]);
  useEffect(() => {
    // Someone else saved a newer revision: take it when nothing here is unsaved, otherwise keep the scene and say so.
    const current = sourceDocRef.current;
    if (!head || !current || head.id !== current.id || head.revision <= current.revision || busyRef.current || dragRef.current) return;
    if ((editorRef.current && editorRef.current.revision !== savedRevisionRef.current)
      || (agentRef.current && agentRef.current.editor.revision !== agentRef.current.savedRevision) || agentBusyRef.current) {
      setError(t('panel.vibi3d.authoring.sourceConflict')); return;
    }
    void load(async () => openModelDocument(root, await readModelDocument(root, current.id)), '', true, draftKeyRef.current, false);
  }, [head, busy, root, load, t]);
  useEffect(() => { transformRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { if (gridRef.current) gridRef.current.visible = showGrid; }, [showGrid]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.background = new THREE.Color(BACKGROUNDS[bg]); }, [bg]);
  useEffect(() => { if (controlsRef.current) { controlsRef.current.autoRotate = spin; controlsRef.current.autoRotateSpeed = 1.2; } }, [spin]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) { scene.overrideMaterial?.dispose(); scene.overrideMaterial = wireframe ? new THREE.MeshBasicMaterial({ color: 0xb9c2d0, wireframe: true }) : null; }
  }, [wireframe]);
  useEffect(() => { if (transformRef.current) transformRef.current.enabled = !busy && !quiescing && viewActor === 'human' && !actionRef.current; }, [busy, quiescing, viewActor, playing, playTime]);
  const observe = useCallback((): Vibi3DSnapshot | null => {
    if (!agentRef.current || agentBusyRef.current || loadingRef.current) return null;
    return agentRef.current.snapshot(ownerId);
  }, [ownerId]);
  useEffect(() => { if (sourceDoc) rememberVibi3DDocument(root, sourceDoc.id); }, [root, sourceDoc?.id]);
  const agentStage = useCallback(() => {
    const agent = agentRef.current, renderer = rendererRef.current, scene = agentSceneRef.current;
    if (!agent || !renderer || !scene || agentBusyRef.current || loadingRef.current) throw new CreationUiError('view-busy');
    const camera = cameraRef.current?.clone() ?? new THREE.PerspectiveCamera(MODEL_VIEW_FOV, 1, 0.01, 5000);
    const snapshot = agent.snapshot(ownerId);
    if (snapshot.camera) {
      camera.position.fromArray(snapshot.camera.position); camera.lookAt(new THREE.Vector3().fromArray(snapshot.camera.target));
      camera.fov = resolveVibi3DCameraFov(snapshot.camera, camera.aspect, camera.fov); camera.updateProjectionMatrix();
    } else if (viewActorRef.current !== 'agent') {
      const { center, radius } = modelFrame(agent.editor.object); frameModelCamera(camera, center, radius);
    }
    scene.background = sceneRef.current?.background ?? new THREE.Color(BACKGROUNDS.dark);
    return { renderer, scene, camera, model: agent.editor.object, snapshot };
  }, [ownerId]);
  const capture = useCallback((): string => {
    const stage = agentStage();
    try {
      renderStudioView(stage.scene, stage.renderer, stage.camera, { object: stage.model, quality: 'draft', mode: 'lit' });
      const canvas = document.createElement('canvas'); canvas.width = Math.min(960, stage.renderer.domElement.width);
      canvas.height = Math.max(1, Math.round(canvas.width * stage.renderer.domElement.height / Math.max(1, stage.renderer.domElement.width)));
      const context = canvas.getContext('2d'); if (!context) throw new CreationUiError('capture-failed');
      context.drawImage(stage.renderer.domElement, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/jpeg', 0.8);
    } finally { render(); }
  }, [agentStage, render]);
  const captureViews = useCallback((command: Vibi3DCaptureCommand) => {
    try { return captureVibi3DViews(agentStage(), command); } finally { render(); }
  }, [agentStage, render]);
  const execute = useCallback(async (request: Vibi3DCommandRequest, context?: Vibi3DExecutionContext): Promise<Vibi3DExecutionResult> => {
    const agent = agentRef.current;
    if (!agent || agentBusyRef.current || loadingRef.current || quiescingRef.current) throw new CreationUiError('model-busy');
    agentBusyRef.current = true; applyingAgentRef.current = true; setAgentBusy(true);
    try {
      const result = await agent.execute(request, ownerId, context);
      if (!mounted.current || agentRef.current !== agent) throw new CreationUiError('scene-changed');
      syncAgent();
      if (viewActorRef.current === 'agent') applySavedView();
      // A successful command receipt means its latest AI draft survived a durable write.
      await autosave.flush(draftScope('agent'));
      return result;
    } finally {
      if (agentRef.current === agent && mounted.current) syncAgent();
      agentBusyRef.current = false; applyingAgentRef.current = false; if (mounted.current) setAgentBusy(false);
    }
  }, [ownerId, syncAgent, autosave, draftScope, applySavedView]);
  const bridge = useVibi3DBridge({ snapshot: agentSnapshot, getSnapshot: observe, capture, captureViews, execute });
  inspectSubjectRef.current = () => {
    const shown = snapshotRef.current;
    if (!shown) return null;
    const source = sourceDocRef.current;
    return {
      kind: 'scene', projectId: root, fileName: shown.fileName, revision: shown.revision,
      liveSessionId: bridge.connected ? shown.sessionId : null,
      source: source ? { id: source.id, revision: source.revision } : null, unsaved: dirtyRef.current,
    };
  };

  const publishTarget = useCallback(async (ref: string | undefined, file: string | undefined): Promise<void> => {
    try { await updateAppWindowTarget(params, { ref, file, draftKey: draftKeyRef.current || undefined }); } catch { throw new CreationUiError('source-save-failed'); }
  }, [params]);
  const saveSource = useCallback(async (copy = false): Promise<boolean> => {
    const editor = editorRef.current; if (!editor || !root || busyRef.current || dragRef.current || quiescingRef.current) return false;
    if (copy && agentBusyRef.current) return false;
    if (sourceConflictRef.current && !copy) { setError(t('panel.vibi3d.authoring.sourceConflict')); return false; }
    const scope = routeScopeRef.current; const base = sourceDocRef.current;
    stopPlayback(); busyRef.current = true; setBusy(true); setError('');
    if (copy) agentBusyRef.current = true;
    try {
      queueDraftRef.current('human'); await autosave.flush();
      const payload = serializeModelSource(editor.object, editor.clips, base?.payload);
      const document = await saveModelDocument(root, base, editor.fileName, payload, copy, modelTextureReferences(editor.object, humanDraftLinksRef.current ?? base?.links ?? []));
      if (!mounted.current || routeScopeRef.current !== scope || editorRef.current !== editor) return false;
      if (copy) {
        // Keep the original AI work under its previous identity; a copy starts from the copied human model.
        const nextAgent = await loadModelSource(document.payload, document.title, root);
        if (!mounted.current || editorRef.current !== editor || routeScopeRef.current !== scope) { disposeModel(nextAgent.object); return false; }
        const key = `doc:${document.id}`; draftKeyRef.current = key; setDraftKey(key);
        draftReadyRef.current = false; installAgent(nextAgent, document, false, document.links); draftReadyRef.current = true;
        lastDraftRef.current = { human: '', agent: '' };
      }
      sourceDocRef.current = document; humanDraftLinksRef.current = null; setSourceDoc(document);
      // A retried save replays and returns the server's current state — newer than ours if someone saved in between.
      if (base && !copy && document.revision > base.revision + 1) {
        sourceConflictRef.current = true; setSavedRevision(-1);
        await publishTarget(document.id, savedPath || undefined);
        throw new CreationUiError('source-changed-elsewhere');
      }
      await publishTarget(document.id, savedPath || undefined);
      persistedRef.current = { path: savedPath, revision: editor.revision }; savedRevisionRef.current = editor.revision; setSavedRevision(editor.revision);
      editor.commitHumanEdits(); humanEditsRef.current = false; sync();
      queueDraftRef.current('human', true); queueDraftRef.current('agent'); await autosave.flush();
      sourceConflictRef.current = false;
      setNotice(t('panel.vibi3d.authoring.sourceSaved')); return true;
    } catch (err) {
      if (err instanceof CreationApiError && err.code === 'revision-conflict') sourceConflictRef.current = true;
      setError(errorText(err)); return false;
    } finally { busyRef.current = false; if (copy) agentBusyRef.current = false; if (mounted.current) setBusy(false); }
  }, [root, stopPlayback, savedPath, t, errorText, publishTarget, sync, autosave, draftScope, installAgent]);
  const applyAgent = useCallback(async (): Promise<void> => {
    const agent = agentRef.current;
    if (!agent || !root || busyRef.current || agentBusyRef.current || quiescingRef.current) return;
    busyRef.current = true; agentBusyRef.current = true; setBusy(true); setError('');
    try {
      queueDraftRef.current('agent'); await autosave.flush(draftScope('agent'));
      const base = agent.document;
      const result = await saveModelDocument(root, base, agent.editor.fileName,
        serializeModelSource(agent.editor.object, agent.editor.clips, base?.payload), false, agent.links());
      if (agent !== agentRef.current || !mounted.current) return;
      if (base && result.revision !== base.revision + 1) throw new CreationUiError('source-changed-elsewhere');
      agent.document = result; agent.referenceLinks = result.links; agent.savedRevision = agent.editor.revision;
      syncAgent(); await autosave.flush(draftScope('agent'));
      // Preserve the user's independently saved edits. Only replace an unchanged user baseline.
      const human = editorRef.current;
      if (human && human.revision === savedRevisionRef.current) {
        const loaded = await loadModelSource(result.payload, result.title, root);
        sourceDocRef.current = result; humanDraftLinksRef.current = null; setSourceDoc(result); installModel(loaded, '');
        savedRevisionRef.current = 0; setSavedRevision(0); queueDraftRef.current('human', true);
        await autosave.flush(draftScope('human'));
      }
      await publishTarget(result.id, savedPath || undefined);
      setNotice(t('panel.vibi3d.authoring.sourceSaved'));
    } catch (failure) { setError(errorText(failure)); }
    finally { busyRef.current = false; agentBusyRef.current = false; if (mounted.current) setBusy(false); }
  }, [root, autosave, draftScope, syncAgent, installModel, publishTarget, savedPath, t, errorText]);
  const outputShots = useCallback(async (ids: string[], video: boolean, motion = false): Promise<void> => {
    if (!editorRef.current || busyRef.current || dragRef.current || quiescingRef.current || viewActorRef.current !== 'human') return;
    if ((!sourceDocRef.current || editorRef.current.revision !== savedRevisionRef.current) && !await saveSource()) return;
    const editor = editorRef.current, document = sourceDocRef.current, scope = routeScopeRef.current;
    if (!editor || !document || sourceConflictRef.current) return;
    stopPlayback(); busyRef.current = true; setBusy(true); setError('');
    const revision = editor.revision;
    const current = (): void => {
      if (!mounted.current || routeScopeRef.current !== scope || editorRef.current !== editor || editor.revision !== revision || sourceConflictRef.current) throw new CreationUiError('scene-changed');
    };
    try {
      const tools = await import('./vibi3dShotOutputs.js'); current();
      const snapshot = editor.snapshot(), shots = ids.map(id => snapshot.shots?.find(shot => shot.id === id));
      if (shots.some(shot => !shot) || (!motion && !shots.length)) throw new CreationUiError('capture-shot-not-found');
      if (video) {
        const path = snapshot.cameraMotion;
        if (motion && !path) throw new CreationUiError('camera-shot-missing');
        const result = await tools.createShotVideo(root, document, { shots: shots.filter(shot => shot !== undefined),
          ...(motion ? { motion: { duration: path!.keys.at(-1)!.time, aspect: snapshot.camera?.aspect } } : {}) });
        current(); if (!openAppWindow({ appId: 'vibistudio', projectId: root, ref: result.id, title: result.title })) throw new CreationUiError('source-open-failed');
        setNotice(t('panel.vibi3d.shots.videoReady'));
      } else {
        const renderer = rendererRef.current, scene = sceneRef.current, camera = cameraRef.current;
        if (!renderer || !scene || !camera) throw new CreationUiError('view-busy');
        const paths: string[] = [];
        for (const id of ids) {
          current();
          const frames = captureVibi3DViews({ renderer, scene, camera, model: editor.object, snapshot }, { type: 'capture', views: [id], quality: 'final', mode: 'lit' });
          paths.push(...await tools.saveShotStills(root, document, frames));
        }
        current(); setNotice(t('panel.vibi3d.shots.stillsSaved', { count: paths.length, path: paths[0] ?? '' }));
      }
    } catch (error) { if (mounted.current) setError(errorText(error)); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); render(); } }
  }, [root, saveSource, stopPlayback, errorText, t, render]);
  /** Runs one server operation on the saved source and shows its result (selection kept when the object survives). */
  const replaceFromServer = useCallback(async (document: CreationDoc, request: () => Promise<CreationDoc>): Promise<void> => {
    const editor = editorRef.current;
    if (!editor || busyRef.current || dragRef.current || quiescingRef.current || editor.revision !== savedRevisionRef.current) throw new CreationUiError('save-before-review');
    stopPlayback(); busyRef.current = true; setBusy(true); setError('');
    const scope = routeScopeRef.current;
    let prepared: LoadedModel | undefined;
    try {
      const result = await request();
      prepared = await loadModelSource(result.payload, result.title, root);
      const stale = !mounted.current || routeScopeRef.current !== scope || editorRef.current !== editor
        || sourceDocRef.current?.id !== document.id || sourceDocRef.current.revision !== document.revision;
      if (stale) { disposeModel(prepared.object); prepared = undefined; return; }
      const selectedId = editor.selectedId;
      installModel(prepared, ''); prepared = undefined;
      sourceDocRef.current = result; humanDraftLinksRef.current = null; setSourceDoc(result); setSavedRevision(0);
      const current = editorRef.current;
      if (current && selectedId && current.findObject(selectedId)) { current.select(selectedId); sync(); }
      await publishTarget(result.id, undefined);
    } catch (err) { if (prepared) disposeModel(prepared.object); setError(errorText(err)); throw err; }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }, [root, stopPlayback, installModel, sync, errorText, publishTarget]);
  const acceptCandidate = useCallback(async (candidate: CreationCandidate): Promise<void> => {
    const document = sourceDocRef.current;
    if (!document) throw new CreationUiError('save-before-review');
    if (compareModelSources(document.payload, candidate.payload).some((change) => change.protected)) throw new CreationUiError('locked-element-changed');
    // The request id follows the intent (doc, candidate, base): a retry after a lost reply replays instead of failing.
    await replaceFromServer(document, () => acceptCreationCandidate(root, document, candidate.id));
  }, [root, replaceFromServer]);
  const revertSource = useCallback(async (): Promise<void> => {
    const document = sourceDocRef.current;
    if (!document) throw new CreationUiError('save-before-review');
    await replaceFromServer(document, () => restoreCreationDoc(root, document, 'undo'));
  }, [root, replaceFromServer]);
  const texture = useCallback(async (file: File): Promise<void> => {
    const editor = editorRef.current; const id = editor?.selectedId; if (!editor || !id || busyRef.current || dragRef.current || quiescingRef.current || viewActorRef.current !== 'human') return;
    const revision = editor.revision; const scope = routeScopeRef.current; const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (!mounted.current || busyRef.current || dragRef.current || quiescingRef.current || viewActorRef.current !== 'human' || routeScopeRef.current !== scope || editorRef.current !== editor) return;
      const target = editor.findObject(id);
      if (!target || editor.revision !== revision) throw new CreationUiError('model-changed');
      const imageSource = await prepareLocalGraphicTexture(root, editor.object, target, image);
      if (!mounted.current || busyRef.current || dragRef.current || quiescingRef.current || viewActorRef.current !== 'human' || routeScopeRef.current !== scope || editorRef.current !== editor) return;
      const map = new THREE.Texture(image); map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true;
      stopPlayback();
      const started = beginHumanEdit(editor);
      try { editor.applyTexture(id, map, revision, file.name, imageHasAlpha(image), imageSource); }
      catch (err) { map.dispose(); throw err; }
      finally {
        if (started && !editor.hasHumanEdits) editor.discardHumanEdits();
        humanEditsRef.current = editor.hasHumanEdits;
      }
      sync();
    } catch (err) { setError(errorText(err)); }
    finally { URL.revokeObjectURL(url); }
  }, [root, stopPlayback, sync, errorText, beginHumanEdit]);
  const linkImageTexture = useCallback(async (sourceId: string, linkId?: string, revision?: number): Promise<void> => {
    const editor = editorRef.current; const document = sourceDocRef.current;
    if (!editor || !document || busyRef.current || dragRef.current || quiescingRef.current || editor.revision !== savedRevisionRef.current) throw new CreationUiError('save-before-review');
    const link = linkId ? document.links.find((item) => item.id === linkId && modelTextureSlot(item.role)) : undefined;
    const targets = link?.targets ?? (editor.selectedId ? [editor.selectedId] : []);
    if ((linkId && !link) || !targets.length) throw new CreationUiError('select-target');
    stopPlayback(); busyRef.current = true; setBusy(true); setError('');
    const scope = routeScopeRef.current;
    let prepared: Awaited<ReturnType<typeof prepareModelTexture>> | undefined;
    const current = (): boolean => mounted.current && routeScopeRef.current === scope && editorRef.current === editor
      && sourceDocRef.current?.id === document.id && sourceDocRef.current.revision === document.revision;
    try {
      const source = await readTextureSource(root, sourceId, revision);
      const rendered = await renderTextureSource(source, root);
      prepared = await prepareModelTexture(root, document, source, targets, rendered, linkId, link ? modelTextureSlot(link.role)! : 'map');
      if (!current()) throw new CreationUiError('scene-changed');
      const next = await commitModelTexture(root, document, prepared);
      if (!current()) { disposeModel(prepared.loaded.object); prepared = undefined; return; }
      if (next.revision > document.revision + 1) {
        sourceConflictRef.current = true;
        throw new CreationUiError('source-changed-elsewhere');
      }
      const selectedId = editor.selectedId;
      installModel(prepared.loaded, ''); prepared = undefined;
      sourceDocRef.current = next; humanDraftLinksRef.current = null; setSourceDoc(next); setSavedRevision(0);
      const installed = editorRef.current;
      if (installed && selectedId && installed.findObject(selectedId)) { installed.select(selectedId); sync(); }
      await publishTarget(next.id, undefined);
    } catch (err) {
      if (prepared) disposeModel(prepared.loaded.object);
      if (!current()) return;
      if (err instanceof CreationUiError && err.code === 'source-changed-elsewhere') sourceConflictRef.current = true;
      setError(errorText(err)); throw err;
    }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }, [root, stopPlayback, installModel, sync, errorText, publishTarget]);
  const save = useCallback(async (download = false): Promise<boolean> => {
    const actor = viewActorRef.current;
    const editor = actor === 'agent' ? agentRef.current?.editor : editorRef.current;
    if (!editor || busyRef.current || agentBusyRef.current || dragRef.current || quiescingRef.current) return false;
    stopPlayback(); busyRef.current = true; setBusy(true); setError('');
    if (actor === 'agent') agentBusyRef.current = true;
    try {
      queueDraftRef.current(actor);
      if (root) await autosave.flush(draftScope(actor));
      const bytes = await exportModelGlb(editor.object, editor.clips); const source = sourcePathRef.current || editor.fileName;
      if (download || !root) {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })); const link = document.createElement('a');
        link.href = url; link.download = editedMediaPath(source, '.glb', 1).split('/').pop() ?? 'model-edit.glb'; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice(t('panel.vibi3d.downloadStarted', { defaultValue: 'GLB download started.' }));
      } else {
        let written = '';
        for (let n = 1; n <= 100; n += 1) {
          const result = await writeWorkspaceMedia(root, editedMediaPath(source, '.glb', n), new Uint8Array(bytes));
          if (result.ok) { written = result.path; break; }
          if (result.error !== 'exists') break;
        }
        if (!written) { setError(t('panel.vibi3d.saveFailed', { defaultValue: 'Could not save. Try downloading the GLB.' })); return false; }
        const doc = actor === 'agent' ? agentRef.current?.document : sourceDocRef.current;
        const committed = actor === 'agent' ? agentRef.current?.savedRevision : savedRevisionRef.current;
        if (doc && editor.revision === committed) {
          try { await recordCreationOutput(root, doc.id, { sourceRevision: doc.revision, path: written, mediaType: 'model/gltf-binary' }); }
          catch { throw new CreationUiError('output-not-recorded', { path: written }); }
        }
        persistedRef.current = { path: written, revision: editor.revision }; setSavedPath(written);
        await publishTarget(sourceDocRef.current?.id, written);
        setNotice(t('panel.vibi3d.saved', { defaultValue: 'Saved: {{path}}', path: written }));
      }
      setError('');
      return true;
    } catch (err) { setError(errorText(err)); return false; }
    finally { busyRef.current = false; if (actor === 'agent') agentBusyRef.current = false; if (mounted.current) setBusy(false); }
  }, [root, stopPlayback, t, errorText, publishTarget, autosave, draftScope]);
  useAppWindowTransferGuard(params, async () => {
    if (busyRef.current || agentBusyRef.current || dragRef.current || quiescingRef.current) {
      setError(t('panel.vibi3d.working', { defaultValue: 'Working…' })); return false;
    }
    const editor = editorRef.current;
    if (!editor) return true;
    if (!root) {
      setError(t('panel.vibi3d.saveFailed', { defaultValue: 'Could not save. Try downloading the GLB.' })); return false;
    }
    quiescingRef.current = true; setQuiescing(true);
    try {
      queueDraftRef.current('human'); queueDraftRef.current('agent'); await autosave.flush();
      if (agentBusyRef.current || busyRef.current || dragRef.current) return false;
      await publishTarget(sourceDocRef.current?.id, sourcePathRef.current || undefined); return true;
    } catch { setError(t('panel.vibi3d.drafts.closeFailed')); return false; }
  }, () => { quiescingRef.current = false; if (mounted.current) setQuiescing(false); });
  const restoreDraft = useCallback(async (draft: Vibi3DDraft): Promise<void> => {
    if (busyRef.current || agentBusyRef.current || dragRef.current || quiescingRef.current) throw new CreationUiError('model-busy');
    if (draft.key !== draftKeyRef.current) {
      await load(async () => { const object = new THREE.Group(); object.name = 'Model'; return { object, clips: [], fileName: draft.fileName }; }, '', false, draft.key);
      if (draftKeyRef.current !== draft.key) throw new CreationUiError('source-open-failed');
    }
    const restoreScope = routeScopeRef.current, restoreEditor = editorRef.current, restoreKey = draftKeyRef.current;
    const assertCurrent = (): void => {
      if (!mounted.current || routeScopeRef.current !== restoreScope || editorRef.current !== restoreEditor || draftKeyRef.current !== restoreKey) throw new CreationUiError('scene-changed');
    };
    busyRef.current = true; agentBusyRef.current = true; setBusy(true);
    let prepared: LoadedModel | undefined;
    try {
      queueDraftRef.current('human'); queueDraftRef.current('agent'); await autosave.flush();
      const scope = draftScope(draft.actor);
      const receipt = await readModelDraft(scope);
      assertCurrent();
      if (!autosave.hydrate(scope, receipt)) throw new Error('draft-version-conflict');
      const base = draft.documentId && draft.baseRevision !== undefined
        ? await readCreationRevision(root, draft.documentId, draft.baseRevision) : null;
      prepared = await loadModelSource(draft.payload, draft.fileName, root);
      assertCurrent();
      draftReadyRef.current = false;
      if (draft.actor === 'human') {
        sourceDocRef.current = base; humanDraftLinksRef.current = draft.links; setSourceDoc(base); installModel(prepared, ''); prepared = undefined;
        const clean = !!base && JSON.stringify(draft.payload) === JSON.stringify(base.payload);
        savedRevisionRef.current = clean ? 0 : -1; setSavedRevision(savedRevisionRef.current); humanEditsRef.current = !clean;
      } else { installAgent(prepared, base, true, draft.links); prepared = undefined; }
      draftReadyRef.current = true; queueDraftRef.current(draft.actor, true);
      await autosave.flush(scope);
      chooseView(draft.actor); await publishTarget(sourceDocRef.current?.id, sourcePathRef.current || undefined);
    } finally {
      if (prepared) disposeModel(prepared.object);
      draftReadyRef.current = !!editorRef.current; busyRef.current = false; agentBusyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [load, autosave, draftScope, root, installModel, installAgent, chooseView, publishTarget]);
  const revertHuman = useCallback(async (): Promise<void> => {
    const editor = editorRef.current;
    if (!editor || busyRef.current || quiescingRef.current || dragRef.current) return;
    if (editor.hasHumanEdits) {
      stopPlayback(); editor.discardHumanEdits(); humanEditsRef.current = false;
      if (humanBaselineRef.current.saved) { savedRevisionRef.current = editor.revision; setSavedRevision(editor.revision); }
      sync(); applySavedView(); return;
    }
    const doc = sourceDocRef.current;
    if (doc) {
      const draft = autosave.get(draftScope('human')).draft;
      if (draft) await restoreDraft({ ...draft, payload: doc.payload, links: doc.links });
    }
  }, [stopPlayback, sync, applySavedView, autosave, draftScope, restoreDraft]);
  const discardAgent = useCallback(async (draft: Vibi3DDraft): Promise<void> => {
    if (draft.actor !== 'agent') return;
    if (busyRef.current || agentBusyRef.current || quiescingRef.current) throw new CreationUiError('model-busy');
    const agent = agentRef.current, revision = agent?.editor.revision, route = routeScopeRef.current;
    if (!await confirmDialog(t('panel.vibi3d.drafts.confirmDeleteAgent'), {
      title: t('panel.vibi3d.drafts.deleteAgent'), confirmLabel: t('panel.vibi3d.drafts.deleteAgent'),
      cancelLabel: t('panel.options.discardKeep'), tone: 'danger',
    })) return;
    if (busyRef.current || agentBusyRef.current || route !== routeScopeRef.current || quiescingRef.current
      || agent !== agentRef.current || agent?.editor.revision !== revision) throw new CreationUiError('model-busy');
    busyRef.current = true; agentBusyRef.current = true; setBusy(true);
    try {
      await autosave.flush();
      const scope = { projectId: root, key: draft.key, actor: 'agent' as const };
      const result = await discardModelDraft(root, { ...scope, expectedVersion: draft.version, requestId: crypto.randomUUID() });
      if (!autosave.hydrate(scope, result)) throw new Error('draft-version-conflict');
      if (draft.key === draftKeyRef.current && editorRef.current) {
        const human = editorRef.current, doc = sourceDocRef.current;
        const loaded = await loadModelSource(serializeModelSource(human.object, human.clips, doc?.payload), human.fileName, root);
        draftReadyRef.current = false; installAgent(loaded, doc, human.revision !== savedRevisionRef.current,
          modelTextureReferences(human.object, humanDraftLinksRef.current ?? doc?.links ?? [])); draftReadyRef.current = true;
        const next = agentRef.current!.editor;
        // The discarded lane stays absent until the agent actually edits again.
        lastDraftRef.current.agent = JSON.stringify([draft.key, next.sessionId, next.revision, doc?.id, doc?.revision]);
        chooseView('human');
      }
    } finally { busyRef.current = false; agentBusyRef.current = false; if (mounted.current) setBusy(false); }
  }, [root, autosave, t, installAgent, chooseView]);
  const retryDraft = useCallback((actor: 'human' | 'agent'): void => {
    if (busyRef.current || agentBusyRef.current || dragRef.current || quiescingRef.current) return;
    const failure = autosave.get(draftScope(actor)).error;
    if (!(failure instanceof ModelDraftApiError) || failure.code !== 'draft-version-conflict') {
      queueDraftRef.current(actor, true);
      void autosave.retry(draftScope(actor)).catch(() => setError(t('panel.vibi3d.drafts.closeFailed')));
      return;
    }
    // Concurrent writers keep both versions. Never retry a conflicting write with a newer expectedVersion.
    busyRef.current = true; agentBusyRef.current = true; setBusy(true);
    void (async () => {
      const actors = ['human', 'agent'] as const;
      const oldScopes = actors.map(lane => draftScope(lane));
      await Promise.allSettled(oldScopes.map(scope => autosave.flush(scope)));
      const scopeKey = JSON.stringify([root, draftKeyRef.current]);
      if (conflictBackupRef.current?.scope !== scopeKey) conflictBackupRef.current = { scope: scopeKey, key: `local:${crypto.randomUUID()}` };
      const key = conflictBackupRef.current.key;
      const backups = actors.map(lane => ({ projectId: root, key, actor: lane }));
      for (const [index, lane] of actors.entries()) {
        const editor = lane === 'human' ? editorRef.current : agentRef.current?.editor;
        const doc = lane === 'human' ? sourceDocRef.current : agentRef.current?.document;
        if (!editor) throw new CreationUiError('model-not-open');
        const input: ModelDraftInput = { fileName: editor.fileName, ...(doc ? { documentId: doc.id, baseRevision: doc.revision } : {}),
          payload: serializeModelSource(editor.object, editor.clips, doc?.payload) as unknown as CreationValue,
          links: lane === 'agent' ? agentRef.current!.links() : modelTextureReferences(editor.object, humanDraftLinksRef.current ?? doc?.links ?? []) };
        autosave.set(oldScopes[index]!, input); autosave.set(backups[index]!, input);
      }
      autosave.cancelScheduled();
      await Promise.all(backups.map(scope => autosave.flush(scope)));
      for (const [index, scope] of oldScopes.entries()) {
        if (!autosave.retireAfterBackup(scope, backups[index]!)) throw new Error('draft-backup-changed');
      }
      draftKeyRef.current = key; setDraftKey(key);
      conflictBackupRef.current = null;
      for (const lane of actors) {
        const editor = lane === 'human' ? editorRef.current! : agentRef.current!.editor;
        const doc = lane === 'human' ? sourceDocRef.current : agentRef.current!.document;
        lastDraftRef.current[lane] = JSON.stringify([key, editor.sessionId, editor.revision, doc?.id, doc?.revision]);
      }
      await publishTarget(sourceDocRef.current?.id, sourcePathRef.current || undefined);
      setError(''); setNotice(t('panel.vibi3d.drafts.conflictSaved'));
    })().catch(() => setError(t('panel.vibi3d.drafts.closeFailed'))).finally(() => {
      busyRef.current = false; agentBusyRef.current = false; if (mounted.current) setBusy(false);
    });
  }, [autosave, draftScope, t, root, publishTarget]);
  const startPlayback = (): void => {
    const editor = editorRef.current; const mixer = mixerRef.current; const clip = editor?.clips[clipIndex];
    if (!editor || !mixer || !clip || busyRef.current) return;
    if (!actionRef.current) actionRef.current = mixer.clipAction(clip).play();
    playingRef.current = !playingRef.current; setPlaying(playingRef.current); transformRef.current?.detach();
  };
  const clips = viewActor === 'human' ? editorRef.current?.clips ?? [] : []; const duration = clips[clipIndex]?.duration ?? 0;
  const viewedSnapshot = viewActor === 'agent' ? agentSnapshot : snapshot;
  const humanSave = autosave.get(draftScope('human')), agentSave = autosave.get(draftScope('agent'));
  const editsDisabled = busy || quiescing || viewActor === 'agent';
  const onSourceDoc = (next: CreationDoc): void => { sourceDocRef.current = next; humanDraftLinksRef.current = null; setSourceDoc(next); };
  return <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100" onKeyDown={(event) => {
    if (event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); userCommand({ type: event.shiftKey ? 'redo' : 'undo' }); }
    if (event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); retryDraft(viewActor); }
  }}>
    <header className={`${hosted ? '' : 'app-drag '}flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3`}>
      <span className={`${hosted ? '' : 'app-drag-label '}text-sm font-semibold`}>Vibi3D</span>
      <span className={`${hosted ? '' : 'app-drag-label '}min-w-0 truncate text-xs text-gray-400`}>{viewedSnapshot?.fileName ?? ''}</span>
      {!hosted && <div className="app-nodrag ml-auto"><WindowControls /></div>}
    </header>
    <input ref={inputRef} type="file" multiple hidden onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void load(() => loadLocalModel(files));
    }} />
    {/* 폰 폭(box-narrow)에서는 여러 줄로 접혀 무대를 밀어내지 않게 한 줄 가로 스크롤로 — 단추는 하나도 빼지 않는다. */}
    <div className="scrollbar-thin flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2 box-narrow:flex-nowrap box-narrow:overflow-x-auto">
      <ToolButton disabled={busy || agentBusy || quiescing} onClick={() => inputRef.current?.click()}>{t('panel.vibi3d.open', { defaultValue: 'Open files' })}</ToolButton>
      <ToolButton disabled={busy || agentBusy || quiescing} onClick={() => {
        void load(async () => { const object = new THREE.Group(); object.name = 'Model'; return { object, clips: [], fileName: 'model' }; });
      }}>{t('panel.vibi3d.authoring.new', { defaultValue: 'New model' })}</ToolButton>
      {viewActor === 'human' ? <ToolButton disabled={!snapshot || editsDisabled || !root} onClick={() => void saveSource()}>{t('panel.vibi3d.drafts.applyHuman')}</ToolButton>
        : <ToolButton disabled={!agentSnapshot || busy || agentBusy || quiescing || !root} onClick={() => void applyAgent()}>{t('panel.vibi3d.drafts.applyAgent')}</ToolButton>}
      {sourceDoc && viewActor === 'human' && <ToolButton disabled={!snapshot || editsDisabled} onClick={() => void saveSource(true)}>{t('panel.vibi3d.authoring.saveCopy', { defaultValue: 'Save a copy' })}</ToolButton>}
      <ToolButton disabled={!viewedSnapshot || busy || agentBusy || quiescing} onClick={() => void save()}>{t('panel.vibi3d.drafts.exportGlb')}</ToolButton>
      {root && <ToolButton disabled={!viewedSnapshot || busy || agentBusy || quiescing} onClick={() => void save(true)}>{t('panel.vibi3d.download', { defaultValue: 'Download' })}</ToolButton>}
      <ToolButton disabled={!editorRef.current?.canUndoHuman || editsDisabled} title={shortcutLabel('Ctrl+Z')} onClick={() => userCommand({ type: 'undo' })}>{t('panel.vibi3d.undo', { defaultValue: 'Undo' })}</ToolButton>
      <ToolButton disabled={!editorRef.current?.canRedoHuman || editsDisabled} title={shortcutLabel('Ctrl+Shift+Z')} onClick={() => userCommand({ type: 'redo' })}>{t('panel.vibi3d.redo', { defaultValue: 'Redo' })}</ToolButton>
      <ToolButton disabled={editsDisabled || (!editorRef.current?.hasHumanEdits && (!dirty || !sourceDoc))} onClick={() => void revertHuman().catch(failure => setError(errorText(failure)))}>{t('panel.vibi3d.drafts.revertHuman')}</ToolButton>
      <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />
      {(['translate', 'rotate', 'scale'] as const).map((item) => <ToolButton key={item} disabled={!snapshot || editsDisabled || !!actionRef.current} active={mode === item} onClick={() => setMode(item)}>
        {t(`panel.vibi3d.tool_${item}`, { defaultValue: item === 'translate' ? 'Move' : item === 'rotate' ? 'Rotate' : 'Scale' })}</ToolButton>)}
      <ToolButton active={inspector} onClick={() => setInspectorChoice(!inspector)}>{t('panel.vibi3d.properties', { defaultValue: 'Properties' })}</ToolButton>
    </div>
    {snapshot && <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-3 py-2">
      <ToolButton active={viewActor === 'human'} disabled={busy || quiescing} onClick={() => chooseView('human')}>{t('panel.vibi3d.drafts.viewHuman')}</ToolButton>
      <ToolButton active={viewActor === 'agent'} disabled={busy || quiescing || !agentSnapshot} onClick={() => chooseView('agent')}>{t('panel.vibi3d.drafts.viewAgent')}</ToolButton>
      <Vibi3DDraftStatus actor="human" state={humanSave} onRetry={() => retryDraft('human')} />
      <Vibi3DDraftStatus actor="agent" state={agentSave} onRetry={() => retryDraft('agent')} />
      {quiescing && <span role="status" className="text-xs text-amber-300">{t('panel.vibi3d.drafts.closing')}</span>}
      {agentBusy && <span role="status" className="text-xs text-violet-300">{t('panel.vibi3d.working')}</span>}
      {!root && <span role="alert" className="text-xs text-amber-300">{t('panel.vibi3d.drafts.noProject')}</span>}
    </div>}
    {/* 무대 + 속성 — 넓은 창은 나란히, 창 폭이 좁으면(box-compact) 속성이 무대 아래 전폭으로 내려간다. 본문 하한(min-h-36)이 무대
        자리를 지키고, 모자라는 높이는 아래 묶음이 먼저 내준다. */}
    <div className="flex min-h-36 flex-1 box-compact:flex-col">
      <div className="relative min-h-36 min-w-0 flex-1" tabIndex={0} aria-label={t('panel.vibi3d.viewport', { defaultValue: '3D view' })}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const files = Array.from(event.dataTransfer.files); if (files.length) void load(() => loadLocalModel(files)); }}>
        <div ref={mountRef} className="absolute inset-0" />
        <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
          <ToolButton disabled={!snapshot} onClick={frameModel}>{t('panel.vibi3d.frame')}</ToolButton>
          <ToolButton active={wireframe} onClick={() => setWireframe(!wireframe)}>{t('panel.vibi3d.wireframe')}</ToolButton>
          <ToolButton active={showGrid} onClick={() => setShowGrid(!showGrid)}>{t('panel.vibi3d.grid')}</ToolButton>
          <ToolButton active={spin} onClick={() => setSpin(!spin)}>{t('panel.vibi3d.spin')}</ToolButton>
          <ToolButton active={bg === 'light'} onClick={() => setBg(bg === 'dark' ? 'light' : 'dark')}>{t('panel.vibi3d.background')}</ToolButton>
        </div>
        {/* 낮은 무대에서 안내 카드가 넘치면 위가 잘리지 않게 — 가운데 맞춤은 m-auto 로(넘치면 위부터) 하고 이 칸이 스크롤한다. */}
        {!snapshot && !busy && <div className="absolute inset-0 flex overflow-auto p-5 pt-16 box-narrow:px-3">
          <div className="m-auto max-w-sm rounded-lg border border-white/10 bg-gray-900/95 p-5 text-center">
            <p className="mb-2 text-sm font-medium">{t('panel.vibi3d.start', { defaultValue: 'Open a model and make it yours' })}</p>
            <p className="mb-4 text-xs leading-relaxed text-gray-400">{t('panel.vibi3d.openHint', { defaultValue: 'Drop a GLB, glTF, OBJ, STL, PLY, FBX, DAE or 3MF here. Select companion textures together.' })}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <ToolButton onClick={() => inputRef.current?.click()}>{t('panel.vibi3d.open', { defaultValue: 'Open files' })}</ToolButton>
              <ToolButton onClick={() => { void load(async () => {
                const object = new THREE.Group(); object.name = 'Sample';
                const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x8b5cf6 }));
                cube.name = 'Cube'; cube.position.y = 0.5; object.add(cube); return { object, clips: [], fileName: 'sample.glb' };
              }); }}>{t('panel.vibi3d.sample', { defaultValue: 'Try a cube' })}</ToolButton>
            </div>
          </div>
        </div>}
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-gray-950/40"><span className="rounded bg-gray-900 px-4 py-2 text-xs">{t('panel.vibi3d.working', { defaultValue: 'Working…' })}</span></div>}
        {contextLost && <div role="alert" className="absolute inset-x-2 bottom-2 rounded bg-gray-900/95 px-3 py-2 text-xs text-amber-300">{errorText(new CreationUiError('webgl-context-lost'))}</div>}
      </div>
      {viewedSnapshot && inspector && <Vibi3DSourceProject.Provider value={root}><Vibi3DInspector snapshot={viewedSnapshot} stats={viewActor === 'human' ? sceneStats : undefined} disabled={editsDisabled || !!actionRef.current} onCommand={userCommand} readView={readView}
        shotActions={root ? { onStills: ids => { void outputShots(ids, false); }, onVideo: (ids, motion) => { void outputShots(ids, true, motion); } } : undefined}
        textureConnections={sourceDoc && viewActor === 'human' ? <Vibi3DImageSources projectId={root} selectedName={viewedSnapshot.nodes.find(node => node.id === viewedSnapshot.selectedId)?.name ?? ''} disabled={busy || dirty} onApply={linkImageTexture} /> : undefined}
        onTexture={(file) => { void texture(file); }}
        onCamera={() => { const view = readView(); if (view) userCommand({ type: 'camera', ...view }); }} /></Vibi3DSourceProject.Provider>}
    </div>
    {clips.length > 0 && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2 text-xs">
      <select aria-label={t('panel.vibi3d.clip', { defaultValue: 'Animation clip' })} className="min-w-0 max-w-44 rounded bg-gray-900 p-1 pointer-coarse:p-2" value={clipIndex} disabled={busy}
        onChange={(event) => { stopPlayback(); const index = Number(event.target.value); clipRef.current = index; setClipIndex(index); }}>
        {clips.map((clip, index) => <option key={index} value={index}>{clip.name || `${index + 1}`}</option>)}
      </select>
      <ToolButton disabled={busy} onClick={startPlayback}>{t(playing ? 'panel.vibi3d.pause' : 'panel.vibi3d.play', { defaultValue: playing ? 'Pause' : 'Play' })}</ToolButton>
      <ToolButton disabled={busy} onClick={stopPlayback}>{t('panel.vibi3d.stop', { defaultValue: 'Stop' })}</ToolButton>
      <input aria-label={t('panel.vibi3d.seek', { defaultValue: 'Animation time' })} className="min-w-20 flex-1" type="range" min="0" max={duration || 1} step="0.01" value={playTime} disabled={busy}
        onChange={(event) => {
          const mixer = mixerRef.current; const clip = clips[clipIndex]; if (!mixer || !clip) return;
          if (!actionRef.current) actionRef.current = mixer.clipAction(clip).play(); playingRef.current = false; setPlaying(false);
          const time = Number(event.target.value); actionRef.current.time = time; mixer.update(0); playTimeRef.current = time; setPlayTime(time); transformRef.current?.detach();
        }} />
      <span className="whitespace-nowrap tabular-nums text-gray-400">{playTime.toFixed(1)} / {duration.toFixed(1)}s</span>
    </div>}
    {/* 아래 묶음(제안 검토 · 텍스처 원본 · 원본 연결 · 생성 코드 · AI 요청)은 높이 상한 안에서 스크롤한다 — 짧은 창에서 이 묶음이
        무대를 밀어내거나 창 밖으로 잘리지 않게. 상태 줄(footer)은 오류를 늘 보이도록 묶음 밖에 둔다. */}
    <div className="scrollbar-thin max-h-[50%] min-h-0 overflow-y-auto box-compact:max-h-[40%]">
      {root && <Vibi3DDraftPanel projectId={root} scopeKey={draftKey} refreshToken={`${draftKey}:${humanSave.version}:${agentSave.version}`} onRestore={restoreDraft} onDiscard={discardAgent} />}
      {agentSnapshot && <p className="px-3 py-2 text-xs text-gray-400">{t('panel.vibi3d.drafts.agentReviewHint')}</p>}
      {sourceDoc && <Vibi3DCandidates projectId={root} doc={sourceDoc} head={head} disabled={editsDisabled || dirty} onAccept={acceptCandidate} onRevert={revertSource} />}
      {sourceDoc && <SourceConnections projectId={root} doc={sourceDoc} disabled={editsDisabled || dirty} onDoc={onSourceDoc} onUpdateLink={async (link, revision) => {
        // A texture link re-renders the image onto its objects; other roles fall back to moving only the reference.
        if (!modelTextureSlot(link.role)) return false;
        await linkImageTexture(link.sourceId, link.id, revision);
        return true;
      }} />}
      {sourceDoc && <Vibi3DCodePanel projectId={root} doc={sourceDoc} disabled={editsDisabled || dirty} onDoc={onSourceDoc} />}
      {sourceDoc && <Vibi3DWorkflowPanel projectId={root} documentId={sourceDoc.id} revision={snapshot?.revision ?? 0} />}
      <Vibi3DAgentPanel projectId={root} snapshot={agentSnapshot} connected={bridge.connected} onBeforeSend={async () => {
        queueDraftRef.current('human'); queueDraftRef.current('agent'); await autosave.flush(); await bridge.publishNow();
      }} sourceDoc={agentRef.current?.document} sourceDirty={!!agentSnapshot && agentSnapshot.revision !== agentRef.current?.savedRevision}
        sourceBusy={busy || agentBusy || quiescing} draftSaved={agentSave.status === 'saved'} />
    </div>
    <footer className="shrink-0 border-t border-white/10 px-3 py-2 text-xs text-gray-400">
      {error ? <p role="alert" className="break-words text-amber-300">{error}</p> : notice ? <p role="status" className="break-words text-emerald-300">{notice}</p>
        : <p>{snapshot ? `${t('panel.vibi3d.vertices', { n: stats.vertices.toLocaleString() })} · ${t('panel.vibi3d.triangles', { n: stats.triangles.toLocaleString() })}` : t('panel.vibi3d.dragHint')}</p>}
      {snapshot && missingTextures.length > 0 && <p className="mt-1 break-words text-amber-300" title={missingTextures.join('\n')}>
        {t('panel.vibi3d.missingTextures', { count: missingTextures.length, names: missingTextures.slice(0, 3).join(', ') + (missingTextures.length > 3 ? ', …' : '') })}</p>}
      {snapshot && !bridge.connected && bridge.error && <p className="mt-1 text-amber-300">{t('panel.vibi3d.connectionIssue', { defaultValue: 'AI connection unavailable. You can still edit and save.' })}</p>}
    </footer>
  </div>;
}
