/**
 * §5.3 #10-6 (G) — 한 번에 등록: 멤버 만들기·설정·엣지·계획 신고(①~④)를 서버가 차례로 한다.
 * 각 단계는 **기존 loopback 경로 그대로** 부른다(`call` — 같은 검사·같은 권한 얼림). 이 모듈은 순서와 이름표(`@이름`) 풀기만 한다.
 * 중간에 실패하면 이미 만든 것을 지우지 않고 어디까지 됐는지 돌려준다(지휘자가 이어서 손으로 한다).
 */
import { ORCHESTRA_MAX_MEMBERS_LIMIT } from '@vibisual/shared';

/** 경로 하나를 부른다 — 서버가 자기 loopback 리스너로 보낸다(시험은 가짜를 꽂는다). */
export type FormationCall = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<{ status: number; json: unknown }>;

export interface FormationMemberInput {
  ref: string;
  label?: string;
  color?: string;
  provider?: unknown;
  config?: Record<string, unknown>;
  reuseAgentId?: string;
}

export interface FormationEdgeInput extends Record<string, unknown> {
  from: string;
  to: string;
}

export interface FormationBody {
  plan: Record<string, unknown>;
  members: FormationMemberInput[];
  edges: FormationEdgeInput[];
}

export interface FormationStep {
  step: 'create' | 'config' | 'edge' | 'plan';
  ref?: string;
  ok: boolean;
  status: number;
  id?: string;
  error?: string;
}

export interface FormationResult {
  ok: boolean;
  status: number;
  error?: string;
  dispatchEdgeId?: string;
  agentIds: Record<string, string>;
  steps: FormationStep[];
}

/** 한 번에 받는 엣지 수 상한 — 지휘 규칙의 엣지 표 상한과 같은 크기. */
const FORMATION_EDGES_MAX = 30;
const REF_RE = /^@[\p{L}\p{N}_-]{1,40}$/u;
/** 권한 축은 사용자만 바꾼다(§5.3 #12-1) — loopback 저장에서 어차피 무시되지만 보내지도 않는다. */
const PERMISSION_FIELDS = new Set(['permissionMode', 'tools', 'disallowedTools', 'askTools']);

/** 본문 모양 검사 — 틀리면 칸 이름으로 실패(조용히 고쳐 받지 않는다). */
export function validateFormationBody(input: unknown): { ok: true; value: FormationBody } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'body-not-object' };
  const b = input as Record<string, unknown>;
  if (!b.plan || typeof b.plan !== 'object' || Array.isArray(b.plan)) return { ok: false, error: 'plan-required' };
  const membersRaw = b.members === undefined ? [] : b.members;
  const edgesRaw = b.edges === undefined ? [] : b.edges;
  if (!Array.isArray(membersRaw)) return { ok: false, error: 'members-not-array' };
  if (!Array.isArray(edgesRaw)) return { ok: false, error: 'edges-not-array' };
  if (membersRaw.length > ORCHESTRA_MAX_MEMBERS_LIMIT) return { ok: false, error: 'members-too-many' };
  if (edgesRaw.length > FORMATION_EDGES_MAX) return { ok: false, error: 'edges-too-many' };
  const members: FormationMemberInput[] = [];
  const refs = new Set<string>();
  for (const raw of membersRaw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'member-not-object' };
    const m = raw as Record<string, unknown>;
    if (typeof m.ref !== 'string' || !REF_RE.test(m.ref)) return { ok: false, error: 'member-ref-invalid' };
    if (refs.has(m.ref)) return { ok: false, error: 'member-ref-duplicate' };
    refs.add(m.ref);
    if (m.reuseAgentId !== undefined && (typeof m.reuseAgentId !== 'string' || m.reuseAgentId === '')) return { ok: false, error: 'member-reuse-invalid' };
    if (m.label !== undefined && typeof m.label !== 'string') return { ok: false, error: 'member-label-invalid' };
    if (m.color !== undefined && typeof m.color !== 'string') return { ok: false, error: 'member-color-invalid' };
    if (m.config !== undefined && (!m.config || typeof m.config !== 'object' || Array.isArray(m.config))) return { ok: false, error: 'member-config-invalid' };
    members.push({
      ref: m.ref,
      ...(typeof m.label === 'string' ? { label: m.label } : {}),
      ...(typeof m.color === 'string' ? { color: m.color } : {}),
      ...(m.provider !== undefined ? { provider: m.provider } : {}),
      ...(m.config ? { config: m.config as Record<string, unknown> } : {}),
      ...(typeof m.reuseAgentId === 'string' ? { reuseAgentId: m.reuseAgentId } : {}),
    });
  }
  const edges: FormationEdgeInput[] = [];
  for (const raw of edgesRaw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'edge-not-object' };
    const e = raw as Record<string, unknown>;
    if (typeof e.from !== 'string' || typeof e.to !== 'string' || e.from === '' || e.to === '') return { ok: false, error: 'edge-endpoint-invalid' };
    edges.push(e as FormationEdgeInput);
  }
  return { ok: true, value: { plan: b.plan as Record<string, unknown>, members, edges } };
}

function errorOf(json: unknown, fallback: string): string {
  if (json && typeof json === 'object' && typeof (json as Record<string, unknown>).error === 'string') return (json as Record<string, string>).error!;
  return fallback;
}

/** 차례대로 ①~④ 를 부른다. 이름표는 앞 단계가 받은 id 로 푼다 — 모르는 이름표는 그대로 실패(지어내지 않는다). */
export async function runOrchestraFormation(
  body: FormationBody,
  ctx: { runId: string; projectName: string | null; centerX: number; centerY: number; radius: number; call: FormationCall },
): Promise<FormationResult> {
  const agentIds: Record<string, string> = {};
  const steps: FormationStep[] = [];
  const fail = (status: number, error: string): FormationResult => ({ ok: false, status: status >= 400 ? status : 502, error, agentIds, steps });
  const resolve = (refOrId: unknown): string | null => {
    if (typeof refOrId !== 'string' || refOrId === '') return null;
    if (refOrId.startsWith('@')) return agentIds[refOrId] ?? null;
    return refOrId;
  };

  const fresh = body.members.filter((m) => !m.reuseAgentId);
  let placed = 0;
  for (const m of body.members) {
    let id: string;
    if (m.reuseAgentId) {
      id = m.reuseAgentId;
    } else {
      const angle = (2 * Math.PI * placed) / Math.max(1, fresh.length);
      placed += 1;
      const createBody: Record<string, unknown> = {
        label: m.label ?? m.ref.slice(1),
        x: Math.round(ctx.centerX + ctx.radius * Math.cos(angle)),
        y: Math.round(ctx.centerY - ctx.radius * Math.sin(angle)),
        project: ctx.projectName,
        orchestraRunId: ctx.runId,
        ...(m.color ? { color: m.color } : {}),
        ...(m.provider !== undefined ? { provider: m.provider } : {}),
      };
      const r = await ctx.call('POST', '/api/create-custom-agent', createBody);
      const agent = (r.json as { agent?: { id?: unknown } } | null)?.agent;
      if (r.status >= 300 || typeof agent?.id !== 'string') {
        steps.push({ step: 'create', ref: m.ref, ok: false, status: r.status, error: errorOf(r.json, 'create-failed') });
        return fail(r.status, errorOf(r.json, 'create-failed'));
      }
      id = agent.id;
      steps.push({ step: 'create', ref: m.ref, ok: true, status: r.status, id });
    }
    agentIds[m.ref] = id;
    if (m.config) {
      const cur = await ctx.call('GET', `/api/agent-config/${encodeURIComponent(id)}`);
      const base = (cur.json as { config?: Record<string, unknown> } | null)?.config ?? {};
      const patch = Object.fromEntries(Object.entries(m.config).filter(([k]) => !PERMISSION_FIELDS.has(k)));
      // 일부 칸만 보내면 나머지가 지워진다(§5.3 #12-1 부분 페이로드) — 읽고 합쳐 통째로 보낸다.
      const r = await ctx.call('PUT', `/api/agent-config/${encodeURIComponent(id)}`, { ...base, ...patch });
      const ok = r.status < 300;
      steps.push({ step: 'config', ref: m.ref, ok, status: r.status, id, ...(ok ? {} : { error: errorOf(r.json, 'config-failed') }) });
      if (!ok) return fail(r.status, errorOf(r.json, 'config-failed'));
    }
  }

  for (const e of body.edges) {
    const source = resolve(e.from);
    const target = resolve(e.to);
    if (!source || !target) {
      steps.push({ step: 'edge', ok: false, status: 400, error: 'edge-ref-unknown' });
      return fail(400, 'edge-ref-unknown');
    }
    const { from: _from, to: _to, ...rest } = e;
    const r = await ctx.call('POST', '/api/task-edges', { ...rest, sourceAgentId: source, targetAgentId: target });
    const edgeId = (r.json as { data?: { id?: unknown } } | null)?.data?.id;
    const ok = r.status < 300 && typeof edgeId === 'string';
    steps.push({ step: 'edge', ok, status: r.status, ...(typeof edgeId === 'string' ? { id: edgeId } : {}), ...(ok ? {} : { error: errorOf(r.json, 'edge-failed') }) });
    if (!ok) return fail(r.status, errorOf(r.json, 'edge-failed'));
  }

  const plan: Record<string, unknown> = { ...body.plan };
  for (const key of ['entryAgentId', 'reviewAgentId'] as const) {
    if (plan[key] === undefined) continue;
    const resolved = resolve(plan[key]);
    if (!resolved) {
      steps.push({ step: 'plan', ok: false, status: 400, error: `${key}-ref-unknown` });
      return fail(400, `${key}-ref-unknown`);
    }
    plan[key] = resolved;
  }
  const reused = body.members.filter((m) => m.reuseAgentId).map((m) => m.reuseAgentId as string);
  const declared = Array.isArray(plan.reusedAgentIds) ? (plan.reusedAgentIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  plan.reusedAgentIds = [...new Set([...declared.map((x) => resolve(x) ?? x), ...reused])];
  const r = await ctx.call('POST', `/api/orchestra/runs/${encodeURIComponent(ctx.runId)}/plan`, plan);
  const json = (r.json ?? {}) as { ok?: unknown; dispatchEdgeId?: unknown };
  const ok = r.status < 300 && json.ok === true;
  steps.push({ step: 'plan', ok, status: r.status, ...(ok ? {} : { error: errorOf(r.json, 'plan-failed') }) });
  if (!ok) return fail(r.status, errorOf(r.json, 'plan-failed'));
  return {
    ok: true,
    status: 200,
    agentIds,
    steps,
    ...(typeof json.dispatchEdgeId === 'string' ? { dispatchEdgeId: json.dispatchEdgeId } : {}),
  };
}
