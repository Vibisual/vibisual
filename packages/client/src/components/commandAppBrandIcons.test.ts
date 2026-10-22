import { describe, expect, it } from 'vitest';
import { commandAppBrandOf, type CommandAppBrand } from '@vibisual/shared';
import { COMMAND_APP_BRAND_ICONS } from './commandAppBrandIcons.js';
import readme from '../assets/command-app-icons/README.md?raw';
import notice from '../../../../NOTICE?raw';

const ASSETS = import.meta.glob('../assets/command-app-icons/*.{svg,png}', { eager: true, query: '?url', import: 'default' });
const fileOf = (href: string): string => href.split(/[?#]/)[0]!.split('/').pop()!;
const BRANDS = Object.keys(COMMAND_APP_BRAND_ICONS) as CommandAppBrand[];
const bundledFiles = (): string[] => [...new Set(BRANDS.flatMap((brand) => Object.values(COMMAND_APP_BRAND_ICONS[brand]).map(fileOf)))];

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
};

describe('which commands get a bundled mark', () => {
  it.each([
    ['C:\\Program Files\\Git\\cmd\\git.exe', 'git'], ['/usr/bin/git', 'git'], ['git', 'git'], ['GIT.EXE', 'git'],
    ['C:/Windows/System32/curl.exe', 'curl'], ['php', 'php'], ['ruby.exe', 'ruby'], ['irb', 'ruby'], ['/usr/bin/perl', 'perl'],
    ['yarn.cmd', 'yarn'], ['D:/tools/npm/pnpm.ps1', 'pnpm'], ['pnpx', 'pnpm'],
    ['godot', 'godot'], ['Godot_v4.3-stable_win64.exe', 'godot'], ['/opt/Godot_v4.2-stable_linux.x86_64', 'godot'], ['godot4', 'godot'],
  ])('%s → %s', (executable, brand) => {
    expect(commandAppBrandOf(executable)).toBe(brand);
  });

  it.each(['node', 'npm', 'npx', 'python3', 'cargo', 'docker', 'go', 'deno', 'bun', 'C:/UE/Engine/Binaries/Win64/UnrealEditor.exe',
    'git-lfs', 'godotx', 'constructor', 'toString', ''])('"%s" keeps the icon read from its own executable', (executable) => {
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
      for (const href of Object.values(COMMAND_APP_BRAND_ICONS[brand])) expect(files.has(fileOf(href)), `${brand}: ${href}`).toBe(true);
    }
  });

  it('no image sits in the folder unused — every shipped file is accounted for', () => {
    expect(Object.keys(ASSETS).map(fileOf).sort()).toEqual(bundledFiles().sort());
  });

  it('the README records source and license of every bundled file', () => {
    for (const file of bundledFiles()) expect(readme, file).toContain(`\`${file}\``);
  });

  it('NOTICE carries the attribution of every bundled mark', () => {
    for (const brand of BRANDS) expect(notice, brand).toContain(ATTRIBUTION[brand]);
    // MIT requires the permission notice itself to travel with the copy.
    expect(notice).toContain('The above copyright notice and this permission notice shall be');
  });
});
