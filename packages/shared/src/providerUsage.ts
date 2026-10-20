export interface ProviderUsageWindow { id: string; label: string; usedPercent: number; windowDurationMins?: number; resetsAt?: number }

/** Provider-reported credit availability; an absent balance is unknown, never zero. */
export interface ProviderUsageCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
}

export interface ProviderUsageResetCredit {
  id: string;
  resetType: 'codexRateLimits' | 'unknown';
  status: 'available' | 'redeeming' | 'redeemed' | 'unknown';
  /** Unix milliseconds, like usage-window reset timestamps. */
  grantedAt?: number;
  /** Null explicitly means no expiry; absence means unavailable. */
  expiresAt?: number | null;
  title?: string;
  description?: string;
}

export interface ProviderUsageResetCredits {
  availableCount: number;
  /** May be omitted or capped by the provider; use availableCount for the total. */
  credits?: ProviderUsageResetCredit[];
}

export interface ProviderUsage {
  windows: ProviderUsageWindow[];
  fetchedAt: number;
  plan?: string;
  credits?: ProviderUsageCredits;
  resetCredits?: ProviderUsageResetCredits;
  error?: string;
}
