import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, HookEventPayload, SubAgent } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { subAgentManager } from './subAgentManager.js';

let root: string;
let graph: ProjectGraph;
let seq = 0;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-presented-')));
  graph = new ProjectGraph();
  graph.registerProject(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function onDisk(rel: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
  return abs;
}

function tool(name: string, rel: string, session = 'native-session'): void {
  const payload: HookEventPayload = {
    session_id: session, cwd: root, hook_event_name: 'PostToolUse', tool_name: name,
    tool_use_id: `tool-${++seq}`, tool_input: { file_path: onDisk(rel) },
  };
  graph.processHookEvent(payload);
}

function files(): BubbleData[] {
  return [...new Map(Object.values(graph.getSnapshot().satellites).flat()
    .filter((node) => node.bubbleType === 'file').map((node) => [node.id, node])).values()];
}

function auditCount(): number {
  return graph.getAuditLog(path.basename(root))?.entries.length ?? 0;
}

describe('files a session presents in its conversation', () => {
  it('stands shown previews as the session read without inventing a tool call', () => {
    tool('Write', 'docs/notes.md');
    const before = auditCount();
    const sheet = onDisk('.vibisual/tmp/hand/texture-sheet.png');
    onDisk('docs/report.html');
    onDisk('docs/app.ts');

    const routed = graph.routePresentedFiles({ session_id: 'native-session' }, [
      sheet, 'docs/report.html', path.join(root, 'docs/missing.png'), path.join(root, 'docs/app.ts'),
    ]);

    expect(routed).toBe(2);
    const labels = files().map((node) => node.label);
    expect(labels).toEqual(expect.arrayContaining(['texture-sheet.png', 'report.html']));
    expect(labels).not.toContain('missing.png');
    expect(labels).not.toContain('app.ts');
    expect(files().find((node) => node.label === 'texture-sheet.png')?.lastTool).toBe('Read');
    expect(auditCount()).toBe(before);
    expect(graph.getAgentBySession('native-session')?.lastTool).toBe('Write');
  });

  it('keeps the write arrow of a result produced this turn and reads it again after the turn closes', () => {
    tool('Write', 'out/report.html');
    const agent = graph.getAgentBySession('native-session')!;
    const report = path.join(root, 'out/report.html');
    const edgeToOut = (): { source: string; target: string } | undefined => {
      const snapshot = graph.getSnapshot();
      const out = snapshot.topFolders.find((node) => node.label === 'out')!;
      return snapshot.edges.find((edge) => [edge.source, edge.target].includes(agent.id)
        && [edge.source, edge.target].includes(out.id));
    };

    expect(graph.routePresentedFiles({ session_id: 'native-session' }, [report])).toBe(0);
    expect(edgeToOut()?.source).toBe(agent.id);

    expect(graph.acknowledgeAgentTurn(agent.id)).toBe(true);
    expect(graph.routePresentedFiles({ session_id: 'native-session' }, [report])).toBe(1);
    expect(edgeToOut()?.target).toBe(agent.id);
  });

  it('records the presenting session as the preview owner', () => {
    const owner = graph.createCustomAgent('Presenter', undefined, path.basename(root));
    const session = graph.findSessionByAgentId(owner.id)!;
    const sub: SubAgent = {
      id: 'sub-alpha', sessionId: 'native-sub-alpha', label: 'alpha', parentAgentId: owner.id,
      status: 'idle', createdAt: Date.now(), lastActivityAt: Date.now(),
    };
    vi.spyOn(subAgentManager, 'getSub').mockImplementation((id) => (id === sub.id ? sub : undefined));
    vi.spyOn(subAgentManager, 'getAllSubsFlat').mockReturnValue([sub]);
    const sheet = onDisk('renders/sheet.png');

    expect(graph.routePresentedFiles({ session_id: session, _vibisualSubAgentId: sub.id }, [sheet])).toBe(1);
    expect(files().find((node) => node.label === 'sheet.png')?.previewSessionIds).toContain('sub-alpha');
  });

  it('does nothing for a session it does not hold', () => {
    const sheet = onDisk('renders/sheet.png');
    expect(graph.routePresentedFiles({ session_id: 'unknown-session' }, [sheet])).toBe(0);
    expect(files()).toEqual([]);
  });
});
