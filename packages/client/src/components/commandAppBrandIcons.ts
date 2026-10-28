import type { CommandAppBrand } from '@vibisual/shared';

/**
 * Bundled marks for commands whose executable shows no app icon (`commandAppBrandOf` decides which). Each file is the owner's artwork
 * under a license permitting this use — sources, licenses, deliberate omissions: ../assets/command-app-icons/README.md (attribution ships in NOTICE).
 * `dark` / `light` = the background the mark sits on (one official variant serves both). `plate` = owner publishes only black-on-white
 * (recolouring is not ours to do), so on dark it sits on a white disc — `pad` insets it, `flush` fills it (the file carries its own margin).
 * Every URL is a literal `new URL(…, import.meta.url)` so Vite emits the file.
 */
export interface CommandAppBrandIcon {
  readonly dark: string;
  readonly light: string;
  readonly plate?: 'pad' | 'flush';
}

const git = new URL('../assets/command-app-icons/git.svg', import.meta.url).href;
const php = new URL('../assets/command-app-icons/php.svg', import.meta.url).href;
const ruby = new URL('../assets/command-app-icons/ruby.png', import.meta.url).href;
const perl = new URL('../assets/command-app-icons/perl.svg', import.meta.url).href;
const yarn = new URL('../assets/command-app-icons/yarn.svg', import.meta.url).href;
const pnpm = new URL('../assets/command-app-icons/pnpm.svg', import.meta.url).href;
const godot = new URL('../assets/command-app-icons/godot.svg', import.meta.url).href;
const bun = new URL('../assets/command-app-icons/bun.svg', import.meta.url).href;
const vite = new URL('../assets/command-app-icons/vite.svg', import.meta.url).href;
const vitest = new URL('../assets/command-app-icons/vitest.svg', import.meta.url).href;
const esbuild = new URL('../assets/command-app-icons/esbuild.svg', import.meta.url).href;
const nx = new URL('../assets/command-app-icons/nx.svg', import.meta.url).href;
const uv = new URL('../assets/command-app-icons/uv.svg', import.meta.url).href;
const ruff = new URL('../assets/command-app-icons/ruff.svg', import.meta.url).href;
const pdm = new URL('../assets/command-app-icons/pdm.svg', import.meta.url).href;
const pytest = new URL('../assets/command-app-icons/pytest.svg', import.meta.url).href;
const r = new URL('../assets/command-app-icons/r.svg', import.meta.url).href;
const zig = new URL('../assets/command-app-icons/zig.svg', import.meta.url).href;
const ocaml = new URL('../assets/command-app-icons/ocaml.svg', import.meta.url).href;
const lua = new URL('../assets/command-app-icons/lua.gif', import.meta.url).href;
const composer = new URL('../assets/command-app-icons/composer.png', import.meta.url).href;
const stack = new URL('../assets/command-app-icons/stack.svg', import.meta.url).href;
const erlang = new URL('../assets/command-app-icons/erlang.svg', import.meta.url).href;
const homebrew = new URL('../assets/command-app-icons/homebrew.svg', import.meta.url).href;
const scoop = new URL('../assets/command-app-icons/scoop.svg', import.meta.url).href;
const chocolatey = new URL('../assets/command-app-icons/chocolatey.png', import.meta.url).href;
const ollama = new URL('../assets/command-app-icons/ollama.svg', import.meta.url).href;
const gnuHead = new URL('../assets/command-app-icons/gnu-head.svg', import.meta.url).href;
const androidHead = new URL('../assets/command-app-icons/android-head.svg', import.meta.url).href;
const emscripten = new URL('../assets/command-app-icons/emscripten.svg', import.meta.url).href;

export const COMMAND_APP_BRAND_ICONS: Readonly<Record<CommandAppBrand, CommandAppBrandIcon>> = {
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
  bun: { dark: bun, light: bun },
  vite: { dark: vite, light: vite },
  vitest: { dark: vitest, light: vitest },
  esbuild: { dark: esbuild, light: esbuild },
  // prettier-logo names variants by bar colour: the light-grey bars are the ones that read on dark.
  prettier: {
    dark: new URL('../assets/command-app-icons/prettier-icon-light.svg', import.meta.url).href,
    light: new URL('../assets/command-app-icons/prettier-icon-dark.svg', import.meta.url).href,
  },
  nx: { dark: nx, light: nx, plate: 'pad' },
  uv: { dark: uv, light: uv },
  ruff: { dark: ruff, light: ruff },
  pdm: { dark: pdm, light: pdm },
  pytest: { dark: pytest, light: pytest },
  r: { dark: r, light: r },
  zig: { dark: zig, light: zig },
  ocaml: { dark: ocaml, light: ocaml },
  lua: { dark: lua, light: lua, plate: 'flush' },
  composer: { dark: composer, light: composer },
  stack: { dark: stack, light: stack },
  erlang: { dark: erlang, light: erlang },
  homebrew: { dark: homebrew, light: homebrew },
  scoop: { dark: scoop, light: scoop },
  chocolatey: { dark: chocolatey, light: chocolatey },
  netlify: {
    dark: new URL('../assets/command-app-icons/netlify-monogram-darkmode.svg', import.meta.url).href,
    light: new URL('../assets/command-app-icons/netlify-monogram-lightmode.svg', import.meta.url).href,
  },
  ollama: { dark: ollama, light: ollama, plate: 'pad' },
  // NixOS branding: "When used on a dark background, use the white variant".
  nix: {
    dark: new URL('../assets/command-app-icons/nix-snowflake-white.svg', import.meta.url).href,
    light: new URL('../assets/command-app-icons/nix-snowflake-colours.svg', import.meta.url).href,
  },
  // GNU Wget has no mark of its own; the GNU head identifies the GNU program it is.
  wget: { dark: gnuHead, light: gnuHead, plate: 'pad' },
  adb: { dark: androidHead, light: androidHead },
  emscripten: { dark: emscripten, light: emscripten },
};
