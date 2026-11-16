import { readAppToolInvocation, type AppToolRule } from '@vibisual/shared';

const HEADLESS = /(?:^|[\s'"])--headless(?=$|[\s='"])/i;
const SCREENSHOT = /(?:^|[\s'"])--screenshot(?=$|[\s='"])/i;
const CHROME = /\bchrome(?:\.exe)?\b/i;
const CAPTURE_SCREENSHOT = /\bPage\.captureScreenshot\b/;
const PROCESS_CALL = /\b(?:spawn(?:Sync)?|exec(?:File)?(?:Sync)?|Popen|subprocess\.(?:run|call|check_call|check_output))\s*\(/;
const HEADLESS_ARG = /^--headless(?:=.*)?$/i;
const SCREENSHOT_ARG = /^--screenshot(?:=.*)?$/i;

function findChromeCaptureInScript(code: string): string | null {
  if (!CHROME.test(code) || !HEADLESS.test(code)) return null;
  if (SCREENSHOT.test(code)) {
    const input = { command: code };
    if (readAppToolInvocation('Bash', input, WINDOWS_CHROME_CAPTURE_RULE).direct
      || readAppToolInvocation('PowerShell', input, WINDOWS_CHROME_CAPTURE_RULE).direct) return 'chrome';
  }
  return PROCESS_CALL.test(code) && (SCREENSHOT.test(code) || CAPTURE_SCREENSHOT.test(code)) ? 'chrome' : null;
}

// A fresh Chrome profile can increment the Windows account's failed logon count.
export const WINDOWS_CHROME_CAPTURE_RULE: AppToolRule = {
  commands: [],
  outputCommands: [],
  outputPattern: SCREENSHOT_ARG,
  scriptMarkers: [],
  matchesInvocation: (name, args) => name === 'chrome'
    && args.some((arg) => HEADLESS_ARG.test(arg))
    && args.some((arg) => SCREENSHOT_ARG.test(arg)),
  findScriptEvidence: findChromeCaptureInScript,
};

export const WINDOWS_CHROME_CAPTURE_DENIAL =
  'Vibisual blocked headless Chrome capture on Windows. Use Vibistudio frame or still.';
