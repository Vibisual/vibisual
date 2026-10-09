import { VIBI3D_API_PREFIX, isReadOnlyHookAgent, type BubbleData, type ProjectInfo, type Vibi3DSnapshot } from '@vibisual/shared';
import { sameClientPath } from '../../utils/platform.js';

export function vibi3dProjectAgents(
  agents: BubbleData[],
  agentProjects: Record<string, string>,
  projects: Record<string, ProjectInfo>,
  projectId: string,
): BubbleData[] {
  if (!projectId) return [];
  const resolve = (value: string): string => projects[value]?.path
    ?? Object.values(projects).find((p) => p.name === value)?.path ?? value;
  const target = resolve(projectId);
  return agents.filter((agent) => {
    const owner = agentProjects[agent.id];
    return agent.customCreated === true && !agent.trashed && !!agent.path && !isReadOnlyHookAgent(agent)
      && !!owner && sameClientPath(resolve(owner), target);
  });
}

/** Only identifiers and the user's request go into the existing agent queue; never renderer credentials. */
export function vibi3dAgentPrompt(snapshot: Vibi3DSnapshot, request: string): string {
  const base = `${VIBI3D_API_PREFIX}/sessions/${encodeURIComponent(snapshot.sessionId)}`;
  return [
    'Edit the open Vibi3D scene using its live HTTP bridge. The user can see the result immediately.',
    `User request (JSON string): ${JSON.stringify(request.trim())}`,
    `Scene context: ${JSON.stringify({ sessionId: snapshot.sessionId, projectId: snapshot.projectId,
      fileName: snapshot.fileName, selectedId: snapshot.selectedId, revision: snapshot.revision })}`,
    '',
    'Connection: read VIBISUAL_BASE from your environment. Authenticate with the x-vibisual-hook-token header using VIBISUAL_TOKEN or VIBISUAL_HOOK_AUTH. Never print credentials or put them in a URL.',
    'If those environment values are absent, use the hook-listener.json identity path already provided in your session instructions (on Windows: %APPDATA%/@vibisual/desktop/hook-listener.json). Read port/token into memory only and use http://127.0.0.1:<port>. Do not guess the port or reveal the file contents. If unavailable, report that the connection is unavailable.',
    '',
    `1. GET ${base} returns {ok,snapshot,imageUrl,updatedAt}. Read the latest snapshot before every edit; the context above may be stale. Inspect its nodes, selectedId, camera and playback. Use node IDs from this response, never guessed names as IDs.`,
    `2. GET ${base}/image returns the current JPEG. Download it to a local temporary file and inspect it with your image viewing tool. To refresh the picture, submit a single {"type":"capture"} command as below, wait for applied, then GET the image. If the image endpoint reports a stale/unavailable frame, request capture first.`,
    'Capture pauses animation and auto-rotation at the current pose to produce a stable image. Node transform values describe the authored pose, while snapshot.playback identifies the animation preview time shown in the image. Editing stops the preview and applies changes to the authored state; do not copy a pictured animated pose into node transforms as if it were the authored pose.',
    `3. POST ${base}/commands with JSON {"commandId":"<new UUID>","expectedRevision":<latest snapshot.revision>,"commands":[<supported commands>]} queues an edit and returns HTTP 202 with {ok,status,commandId,statusUrl}.`,
    'Supported commands (literal JSON schemas; omit unchanged properties):',
    '  {"type":"update","id":"<node id>","position":[x,y,z],"rotation":[x,y,z],"scale":[x,y,z],"color":"#rrggbb"}',
    '  {"type":"lighting","intensity":1.4} (0 through 10)',
    '  {"type":"select","id":"<node id>"} (or id:null)',
    '  {"type":"undo"}, {"type":"redo"}, {"type":"capture"}',
    'Positions/scales are absolute LOCAL values. Rotation is Euler XYZ in DEGREES. Read current values to calculate relative changes. Scale components must be nonzero. Only update nodes that support the requested property; a color is only meaningful on a mesh material.',
    'A request may contain 1 to 100 update/lighting commands atomically. select, undo, redo and capture must each be the only command in their request. Unsupported geometry, rigging, deletion, arbitrary scripts and file writes are not bridge commands.',
    `4. GET ${base}/commands/<commandId> (or the returned statusUrl) until status is applied or rejected; poll at most once per second and stop after 30 seconds with a clear pending report. HTTP 202 only means queued, never completed.`,
    'On network uncertainty, poll the SAME commandId before retrying. Reuse that ID for transport retries so an edit or undo cannot run twice. On HTTP 409 / revision-conflict, read the fresh snapshot, preserve human edits, recalculate the change and use a new commandId. Do not replay an old absolute transform over a human change.',
    'Exception: command-timeout-refresh-state means the outcome is still uncertain, even if status says rejected. A late renderer acknowledgement may change it to applied. Re-read the scene and poll the SAME commandId to establish the actual outcome. Do not automatically replay the edit, issue a new commandId, or calculate and submit another relative edit after this timeout. If uncertainty remains at the polling limit, report it and stop.',
    `5. After applied, GET ${base} again and inspect the updated ${base}/image. Request a fresh capture if needed. Report only verified changes. Live scene changes are unsaved until the user uses Vibi3D Save; do not claim the source file was saved.`,
    '',
    'Keep the user’s current selection and unrelated edits unless their request requires changing them. If this scene is closed/offline, report it; do not switch to another session or reopen a different model automatically.',
    'Use this bridge to change the scene. Do not modify Vibisual source code, rebuild the application, or create a separate editor to satisfy a scene-edit request.',
  ].join('\n');
}
