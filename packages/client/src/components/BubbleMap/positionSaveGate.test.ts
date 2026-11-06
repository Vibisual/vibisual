import { describe, expect, it } from 'vitest';
import { PositionSaveGate } from './positionSaveGate.js';

describe('coordinate save acknowledgement', () => {
  it('sends first positions and changes, then suppresses identical successful saves', () => {
    const gate = new PositionSaveGate();
    const first = gate.begin('A')!;
    expect(first).not.toBeNull();
    expect(gate.begin('A')).toBeNull();
    gate.settle(first, true);
    expect(gate.begin('A')).toBeNull();
    expect(gate.needsUnloadFlush('A')).toBe(false);
    expect(gate.begin('B')).not.toBeNull();
  });

  it('retries network/HTTP failures without requiring another position change', () => {
    const gate = new PositionSaveGate();
    gate.settle(gate.begin('A')!, false);
    expect(gate.needsUnloadFlush('A')).toBe(true);
    expect(gate.begin('A')).not.toBeNull();
  });

  it('does not discard a return to saved coordinates while a different write is pending', () => {
    const gate = new PositionSaveGate();
    gate.settle(gate.begin('A')!, true);
    const move = gate.begin('B')!;
    const returnToA = gate.begin('A')!;
    expect(returnToA).not.toBeNull();
    gate.settle(returnToA, true);
    gate.settle(move, true);
    // The older reply arrived last: the next periodic flush repairs any stale write.
    expect(gate.begin('A')).not.toBeNull();
  });

  it('keeps the unload safety write until a pending normal fetch is acknowledged', () => {
    const gate = new PositionSaveGate();
    expect(gate.needsUnloadFlush('A')).toBe(true);
    const ticket = gate.begin('A')!;
    expect(gate.needsUnloadFlush('A')).toBe(true);
    gate.settle(ticket, true);
    expect(gate.needsUnloadFlush('A')).toBe(false);
    expect(gate.needsUnloadFlush('B')).toBe(true);
  });
});
