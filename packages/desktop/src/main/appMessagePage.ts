import { splashPalette } from './splashPolicy';

export const APP_MESSAGE_ORIGIN = 'https://message.vibisual.invalid';

export interface AppMessageOptions {
  title: string;
  message: string;
  detail?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
  type?: 'info' | 'warning' | 'error';
  destructiveId?: number;
  locale?: string;
  theme?: { background: string; kind: 'dark' | 'light' };
}

export function messageButtonIndex(value: number | undefined, count: number): number {
  return Number.isInteger(value) && value! >= 0 && value! < count ? value! : 0;
}

/** Only a button from this isolated document may answer the question. */
export function messageResponse(destination: string, nonce: string, count: number): number | null {
  let url: URL;
  try { url = new URL(destination); } catch { return null; }
  if (url.origin !== APP_MESSAGE_ORIGIN || url.pathname !== '/answer' || url.searchParams.get('nonce') !== nonce) return null;
  const raw = url.searchParams.get('button');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const answer = Number(raw);
  return Number.isInteger(answer) && answer >= 0 && answer < count ? answer : null;
}

/** No preload, app bundle, remote assets or backend is required, including during crash recovery. */
export function appMessagePage(options: AppMessageOptions, nonce: string): string {
  const palette = splashPalette(options.theme?.background, options.theme?.kind);
  const data = JSON.stringify({
    ...options, nonce, origin: APP_MESSAGE_ORIGIN,
    defaultId: messageButtonIndex(options.defaultId, options.buttons.length),
    cancelId: messageButtonIndex(options.cancelId, options.buttons.length),
  }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Vibisual</title>
<style nonce="${nonce}">
:root { color-scheme: ${palette.kind}; font: 14px/1.5 system-ui, sans-serif; color: ${palette.foreground}; background: ${palette.background}; }
* { box-sizing: border-box; } body { margin: 0; height: 100vh; padding: 1px; }
article { height: 100%; border: 1px solid ${palette.border}; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 10px; padding: 15px 20px; border-bottom: 1px solid ${palette.border}; -webkit-app-region: drag; }
svg { width: 20px; height: 20px; flex-shrink: 0; color: ${palette.kind === 'light' ? '#b45309' : '#fbbf24'}; }
h1 { margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
main { flex: 1; min-height: 0; padding: 20px; overflow: auto; } p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
#detail { margin-top: 12px; color: ${palette.muted}; font-size: 12px; }
footer { display: flex; justify-content: end; flex-wrap: wrap; gap: 8px; padding: 0 20px 18px; }
button { border: 1px solid ${palette.border}; background: ${palette.track}; color: inherit; font: inherit; border-radius: 5px; padding: 6px 12px; cursor: pointer; -webkit-app-region: no-drag; }
button:hover { filter: brightness(${palette.kind === 'light' ? '.94' : '1.18'}); } button:focus-visible { outline: 2px solid #84cc16; outline-offset: 2px; }
button.destructive { background: #991b1b; border-color: #b91c1c; color: #fff; }
#close { margin-left: auto; background: transparent; border: 0; font-size: 20px; line-height: 1; }
[hidden] { display: none !important; }
</style></head><body><article role="alertdialog" aria-modal="true" aria-labelledby="title" aria-describedby="message detail">
<header><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg><h1 id="title"></h1><button id="close" type="button">×</button></header>
<main><p id="message"></p><p id="detail"></p></main><footer id="buttons"></footer></article>
<script nonce="${nonce}">
'use strict'; const data = ${data};
document.documentElement.lang = data.locale || 'en'; document.title = data.title;
for (const name of ['title', 'message', 'detail']) document.getElementById(name).textContent = data[name] || '';
document.getElementById('detail').hidden = !data.detail;
let answered = false;
function answer(index) { if (answered) return; answered = true; location.href = data.origin + '/answer?nonce=' + data.nonce + '&button=' + index; }
const close = document.getElementById('close'); close.setAttribute('aria-label', data.buttons[data.cancelId]); close.onclick = () => answer(data.cancelId);
const buttons = data.buttons.map((label, index) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  if (index === data.destructiveId) button.className = 'destructive'; button.onclick = () => answer(index); document.getElementById('buttons').append(button); return button; });
buttons[data.defaultId].focus();
document.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') { event.preventDefault(); answer(data.cancelId); }
  if (event.key === 'Tab') { const all = [close, ...buttons]; const current = all.indexOf(document.activeElement);
    event.preventDefault(); all[(current + (event.shiftKey ? all.length - 1 : 1)) % all.length].focus(); }
});
</script></body></html>`;
}
