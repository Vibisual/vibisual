import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUTO_GOAL_ASSESSMENT_TTL_MS, AUTO_GOAL_EVIDENCE_FILE_BYTES, type AutoGoalCandidate } from '@vibisual/shared';
import {
  assessAutoGoalSkill, recordAutoGoalOutcome, reviewAutoGoalSkill, requestAutoGoalReview,
  autoGoalRevision, AutoGoalLifecycleError, dropAutoGoalAssessments,
} from './autoGoalLifecycle.js';
import {
  writeAutoGoalSkill, listAutoGoalSkills, deleteAutoGoalSkill, readAutoGoalSkillBody,
  buildAutoGoalPromptBlock, getAutoGoalSummary, autoGoalSkillRelevant,
} from './autoGoalService.js';

let root: string;
const actor = { agentId: 'agent-a', subAgentId: 'session-a' };
const ON = { enabledProject: true };
const candidate: AutoGoalCandidate = {
  id: 'command:review-test', title: 'Compile graph renderer', steps: ['pnpm build', 'pnpm test'],
  runs: 3, lastSeenAt: 1_700_000_000_000, source: 'command', files: ['procedure.ts'],
};
function write(relative: string, text: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
}
function current(id: string) { return listAutoGoalSkills(root).find((s) => s.id === id)!; }
function create(title = candidate.title) { return writeAutoGoalSkill(root, { ...candidate, title, id: `${candidate.id}-${title.length}` })!; }
function approve(id: string) {
  return reviewAutoGoalSkill(root, { skillId: id, revision: current(id).revision!, decision: 'approve',
    reason: 'Read the current procedure implementation and verified its applicability.',
    applicability: 'Compile graph renderer outputs after input data changes.', files: ['procedure.ts'] }, actor);
}
function assess(id: string, taskKey = 'build-graph') {
  return assessAutoGoalSkill(root, { skillId: id, taskKey, inputFiles: ['input.txt'] }, actor);
}
function complete(id: string) {
  const assessment = assess(id);
  return { assessment, result: recordAutoGoalOutcome(root, { skillId: id, assessmentId: assessment.assessmentId!,
    outcome: 'completed', outputFiles: ['output.txt'], evidence: 'Build succeeded; output matches expected graph.' }, actor) };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-procedure-lifecycle-'));
  write('procedure.ts', 'export const version = 1;');
  write('input.txt', 'graph input'); write('output.txt', 'graph output');
});
afterEach(() => {
  vi.useRealTimers(); dropAutoGoalAssessments(root);
  // Only the explicitly created fixture root is removed.
  if (!path.basename(root).startsWith('vib-procedure-lifecycle-') || path.dirname(root) !== os.tmpdir()) throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});

describe('reviewed procedure lifecycle', () => {
  it('keeps newly observed and legacy verified procedures out of active execution until reviewed', () => {
    const skill = create();
    expect(skill.status).toBe('candidate');
    expect(assess(skill.id).decision).toBe('review');
    write('.vibisual/brain/skills/legacy/SKILL.md', '---\nname: Legacy graph\ndescription: graph renderer\nid: legacy\nstatus: active\nverifyState: verified\n---\nOld instructions');
    expect(current('legacy').status).toBe('needs-review');
    expect(current('legacy').path).toBe('.vibisual/brain/skills/legacy/SKILL.md');
    const prompt = buildAutoGoalPromptBlock(root, ON, {}, 'graph renderer');
    expect(prompt).toContain('.vibisual/brain/skills/legacy/SKILL.md');
    expect(prompt).toContain('검토 대기 — 실행 지침이 아님');
    expect(prompt).not.toContain('그대로 따르라');
    expect(prompt).toContain(`revision=${skill.revision}`);
  });

  it('requires current revision, reason, applicability and project file evidence', () => {
    const skill = create();
    const input = { skillId: skill.id, revision: skill.revision!, decision: 'approve' as const, reason: 'Read implementation', applicability: 'When building graph', files: ['procedure.ts'] };
    expect(() => reviewAutoGoalSkill(root, { ...input, reason: '' }, actor)).toThrow();
    expect(() => reviewAutoGoalSkill(root, { ...input, applicability: '' }, actor)).toThrow();
    expect(() => reviewAutoGoalSkill(root, { ...input, files: [] }, actor)).toThrow();
    expect(() => reviewAutoGoalSkill(root, { ...input, revision: 'old' }, actor)).toThrow(/changed/);
    expect(() => reviewAutoGoalSkill(root, { ...input, files: ['missing.ts'] }, actor)).toThrow();
    expect(approve(skill.id).status).toBe('active');
    expect(current(skill.id).revisionCount).toBe(1);
  });

  it('invalidates reviewed instructions edited by hand and preserves the edit during observation', () => {
    const skill = create(); approve(skill.id);
    const file = path.join(root, current(skill.id).path!);
    fs.appendFileSync(file, '\nManual correction survives.');
    const changed = current(skill.id);
    expect(changed.status).toBe('needs-review');
    expect(changed.reason).toContain('instructions changed');
    writeAutoGoalSkill(root, { ...candidate, runs: 9 }, changed);
    expect(fs.readFileSync(file, 'utf8')).toContain('Manual correction survives.');
    expect(current(skill.id).runs).toBe(9);
    expect(current(skill.id).status).toBe('needs-review');
  });

  it('invalidates same-size changed dependencies and persists the reason', () => {
    const skill = create(); approve(skill.id);
    expect(current(skill.id).status).toBe('active'); // populate summary hash cache
    write('procedure.ts', 'export const version = 2;');
    const changed = current(skill.id);
    expect(changed.status).toBe('needs-review');
    expect(changed.reason).toContain('dependency changed');
    expect(fs.readFileSync(path.join(root, changed.path!), 'utf8')).toContain('"status":"needs-review"');
    expect(assess(skill.id).decision).toBe('review');
  });

  it('does not replace an original whose manually edited frontmatter is temporarily invalid', () => {
    const skill = create();
    const file = path.join(root, skill.path!);
    const editing = fs.readFileSync(file, 'utf8').replace(/^name: .*$/m, 'name: ');
    fs.writeFileSync(file, editing);
    expect(writeAutoGoalSkill(root, { ...candidate, runs: 8 }, skill)).toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe(editing);
  });

  it('preserves old source in markdown history on revision and retirement', () => {
    const skill = create(); const approved = approve(skill.id);
    const oldText = fs.readFileSync(path.join(root, approved.path!), 'utf8');
    const revised = reviewAutoGoalSkill(root, { skillId: skill.id, revision: approved.revision!, decision: 'revise',
      reason: 'Use current compiler command.', applicability: 'Build graph renderer', files: ['procedure.ts'], body: 'Use pnpm build:graph.' }, actor);
    expect(revised.revisionCount).toBe(2);
    expect(readAutoGoalSkillBody(root, skill.id)).toBe('Use pnpm build:graph.');
    const history = path.join(root, path.dirname(revised.path!), 'revisions');
    expect(fs.readdirSync(history).some((f) => fs.readFileSync(path.join(history, f), 'utf8') === oldText)).toBe(true);
    const retired = reviewAutoGoalSkill(root, { skillId: skill.id, revision: revised.revision!, decision: 'retire', reason: 'This build system was removed.' }, actor);
    expect(retired.status).toBe('retired');
    expect(assess(skill.id).decision).toBe('blocked');
    expect(writeAutoGoalSkill(root, { ...candidate, runs: 99 }, retired)?.status).toBe('retired');
    expect(buildAutoGoalPromptBlock(root, ON, {}, 'graph')).toBeUndefined();
    expect(requestAutoGoalReview(root, { skillId: skill.id, revision: retired.revision!, reason: 'Reconsider with current implementation.' }, actor).status).toBe('needs-review');
  });

  it('requires an active different replacement before superseding', () => {
    const skill = create(); const replacement = create('Current graph compiler');
    approve(skill.id);
    const input = { skillId: skill.id, revision: current(skill.id).revision!, decision: 'supersede' as const, reason: 'Replaced compiler', supersededBy: replacement.id };
    expect(() => reviewAutoGoalSkill(root, input, actor)).toThrow(/active|approved/);
    approve(replacement.id);
    const superseded = reviewAutoGoalSkill(root, input, actor);
    expect(superseded.status).toBe('superseded');
    expect(superseded.supersededBy).toBe(replacement.id);
    expect(assess(skill.id).decision).toBe('blocked');
  });

  it('honors a manual non-active status without allowing a manual active marker to bypass review', () => {
    const skill = create(); approve(skill.id); complete(skill.id);
    const file = path.join(root, current(skill.id).path!);
    for (const status of ['retired', 'superseded', 'candidate', 'needs-review']) {
      const text = fs.readFileSync(file, 'utf8').replace(/^status: .*$/m, `status: ${status}`);
      fs.writeFileSync(file, text);
      expect(current(skill.id).status).toBe(status);
      expect(assess(skill.id).decision).toBe(status === 'retired' || status === 'superseded' ? 'blocked' : 'review');
    }
    // The observed manual close is persisted; changing only its marker cannot reopen it.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status: .*$/m, 'status: active'));
    expect(current(skill.id).status).toBe('needs-review');
  });

  it('requires a new review if applicability changes or its approved snapshot is missing', () => {
    const skill = create(); approve(skill.id); complete(skill.id);
    const file = path.join(root, current(skill.id).path!);
    const editLifecycle = (mutate: (value: Record<string, unknown>) => void) => {
      const text = fs.readFileSync(file, 'utf8').replace(/^autoGoalLifecycle: (.+)$/m, (_, json: string) => {
        const value = JSON.parse(json) as Record<string, unknown>; mutate(value);
        return `autoGoalLifecycle: ${JSON.stringify(value)}`;
      });
      fs.writeFileSync(file, text);
    };
    editLifecycle((value) => { value.applicability = 'Deploy production database schema changes.'; });
    expect(current(skill.id).status).toBe('needs-review');
    expect(current(skill.id).reason).toContain('applicability changed');
    expect(assess(skill.id).decision).toBe('review');
    approve(skill.id);
    editLifecycle((value) => { delete (value.review as Record<string, unknown>).applicability; });
    expect(current(skill.id).status).toBe('needs-review');
    expect(assess(skill.id).decision).toBe('review');
  });
});

describe('confirmed completion reuse', () => {
  it('skips only unchanged task/procedure/input/output evidence and counts outcomes once', () => {
    const skill = create(); approve(skill.id);
    const first = complete(skill.id);
    expect(first.assessment.decision).toBe('run');
    expect(first.result.skill.reuseCount).toBe(1);
    const replay = recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: first.assessment.assessmentId!,
      outcome: 'completed', outputFiles: ['output.txt'], evidence: 'Build succeeded; output matches expected graph.' }, actor);
    expect(replay.idempotent).toBe(true);
    expect(current(skill.id).reuseCount).toBe(1);
    const next = assess(skill.id);
    expect(next.decision).toBe('skip');
    recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: next.assessmentId!, outcome: 'skipped', evidence: 'Reused unchanged graph artifact.' }, actor);
    expect(current(skill.id).skipCount).toBe(1);
    expect(assess(skill.id, 'different-task').decision).toBe('run');
    write('output.txt', 'different result');
    expect(assess(skill.id).decision).toBe('run');
    write('output.txt', 'graph output'); write('input.txt', 'new input');
    expect(assess(skill.id).decision).toBe('run');
  });

  it('fails closed on changed inputs and output tampering between assessment and outcome', () => {
    const skill = create(); approve(skill.id);
    const run = assess(skill.id);
    write('input.txt', 'changed mid-run');
    expect(() => recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: run.assessmentId!, outcome: 'completed', outputFiles: ['output.txt'], evidence: 'Done' }, actor)).toThrow(/Input files changed/);
    write('input.txt', 'graph input'); complete(skill.id);
    const skip = assess(skill.id);
    write('output.txt', 'tampered');
    expect(() => recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: skip.assessmentId!, outcome: 'skipped', evidence: 'Skip' }, actor)).toThrow(/unchanged confirmed outputs/);
    expect(current(skill.id).skipCount).toBe(0);
  });

  it('binds one-use tokens to actor/root/skill/revision and rejects missing output proof', () => {
    const skill = create(); approve(skill.id);
    const run = assess(skill.id);
    const outcome = { skillId: skill.id, assessmentId: run.assessmentId!, outcome: 'completed' as const, evidence: 'Done', outputFiles: ['output.txt'] };
    expect(() => recordAutoGoalOutcome(root, outcome, { ...actor, subAgentId: 'other-session' })).toThrow(/another/);
    expect(() => recordAutoGoalOutcome(root, { ...outcome, skillId: 'other-skill' }, actor)).toThrow(/another/);
    expect(() => recordAutoGoalOutcome(root, { ...outcome, outputFiles: [] }, actor)).toThrow(/Supply/);
    recordAutoGoalOutcome(root, outcome, actor);
    expect(() => recordAutoGoalOutcome(root, { ...outcome, evidence: 'Different story' }, actor)).toThrow(/already/);
    const stale = assess(skill.id, 'new-task');
    const file = path.join(root, current(skill.id).path!); fs.appendFileSync(file, '\nChanged');
    expect(() => recordAutoGoalOutcome(root, { ...outcome, assessmentId: stale.assessmentId! }, actor)).toThrow(/changed/);
  });

  it('expires tokens and makes reported failure require review', () => {
    const skill = create(); approve(skill.id);
    const expired = assess(skill.id);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + AUTO_GOAL_ASSESSMENT_TTL_MS + 1);
    expect(() => recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: expired.assessmentId!, outcome: 'failed', evidence: 'Failure' }, actor)).toThrow(/expired/);
    vi.useRealTimers();
    const run = assess(skill.id);
    // A failure can also change an implementation dependency; it must still be recorded.
    write('procedure.ts', 'broken implementation');
    const failed = recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: run.assessmentId!, outcome: 'failed', evidence: 'Compiler failed with invalid configuration.' }, actor);
    expect(failed.skill.status).toBe('needs-review');
    expect(failed.skill.failureCount).toBe(1);
  });

  it('clears old completion records on re-review', () => {
    const skill = create(); approve(skill.id); complete(skill.id);
    expect(assess(skill.id).decision).toBe('skip');
    approve(skill.id);
    expect(assess(skill.id).decision).toBe('run');
  });

  it('allows observation-only metadata changes during execution but rejects a different review', () => {
    const skill = create(); approve(skill.id);
    const run = assess(skill.id);
    writeAutoGoalSkill(root, { ...candidate, runs: 6 }, current(skill.id));
    expect(recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: run.assessmentId!, outcome: 'completed',
      outputFiles: ['output.txt'], evidence: 'Build completed while observations increased.' }, actor).skill.reuseCount).toBe(1);
    const other = assess(skill.id, 'other-task');
    approve(skill.id);
    expect(() => recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: other.assessmentId!, outcome: 'completed',
      outputFiles: ['output.txt'], evidence: 'An older assessment cannot use a new review.' }, actor)).toThrow(/review changed/);
  });

  it('reloads disk completion evidence after restart without resurrecting tokens or retired procedures', async () => {
    const skill = create(); approve(skill.id); complete(skill.id);
    const oldToken = assess(skill.id);
    expect(oldToken.decision).toBe('skip');
    vi.resetModules();
    const restarted = await import('./autoGoalLifecycle.js');
    expect(() => restarted.recordAutoGoalOutcome(root, { skillId: skill.id, assessmentId: oldToken.assessmentId!,
      outcome: 'skipped', evidence: 'An old process token must not survive.' }, actor)).toThrow(/expired/);
    const next = restarted.assessAutoGoalSkill(root, { skillId: skill.id, taskKey: 'build-graph', inputFiles: ['input.txt'] }, actor);
    expect(next.decision).toBe('skip');
    restarted.reviewAutoGoalSkill(root, { skillId: skill.id, revision: next.revision, decision: 'retire', reason: 'No longer used.' }, actor);
    vi.resetModules();
    const again = await import('./autoGoalLifecycle.js');
    expect(again.assessAutoGoalSkill(root, { skillId: skill.id, taskKey: 'build-graph', inputFiles: ['input.txt'] }, actor).decision).toBe('blocked');
    again.dropAutoGoalAssessments(root);
    restarted.dropAutoGoalAssessments(root);
  });
});

describe('storage and cost boundaries', () => {
  it('blocks traversal, symlink evidence and excessive evidence files', () => {
    const skill = create();
    expect(() => readAutoGoalSkillBody(root, '../outside')).toThrow(AutoGoalLifecycleError);
    expect(() => deleteAutoGoalSkill(root, '..')).toThrow(AutoGoalLifecycleError);
    const input = { skillId: skill.id, revision: skill.revision!, decision: 'approve' as const, reason: 'Reviewed', applicability: 'Build', files: ['../outside'] };
    expect(() => reviewAutoGoalSkill(root, input, actor)).toThrow(/Traversal/);
    fs.symlinkSync(root, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => reviewAutoGoalSkill(root, { ...input, files: ['linked/procedure.ts'] }, actor)).toThrow(/Symlink/);
    fs.writeFileSync(path.join(root, 'large.txt'), Buffer.alloc(AUTO_GOAL_EVIDENCE_FILE_BYTES + 1));
    expect(() => reviewAutoGoalSkill(root, { ...input, files: ['large.txt'] }, actor)).toThrow(/size limit/);
    expect(() => reviewAutoGoalSkill(root, { ...input, files: Array.from({ length: 17 }, () => 'procedure.ts') }, actor)).toThrow(/Supply/);
  });

  it('deletes both modern and legacy copies without reviving the older procedure', () => {
    const skill = create();
    const text = fs.readFileSync(path.join(root, skill.path!), 'utf8');
    write(`.vibisual/brain/skills/${skill.id}/SKILL.md`, text);
    expect(deleteAutoGoalSkill(root, skill.id)).toBe(true);
    expect(listAutoGoalSkills(root)).toEqual([]);
  });

  it('keeps prompt work relevant and honors disabled injection', () => {
    const skill = create(); approve(skill.id);
    expect(buildAutoGoalPromptBlock(root, ON, {}, 'Compile graph renderer')).toContain('검토 통과');
    expect(buildAutoGoalPromptBlock(root, ON, {}, 'Check Windows microphone capture')).toBeUndefined();
    expect(buildAutoGoalPromptBlock(root, { enabledProject: false }, {}, 'Compile graph')).toBeUndefined();
    expect(autoGoalSkillRelevant({ ...skill, name: '플랫폼별 경로 처리', description: '운영체제 경로 오류' }, '플랫폼별로 경로를 고쳐줘')).toBe(true);
    expect(autoGoalSkillRelevant(skill, '작업 진행 확인')).toBe(false);
  });

  it('mines when only an agent is enabled and reports reviewed metrics separately', () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, command: i % 2 ? 'pnpm test' : 'pnpm build', status: 'success' as const, timestamp: 1700000000000 + i * 1000 }));
    const summary = getAutoGoalSummary(root, { enabledProject: false, enabledAgents: { a: true } }, { bashHistory: { a: history } });
    expect(summary?.enabled).toBe(false);
    expect(summary?.skillCount).toBeGreaterThan(0);
    expect(summary?.activeCount).toBe(0);
    expect(summary?.reviewCount).toBeGreaterThan(0);
    const skill = listAutoGoalSkills(root)[0]!;
    expect(skill.revision).toBe(autoGoalRevision(fs.readFileSync(path.join(root, skill.path!), 'utf8')));
  });
});
