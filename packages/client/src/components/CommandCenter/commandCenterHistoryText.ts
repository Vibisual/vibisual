import { displayCommands } from '@vibisual/shared';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import type { CommandCenterInput } from './commandCenterModel.js';

/** Search uses every conversation record, independently of the live-card lane rules. */
export function commandCenterHistoryText(
  input: CommandCenterInput,
  agentIds: ReadonlySet<string>,
): Map<string, string> {
  const parts = new Map<string, string[]>();
  const commandStarts = new Map<string, number[]>();
  const append = (agentId: string, subId: string | null | undefined, texts: string[]): void => {
    const keys = [`${agentId}::main`];
    if (subId) keys.push(`${agentId}::${subId}`);
    for (const key of keys) {
      const list = parts.get(key) ?? [];
      list.push(...texts);
      parts.set(key, list);
    }
  };
  for (const agentId of agentIds) {
    for (const cmd of [
      ...displayCommands(input.queuedCommands[agentId]),
      ...displayCommands(input.completedCommands[agentId]),
    ]) {
      append(agentId, cmd.subAgentId, [cmd.text, cmd.result ?? '']);
      if (cmd.subAgentId && (cmd.status !== 'queued' || cmd.startedAt !== undefined)) {
        const key = `${agentId}::${cmd.subAgentId}`;
        const starts = commandStarts.get(key) ?? [];
        starts.push(cmd.startedAt ?? cmd.timestamp);
        commandStarts.set(key, starts);
      }
    }
    for (const card of input.agentQuestions[agentId] ?? []) {
      append(agentId, card.subAgentId, [card.note ?? '', ...card.items.flatMap(
        (item) => [item.header ?? '', item.question, ...item.prompts],
      )]);
    }
    for (const card of input.agentReviews[agentId] ?? []) {
      append(agentId, card.subAgentId, [card.instruction ?? '', card.note ?? '', ...card.changes, ...card.checkpoints]);
    }
    for (const card of input.agentReports[agentId] ?? []) {
      append(agentId, card.subAgentId, [
        card.note ?? '', ...card.did, ...card.userActions, ...(card.nextSteps ?? []), ...(card.learned ?? []),
      ]);
    }
  }
  for (const events of Object.values(input.subAgentStreams ?? {})) {
    let previous: SubAgentStreamEvent | undefined;
    let chunks: string[] = [];
    const flush = (): void => {
      if (previous && chunks.length) append(previous.parentAgentId, previous.subAgentId, [chunks.join('')]);
      chunks = [];
    };
    for (const event of events) {
      if (!agentIds.has(event.parentAgentId)) { flush(); previous = undefined; continue; }
      if ((event.eventType !== 'text' && event.eventType !== 'result') || event.imagePath) {
        flush(); previous = undefined; continue;
      }
      if (previous && (previous.parentAgentId !== event.parentAgentId || previous.subAgentId !== event.subAgentId ||
        previous.turnId !== event.turnId || previous.nestedUnderToolUseId !== event.nestedUnderToolUseId ||
        previous.eventType !== 'text' || event.eventType !== 'text' ||
        (!previous.turnId && commandStarts.get(`${event.parentAgentId}::${event.subAgentId}`)?.some(
          (timestamp) => timestamp > previous!.timestamp && timestamp <= event.timestamp,
        )))) flush();
      chunks.push(event.content);
      previous = event;
    }
    flush();
  }
  return new Map([...parts].map(([key, texts]) => [key, texts.join('\n')]));
}
