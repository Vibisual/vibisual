import type { ConsentDocuments } from './consentDocuments';
import { CONSENT_LANGUAGES, consentStrings } from './consentStrings';

export const CONSENT_ACTION_ORIGIN = 'https://consent.vibisual.invalid';
export const CONSENT_WINDOW = { width: 900, height: 760, minWidth: 640, minHeight: 540, backgroundColor: '#f6f7fb' };

/** Only textContent renders documents. No provider, remote font, preload, or app IPC is needed here. */
export function consentPage(documents: ConsentDocuments, locale: string, nonce: string, saveFailed = false): string {
  const payload = JSON.stringify({
    documents, locale, nonce, saveFailed, origin: CONSENT_ACTION_ORIGIN,
    languages: CONSENT_LANGUAGES.map((language) => ({ ...language, strings: consentStrings(language.locale) })),
  }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Vibisual</title>
<style nonce="${nonce}">
:root { color-scheme: light dark; font: 14px/1.55 system-ui, sans-serif; color: #202637; background: #f6f7fb; }
* { box-sizing: border-box; } body { margin: 0; height: 100vh; padding: 28px; display: flex; flex-direction: column; gap: 16px; }
header { display: flex; gap: 24px; align-items: start; justify-content: space-between; } h1 { font-size: 24px; margin: 0 0 4px; }
p { margin: 0; } #intro, #version, #fullTextLanguage { color: #596276; } #version { margin-top: 6px; font-size: 12px; }
label { cursor: pointer; } .language { display: grid; gap: 5px; min-width: 160px; } select, button { font: inherit; border-radius: 8px; padding: 9px 12px; border: 1px solid #bdc4d3; background: #fff; color: inherit; }
select { width: 100%; } main { display: flex; flex-direction: column; flex: 1; min-height: 100px; gap: 10px; }
.document-picker { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; } #document { width: auto; min-width: 170px; }
#fullTextLanguage { font-size: 12px; } #text { margin: 0; padding: 20px; overflow: auto; flex: 1; min-height: 0; border: 1px solid #bdc4d3; border-radius: 10px; background: #fff; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; user-select: text; }
.acceptance { display: flex; align-items: start; gap: 10px; } #checked { margin-top: 4px; min-width: 18px; height: 18px; accent-color: #334ed8; }
footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; } .buttons { display: flex; gap: 10px; margin-left: auto; }
button { cursor: pointer; } #accept { background: #334ed8; color: #fff; border-color: #334ed8; } button:disabled { opacity: .45; cursor: not-allowed; }
:focus-visible { outline: 3px solid #7084ef; outline-offset: 3px; } #status { color: #ad283e; } [hidden] { display: none !important; }
@media (prefers-color-scheme: dark) { :root { background: #171b25; color: #edf0f7; } select, button, #text { background: #222938; border-color: #535e75; } #intro, #version, #fullTextLanguage { color: #bbc3d4; } #status { color: #ffabb8; } }
@media (max-width: 700px) { body { padding: 18px; } header { gap: 14px; } h1 { font-size: 21px; } }
</style></head><body>
<header><div><h1 id="title"></h1><p id="intro"></p><p id="version"></p></div>
<label class="language"><span id="languageLabel"></span><select id="language"></select></label></header>
<main><div class="document-picker"><select id="document"><option value="summary"></option><option value="eula"></option><option value="privacy"></option></select><span id="fullTextLanguage" hidden></span></div>
<pre id="text" tabindex="0"></pre></main>
<label class="acceptance"><input id="checked" type="checkbox"><span id="acceptance"></span></label>
<footer><p id="status" role="status" aria-live="polite"></p><div class="buttons"><button id="decline" type="button"></button><button id="accept" type="button" disabled></button></div></footer>
<script nonce="${nonce}">
'use strict';
const data = ${payload};
const byId = (id) => document.getElementById(id);
const language = byId('language'), documentPicker = byId('document'), checked = byId('checked'), accept = byId('accept');
let busy = false;
for (const entry of data.languages) { const option = document.createElement('option'); option.value = entry.locale; option.textContent = entry.name; language.append(option); }
language.value = data.locale;
const current = () => data.languages.find((entry) => entry.locale === language.value);
function renderDocument() {
  const type = documentPicker.value;
  byId('text').textContent = type === 'summary' ? data.documents.summaries[language.value] : data.documents[type];
  byId('text').lang = type === 'summary' ? language.value : 'en';
  byId('text').scrollTop = 0;
  byId('text').setAttribute('aria-label', documentPicker.selectedOptions[0].textContent);
  byId('fullTextLanguage').hidden = type === 'summary';
}
function renderLanguage() {
  const s = current().strings;
  document.documentElement.lang = language.value;
  document.title = s.title;
  for (const id of ['title', 'intro', 'acceptance', 'accept', 'decline', 'fullTextLanguage']) byId(id).textContent = s[id];
  byId('languageLabel').textContent = s.language;
  byId('version').textContent = s.version.replace('{version}', data.documents.version);
  const labels = { summary: s.summary, eula: s.fullTerms, privacy: s.privacy };
  for (const option of documentPicker.options) option.textContent = labels[option.value];
  documentPicker.setAttribute('aria-label', s.fullTerms + ' / ' + s.privacy);
  checked.checked = false;
  accept.disabled = true;
  byId('status').textContent = data.saveFailed ? s.saveError : '';
  renderDocument();
}
language.addEventListener('change', () => { documentPicker.value = 'summary'; renderLanguage(); });
documentPicker.addEventListener('change', renderDocument);
checked.addEventListener('change', () => { accept.disabled = busy || !checked.checked; });
function act(action) {
  if (busy || (action === 'accept' && !checked.checked)) return;
  busy = true; accept.disabled = true; language.disabled = true; byId('decline').disabled = true;
  if (action === 'accept') byId('status').textContent = current().strings.saving;
  const url = new URL('/' + action, data.origin);
  url.searchParams.set('nonce', data.nonce); url.searchParams.set('locale', language.value);
  if (action === 'accept') url.searchParams.set('accepted', 'true');
  location.href = url.href;
}
accept.addEventListener('click', () => act('accept'));
byId('decline').addEventListener('click', () => act('decline'));
renderLanguage(); language.focus();
</script></body></html>`;
}
