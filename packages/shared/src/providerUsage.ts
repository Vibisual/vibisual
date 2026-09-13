export interface ProviderUsageWindow { id: string; label: string; usedPercent: number; windowDurationMins?: number; resetsAt?: number }
export interface ProviderUsage { windows: ProviderUsageWindow[]; fetchedAt: number; error?: string }
