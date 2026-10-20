import { VIBI3D_API_PREFIX, VIBI3D_LIMITS, buildVibi3DCommandReference, buildVibi3DWorkflowInstructions, type Vibi3DSnapshot } from '@vibisual/shared';

/** Only identifiers and the user's request go into the existing agent queue; never renderer credentials. */
export function vibi3dAgentPrompt(snapshot: Vibi3DSnapshot, request: string, options?: { workDraft?: boolean }): string {
  const base = `${VIBI3D_API_PREFIX}/sessions/${encodeURIComponent(snapshot.sessionId)}`;
  return [
    'Edit the open Vibi3D scene using its live HTTP bridge. The user can see the result immediately.',
    `User request (JSON string): ${JSON.stringify(request.trim())}`,
    `Scene context: ${JSON.stringify({ sessionId: snapshot.sessionId, projectId: snapshot.projectId,
      fileName: snapshot.fileName, selectedId: snapshot.selectedId, revision: snapshot.revision,
      document: snapshot.document, runId: snapshot.runId })}`,
    '',
    'Connection: read VIBISUAL_BASE from your environment. Authenticate with the x-vibisual-hook-token header using VIBISUAL_TOKEN or VIBISUAL_HOOK_AUTH. Never print credentials or put them in a URL.',
    'If those environment values are absent, use the hook-listener.json identity path already provided in your session instructions (on Windows: '
      + '%APPDATA%/@vibisual/desktop/hook-listener.json). Read port/token into memory only and use http://127.0.0.1:<port>. Do not guess the port or reveal the '
      + 'file contents. If unavailable, report that the connection is unavailable.',
    '',
    `1. GET ${base} returns {ok,snapshot,imageUrl,updatedAt}. Read the latest snapshot before every edit; the context above may be stale. Inspect its nodes, selectedId, camera and playback. Use node IDs from this response, never guessed names as IDs.`,
    `2. GET ${base}/image returns the current JPEG. Download it to a local temporary file and inspect it with your image viewing tool. To refresh the `
      + `picture, submit a single {"type":"capture"} command as below, wait for applied, then GET the image. If the image endpoint reports a stale/unavailable frame, request capture first.`,
    'Capture pauses animation and auto-rotation at the current pose to produce a stable image. Node transform values describe the authored pose, while '
      + 'snapshot.playback identifies the animation preview time shown in the image. Editing stops the preview and applies changes to the authored state; do '
      + 'not copy a pictured animated pose into node transforms as if it were the authored pose.',
    `3. POST ${base}/commands with JSON {"commandId":"<new UUID>","expectedRevision":<latest snapshot.revision>,"commands":[<supported commands>]} queues an edit and returns HTTP 202 with {ok,status,commandId,statusUrl}.`,
    buildVibi3DCommandReference(),
    options?.workDraft
      ? 'Continue the automatically saved AI work draft in this live scene. It differs from the committed source; preserve the source and the user’s separate edits. Do not checkpoint, propose, accept, or commit a source-document candidate automatically. The user explicitly applies this AI work draft from the modeling app. Do not restore an older source over the retained draft. Inspect the live JPEG after edits; a document without a named workflow stage has no saved capture PNGs.'
      : buildVibi3DWorkflowInstructions(),
    'Positions/scales are absolute LOCAL values. Rotation is Euler XYZ in DEGREES. Read current values to calculate relative changes. Scale components must be nonzero. Only update nodes that support the requested property; a color is only meaningful on a mesh material.',
    `A request may contain 1 to ${VIBI3D_LIMITS.commandCount} creation/edit commands atomically, within ${VIBI3D_LIMITS.requestBytes} UTF-8 JSON bytes. select, undo, redo, stats, capture, checkpoint, propose and resume must each be the only command in their request. `
      + 'Rigging, arbitrary executable scripts and file writes are not bridge commands. Geometry is editable through bounded recipes; no paid model or external generator is required.',
    `4. GET ${base}/commands/<commandId> (or the returned statusUrl) until status is applied or rejected; poll at most once per second; running/progress means the renderer is working. A 30-second status wait is not the command deadline; follow the helper's per-command timeout. HTTP 202 only means queued, never completed.`,
    'On network uncertainty, poll the SAME commandId before retrying. Reuse that ID for transport retries so an edit or undo cannot run twice. On HTTP 409 '
      + '/ revision-conflict, read the fresh snapshot, preserve human edits, recalculate the change and use a new commandId. Do not replay an old absolute transform over a human change.',
    'unsaved-human-edits means scene mutations are temporarily blocked to protect the user’s unsaved draft. Never discard or save the human draft through '
      + 'agent commands. Wait for the user to save or discard their own edits, then GET the latest snapshot and recalculate your change before sending a new commandId.',
    'Exception: command-timeout-refresh-state means the outcome is still uncertain, even if status says rejected. A late renderer acknowledgement may '
      + 'change it to applied. Re-read the scene and poll the SAME commandId to establish the actual outcome. Do not automatically replay the edit, issue a new '
      + 'commandId, or calculate and submit another relative edit after this timeout. If uncertainty remains at the polling limit, report it and stop.',
    `5. After applied, GET ${base} again and inspect the updated ${base}/image. Request a fresh capture if needed. Report only verified changes. The app automatically saves each successful mutation into the AI work draft before acknowledging applied. This does not apply the draft to the original source. A draft-save failure can leave the live revision advanced: re-read the scene, report the failure, and never replay the mutation blindly.`,
    '',
    'Closing the Vibi3D window keeps the live session and agent connection running. Continue using the same session while it is online; do not reopen the '
      + 'window just because it is hidden. Saved work drafts survive closing the view. Full app shutdown waits for durable draft writes, stops processing, and restores saved drafts when reopened; it does not keep an agent running after the app exits.',
    snapshot.document
      ? `This session belongs to document ${JSON.stringify(snapshot.document.id)}. Only if the session is actually offline, POST ${VIBI3D_API_PREFIX}/documents/${encodeURIComponent(snapshot.document.id)}/reopen with ${JSON.stringify({ projectId: snapshot.projectId, runId: snapshot.runId })}, then GET the same document's /session?projectId=${encodeURIComponent(snapshot.projectId)} until online and use its returned sessionId. Never switch documents. The app chooses the existing editor surface, otherwise the initiating screen (including mobile web).`
      : 'If this scene is actually offline, report it; do not switch to another session or reopen a different model automatically.',
    `GET ${VIBI3D_API_PREFIX}/authoring/native-kit?projectId=${encodeURIComponent(snapshot.projectId)} provides the portable Node helper and instructions. Save its files inside the project and use node vibi3d_native.mjs send --session <sessionId> --file <commands.json>; it sends JSON files, waits for applied, and reports saved capture paths without shell-specific quoting. The helper runs in your own shell, never inside the app.`,
    'If Claude asks permission to run the helper, use its existing approval dialog to allow that specific helper invocation for this project. Do not disable permission checks or change user settings. If Codex reports local-transport-network-required, explain that the explicitly disabled network setting must be changed by the user before continuing.',
    'When a document has a saved workflow stage, capture returns result.captures with project-relative PNG paths. Open those actual files with your image viewer (Claude Read; Codex installed image-viewing tool) before reporting visual checks. Otherwise inspect the existing /image JPEG. Do not claim a saved PNG or an image check unless the result and opened image prove it.',
    options?.workDraft
      ? 'Finish with a reviewable AI work draft. Autosave already preserves it; the user chooses whether to apply it to the source.'
      : 'Checkpoint saves named run stages independently of the source, including initially empty documents. Propose creates a Before/After review candidate. Only the user applies work to the source; never accept your own candidate. Resume is an explicit command for a saved run/stage, issued before new edits; it restores this document only and preserves human edits by rejecting conflicts.',
    'Keep the user’s current selection and unrelated edits unless their request requires changing them.',
    'Use this bridge to change the scene. Do not modify Vibisual source code, rebuild the application, or create a separate editor to satisfy a scene-edit request.',
  ].join('\n');
}
