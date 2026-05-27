import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_UI_LOCALES,
  LOCALE_META,
  DEFAULT_UI_LOCALE,
  DEFAULT_PORT,
  BUBBLE_STYLES,
  BUBBLE_COLORS,
} from '../constants.js';

describe('SUPPORTED_UI_LOCALES', () => {
  it('contains 12 locales', () => {
    expect(SUPPORTED_UI_LOCALES).toHaveLength(12);
  });

  it('starts with "en"', () => {
    expect(SUPPORTED_UI_LOCALES[0]).toBe('en');
  });

  it('includes all LOCALE_META keys', () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      expect(LOCALE_META).toHaveProperty(locale);
    }
  });

  it('LOCALE_META covers every supported locale', () => {
    const metaKeys = Object.keys(LOCALE_META);
    expect(metaKeys).toHaveLength(SUPPORTED_UI_LOCALES.length);
  });
});

describe('DEFAULT_UI_LOCALE', () => {
  it('is a member of SUPPORTED_UI_LOCALES', () => {
    expect(SUPPORTED_UI_LOCALES).toContain(DEFAULT_UI_LOCALE);
  });
});

describe('DEFAULT_PORT', () => {
  it('is a positive integer', () => {
    expect(DEFAULT_PORT).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_PORT)).toBe(true);
  });
});

describe('BUBBLE_STYLES', () => {
  it('every style entry has required fields', () => {
    for (const [, style] of Object.entries(BUBBLE_STYLES)) {
      expect(style).toHaveProperty('color');
      expect(style).toHaveProperty('glow');
      expect(style).toHaveProperty('icon');
    }
  });

  it('BUBBLE_COLORS mirrors BUBBLE_STYLES colors', () => {
    for (const [type, style] of Object.entries(BUBBLE_STYLES)) {
      expect(BUBBLE_COLORS[type as keyof typeof BUBBLE_COLORS]).toBe(style.color);
    }
  });
});

