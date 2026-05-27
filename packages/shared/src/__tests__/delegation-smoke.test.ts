import { describe, it, expect } from 'vitest';
import {
  calculateTokenCost,
  isOpusModel,
  parseModelFamily,
  DEFAULT_AGENT_CONFIG,
  AVAILABLE_AGENT_TOOLS,
  LOCKED_AGENT_TOOLS,
  BUBBLE_STYLES,
  BUBBLE_COLORS,
} from '../constants.js';

console.log('[smoke] AVAILABLE_AGENT_TOOLS:', AVAILABLE_AGENT_TOOLS);
console.log('[smoke] DEFAULT_AGENT_CONFIG:', DEFAULT_AGENT_CONFIG);
console.log('[smoke] BUBBLE_COLORS keys:', Object.keys(BUBBLE_COLORS));

describe('calculateTokenCost', () => {
  it('returns zero cost when all token counts are zero', () => {
    const result = calculateTokenCost(0, 0, 0, 0);
    console.log('[smoke] zero cost result:', result);
    expect(result.total).toBe(0);
    expect(result.input).toBe(0);
    expect(result.output).toBe(0);
  });

  it('uses specified model pricing when model is recognized', () => {
    const result = calculateTokenCost(1_000_000, 0, 0, 0, 'claude-haiku-4-5-20251001');
    console.log('[smoke] haiku 1M input cost:', result);
    expect(result.input).toBeCloseTo(0.80);
  });

  it('falls back to DEFAULT_PRICING for unknown models', () => {
    const known = calculateTokenCost(1_000_000, 0, 0, 0, 'claude-opus-4-6');
    const unknown = calculateTokenCost(1_000_000, 0, 0, 0, 'claude-unknown-model');
    console.log('[smoke] known:', known.input, 'unknown:', unknown.input);
    expect(unknown.input).toBe(known.input);
  });
});

describe('isOpusModel', () => {
  it('returns true for the short alias "opus"', () => {
    const r = isOpusModel('opus');
    console.log('[smoke] isOpusModel("opus"):', r);
    expect(r).toBe(true);
  });

  it('returns false for non-Opus model IDs', () => {
    const r = isOpusModel('claude-sonnet-4-6');
    console.log('[smoke] isOpusModel("claude-sonnet-4-6"):', r);
    expect(r).toBe(false);
  });

  it('returns false for null', () => {
    expect(isOpusModel(null)).toBe(false);
  });
});

describe('parseModelFamily', () => {
  it('extracts family from full model IDs', () => {
    const cases = [
      ['claude-opus-4-6', 'opus'],
      ['claude-sonnet-4-5-20250414', 'sonnet'],
      ['claude-haiku-4-5-20251001', 'haiku'],
    ] as const;
    for (const [id, expected] of cases) {
      const result = parseModelFamily(id);
      console.log(`[smoke] parseModelFamily("${id}"):`, result);
      expect(result).toBe(expected);
    }
  });

  it('returns undefined for unrecognized model families', () => {
    expect(parseModelFamily('claude-unknown-1-0')).toBeUndefined();
    expect(parseModelFamily(null)).toBeUndefined();
  });
});

describe('DEFAULT_AGENT_CONFIG', () => {
  it('includes all AVAILABLE_AGENT_TOOLS by default', () => {
    console.log('[smoke] DEFAULT_AGENT_CONFIG.tools:', DEFAULT_AGENT_CONFIG.tools);
    expect(DEFAULT_AGENT_CONFIG.tools).toEqual([...AVAILABLE_AGENT_TOOLS]);
  });

  it('includes Bash (LOCKED_AGENT_TOOLS)', () => {
    for (const locked of LOCKED_AGENT_TOOLS) {
      expect(DEFAULT_AGENT_CONFIG.tools).toContain(locked);
    }
  });
});

describe('BUBBLE_COLORS derivation', () => {
  it('matches BUBBLE_STYLES[type].color for every bubble type', () => {
    for (const [type, style] of Object.entries(BUBBLE_STYLES)) {
      console.log(`[smoke] BUBBLE_COLORS[${type}]:`, BUBBLE_COLORS[type as keyof typeof BUBBLE_COLORS], '===', style.color);
      expect(BUBBLE_COLORS[type as keyof typeof BUBBLE_COLORS]).toBe(style.color);
    }
  });
});
