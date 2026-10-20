/** Only app identity fields enter the native renderer URL; arbitrary transport values stay private. */
export function simpleAppWindowHash(appId: string, params: Record<string, string>): string {
  const parts = [`app=${encodeURIComponent(appId)}`];
  for (const key of ['projectId', 'file', 'clipId', 'modelId', 'imageId', 'draftKey', 'appBubbleId']) {
    const value = params[key];
    if (value !== undefined && value !== '') parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}
