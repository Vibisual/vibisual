import { describe, expect, it, vi } from 'vitest';
import type { LiveFollowUpDelivery, QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import {
  buildBaseItems, commandAnchorTs, dispatchedTurnAnchorsAsc, followUpAnchorTs, IncrementalStreamParser, mergeCardsIntoItems,
  PENDING_COMMAND_TS, sameStreamItem, turnOfEvent, type StreamCommand, type StreamItemFull, type StreamPlan,
} from './streamItems.js';
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
function accepted(deliveredAt = 25): QueuedCommand {
  const input = follow();
  return { ...base(), followUps: [{ id: input.id, text: input.text, timestamp: input.timestamp, deliveredAt, attachments: input.attachments }] };
}
function followItem(commands: QueuedCommand[]): StreamCommand {
  const item = buildBaseItems([event], commands).items.find((candidate) => candidate.id === 'cmd-follow');
  expect(item?.kind).toBe('command');
  return item as StreamCommand;
}
const text = (id: string, timestamp: number, content = `${id}.`): SubAgentStreamEvent => ({
  id, eventType: 'text', content, subAgentId: 'S', parentAgentId: 'P', timestamp,
});
/** 화면에 서는 최종 순서(Sub 탭) — 대기 말풍선은 정렬 밖 꼬리로 붙는다. */
function subOrder(events: SubAgentStreamEvent[], commands: QueuedCommand[]): StreamItemFull[] {
  return mergeCardsIntoItems(buildBaseItems(events, commands), commands);
}
const labelOf = (item: { kind?: string; id: string; content?: string; text?: string }): string =>
  item.id.startsWith('cmd-') ? item.id : (item.content ?? item.text ?? item.id);

describe('live follow-up transcript projection', () => {
  it('keeps the same message identity, input time, text and attachments from waiting through delivery', () => {
    const waiting = followItem([base(), follow()]);
    const sending = followItem([base(), follow({ state: 'sending' })]);
    const delivered = followItem([accepted()]);
    for (const item of [waiting, sending, delivered]) {
      expect(item).toMatchObject({
        kind: 'command', id: 'cmd-follow', prompt: follow().text,
        submittedAt: 20, attachments: follow().attachments, isFollowUp: true,
      });
    }
    // §5.5 #17-18 ⑥-6 — 전달 전엔 꼬리, 엔진이 받은 순간 그 시각에 선다(보낸 시각 표기는 그대로 20).
    expect(waiting.timestamp).toBe(PENDING_COMMAND_TS);
    expect(sending.timestamp).toBe(PENDING_COMMAND_TS);
    expect(delivered.timestamp).toBe(25);
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
    // 확인 불가는 잠긴 채 큐에 남는다 — 정해진 시각이 없는 옛 기록만 투입 시각, 나머지는 꼬리.
    expect(item.timestamp).toBe(state === 'uncertain' ? 20 : PENDING_COMMAND_TS);
    for (const selected of [null, 'S']) {
      const entries = buildEntries(commands, [sub], { S: [event] }, selected, [], formatError);
      const entry = entries.find((candidate) => candidate.id === item.id);
      expect(entry).toMatchObject({ text: item.prompt, timestamp: item.timestamp, submittedAt: 20, attachments: item.attachments, isFollowUp: true });
      expect(entry?.command?.liveDelivery).toEqual(item.liveDelivery);
    }
  });

  it('restores delivered messages independently in both main view scopes', () => {
    for (const selected of [null, 'S']) {
      const entries = buildEntries([accepted()], [sub], { S: [event] }, selected, [], formatError);
      expect(entries.find((entry) => entry.id === 'cmd-base')?.text).toBe(base().text);
      expect(entries.find((entry) => entry.id === 'cmd-follow')).toMatchObject({
        text: follow().text, timestamp: 25, submittedAt: 20, attachments: follow().attachments,
        command: { status: 'completed', dispatchMode: 'steer', liveDelivery: { state: 'delivered' } },
      });
      expect(entries.filter((entry) => entry.id === 'cmd-follow')).toHaveLength(1);
    }
  });

  it('never treats a live follow-up as a new turn, before or after acknowledgement', () => {
    for (const commands of [[base(), follow()], [accepted()], [base(), follow({ state: 'uncertain', reason: 'deliveryUnknown', decidedAt: 26 })]]) {
      const anchors = dispatchedTurnAnchorsAsc(commands);
      expect(anchors).toEqual([{ id: 'base', ts: 2 }]);
      expect(turnOfEvent(event, anchors)).toBe('base');
    }
  });

  it('keeps incremental parsing equivalent across delivery transitions and restored history', () => {
    const parser = new IncrementalStreamParser();
    const events = [event];
    for (const commands of [
      [base(), { ...follow(), dispatchMode: 'wait' as const }],
      [base(), follow()],
      [base(), follow({ state: 'sending' })],
      [accepted()],
      [{ ...accepted(), status: 'completed' as const }],
      [base(), follow({ state: 'uncertain', reason: 'deliveryUnknown', decidedAt: 26 })],
    ]) {
      expect(parser.sync(events, commands)).toEqual(buildBaseItems(events, commands));
    }
  });

  it('keeps a waiting input out of the paragraph and splits the paragraph where the engine received it', () => {
    const events = [{ ...event, id: 'before', timestamp: 10, content: 'Before the message.' }, event];
    const parser = new IncrementalStreamParser();
    expect(parser.sync(events, [base()]).items.filter((item) => item.kind === 'text')).toHaveLength(1);
    // 보내는 중 — 아직 대화에 들어가지 않았다. 문단은 하나, 말풍선은 맨 끝.
    const sending = [base(), follow({ state: 'sending' })];
    const pending = parser.sync(events, sending);
    expect(pending).toEqual(buildBaseItems(events, sending));
    expect(pending.items.filter((item) => item.kind === 'text').map((item) => item.content)).toEqual([`Before the message.${event.content}`]);
    expect(subOrder(events, sending).map(labelOf).at(-1)).toBe('cmd-follow');
    // 받은 뒤 — 받은 시각(25)에서 문단이 갈리고 말풍선은 그 사이에 선다. 두 문단 모두 원래 턴의 것.
    const delivered = [accepted()];
    const result = parser.sync(events, delivered);
    expect(result).toEqual(buildBaseItems(events, delivered));
    expect(result.items.filter((item) => item.kind === 'text').map((item) => item.content)).toEqual(['Before the message.', event.content]);
    expect(subOrder(events, delivered).filter((item) => item.kind === 'command' || item.kind === 'text').map(labelOf))
      .toEqual(['cmd-base', 'Before the message.', 'cmd-follow', event.content]);
    const anchors = dispatchedTurnAnchorsAsc(delivered);
    expect(events.map((entry) => turnOfEvent(entry, anchors))).toEqual(['base', 'base']);
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

/**
 * §5.5 #17-18 ⑥-6 — 오래 기다린 [작업에 반영] 입력이 작업에 들어가는 순간 위로 튀던 회귀.
 * 투입(20) 뒤로 출력(40·60)이 쌓이는 동안 기다리다가 70 에 엔진이 받았다. 말풍선은 그 출력 위(20)가 아니라 아래(70)에 서야 한다.
 */
describe('a long-waiting live input lands at the bottom, not at its input time', () => {
  const during = [text('before', 10), { ...text('tool', 40), eventType: 'tool_use' as const, toolName: 'Bash', content: '{"command":"pnpm test"}' },
    { ...text('tool-done', 60), eventType: 'tool_result' as const, content: 'ok' }];
  const reply = text('reply', 80, 'Applied the extra requirement.');
  const events = [...during, reply];
  const queuedAsWait: QueuedCommand = { ...follow(), dispatchMode: 'wait' };

  it('stays at the tail while it waits, including right after switching a queued command to live delivery', () => {
    for (const commands of [[base(), queuedAsWait], [base(), follow()], [base(), follow({ state: 'sending' })]]) {
      const order = subOrder(during, commands).map(labelOf);
      expect(order.at(-1)).toBe('cmd-follow');
      const entries = buildEntries(commands, [sub], { S: during }, 'S', [], formatError);
      expect(entries.at(-1)?.id).toBe('cmd-follow');
      expect(commandAnchorTs(commands[1]!)).toBe(PENDING_COMMAND_TS);
    }
  });

  it('fixes the bubble where the engine received it, below everything it waited behind', () => {
    const delivered = [accepted(70)];
    const order = subOrder(events, delivered).map(labelOf);
    const at = order.indexOf('cmd-follow');
    expect(at).toBeGreaterThan(order.indexOf('before.'));
    for (const item of subOrder(events, delivered)) {
      if (item.kind === 'tool') expect(order.indexOf(labelOf(item))).toBeLessThan(at);
    }
    expect(order.indexOf('Applied the extra requirement.')).toBeGreaterThan(at);
    for (const selected of [null, 'S']) {
      const ids = buildEntries(delivered, [sub], { S: events }, selected, [], formatError).map((entry) => entry.id);
      const main = ids.indexOf('cmd-follow');
      expect(main).toBeGreaterThan(ids.indexOf('tool-done'));
      expect(main).toBeLessThan(ids.indexOf('reply'));
    }
  });

  it('locks an uncertain input where its delivery became unknown; old records keep their input time', () => {
    const decided = follow({ state: 'uncertain', reason: 'deliveryUnknown', decidedAt: 70 });
    expect(commandAnchorTs(decided)).toBe(70);
    const order = subOrder(events, [base(), decided]).map(labelOf);
    expect(order.indexOf('cmd-follow')).toBeGreaterThan(order.indexOf('before.'));
    expect(order.indexOf('cmd-follow')).toBeLessThan(order.indexOf('Applied the extra requirement.'));
    expect(commandAnchorTs(follow({ state: 'uncertain', reason: 'deliveryUnknown' }))).toBe(20);
  });

  it('never parks a sealed or archived input at the tail', () => {
    expect(commandAnchorTs({ ...follow(), status: 'completed', startedAt: 33 })).toBe(33);
    expect(commandAnchorTs({ ...follow(), status: 'completed' })).toBe(20);
  });

  it('falls back to the input time only when a delivered record lacks its receipt time', () => {
    const message = { id: 'm', text: 'x', timestamp: 20, deliveredAt: 70 };
    expect(followUpAnchorTs(message)).toBe(70);
    expect(followUpAnchorTs({ ...message, deliveredAt: undefined as unknown as number })).toBe(20);
  });
});
