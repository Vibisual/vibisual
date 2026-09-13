/** Use patched fetch (desktop IPC / remote authentication), not an img's direct API request. */
export async function loadStreamImage(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}
