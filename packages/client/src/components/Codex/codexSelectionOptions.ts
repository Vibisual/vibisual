import type { CodexModelEntry } from '@vibisual/shared';

interface CodexSelectOption { value: string; label: string; description: string }

/** A refreshed catalog never removes a saved choice from the control. */
export function codexModelOptionsFor(
  models: readonly CodexModelEntry[],
  selected: string,
  selectedName: string | undefined,
  retainedDescription: string,
): CodexSelectOption[] {
  const options = models.map((model) => ({
    value: model.slug,
    label: model.displayName || model.slug,
    description: model.description || model.slug,
  }));
  if (selected && !options.some((option) => option.value === selected)) {
    options.unshift({ value: selected, label: selectedName || selected, description: retainedDescription });
  }
  return options;
}

/** Keep an explicitly saved effort even when a new or unavailable catalog omits it. */
export function codexEffortOptionsFor(levels: readonly string[], selected: string): CodexSelectOption[] {
  const values = selected && !levels.includes(selected) ? [selected, ...levels] : levels;
  return values.map((value) => ({ value, label: value, description: value }));
}
