import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

import type { AppShellProps } from '../../apps/registry.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { mediaDirName, mediaFileName, workspaceMediaUrl } from '../../utils/workspaceMedia.js';

/**
 * §5.13 (R-5) Vibi3D — **3D 뷰어**(여덟 번째 shell).
 *
 * `#app=vibi3d&projectId=…&file=…` 로 뜬다. 3D 파일을 눌렀을 때 앱 밖으로 나가지 않고 그 자리에서
 * 돌려 보기 위한 창이다(사용자 지시: "3d도 우리 뷰에서 손쉽게 3d뷰 볼수 있잖아").
 *
 * **보기 전용이다.** 편집·저장을 하지 않는 이유는 (C) 표의 판단과 같다 — 3D 저작은 이미 남들이
 * 아주 잘 푼 문제이고, 우리가 필요한 것은 "결과물을 눌러서 확인하는" 자리다.
 *
 * 렌더는 `three`(MIT)를 쓴다. **이 파일은 앱 청크 안에만 있으므로** 기본 번들에는 한 바이트도
 * 들어가지 않는다(§5.13 (H) — 안 쓰면 비용이 없다는 규율의 주인은 늦은 로더다).
 */

/** 배경 두 벌 — 어두운 모델은 밝은 배경에서, 밝은 모델은 어두운 배경에서 형태가 보인다. */
const BACKGROUNDS = { dark: 0x0b0d12, light: 0x9aa3b2 } as const;

interface ModelStats {
  readonly vertices: number;
  readonly triangles: number;
  readonly size: { x: number; y: number; z: number };
}

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

/** 확장자별 파서. 여기 한 줄을 더하는 것이 새 형식을 받는 유일한 작업이다. */
async function parseModel(
  ext: string,
  bytes: ArrayBuffer,
  manager: THREE.LoadingManager,
): Promise<THREE.Object3D> {
  const text = (): string => new TextDecoder().decode(bytes);

  switch (ext) {
    case '.glb':
    case '.gltf': {
      const loader = new GLTFLoader(manager);
      return new Promise<THREE.Object3D>((resolve, reject) => {
        // 실패 콜백은 `ErrorEvent` 가 오기도 한다 — 문자열로 접어 던져야 호출부의 catch 가 한 모양으로 받는다.
        loader.parse(
          ext === '.gltf' ? text() : bytes,
          '',
          (gltf) => resolve(gltf.scene),
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
        );
      });
    }
    case '.obj':
      return new OBJLoader(manager).parse(text());
    case '.stl': {
      const geometry = new STLLoader(manager).parse(bytes);
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb9c2d0, roughness: 0.65, metalness: 0.1 }));
    }
    case '.ply': {
      const geometry = new PLYLoader(manager).parse(bytes);
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb9c2d0, roughness: 0.65, metalness: 0.1 }));
    }
    case '.fbx':
      return new FBXLoader(manager).parse(bytes, '');
    case '.dae': {
      const collada = new ColladaLoader(manager).parse(text(), '');
      if (!collada?.scene) throw new Error('collada: empty scene');
      return collada.scene;
    }
    case '.3mf':
      return new ThreeMFLoader(manager).parse(bytes);
    default:
      throw new Error(`unsupported: ${ext}`);
  }
}

function ToolButton({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-[12px] transition-colors ${
        active === true ? 'bg-violet-500/25 text-violet-200' : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]'
      }`}
    >
      {children}
    </button>
  );
}

export function Vibi3DShell({ params }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const root = params['projectId'] ?? '';
  const filePath = params['file'] ?? '';
  const fileName = useMemo(() => (filePath ? mediaFileName(filePath) : ''), [filePath]);

  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [spin, setSpin] = useState(false);
  const [bg, setBg] = useState<'dark' | 'light'>('dark');

  // ─── 무대 세우기(한 번) ───

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUNDS.dark);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    camera.position.set(2.5, 2, 3.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 조명 — 모델에 재질이 없어도 형태가 읽히는 최소 구성.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 5, 4);
    scene.add(key);

    const grid = new THREE.GridHelper(10, 20, 0x475569, 0x1f2937);
    scene.add(grid);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    gridRef.current = grid;

    const resize = (): void => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      // 창을 닫을 때 GPU 자원을 놓아 준다 — 앱 창을 여닫는 것이 흔한 조작이라 여기가 새면 계속 쌓인다.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  // ─── 모델 넣기 ───

  const frameModel = useCallback((): void => {
    const model = modelRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!model || !camera || !controls) return;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360);

    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance * 1.6));
    camera.near = Math.max(0.001, distance / 500);
    camera.far = distance * 50;
    camera.updateProjectionMatrix();
    controls.update();
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || root === '' || filePath === '') {
      if (root === '' || filePath === '') {
        setLoad({ status: 'error', message: t('panel.vibi3d.noFile', { defaultValue: '3D 파일을 눌러 열면 여기서 돌려 봅니다.' }) });
      }
      return undefined;
    }

    let alive = true;
    setLoad({ status: 'loading' });

    void (async () => {
      try {
        const res = await fetch(workspaceMediaUrl(root, filePath));
        if (!res.ok) throw new Error(String(res.status));
        const bytes = await res.arrayBuffer();

        /**
         * `.gltf` 는 버퍼·텍스처를 **옆 파일로** 두는 형식이라 상대 URL 이 나온다. 우리 파일은
         * 쿼리(`?root=&path=`)로만 닿으므로 그대로는 못 찾는다 — 나오는 상대 경로를 그 자리에서
         * 우리 창구로 바꿔 준다(모델이 있는 폴더 기준).
         */
        const dir = mediaDirName(filePath);
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/api/')) return url;
          const clean = url.replace(/^\.\//, '');
          return workspaceMediaUrl(root, dir === '' ? clean : `${dir}/${clean}`);
        });

        const ext = (fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '').toLowerCase();
        const object = await parseModel(ext, bytes, manager);
        if (!alive) return;

        if (modelRef.current) scene.remove(modelRef.current);
        modelRef.current = object;
        scene.add(object);

        let vertices = 0;
        let triangles = 0;
        object.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          const geo = mesh.geometry;
          if (!geo || !geo.attributes) return;
          const pos = geo.attributes['position'];
          if (!pos) return;
          vertices += pos.count;
          triangles += geo.index ? geo.index.count / 3 : pos.count / 3;
        });
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        setStats({ vertices, triangles: Math.round(triangles), size: { x: size.x, y: size.y, z: size.z } });

        frameModel();
        setLoad({ status: 'ready' });
      } catch (err) {
        if (!alive) return;
        setLoad({
          status: 'error',
          message: t('panel.vibi3d.parseFailed', {
            defaultValue: '이 파일을 읽지 못했습니다. 연결 프로그램으로 열어 주세요.',
          }),
        });
        // 원인은 개발자용이라 화면에 크게 쓰지 않는다(사용자에게는 다음 행동이 더 중요하다).
        console.warn('[vibi3d] parse failed', err);
      }
    })();

    return () => {
      alive = false;
    };
  }, [root, filePath, fileName, frameModel, t]);

  // ─── 보기 옵션 ───

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as (THREE.Material & { wireframe?: boolean }) | (THREE.Material & { wireframe?: boolean })[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => { if ('wireframe' in m) m.wireframe = wireframe; });
      else if (mat && 'wireframe' in mat) mat.wireframe = wireframe;
    });
  }, [wireframe, load]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) scene.background = new THREE.Color(BACKGROUNDS[bg]);
  }, [bg]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.autoRotate = spin;
    controls.autoRotateSpeed = 1.2;
  }, [spin, load]);

  const openExternal = useCallback((): void => {
    void fetch('/api/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ absolutePath: `${root}/${filePath}` }),
    }).catch(() => undefined);
  }, [root, filePath]);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <header className="app-drag flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3">
        <span className="text-sm font-semibold">{t('panel.vibi3d.title', { defaultValue: 'Vibi3D' })}</span>
        <span className="truncate text-xs text-white/45">{fileName}</span>
        <div className="app-nodrag ml-auto flex items-center">
          <WindowControls />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <ToolButton onClick={frameModel}>{t('panel.vibi3d.frame', { defaultValue: '화면에 맞추기' })}</ToolButton>
        <ToolButton onClick={() => setWireframe((v) => !v)} active={wireframe}>
          {t('panel.vibi3d.wireframe', { defaultValue: '와이어프레임' })}
        </ToolButton>
        <ToolButton onClick={() => setShowGrid((v) => !v)} active={showGrid}>
          {t('panel.vibi3d.grid', { defaultValue: '격자' })}
        </ToolButton>
        <ToolButton onClick={() => setSpin((v) => !v)} active={spin}>
          {t('panel.vibi3d.spin', { defaultValue: '자동 회전' })}
        </ToolButton>
        <ToolButton onClick={() => setBg((v) => (v === 'dark' ? 'light' : 'dark'))} active={bg === 'light'}>
          {t('panel.vibi3d.background', { defaultValue: '밝은 배경' })}
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <ToolButton onClick={openExternal}>
          {t('panel.vibi3d.openExternal', { defaultValue: '연결 프로그램으로 열기' })}
        </ToolButton>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={mountRef} className="absolute inset-0" />
        {load.status !== 'ready' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto rounded-lg border border-white/10 bg-gray-900/90 px-4 py-3 text-center">
              {load.status === 'loading' ? (
                <p className="text-[12px] text-gray-400">{t('panel.vibi3d.loading', { defaultValue: '모델을 읽는 중…' })}</p>
              ) : (
                <>
                  <p className="mb-2 text-[12px] text-amber-300/90">{load.message}</p>
                  <ToolButton onClick={openExternal}>
                    {t('panel.vibi3d.openExternal', { defaultValue: '연결 프로그램으로 열기' })}
                  </ToolButton>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 px-3 py-2 text-[12px] text-gray-400">
        {stats ? (
          <>
            <span className="tabular-nums">
              {t('panel.vibi3d.vertices', { defaultValue: '정점 {{n}}', n: stats.vertices.toLocaleString() })}
            </span>
            <span className="tabular-nums">
              {t('panel.vibi3d.triangles', { defaultValue: '삼각형 {{n}}', n: stats.triangles.toLocaleString() })}
            </span>
            <span className="tabular-nums text-gray-500">
              {stats.size.x.toFixed(2)} × {stats.size.y.toFixed(2)} × {stats.size.z.toFixed(2)}
            </span>
          </>
        ) : (
          <span className="text-gray-600">{t('panel.vibi3d.dragHint', { defaultValue: '끌어서 돌리고, 휠로 확대합니다' })}</span>
        )}
        <span className="ml-auto text-gray-600">{t('panel.vibi3d.viewOnly', { defaultValue: '보기 전용' })}</span>
      </footer>
    </div>
  );
}
