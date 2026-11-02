import { describe, expect, it, vi } from 'vitest';
import type { LiveFollowUpDelivery, QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { buildBaseItems, dispatchedTurnAnchorsAsc, IncrementalStreamParser, sameStreamItem, turnOfEvent, type StreamCommand, type StreamPlan } from './streamItems.js';
import { applyStreamDensity } from './streamDensity.js';
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
import { applyMainDensity, buildEntries } from './IDEMainArea.js';

const base = (): QueuedCommand => ({
  id: 'base', text: 'Keep the original task unchanged', subAgentId: 'S', status: 'executing', timestamp: 1, startedAt: 2,
});
const follow = (liveDelivery?: LiveFollowUpDelivery): QueuedCommand => ({
  id: 'follow', text: 'One more requirement\nKeep this second line visible.', subAgentId: 'S',
  status: 'queued', timestamp: 20, dispatchMode: 'steer', attachments: ['C:/uploads/reference.png'], liveDelivery,
});
const sub: SubAgent = { id: 'S', sessionId: 'S', parentAgentId: 'P', label: 'Session', status: 'active', createdAt: 1, lastActivityAt: 30 };
const event: SubAgentStreamEvent = { id: 'reply', eventType: 'text', content: 'Still working on the same task', subAgentId: 'S', parentAgentId: 'P', timestamp: 30 };
const formatError = (): string => 'Error';
function accepted(): QueuedCommand {
  const input = follow();
  return { ...base(), followUps: [{ id: input.id, text: input.text, timestamp: input.timestamp, deliveredAt: 25, attachments: input.attachments }] };
}
function followItem(commands: QueuedCommand[]): StreamCommand {
  const item = buildBaseItems([event], commands).items.find((candidate) => candidate.id === 'cmd-follow');
  expect(item?.kind).toBe('command');
  return item as StreamCommand;
}

describe('live follow-up transcript projection', () => {
  it('keeps the same message identity, input time, text and attachments from waiting through delivery', () => {
    const waiting = followItem([base(), follow()]);
    const sending = followItem([base(), follow({ state: 'sending' })]);
    const delivered = followItem([accepted()]);
    for (const item of [waiting, sending, delivered]) {
      expect(item).toMatchObject({
        kind: 'command', id: 'cmd-follow', prompt: follow().text,
        timestamp: 20, submittedAt: 20, attachments: follow().attachments, isFollowUp: true,
      });
    }
    expect(waiting.liveDelivery?.state).toBe('waiting');
    expect(sending.liveDelivery?.state).toBe('sending');
    expect(delivered.liveDelivery?.state).toBe('delivered');
    expect(delivered.commandId).toBeUndefined();
    expect(sameStreamItem(waiting, sending)).toBe(false);
    expect(sameStreamItem(sending, delivered)).toBe(false);
    const originals = buildBaseItems([event], [accepted()]).items.filter((item) => item.kind === 'command');
    expect(originals).toHaveLength(2);
    expect(originals.find((item) => item.id === 'cmd-base')).toMatchObject({ prompt: base().text });
  });

  it.each(['sending', 'unavailable', 'uncertain'] as const)('preserves %s state and its reason in both transcript views', (state) => {
    const commands = [base(), follow({ state, reason: state === 'unavailable' ? 'unsupported' : 'deliveryUnknown' })];
    const item = followItem(commands);
    for (const selected of [null, 'S']) {
      const entries = buildEntries(commands, [sub], { S: [event] }, selected, [], formatError);
      const entry = entries.find((candidate) => candidate.id === item.id);
      expect(entry).toMatchObject({ text: item.prompt, timestamp: 20, submittedAt: 20, attachments: item.attachments, isFollowUp: true });
      expect(entry?.command?.liveDelivery).toEqual(item.liveDelivery);
    }
  });

  it('restores delivered messages independently in both main view scopes', () => {
    for (const selected of [null, 'S']) {
      const entries = buildEntries([accepted()], [sub], { S: [event] }, selected, [], formatError);
      expect(entries.find((entry) => entry.id === 'cmd-base')?.text).toBe(base().text);
      expect(entries.find((entry) => entry.id === 'cmd-follow')).toMatchObject({
        text: follow().text, timestamp: 20, submittedAt: 20, attachments: follow().attachments,
        command: { status: 'completed', dispatchMode: 'steer', liveDelivery: { state: 'delivered' } },
      });
      expect(entries.filter((entry) => entry.id === 'cmd-follow')).toHaveLength(1);
    }
  });

  it('never treats a live follow-up as a new turn, before or after acknowledgement', () => {
    for (const commands of [[base(), follow()], [accepted()]]) {
      const anchors = dispatchedTurnAnchorsAsc(commands);
      expect(anchors).toEqual([{ id: 'base', ts: 2 }]);
      expect(turnOfEvent(event, anchors)).toBe('base');
    }
  });

  it('keeps incremental parsing equivalent across delivery transitions and restored history', () => {
    const parser = new IncrementalStreamParser();
    const events = [event];
    for (const commands of [[base(), follow()], [base(), follow({ state: 'sending' })], [accepted()], [{ ...accepted(), status: 'completed' as const }]]) {
      expect(parser.sync(events, commands)).toEqual(buildBaseItems(events, commands));
    }
  });

  it('places the message between assistant paragraphs while keeping both paragraphs in the original turn', () => {
    const events = [{ ...event, id: 'before', timestamp: 10, content: 'Before the message.' }, event];
    const parser = new IncrementalStreamParser();
    expect(parser.sync(events, [base()]).items.filter((item) => item.kind === 'text')).toHaveLength(1);
    for (const commands of [[base(), follow({ state: 'sending' })], [accepted()]]) {
      const result = parser.sync(events, commands);
      expect(result).toEqual(buildBaseItems(events, commands));
      expect(result.items.filter((item) => item.kind === 'text').map((item) => item.content)).toEqual(['Before the message.', event.content]);
      const anchors = dispatchedTurnAnchorsAsc(commands);
      expect(events.map((entry) => turnOfEvent(entry, anchors))).toEqual(['base', 'base']);
    }
  });

  it('keeps follow-up bubbles visible in every density without resetting plan history', () => {
    const followUp = followItem([accepted()]);
    const oldPlan: StreamPlan = { kind: 'plan', id: 'old', todos: [{ content: 'Old plan', status: 'pending' }], timestamp: 10 };
    const newPlan: StreamPlan = { kind: 'plan', id: 'new', todos: [{ content: 'Updated plan', status: 'in_progress' }], timestamp: 30 };
    const mainFollow = buildEntries([accepted()], [sub], {}, 'S', [], formatError).find((entry) => entry.id === 'cmd-follow')!;
    for (const density of ['compact', 'standard', 'raw'] as const) {
      const items = applyStreamDensity([oldPlan, followUp, newPlan], density);
      const mainItems = applyMainDensity([oldPlan, mainFollow, newPlan], density);
      expect(items.find((item) => item.id === 'cmd-follow')).toBe(followUp);
      expect(mainItems.find((item) => item.id === 'cmd-follow')).toBe(mainFollow);
      if (density !== 'raw') {
        expect(items.find((item) => item.id === 'old')).toMatchObject({ superseded: true });
        expect(mainItems.find((item) => item.id === 'old')).toMatchObject({ superseded: true });
      }
    }
  });
});
