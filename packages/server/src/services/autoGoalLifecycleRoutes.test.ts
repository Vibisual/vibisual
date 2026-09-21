import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, type AutoGoalSettings, type AutoGoalState, type AutoGoalSkillSummary } from '@vibisual/shared';
import type { AutoGoalAssessment } from './autoGoalLifecycle.js';
import { mountAutoGoalLifecycleRoutes } from './autoGoalLifecycleRoutes.js';
import { dropAutoGoalCache } from './autoGoalService.js';
import { issueAutoGoalCapability } from './autoGoalActorAuth.js';

let root: string;
let server: Server;
let base: string;
let settings: AutoGoalSettings;
let broadcasts: number;
const actor = { agentId: 'a', subAgentId: 's', procedureToken: '' };
interface TestReply { state: AutoGoalState; skill: AutoGoalSkillSummary; assessment: AutoGoalAssessment; idempotent?: boolean }

async function post(route: string, body: unknown, loopback = true) {
  const response = await fetch(`${base}/api/auto-goal/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(loopback ? { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as TestReply };
}
async function current() {
  const skill = (await post('context', actor)).data.state.skills[0];
  if (!skill) throw new Error('Fixture procedure was not returned');
  return skill;
}
async function approve() {
  const skill = await current();
  return post('review', { ...actor, skillId: 'fixture', revision: skill.revision, decision: 'approve',
    reason: 'Checked the transformation against the current source and verified its output.',
    applicability: 'Generate the fixture output for the same source contents.', files: ['source.txt'] });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-procedure-http-'));
  actor.procedureToken = issueAutoGoalCapability(root, actor);
  fs.mkdirSync(path.join(root, '.vibisual/skills/fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, '.vibisual/skills/fixture/SKILL.md'), [
    '---', 'name: Fixture generation', 'description: Generate fixture output from source.', 'id: fixture',
    'source: auto-goal', 'status: candidate', 'runs: 3', 'steps: 2', '---', '# Fixture\nRead source and generate output.\n',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'source.txt'), 'current input');
  settings = { enabledProject: true };
  broadcasts = 0;
  const app = express();
  app.use(express.json());
  mountAutoGoalLifecycleRoutes(app, {
    resolveRoot: (p) => p === root ? root : null,
    rootForAgent: (id) => id === 'a' || id === 'b' ? root : null,
    ownsSession: (id, sub) => (id === 'a' && sub === 's') || (id === 'b' && sub === 't'),
    settings: () => settings, material: () => ({}), changed: () => { broadcasts += 1; },
  });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test listener unavailable');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  dropAutoGoalCache(root);
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vib-procedure-http-')) throw new Error('Unsafe test cleanup');
  fs.rmSync(resolved, { recursive: true, force: true });
});

describe('agent procedure review and reuse HTTP flow', () => {
  it('reviews, records a completed result, skips the same unchanged task, and counts each report once', async () => {
    expect((await current()).status).toBe('candidate');
    expect((await approve()).status).toBe(200);
    const request = { ...actor, skillId: 'fixture', taskKey: 'fixture-v1', inputFiles: ['source.txt'] };
    const run = (await post('assess', request)).data.assessment;
    expect(run.decision).toBe('run');
    fs.writeFileSync(path.join(root, 'output.txt'), 'verified output');
    const completion = { ...actor, skillId: 'fixture', assessmentId: run.assessmentId, outcome: 'completed',
      evidence: 'Compared the generated contents with expected output.', outputFiles: ['output.txt'] };
    expect((await post('outcome', completion)).data.skill.reuseCount).toBe(1);
    expect((await post('outcome', completion)).data.idempotent).toBe(true);
    const skip = (await post('assess', request)).data.assessment;
    expect(skip.decision).toBe('skip');
    const receipt = await post('outcome', { ...actor, skillId: 'fixture', assessmentId: skip.assessmentId,
      outcome: 'skipped', evidence: 'Reused the server-verified unchanged result.' });
    expect(receipt.data.skill.skipCount).toBe(1);
    expect((await current()).reuseCount).toBe(1);
    expect(broadcasts).toBeGreaterThan(0);
    fs.writeFileSync(path.join(root, 'output.txt'), 'changed output');
    expect((await post('assess', request)).data.assessment.decision).toBe('run');
    fs.writeFileSync(path.join(root, 'source.txt'), 'new input');
    expect((await post('assess', request)).data.assessment.decision).toBe('review');
  });

  it('enforces project, actor, session and enablement boundaries', async () => {
    expect((await post('context', { ...actor, agentId: 'other' })).status).toBe(403);
    expect((await post('context', { ...actor, subAgentId: 'other' })).status).toBe(403);
    expect((await post('context', { ...actor, projectPath: 'another-project' })).status).toBe(403);
    settings = { enabledProject: true, enabledSessions: { s: false } };
    expect((await post('context', actor)).status).toBe(403);
    settings = { enabledAgents: { a: true } };
    expect((await post('context', actor)).status).toBe(200);
  });

  it('rejects a different valid actor even when the caller knows both session ids', async () => {
    const other = { agentId: 'b', subAgentId: 't' };
    expect((await post('context', { ...actor, ...other })).status).toBe(403);
    expect((await post('context', { ...actor, procedureToken: undefined })).status).toBe(403);
    expect((await post('context', { ...actor, procedureToken: '0'.repeat(64) })).status).toBe(403);
    expect((await post('context', { ...other, procedureToken: issueAutoGoalCapability(root, other) })).status).toBe(200);
  });

  it('rejects stale review writes and lets only the UI request review or pause', async () => {
    const old = await current();
    expect((await approve()).status).toBe(200);
    expect((await post('review', { ...actor, skillId: 'fixture', revision: old.revision, decision: 'retire', reason: 'Old request' })).status).toBe(409);
    const active = await current();
    const body = { projectPath: root, revision: active.revision };
    expect((await post('skills/fixture/retire', body)).status).toBe(403);
    expect((await post('skills/fixture/retire', body, false)).data.skill.status).toBe('retired');
    const paused = await current();
    expect((await post('assess', { ...actor, skillId: 'fixture', taskKey: 'x', inputFiles: ['source.txt'] })).data.assessment.decision).toBe('blocked');
    expect((await post('skills/fixture/request-review', { projectPath: root, revision: paused.revision }, false)).data.skill.status).toBe('needs-review');
  });

  it('fails closed on malformed reviews and unsafe evidence instead of activating a candidate', async () => {
    const skill = await current();
    expect((await post('review', { ...actor, skillId: 'fixture', revision: skill.revision, decision: 'approve', reason: 'Reviewed' })).status).toBe(400);
    expect((await post('review', { ...actor, skillId: 'fixture', revision: skill.revision, decision: 'approve', reason: 'Reviewed',
      applicability: 'Current task', files: ['../source.txt'] })).status).toBe(400);
    expect((await current()).status).toBe('candidate');
  });
});
