import { useEffect, useState } from 'react';

export function useCanvasMemoReturnAvailable(project: string | null, id: string | null): boolean | null {
  const [state, setState] = useState<{ project: string; id: string; available: boolean } | null>(null);
  useEffect(() => {
    setState(null);
    if (!project || !id) return;
    const controller = new AbortController();
    void fetch('/api/canvas-memos/home', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ project, memoId: id }),
    }).then(async (response) => {
      if (!response.ok) return;
      const data: { returnAvailable?: unknown } = await response.json();
      if (!controller.signal.aborted && typeof data.returnAvailable === 'boolean') {
        setState({ project, id, available: data.returnAvailable });
      }
    }).catch(() => { /* 메뉴를 다시 열면 재확인한다. */ });
    return () => controller.abort();
  }, [project, id]);
  return state?.project === project && state.id === id ? state.available : null;
}
