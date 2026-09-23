import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCommandCenterQuery } from './commandCenterModel.js';
import { useCommandCenterHistorySearch } from './useCommandCenterHistorySearch.js';

interface Props {
  projectId: string;
  agentIds: string[];
  query: string;
}

let view: ReactTestRenderer | undefined;
let state: ReturnType<typeof useCommandCenterHistorySearch>;
const fetcher = vi.fn<typeof fetch>();

function Probe({ projectId, agentIds, query }: Props) {
  state = useCommandCenterHistorySearch(projectId, agentIds, parseCommandCenterQuery(query).terms);
  return null;
}

async function render(over: Partial<Props> = {}): Promise<void> {
  const props: Props = { projectId: 'proj', agentIds: ['a1'], query: '시간경화', ...over };
  await act(async () => {
    if (view) view.update(<Probe {...props} />);
    else view = create(<Probe {...props} />);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function response(matches: Record<string, string[]>): Response {
  return new Response(JSON.stringify({ matches }), { status: 200 });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetcher.mockReset();
  fetcher.mockImplementation(async () => response({}));
  vi.stubGlobal('fetch', fetcher);
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCommandCenterHistorySearch 요청과 검색 범위', () => {
  it.each(['', '  \t ', 'is:working needs:review agent:alpha tool:bash'])('자유 검색어 없는 %j는 요청하지 않는다', async (query) => {
    await render({ query });
    await advance(20_000);

    expect(fetcher).not.toHaveBeenCalled();
    expect(state).toMatchObject({ matches: {}, pending: false, failed: false });
  });

  it('프로젝트에 검색할 에이전트가 없으면 요청하지 않는다', async () => {
    await render({ agentIds: [] });
    await advance(20_000);

    expect(fetcher).not.toHaveBeenCalled();
    expect(state.pending).toBe(false);
  });

  it('입력이 멈춘 뒤 최신 검색어로 한 번 요청한다', async () => {
    fetcher.mockImplementation(async () => response({ s1: ['시간경화'] }));
    await render({ query: '시간' });
    expect(state.pending).toBe(true);
    await advance(249);
    await render({ query: '시간경화 ' });
    await advance(249);
    expect(fetcher).not.toHaveBeenCalled();

    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetcher.mock.calls[0]![0]), 'http://localhost');
    expect(url.pathname).toBe('/api/subagent-streams/a1');
    expect(JSON.parse(url.searchParams.get('searchTerms')!)).toEqual(['시간경화']);
    expect(state).toMatchObject({ pending: false, failed: false, matches: {
      'a1::s1': ['시간경화'], 'a1::main': ['시간경화'],
    } });
  });

  it('세션별 일치는 유지하고 같은 에이전트의 메인에는 검색어를 합친다', async () => {
    fetcher.mockImplementation(async (url) => String(url).includes('/a1?')
      ? response({ s1: ['시간경화', '무관한단어'], s2: ['재현검증', '시간경화'] })
      : response({ s3: ['재현검증'] }));
    await render({ agentIds: ['a1', 'a2'], query: '시간경화 재현검증' });
    await advance(250);

    expect(state.matches).toEqual({
      'a1::s1': ['시간경화'],
      'a1::s2': ['재현검증', '시간경화'],
      'a1::main': ['시간경화', '재현검증'],
      'a2::s3': ['재현검증'],
      'a2::main': ['재현검증'],
    });
    expect(state.failed).toBe(false);
  });

  it('배열 참조나 검색어 순서만 바뀌면 진행 중 요청을 다시 시작하지 않는다', async () => {
    const pending = deferred<Response>();
    fetcher.mockImplementation(() => pending.promise.then((value) => value.clone()));
    await render({ agentIds: ['a1', 'a2'], query: '시간경화 재현검증' });
    await advance(250);
    const signals = fetcher.mock.calls.map(([, options]) => options?.signal);

    await render({ agentIds: ['a2', 'a1', 'a1'], query: '재현검증 시간경화 시간경화 ' });
    await advance(500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(signals.every((signal) => signal?.aborted === false)).toBe(true);
    await act(async () => { pending.resolve(response({})); });
    expect(state.failed).toBe(false);
  });
});

describe('useCommandCenterHistorySearch 이전 요청 격리', () => {
  it.each<[string, Partial<Props>]>([
    ['검색어', { query: '재현검증' }],
    ['프로젝트', { projectId: 'other-project' }],
  ])('%s가 바뀌면 이전 요청을 취소하고 취소를 무시한 응답도 버린다', async (_change, props) => {
    const first = deferred<Response>();
    const currentTerm = props.query ?? '시간경화';
    fetcher.mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => response({ current: [currentTerm] }));
    await render();
    await advance(250);
    const oldSignal = fetcher.mock.calls[0]![1]?.signal;

    await render(props);
    expect(oldSignal?.aborted).toBe(true);
    expect(state).toMatchObject({ matches: {}, pending: true, failed: false });
    await advance(250);
    const expected = { 'a1::current': [currentTerm], 'a1::main': [currentTerm] };
    expect(state.matches).toEqual(expected);

    await act(async () => { first.resolve(response({ stale: ['시간경화'] })); });
    expect(state.matches).toEqual(expected);
    expect(state.pending).toBe(false);
    expect(state.failed).toBe(false);
  });

  it('검색어를 지우면 이전 결과를 즉시 걷고 새 요청이나 주기 갱신을 하지 않는다', async () => {
    fetcher.mockImplementation(async () => response({ s1: ['시간경화'] }));
    await render();
    await advance(250);
    expect(state.matches['a1::s1']).toEqual(['시간경화']);
    const signal = fetcher.mock.calls[0]![1]?.signal;

    await render({ query: 'agent:alpha' });
    expect(state).toMatchObject({ matches: {}, pending: false, failed: false });
    expect(signal?.aborted).toBe(true);
    await advance(20_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('useCommandCenterHistorySearch 오류와 갱신', () => {
  it.each(['network', 'http', 'invalid-body', 'invalid-terms'] as const)('%s 오류를 표시하고 재시도로 복구한다', async (failure) => {
    fetcher.mockImplementationOnce(async () => {
      if (failure === 'network') throw new Error('offline');
      if (failure === 'http') return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify(failure === 'invalid-body' ? { data: [] } : { matches: { s1: [7] } }));
    }).mockImplementationOnce(async () => response({ s1: ['시간경화'] }));
    await render();
    await advance(250);
    expect(state).toMatchObject({ matches: {}, pending: false, failed: true });

    await act(async () => { state.retry(); });
    await advance(250);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ pending: false, failed: false, matches: {
      'a1::s1': ['시간경화'], 'a1::main': ['시간경화'],
    } });
  });

  it('일부 에이전트 요청이 실패해도 성공한 검색 결과와 오류를 함께 유지한다', async () => {
    fetcher.mockImplementation(async (url) => {
      if (String(url).includes('/a2?')) throw new Error('offline');
      return response({ s1: ['시간경화'] });
    });
    await render({ agentIds: ['a1', 'a2'] });
    await advance(250);

    expect(state).toMatchObject({ pending: false, failed: true, matches: {
      'a1::s1': ['시간경화'], 'a1::main': ['시간경화'],
    } });
  });

  it('진행 중인 요청과 겹치지 않고 완료 후 15초가 지나면 새 기록을 조회한다', async () => {
    const first = deferred<Response>();
    fetcher.mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => response({ fresh: ['시간경화'] }));
    await render();
    await advance(250);
    await advance(15_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(state.pending).toBe(true);

    await act(async () => { first.resolve(response({ old: ['시간경화'] })); });
    expect(state.matches['a1::old']).toEqual(['시간경화']);
    await advance(14_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.matches).toEqual({ 'a1::fresh': ['시간경화'], 'a1::main': ['시간경화'] });
  });

  it('숨겨진 창에서는 주기 갱신을 미루고 다시 보이면 갱신한다', async () => {
    const page = { visibilityState: 'visible' };
    vi.stubGlobal('document', page);
    await render();
    await advance(250);
    page.visibilityState = 'hidden';
    await advance(15_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    page.visibilityState = 'visible';
    await advance(15_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
