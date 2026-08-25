import { useCallback, useState } from 'react';
import type { LocalModelCatalogEntry, LocalModelCatalogRepo, LocalModelCatalogSort } from '@vibisual/shared';

/**
 * §5.19 — All Model 창이 쓰는 조작들.
 *
 * 상태(엔진·모델·진행률)는 **서버가 스냅샷으로 내려준 것**을 그대로 읽고, 여기서는 조작만
 * 보낸다 — 클라이언트가 자기 판단으로 목록을 만들면 디스크의 진실과 어긋난다.
 *
 * 설치를 부르는 자리가 하나뿐이어도 이 훅에 모아 두는 이유는 `useAppInstall` 과 같다:
 * 실패했을 때 무엇을 되돌리고 무엇을 보여 줄지가 한 곳에 있어야 갈라지지 않는다.
 */
export function useLocalLlm(): {
  installEngine: () => Promise<void>;
  uninstallEngine: () => Promise<void>;
  searchRepos: (q: string, sort?: LocalModelCatalogSort) => Promise<LocalModelCatalogRepo[]>;
  listRepoFiles: (repo: string) => Promise<LocalModelCatalogEntry[]>;
  downloadModel: (repo: string, file: string, partFiles?: readonly string[]) => Promise<void>;
  cancelDownload: (downloadId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  busy: boolean;
  error: string;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** 조작 하나를 감싸 실패 사유를 화면에 남긴다. 던지지 않는다 — 창은 계속 떠 있어야 한다. */
  const run = useCallback(async (fn: () => Promise<Response>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const installEngine = useCallback(
    () => run(() => fetch('/api/local-llm/engine/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })),
    [run],
  );

  const uninstallEngine = useCallback(
    () => run(() => fetch('/api/local-llm/engine', { method: 'DELETE' })),
    [run],
  );

  // 정렬 축은 **서버를 거쳐 카탈로그로** 넘긴다 — 받아 온 스무 건을 여기서 다시 줄 세우면
  //   그 스무 건 안에서의 순위가 되어 화면이 말하는 순위와 실제가 갈린다(§5.19 (E)).
  const searchRepos = useCallback(async (q: string, sort: LocalModelCatalogSort = 'downloads'): Promise<LocalModelCatalogRepo[]> => {
    setError('');
    try {
      const res = await fetch(`/api/local-llm/catalog?q=${encodeURIComponent(q)}&sort=${sort}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const j = (await res.json()) as { repos?: LocalModelCatalogRepo[] };
      return j.repos ?? [];
    } catch (err) {
      setError(String(err));
      return [];
    }
  }, []);

  const listRepoFiles = useCallback(async (repo: string): Promise<LocalModelCatalogEntry[]> => {
    setError('');
    try {
      const res = await fetch(`/api/local-llm/catalog/files?repo=${encodeURIComponent(repo)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const j = (await res.json()) as { files?: LocalModelCatalogEntry[] };
      return j.files ?? [];
    } catch (err) {
      setError(String(err));
      return [];
    }
  }, []);

  const downloadModel = useCallback(
    // 쪼개진 모델은 조각 목록을 함께 보낸다 — 한 조각만 받으면 그 모델은 쓸 수 없다.
    (repo: string, file: string, partFiles?: readonly string[]) =>
      run(() =>
        fetch('/api/local-llm/models/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, file, ...(partFiles && partFiles.length > 0 ? { partFiles } : {}) }),
        }),
      ),
    [run],
  );

  const cancelDownload = useCallback(
    (downloadId: string) =>
      run(() =>
        fetch('/api/local-llm/models/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ downloadId }),
        }),
      ),
    [run],
  );

  const deleteModel = useCallback(
    (modelId: string) => run(() => fetch(`/api/local-llm/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' })),
    [run],
  );

  return { installEngine, uninstallEngine, searchRepos, listRepoFiles, downloadModel, cancelDownload, deleteModel, busy, error };
}

/** 사람이 읽는 크기. 0 이면 "크기 미상"을 부를 수 있게 빈 문자열을 준다. */
export function formatBytes(n: number): string {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)}${units[i]}`;
}
