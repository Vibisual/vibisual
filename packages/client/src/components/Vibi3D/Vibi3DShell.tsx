import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/controls/TransformControls.js';
import type { Vibi3DCommand, Vibi3DCommandRequest, Vibi3DSnapshot } from '@vibisual/shared';
import type { AppShellProps } from '../../apps/registry.js';
import { updateAppWindowTarget, useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { editedMediaPath, writeWorkspaceMedia } from '../../utils/workspaceMedia.js';
import { ModelEditor } from './modelEditor.js';
import { disposeModel, exportModelGlb, loadLocalModel, loadWorkspaceModel, type LoadedModel } from './modelIO.js';
import { Vibi3DInspector } from './Vibi3DInspector.js';
import { Vibi3DAgentPanel } from './Vibi3DAgentPanel.js';
import { useVibi3DBridge } from './useVibi3DBridge.js';

/** The existing lazy-loaded viewer, with a single command path for manual and AI edits. */
const BACKGROUNDS = { dark: 0x0b0d12, light: 0x9aa3b2 } as const;
const degrees = (object: THREE.Object3D): [number, number, number] => {
  const r = new THREE.Euler().setFromQuaternion(object.quaternion, 'XYZ');
  return [r.x, r.y, r.z].map(THREE.MathUtils.radToDeg) as [number, number, number];
};
function ToolButton({ onClick, active, disabled, children }: { onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }): React.JSX.Element {
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
    className={`rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${active ? 'bg-violet-500/25 text-violet-200' : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]'}`}>{children}</button>;
}

export function Vibi3DShell({ params }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const root = params['projectId'] ?? '';
  const initialPath = params['file'] ?? '';
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  const mountRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<ModelEditor | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const boxRef = useRef<THREE.BoxHelper | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const lightsRef = useRef<{ ambient: THREE.HemisphereLight; key: THREE.DirectionalLight } | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const clipRef = useRef(0);
  const playingRef = useRef(false);
  const playTimeRef = useRef(0);
  const snapshotRef = useRef<Vibi3DSnapshot | null>(null);
  const busyRef = useRef(false);
  const loadingRef = useRef(false);
  const dragRef = useRef<{ object: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 } | null>(null);
  const sourcePathRef = useRef('');
  const persistedRef = useRef({ path: '', revision: -1 });
  const loadSequence = useRef(0);
  const mounted = useRef(true);
  const [snapshot, setSnapshot] = useState<Vibi3DSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [savedRevision, setSavedRevision] = useState(-1);
  const [savedPath, setSavedPath] = useState('');
  const [mode, setMode] = useState<TransformControlsMode>('translate');
  const [inspector, setInspector] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [spin, setSpin] = useState(false);
  const [bg, setBg] = useState<'dark' | 'light'>('dark');
  const [playing, setPlaying] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);
  const [playTime, setPlayTime] = useState(0);
  const [stats, setStats] = useState({ triangles: 0, vertices: 0 });
  const [missingTextures, setMissingTextures] = useState<string[]>([]);
  useAppWindowTarget(params, snapshot ? { ref: undefined, file: savedPath || undefined } : null);

  const sync = useCallback((): Vibi3DSnapshot => {
    const editor = editorRef.current;
    if (!editor) throw new Error('No model is open.');
    const next = editor.snapshot(); snapshotRef.current = next; setSnapshot(next);
    const selected = next.selectedId ? editor.findObject(next.selectedId) : null;
    if (selected && !actionRef.current) transformRef.current?.attach(selected); else transformRef.current?.detach();
    if (boxRef.current) { boxRef.current.visible = !!selected; if (selected) boxRef.current.setFromObject(selected); }
    if (lightsRef.current) { lightsRef.current.ambient.intensity = 1.1 * (next.lighting ?? 1); lightsRef.current.key.intensity = 1.4 * (next.lighting ?? 1); }
    return next;
  }, []);
  const stopPlayback = useCallback((): void => {
    mixerRef.current?.stopAllAction(); actionRef.current = null; playingRef.current = false; playTimeRef.current = 0;
    setPlaying(false); setPlayTime(0); if (editorRef.current) sync();
  }, [sync]);
  const apply = useCallback((commands: Vibi3DCommand[], expectedRevision?: number): Vibi3DSnapshot => {
    const editor = editorRef.current;
    if (!editor) throw new Error('No model is open.');
    if (busyRef.current || dragRef.current) throw new Error('The model is being loaded, saved or dragged. Read the scene and retry after it finishes.');
    stopPlayback(); editor.apply(commands, expectedRevision ?? editor.revision); setError(''); setNotice(''); return sync();
  }, [stopPlayback, sync]);
  const applyRef = useRef(apply); applyRef.current = apply;
  const userCommand = useCallback((command: Vibi3DCommand): void => {
    try { apply([command]); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [apply]);
  const frameModel = useCallback((): void => {
    const object = editorRef.current?.object; const camera = cameraRef.current; const controls = controlsRef.current;
    if (!object || !camera || !controls) return;
    const bounds = new THREE.Box3().setFromObject(object); const center = bounds.getCenter(new THREE.Vector3()); const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const distance = radius / Math.sin(camera.fov * Math.PI / 360) * Math.max(1, 1 / camera.aspect);
    controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance * 1.6));
    camera.near = Math.max(0.001, distance / 500); camera.far = Math.max(100, distance * 50); camera.updateProjectionMatrix(); controls.update();
  }, []);

  useEffect(() => {
    mounted.current = true; busyRef.current = false;
    const mount = mountRef.current; if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (err) { setError(String(err)); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(BACKGROUNDS.dark);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000); camera.position.set(2.5, 2, 3.5);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const transform = new TransformControls(camera, renderer.domElement); transform.setSize(0.8); scene.add(transform.getHelper());
    const grid = new THREE.GridHelper(10, 20, 0x475569, 0x1f2937); scene.add(grid);
    const ambient = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, 4); scene.add(ambient, key);
    const box = new THREE.BoxHelper(new THREE.Object3D(), 0xa78bfa); box.visible = false; scene.add(box);
    sceneRef.current = scene; cameraRef.current = camera; rendererRef.current = renderer; controlsRef.current = controls;
    transformRef.current = transform; gridRef.current = grid; boxRef.current = box; lightsRef.current = { ambient, key };
    transform.addEventListener('mouseDown', () => {
      const object = transform.object; if (!object) return;
      dragRef.current = { object, position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone() }; controls.enabled = false;
    });
    transform.addEventListener('mouseUp', () => {
      const start = dragRef.current; dragRef.current = null; controls.enabled = true; if (!start) return;
      const id = editorRef.current?.getId(start.object);
      const command: Vibi3DCommand = { type: 'update', id: id ?? '', position: start.object.position.toArray(), rotation: degrees(start.object), scale: start.object.scale.toArray() };
      // Restore the start before committing: one drag, one undo, one revision.
      start.object.position.copy(start.position); start.object.rotation.copy(start.rotation); start.object.scale.copy(start.scale); start.object.updateMatrixWorld(true);
      if (id) { try { applyRef.current([command]); } catch (err) { setError(String(err)); } }
    });
    const raycaster = new THREE.Raycaster(); let pointerStart = { x: 0, y: 0, gizmo: false };
    const down = (event: PointerEvent): void => { pointerStart = { x: event.clientX, y: event.clientY, gizmo: transform.axis !== null }; };
    const up = (event: PointerEvent): void => {
      const editor = editorRef.current;
      if (!editor || event.button !== 0 || busyRef.current || pointerStart.gizmo || actionRef.current || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObject(editor.object, true)[0]?.object; editor.select(hit ? editor.getId(hit) : null); sync();
    };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    const resize = (): void => { if (mount.clientWidth && mount.clientHeight) { renderer.setSize(mount.clientWidth, mount.clientHeight, false); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); } };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    let raf = 0; let previous = performance.now(); let lastReadout = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (playingRef.current && mixerRef.current) {
        mixerRef.current.update(Math.min((now - previous) / 1000, 0.1)); playTimeRef.current = actionRef.current?.time ?? 0;
        if (now - lastReadout > 100) { lastReadout = now; setPlayTime(playTimeRef.current); }
      }
      previous = now; controls.update(); if (box.visible) box.update(); renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      mounted.current = false; loadSequence.current += 1; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); transform.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      mixerRef.current?.stopAllAction(); if (editorRef.current) disposeModel(editorRef.current.object);
      editorRef.current = null; snapshotRef.current = null; dragRef.current = null;
      grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); box.geometry.dispose(); (box.material as THREE.Material).dispose();
      scene.overrideMaterial?.dispose(); renderer.dispose(); renderer.domElement.remove(); sceneRef.current = null; rendererRef.current = null;
    };
  }, [sync]);

  const installModel = useCallback((loaded: LoadedModel, sourcePath: string): void => {
    const scene = sceneRef.current;
    if (!scene) { disposeModel(loaded.object); throw new Error('3D view is unavailable.'); }
    const next = new ModelEditor(loaded.object, loaded.clips, { projectId: root, fileName: loaded.fileName });
    stopPlayback(); transformRef.current?.detach();
    if (editorRef.current) { scene.remove(editorRef.current.object); disposeModel(editorRef.current.object); }
    editorRef.current = next; scene.add(next.object); sourcePathRef.current = sourcePath;
    persistedRef.current = { path: sourcePath, revision: sourcePath ? next.revision : -1 }; setSavedPath(sourcePath);
    mixerRef.current = new THREE.AnimationMixer(next.object); clipRef.current = 0; setClipIndex(0);
    let triangles = 0; let vertices = 0;
    next.object.traverse((object) => { const g = (object as THREE.Mesh).geometry; const p = g?.attributes['position']; if (p) { vertices += p.count; triangles += (g.index?.count ?? p.count) / 3; } });
    setStats({ vertices, triangles: Math.round(triangles) }); setMissingTextures(loaded.missingTextures ?? []); next.select(next.getId(next.object));
    sync(); frameModel(); setSavedRevision(sourcePath ? 0 : -1); setNotice(''); setError('');
  }, [root, stopPlayback, sync, frameModel]);
  const load = useCallback(async (loader: () => Promise<LoadedModel>, sourcePath = ''): Promise<void> => {
    if (busyRef.current) return;
    const sequence = ++loadSequence.current; busyRef.current = true; loadingRef.current = true; setBusy(true); setError('');
    try {
      const loaded = await loader();
      if (!mounted.current || sequence !== loadSequence.current) { disposeModel(loaded.object); return; }
      installModel(loaded, sourcePath);
    } catch (err) { if (mounted.current && sequence === loadSequence.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (sequence === loadSequence.current) { busyRef.current = false; loadingRef.current = false; setBusy(false); } }
  }, [installModel]);
  useEffect(() => {
    if (!root || !initialPath) return;
    // Publishing a just-saved path updates host params; keep this live editor and its undo history.
    if (editorRef.current && snapshotRef.current?.projectId === root && persistedRef.current.path === initialPath) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const openRequestedFile = (): void => {
      // A file request arriving during export waits until export owns no mutable scene state.
      if (busyRef.current) { timer = setTimeout(openRequestedFile, 100); return; }
      started = true;
      void load(() => loadWorkspaceModel(root, initialPath), initialPath);
    };
    openRequestedFile();
    return () => {
      if (timer) clearTimeout(timer);
      if (started && loadingRef.current) {
        loadSequence.current += 1; loadingRef.current = false; busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    };
  }, [root, initialPath, load]);
  useEffect(() => { transformRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { if (gridRef.current) gridRef.current.visible = showGrid; }, [showGrid]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.background = new THREE.Color(BACKGROUNDS[bg]); }, [bg]);
  useEffect(() => { if (controlsRef.current) { controlsRef.current.autoRotate = spin; controlsRef.current.autoRotateSpeed = 1.2; } }, [spin]);
  useEffect(() => { const scene = sceneRef.current; if (scene) { scene.overrideMaterial?.dispose(); scene.overrideMaterial = wireframe ? new THREE.MeshBasicMaterial({ color: 0xb9c2d0, wireframe: true }) : null; } }, [wireframe]);
  useEffect(() => { if (transformRef.current) transformRef.current.enabled = !busy && !actionRef.current; }, [busy, playing, playTime]);
  const observe = useCallback((): Vibi3DSnapshot | null => {
    const base = snapshotRef.current; if (!base || busyRef.current || dragRef.current) return null;
    const camera = cameraRef.current; const controls = controlsRef.current;
    return { ...base, ...(camera && controls ? { camera: { position: camera.position.toArray(), target: controls.target.toArray() } } : {}),
      playback: { clip: editorRef.current?.clips[clipRef.current]?.name ?? null, time: playTimeRef.current, playing: playingRef.current } };
  }, []);
  const capture = useCallback((): string => {
    const renderer = rendererRef.current; const scene = sceneRef.current; const camera = cameraRef.current;
    if (!renderer || !scene || !camera || dragRef.current || busyRef.current) throw new Error('The view is busy.');
    // AI needs a stable frame it can inspect after the HTTP round trip. Keep the
    // current animation pose, pause motion and settle orbit damping before capture.
    playingRef.current = false; setPlaying(false); setSpin(false);
    const controls = controlsRef.current;
    if (controls) {
      controls.autoRotate = false;
      const damping = controls.enableDamping; controls.enableDamping = false;
      controls.update(); controls.enableDamping = damping;
    }
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas'); canvas.width = Math.min(960, renderer.domElement.width);
    canvas.height = Math.max(1, Math.round(canvas.width * renderer.domElement.height / Math.max(1, renderer.domElement.width)));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Cannot capture the 3D view.');
    context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/jpeg', 0.8);
  }, []);
  const execute = useCallback((request: Vibi3DCommandRequest) => apply(request.commands, request.expectedRevision), [apply]);
  const bridge = useVibi3DBridge({ snapshot, getSnapshot: observe, capture, execute });

  const save = useCallback(async (download = false): Promise<boolean> => {
    const editor = editorRef.current; if (!editor || busyRef.current || dragRef.current) return false;
    stopPlayback(); busyRef.current = true; setBusy(true); setError('');
    try {
      const bytes = await exportModelGlb(editor.object, editor.clips); const source = sourcePathRef.current || editor.fileName;
      if (download || !root) {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })); const link = document.createElement('a');
        link.href = url; link.download = editedMediaPath(source, '.glb', 1).split('/').pop() ?? 'model-edit.glb'; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice(t('panel.vibi3d.downloadStarted', { defaultValue: 'GLB download started.' }));
      } else {
        let savedPath = '';
        for (let n = 1; n <= 100; n += 1) {
          const result = await writeWorkspaceMedia(root, editedMediaPath(source, '.glb', n), new Uint8Array(bytes));
          if (result.ok) { savedPath = result.path; break; }
          if (result.error !== 'exists') break;
        }
        if (!savedPath) throw new Error(t('panel.vibi3d.saveFailed', { defaultValue: 'Could not save. Try downloading the GLB.' }));
        persistedRef.current = { path: savedPath, revision: editor.revision }; setSavedPath(savedPath);
        await updateAppWindowTarget(params, { ref: undefined, file: savedPath });
        setNotice(t('panel.vibi3d.saved', { defaultValue: 'Saved: {{path}}', path: savedPath }));
      }
      setSavedRevision(editor.revision);
      setError('');
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }, [root, stopPlayback, t, params]);
  useAppWindowTransferGuard(params, async () => {
    if (busyRef.current || dragRef.current) {
      setError(t('panel.vibi3d.working', { defaultValue: 'Working…' })); return false;
    }
    const editor = editorRef.current;
    if (!editor) return true;
    if (!root) {
      setError(t('panel.vibi3d.saveFailed', { defaultValue: 'Could not save. Try downloading the GLB.' })); return false;
    }
    if (persistedRef.current.path && persistedRef.current.revision === editor.revision) {
      try {
        await updateAppWindowTarget(params, { ref: undefined, file: persistedRef.current.path }); return true;
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; }
    }
    return save();
  });
  const startPlayback = (): void => {
    const editor = editorRef.current; const mixer = mixerRef.current; const clip = editor?.clips[clipIndex];
    if (!editor || !mixer || !clip || busyRef.current) return;
    if (!actionRef.current) actionRef.current = mixer.clipAction(clip).play();
    playingRef.current = !playingRef.current; setPlaying(playingRef.current); transformRef.current?.detach();
  };
  const clips = editorRef.current?.clips ?? []; const duration = clips[clipIndex]?.duration ?? 0;
  return <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100" onKeyDown={(event) => {
    if (event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); userCommand({ type: event.shiftKey ? 'redo' : 'undo' }); }
    if (event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void save(); }
  }}>
    <header className={`${hosted ? '' : 'app-drag '}flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3`}>
      <span className={`${hosted ? '' : 'app-drag-label '}text-sm font-semibold`}>Vibi3D</span>
      <span className={`${hosted ? '' : 'app-drag-label '}min-w-0 truncate text-xs text-gray-400`}>{snapshot?.fileName ?? ''}{snapshot && snapshot.revision !== savedRevision ? ' •' : ''}</span>
      {!hosted && <div className="app-nodrag ml-auto"><WindowControls /></div>}
    </header>
    <input ref={inputRef} type="file" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void load(() => loadLocalModel(files)); }} />
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
      <ToolButton disabled={busy} onClick={() => inputRef.current?.click()}>{t('panel.vibi3d.open', { defaultValue: 'Open files' })}</ToolButton>
      <ToolButton disabled={!snapshot || busy} onClick={() => void save()}>{t('panel.vibi3d.save', { defaultValue: 'Save GLB' })}</ToolButton>
      {root && <ToolButton disabled={!snapshot || busy} onClick={() => void save(true)}>{t('panel.vibi3d.download', { defaultValue: 'Download' })}</ToolButton>}
      <ToolButton disabled={!snapshot?.canUndo || busy} onClick={() => userCommand({ type: 'undo' })}>{t('panel.vibi3d.undo', { defaultValue: 'Undo' })}</ToolButton>
      <ToolButton disabled={!snapshot?.canRedo || busy} onClick={() => userCommand({ type: 'redo' })}>{t('panel.vibi3d.redo', { defaultValue: 'Redo' })}</ToolButton>
      <span className="mx-1 h-4 w-px bg-white/10" />
      {(['translate', 'rotate', 'scale'] as const).map((item) => <ToolButton key={item} disabled={!snapshot || busy || !!actionRef.current} active={mode === item} onClick={() => setMode(item)}>{t(`panel.vibi3d.tool_${item}`, { defaultValue: item === 'translate' ? 'Move' : item === 'rotate' ? 'Rotate' : 'Scale' })}</ToolButton>)}
      <ToolButton active={inspector} onClick={() => setInspector(!inspector)}>{t('panel.vibi3d.properties', { defaultValue: 'Properties' })}</ToolButton>
    </div>
    <div className="flex min-h-0 flex-1">
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
        {!snapshot && !busy && <div className="absolute inset-0 flex items-center justify-center p-5 pt-16">
          <div className="max-w-sm rounded-lg border border-white/10 bg-gray-900/95 p-5 text-center">
            <p className="mb-2 text-sm font-medium">{t('panel.vibi3d.start', { defaultValue: 'Open a model and make it yours' })}</p>
            <p className="mb-4 text-xs leading-relaxed text-gray-400">{t('panel.vibi3d.openHint', { defaultValue: 'Drop a GLB, glTF, OBJ, STL, PLY, FBX, DAE or 3MF here. Select companion textures together.' })}</p>
            <div className="flex justify-center gap-2">
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
      </div>
      {snapshot && inspector && <Vibi3DInspector snapshot={snapshot} disabled={busy || !!actionRef.current} onCommand={userCommand} />}
    </div>
    {clips.length > 0 && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2 text-xs">
      <select aria-label={t('panel.vibi3d.clip', { defaultValue: 'Animation clip' })} className="max-w-44 rounded bg-gray-900 p-1" value={clipIndex} disabled={busy}
        onChange={(event) => { stopPlayback(); const index = Number(event.target.value); clipRef.current = index; setClipIndex(index); }}>
        {clips.map((clip, index) => <option key={index} value={index}>{clip.name || `Clip ${index + 1}`}</option>)}
      </select>
      <ToolButton disabled={busy} onClick={startPlayback}>{t(playing ? 'panel.vibi3d.pause' : 'panel.vibi3d.play', { defaultValue: playing ? 'Pause' : 'Play' })}</ToolButton>
      <ToolButton disabled={busy} onClick={stopPlayback}>{t('panel.vibi3d.stop', { defaultValue: 'Stop' })}</ToolButton>
      <input aria-label={t('panel.vibi3d.seek', { defaultValue: 'Animation time' })} className="min-w-20 flex-1" type="range" min="0" max={duration || 1} step="0.01" value={playTime} disabled={busy}
        onChange={(event) => {
          const mixer = mixerRef.current; const clip = clips[clipIndex]; if (!mixer || !clip) return;
          if (!actionRef.current) actionRef.current = mixer.clipAction(clip).play(); playingRef.current = false; setPlaying(false);
          const time = Number(event.target.value); actionRef.current.time = time; mixer.update(0); playTimeRef.current = time; setPlayTime(time); transformRef.current?.detach();
        }} />
      <span className="tabular-nums text-gray-400">{playTime.toFixed(1)} / {duration.toFixed(1)}s</span>
    </div>}
    <Vibi3DAgentPanel projectId={root} snapshot={snapshot} connected={bridge.connected} onBeforeSend={bridge.publishNow} />
    <footer className="shrink-0 border-t border-white/10 px-3 py-2 text-[11px] text-gray-400">
      {error ? <p role="alert" className="break-words text-amber-300">{error}</p> : notice ? <p role="status" className="break-words text-emerald-300">{notice}</p>
        : <p>{snapshot ? `${t('panel.vibi3d.vertices', { n: stats.vertices.toLocaleString() })} · ${t('panel.vibi3d.triangles', { n: stats.triangles.toLocaleString() })}` : t('panel.vibi3d.dragHint')}</p>}
      {snapshot && missingTextures.length > 0 && <p className="mt-1 break-words text-amber-300" title={missingTextures.join('\n')}>
        {t('panel.vibi3d.missingTextures', { count: missingTextures.length, names: missingTextures.slice(0, 3).join(', ') + (missingTextures.length > 3 ? ', …' : '') })}</p>}
      {snapshot && !bridge.connected && bridge.error && <p className="mt-1 text-amber-300">{t('panel.vibi3d.connectionIssue', { defaultValue: 'AI connection unavailable. You can still edit and save.' })}</p>}
    </footer>
  </div>;
}
