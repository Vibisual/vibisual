import type { CommandAppBrand } from '@vibisual/shared';

/**
 * Bundled marks for commands whose executable shows no app icon (`commandAppBrandOf` decides which).
 * Each file is the owner's own artwork under a license that permits this use — sources, licenses and the
 * marks deliberately left out: ../assets/command-app-icons/README.md (attribution ships in NOTICE).
 * `dark` / `light` = the background the mark sits on; a mark with one official variant serves both.
 * Every URL is a literal `new URL(…, import.meta.url)` so Vite emits the file.
 */
const git = new URL('../assets/command-app-icons/git.svg', import.meta.url).href;
const php = new URL('../assets/command-app-icons/php.svg', import.meta.url).href;
const ruby = new URL('../assets/command-app-icons/ruby.png', import.meta.url).href;
const perl = new URL('../assets/command-app-icons/perl.svg', import.meta.url).href;
const yarn = new URL('../assets/command-app-icons/yarn.svg', import.meta.url).href;
const pnpm = new URL('../assets/command-app-icons/pnpm.svg', import.meta.url).href;
const godot = new URL('../assets/command-app-icons/godot.svg', import.meta.url).href;

export const COMMAND_APP_BRAND_ICONS: Readonly<Record<CommandAppBrand, Readonly<{ dark: string; light: string }>>> = {
  git: { dark: git, light: git },
  // curl publishes a white symbol for dark backgrounds and a navy one for light backgrounds.
  curl: {
    dark: new URL('../assets/command-app-icons/curl-white.svg', import.meta.url).href,
    light: new URL('../assets/command-app-icons/curl.svg', import.meta.url).href,
  },
  php: { dark: php, light: php },
  ruby: { dark: ruby, light: ruby },
  perl: { dark: perl, light: perl },
  yarn: { dark: yarn, light: yarn },
  pnpm: { dark: pnpm, light: pnpm },
  godot: { dark: godot, light: godot },
};
