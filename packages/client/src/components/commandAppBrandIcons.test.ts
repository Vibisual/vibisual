import { describe, expect, it } from 'vitest';
import { commandAppBrandOf, type CommandAppBrand } from '@vibisual/shared';
import { COMMAND_APP_BRAND_ICONS } from './commandAppBrandIcons.js';
import readme from '../assets/command-app-icons/README.md?raw';
import notice from '../../../../NOTICE?raw';

const ASSETS = import.meta.glob('../assets/command-app-icons/*.{svg,png,gif}', { eager: true, query: '?url', import: 'default' });
const fileOf = (href: string): string => href.split(/[?#]/)[0]!.split('/').pop()!;
const BRANDS = Object.keys(COMMAND_APP_BRAND_ICONS) as CommandAppBrand[];
/** The files a brand draws — its two backgrounds; `plate` is a drawing hint, not a file. */
const variantsOf = (brand: CommandAppBrand): string[] => [COMMAND_APP_BRAND_ICONS[brand].dark, COMMAND_APP_BRAND_ICONS[brand].light];
const bundledFiles = (): string[] => [...new Set(BRANDS.flatMap((brand) => variantsOf(brand).map(fileOf)))];

/** The attribution line each mark needs in NOTICE (which ships with every installer). */
const ATTRIBUTION: Readonly<Record<CommandAppBrand, string>> = {
  git: 'Git Logo by Jason Long',
  curl: 'curl symbol by the curl project',
  php: 'PHP logo by Colin Viebrock',
  ruby: 'The Ruby Logo, Copyright (c) 2006 Yukihiro Matsumoto',
  perl: 'Perl logo by Zach Roszczewski',
  yarn: 'Yarn logo from yarnpkg/assets',
  pnpm: 'pnpm logo, Copyright (c) 2016-2022 Zoltan Kochan',
  godot: 'Godot Engine Logo, Copyright (c) 2017',
  bun: 'Bun logo from oven-sh/bun',
  vite: 'Vite logo, Copyright (c) 2019-present, VoidZero Inc. and Vite contributors',
  vitest: 'Vitest logo, Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors',
  esbuild: 'esbuild logo, Copyright (c) 2020 Evan Wallace',
  prettier: 'Prettier logo, Copyright 2017 James Long',
  nx: 'Nx logo, Copyright (c) 2017-2026 Narwhal Technologies Inc.',
  uv: 'uv logo, Copyright (c) 2023 Astral Software Inc.',
  ruff: 'Ruff logo, Copyright (c) 2022 Charles Marsh',
  pdm: 'PDM logo, Copyright (c) 2019-present Frost Ming',
  pytest: 'pytest logo, Copyright (c) 2016-2017 Vasily Kuznetsov and others',
  r: 'The R logo is (c) 2016 The R Foundation',
  zig: 'Zig logomark from ziglang/logo',
  ocaml: 'OCaml logo from ocaml/ocaml-logo',
  lua: 'Lua logo, Copyright (c) 1998 Lua.org. Graphic design by Alexandre Nakonechnyj.',
  composer: 'Composer logo by Max Grigorian',
  stack: 'Stack logo, Copyright (c) 2015-2024, Stack contributors',
  erlang: 'Erlang logo from erlang/erlang-org',
  homebrew: 'Homebrew logo, Copyright (c) 2009-present, Homebrew contributors',
  scoop: 'Scoop logo, Copyright (c) 2022 scoopinstaller.github.io',
  chocolatey: 'Chocolatey Logo Use Policy',
  netlify: 'Netlify monogram',
  ollama: 'Ollama logo, Copyright (c) Ollama',
  nix: 'Nix snowflake from NixOS/nixos-artwork',
  wget: 'GNU head',
  adb: 'The Android robot is reproduced or modified from work created and shared by Google',
  emscripten: 'Emscripten logo, Copyright (c) 2010-2014 Emscripten authors',
};

describe('which commands get a bundled mark', () => {
  it.each([
    ['C:\\Program Files\\Git\\cmd\\git.exe', 'git'], ['/usr/bin/git', 'git'], ['git', 'git'], ['GIT.EXE', 'git'],
    ['C:/Windows/System32/curl.exe', 'curl'], ['php', 'php'], ['ruby.exe', 'ruby'], ['irb', 'ruby'], ['/usr/bin/perl', 'perl'],
    ['yarn.cmd', 'yarn'], ['D:/tools/npm/pnpm.ps1', 'pnpm'], ['pnpx', 'pnpm'],
    ['godot', 'godot'], ['Godot_v4.3-stable_win64.exe', 'godot'], ['/opt/Godot_v4.2-stable_linux.x86_64', 'godot'], ['godot4', 'godot'],
    ['bun.exe', 'bun'], ['bunx', 'bun'], ['vite', 'vite'], ['vitest.cmd', 'vitest'], ['esbuild', 'esbuild'], ['prettier', 'prettier'],
    ['nx.cmd', 'nx'], ['uv', 'uv'], ['uvx', 'uv'], ['ruff.exe', 'ruff'], ['pdm', 'pdm'], ['pytest', 'pytest'], ['py.test', 'pytest'],
    ['C:/Program Files/R/R-4.4.1/bin/R.exe', 'r'], ['Rscript', 'r'], ['zig', 'zig'], ['ocamlfind', 'ocaml'], ['lua', 'lua'],
    ['lua5.4', 'lua'], ['luac54.exe', 'lua'], ['composer.bat', 'composer'], ['stack', 'stack'], ['erl', 'erlang'], ['escript', 'erlang'],
    ['/opt/homebrew/bin/brew', 'homebrew'], ['scoop.ps1', 'scoop'], ['choco.exe', 'chocolatey'], ['ntl', 'netlify'], ['ollama', 'ollama'],
    ['nix-shell', 'nix'], ['/usr/bin/wget', 'wget'], ['adb.exe', 'adb'], ['em++', 'emscripten'], ['emcmake', 'emscripten'],
  ])('%s → %s', (executable, brand) => {
    expect(commandAppBrandOf(executable)).toBe(brand);
  });

  it.each(['node', 'npm', 'npx', 'python3', 'cargo', 'docker', 'go', 'deno', 'tsc', 'eslint', 'jest', 'kubectl', 'terraform', 'gh',
    'C:/UE/Engine/Binaries/Win64/UnrealEditor.exe', 'git-lfs', 'godotx', 'lua5', 'luajit', 'bunyan', 'constructor', 'toString', ''])('"%s" keeps the icon read from its own executable', (executable) => {
    expect(commandAppBrandOf(executable)).toBeUndefined();
  });

  it('an absent executable has no mark', () => {
    expect(commandAppBrandOf(undefined)).toBeUndefined();
  });
});

describe('bundled mark files and their notices', () => {
  it('every variant points at a file that exists in assets/command-app-icons', () => {
    const files = new Set(Object.keys(ASSETS).map(fileOf));
    for (const brand of BRANDS) {
      for (const href of variantsOf(brand)) expect(files.has(fileOf(href)), `${brand}: ${href}`).toBe(true);
    }
  });

  it('no image sits in the folder unused — every shipped file is accounted for', () => {
    expect(Object.keys(ASSETS).map(fileOf).sort()).toEqual(bundledFiles().sort());
  });

  it('the README records source and license of every bundled file', () => {
    for (const file of bundledFiles()) expect(readme, file).toContain(`\`${file}\``);
  });

  it('NOTICE carries the attribution of every bundled mark', () => {
    // NOTICE wraps its lines; an attribution may break anywhere a space is.
    const flat = notice.replace(/\s+/g, ' ');
    for (const brand of BRANDS) expect(flat, brand).toContain(ATTRIBUTION[brand]);
    // MIT and BSD require the permission notice itself to travel with the copy.
    expect(flat).toContain('The above copyright notice and this permission notice shall be');
    expect(flat).toContain('Redistributions in binary form must reproduce the above copyright notice');
    expect(flat).toContain('Neither the name of Stack nor the names of its contributors');
  });
});
