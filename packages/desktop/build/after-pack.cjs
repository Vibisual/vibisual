// electron-builder afterPack hook — SCENARIO.md §3.7.
//
// electron-builder's default file walk + pnpm symlinks misses the server's
// dist/ and node_modules/ (.gitignore excludes them; symlinks confuse the
// walker). This hook copies real files (symlinks dereferenced) into the
// packaged tree after electron-builder finishes.
//
// Source : <repo>/packages/server/{dist, node_modules}
// Dest   : <appOutDir>/resources/app/node_modules/@vibisual/server/{dist, node_modules}

const { cpSync, existsSync, readdirSync, readlinkSync, realpathSync, rmSync, mkdirSync, lstatSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  const desktopDir = __dirname.replace(/[\\/]build$/, '');
  const serverDir = join(desktopDir, '..', 'server');

  const appNodeModules = join(appOutDir, 'resources', 'app', 'node_modules', '@vibisual', 'server');
  if (!existsSync(appNodeModules)) {
    mkdirSync(appNodeModules, { recursive: true });
  }

  const copies = [
    { from: join(serverDir, 'dist'),         to: join(appNodeModules, 'dist') },
    { from: join(serverDir, 'node_modules'), to: join(appNodeModules, 'node_modules') },
  ];

  for (const { from, to } of copies) {
    if (!existsSync(from)) {
      console.warn(`[afterPack] source missing: ${from} — skipped`);
      continue;
    }
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    // dereference:true follows pnpm symlinks → real files in the package.
    cpSync(from, to, { recursive: true, dereference: true });
    console.log(`[afterPack] copied ${from} → ${to}`);
  }

  const path = require('node:path');
  const PNPM_SEG = `${path.sep}.pnpm${path.sep}`;

  // pnpm transitive deps — BFS over .pnpm sibling buckets.
  // <pkg>/node_modules/<dep> is a junction into .pnpm/<pkg>@<ver>/node_modules/<pkg>.
  // Sibling packages in that same .pnpm bucket are the package's actual runtime deps,
  // but cpSync(dereference:true) only copies the junction target itself. Without
  // siblings, deep transitive chains (express → finalhandler → debug → ms) break.
  // We BFS: enqueue each junction, copy it + every sibling in its .pnpm bucket,
  // then enqueue each sibling so its own bucket gets visited too.
  const bfsCopy = (srcNm, destNm, label) => {
    if (!existsSync(srcNm)) return;
    const seen = new Set();
    const queue = [];
    const enqueueFromDir = (dir) => {
      let entries;
      try { entries = readdirSync(dir); } catch { return; }
      for (const e of entries) {
        if (e.startsWith('.')) continue;
        const full = join(dir, e);
        if (e.startsWith('@')) {
          let subs;
          try { subs = readdirSync(full); } catch { continue; }
          for (const s of subs) {
            const name = `${e}/${s}`;
            let real;
            try { real = realpathSync(join(full, s)); } catch { continue; }
            queue.push({ name, real });
          }
        } else {
          let real;
          try { real = realpathSync(full); } catch { continue; }
          queue.push({ name: e, real });
        }
      }
    };
    enqueueFromDir(srcNm);
    let copied = 0;
    while (queue.length) {
      const { name, real } = queue.shift();
      if (seen.has(name)) continue;
      seen.add(name);
      const dest = join(destNm, name);
      if (!existsSync(dest)) {
        try {
          if (name.includes('/')) mkdirSync(dirname(dest), { recursive: true });
          cpSync(real, dest, { recursive: true, dereference: true });
          copied += 1;
        } catch (err) {
          console.warn(`[afterPack] copy failed ${name}: ${err.message}`);
          continue;
        }
      }
      const bucketDir = name.includes('/') ? dirname(dirname(real)) : dirname(real);
      if (!bucketDir.includes(PNPM_SEG)) continue;
      enqueueFromDir(bucketDir);
    }
    console.log(`[afterPack] [${label}] copied ${copied} transitive deps via pnpm-sibling BFS`);
  };

  // Server transitive deps → resources/app/node_modules/@vibisual/server/node_modules/
  bfsCopy(join(serverDir, 'node_modules'), join(appNodeModules, 'node_modules'), 'server');

  // Desktop's own direct prod deps (light-my-request) are copied by electron-builder, but
  // their transitive deps (cookie, process-warning, set-cookie-parser, ...) are missed
  // because pnpm symlinks confuse the walker. BFS only the prod-dep subgraph (NOT all of
  // desktop/node_modules, which contains electron/vite/tsx/tailwind devDeps) into the
  // top-level resources/app/node_modules so externalized desktop deps resolve at runtime.
  const desktopPkg = require(join(desktopDir, 'package.json'));
  const desktopProdDeps = Object.keys(desktopPkg.dependencies || {})
    .filter((n) => !n.startsWith('@vibisual/'));
  if (desktopProdDeps.length) {
    const seedDestNm = join(appOutDir, 'resources', 'app', 'node_modules');
    const seedSrcNm = join(desktopDir, 'node_modules');
    const seedSeen = new Set();
    const seedQueue = [];
    for (const name of desktopProdDeps) {
      let real;
      try { real = realpathSync(join(seedSrcNm, name)); } catch { continue; }
      seedQueue.push({ name, real });
    }
    let copied = 0;
    const enqueueSiblings = (dir) => {
      let entries;
      try { entries = readdirSync(dir); } catch { return; }
      for (const e of entries) {
        if (e.startsWith('.')) continue;
        const full = join(dir, e);
        if (e.startsWith('@')) {
          let subs;
          try { subs = readdirSync(full); } catch { continue; }
          for (const s of subs) {
            const name = `${e}/${s}`;
            let real;
            try { real = realpathSync(join(full, s)); } catch { continue; }
            seedQueue.push({ name, real });
          }
        } else {
          let real;
          try { real = realpathSync(full); } catch { continue; }
          seedQueue.push({ name: e, real });
        }
      }
    };
    while (seedQueue.length) {
      const { name, real } = seedQueue.shift();
      if (seedSeen.has(name)) continue;
      seedSeen.add(name);
      const dest = join(seedDestNm, name);
      if (!existsSync(dest)) {
        try {
          if (name.includes('/')) mkdirSync(dirname(dest), { recursive: true });
          cpSync(real, dest, { recursive: true, dereference: true });
          copied += 1;
        } catch (err) {
          console.warn(`[afterPack] copy failed ${name}: ${err.message}`);
          continue;
        }
      }
      const bucketDir = name.includes('/') ? dirname(dirname(real)) : dirname(real);
      if (!bucketDir.includes(PNPM_SEG)) continue;
      enqueueSiblings(bucketDir);
    }
    console.log(`[afterPack] [desktop] copied ${copied} transitive deps via pnpm-sibling BFS (seeded from ${desktopProdDeps.join(', ')})`);
  }
  // (v1.97 §3.7) sqlite-vec / better-sqlite3 플랫폼 바이너리 복사 블록은 제거됐다 —
  // v1.96 에서 Keyword Graph(SQLite) 가 폐기되어 server 에 네이티브 의존성이 없다.
  // in-process 모델의 server 런타임 deps(express·multer·cors·chokidar)는 전부 순수 JS 라
  // 위 pnpm-sibling BFS 만으로 패키징이 닫힌다.

  // Embed brand bubble icon into Vibisual.exe via rcedit (Windows only).
  // electron-builder.yml sets signAndEditExecutable=false to skip the winCodeSign
  // cache download (its 7z contains macOS symlinks that fail to extract on Windows
  // without Developer Mode). That flag also disables rcedit — so we invoke rcedit
  // ourselves here. Without this the .exe ships with the default Electron atom
  // icon embedded by the prebuilt electron binary.
  if (process.platform === 'win32' && context.electronPlatformName === 'win32') {
    const exeName = `${context.packager.appInfo.productFilename}.exe`;
    const exePath = join(appOutDir, exeName);
    const iconPath = join(desktopDir, 'resources', 'icons', 'icon.ico');
    if (existsSync(exePath) && existsSync(iconPath)) {
      const rceditPath = findRcedit();
      if (rceditPath) {
        const r = spawnSync(rceditPath, [exePath, '--set-icon', iconPath], { stdio: 'inherit' });
        if (r.status === 0) {
          console.log(`[afterPack] embedded ${iconPath} → ${exePath} via ${rceditPath}`);
        } else {
          console.warn(`[afterPack] rcedit exit=${r.status} — icon not embedded`);
        }
      } else {
        console.warn('[afterPack] rcedit not found; icon left as Electron default. Run an electron-builder build once with signAndEditExecutable=true to populate the cache, then rebuild.');
      }
    }
  }
};

// Locate an rcedit binary. Priority:
//   1. RCEDIT_PATH env override (manual install)
//   2. electron-builder winCodeSign cache (any extracted variant)
function findRcedit() {
  if (process.env.RCEDIT_PATH && existsSync(process.env.RCEDIT_PATH)) {
    return process.env.RCEDIT_PATH;
  }
  const cacheRoot = join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  if (!existsSync(cacheRoot)) return null;
  let entries;
  try { entries = readdirSync(cacheRoot); } catch { return null; }
  for (const id of entries) {
    const candidate = join(cacheRoot, id, 'rcedit-x64.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
