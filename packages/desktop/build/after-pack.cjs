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

// ─────────────────────────────────────────────────────────────
// 빌드에만 쓰는 것은 사용자에게 보내지 않는다 (2026-08-21 실측).
//
// 이 훅은 pnpm 링크를 풀어 실물을 복사하는데, `node_modules` 에는 devDependency 도 함께
// 링크돼 있어 **빌드 도구가 통째로 설치본에 실려 갔다**. 실측 — 설치본 917MB 중:
//   · `@vibisual/video` 가 물고 있던 **electron 270MB** (이미 Electron 인 앱 안에 한 벌 더)
//   · typescript 23MB × 여러 벌 · vite/vitest/rollup/esbuild/lightningcss 약 35MB
// 설치 파일이 v0.1.7 131MB → v0.1.8 250MB 로 뛴 것이 이 자리다.
//
// **왜 이름 목록인가**: "devDependency 전부 빼기"는 pnpm 링크 구조상 판정이 어렵고, 하나만
// 잘못 빼도 앱이 실행 시점에 죽는다(그때는 이미 사용자 PC 다). 그래서 **런타임에 안 부르는
// 것이 확인된 것만** 이름으로 뺀다 — 확인 방법은 빌드 산출물에서의 참조 검사다.
//   · `electron` — 메인 프로세스가 내장 모듈로 받는다(npm 패키지는 바이너리 내려받기용 껍데기).
//   · `vitest`/`vite` — 참조하는 것은 컴파일된 `*.test.js` 뿐이고 그 파일은 실행되지 않는다.
//   · 나머지(typescript·rollup·esbuild·lightningcss·jiti·tsx) — 참조 0.
const BUILD_ONLY_PACKAGES = new Set([
  'electron', 'typescript', 'vitest', 'vite', 'rollup', 'esbuild', 'jiti', 'tsx',
  'why-is-node-running',
]);
/** 접두사로 갈리는 것들(플랫폼별 네이티브 빌드 도구 등). */
const BUILD_ONLY_PREFIXES = ['@vitest/', '@rollup/', '@esbuild/', 'lightningcss', '@types/'];

function isBuildOnlyPackage(name) {
  if (BUILD_ONLY_PACKAGES.has(name)) return true;
  return BUILD_ONLY_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * 컴파일된 테스트 산출물은 설치본에서 뺀다 — 실행되지 않는데 자리만 차지하고,
 * 유일하게 `vitest` 를 참조해 위 목록을 지우면 "없는 모듈" 참조로 남는다.
 */
function isTestArtifact(src) {
  return /\.test\.(js|mjs|cjs|d\.ts)$/.test(src) || /\.test\.js\.map$/.test(src);
}

/**
 * 경로 어딘가의 `node_modules/<빌드전용>` 을 잡아낸다.
 *
 * **왜 BFS 의 이름 검사만으로는 부족한가 (2026-08-21 실측)**: 가장 큰 덩어리인 electron
 * 270MB 는 BFS 가 아니라 **첫 단계의 통짜 복사**로 들어왔다 —
 * `server/node_modules/@vibisual/video` 를 dereference 하면 워크스페이스 실물이라
 * 그 안의 `node_modules/electron`(devDependency) 까지 통째로 따라온다. BFS 에만 그물을
 * 치고 8개(typescript·vitest·@types…)가 걸린 것을 보고 다 잡은 줄 알았으나, 정작 용량의
 * 3분의 1은 그 앞 단계로 지나가고 있었다.
 */
function isBuildOnlyPath(src) {
  const parts = src.split(/[\\/]/);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] !== 'node_modules') continue;
    const name = parts[i + 1].startsWith('@') && parts[i + 2]
      ? `${parts[i + 1]}/${parts[i + 2]}`
      : parts[i + 1];
    if (isBuildOnlyPackage(name)) return true;
    // 스코프 이름만으로도 판정되는 경우(`@types/…`)를 위해 한 겹 더 본다.
    if (parts[i + 1].startsWith('@') && isBuildOnlyPackage(`${parts[i + 1]}/`)) return true;
  }
  return false;
}

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
    // filter — 최상위 `node_modules` 는 아래 BFS 가 이름 단위로 거르므로 여기서는 dist 의
    //   테스트 산출물만 뺀다(실행되지 않는데 자리를 차지한다).
    cpSync(from, to, {
      recursive: true,
      dereference: true,
      // 여기가 진짜 관문이다 — 워크스페이스 실물을 따라 들어오는 devDependency(electron 270MB)를
      //   막는 자리. BFS 의 이름 검사보다 **앞서** 걸린다.
      filter: (src) => !isTestArtifact(src) && !isBuildOnlyPath(src),
    });
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
    const skipped = new Set();
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
            // 빌드에만 쓰는 것은 여기서 끊는다 — 넣지 않을 뿐 아니라 그 버킷도 걷지 않는다
            //   (electron 하나가 270MB 를 끌고 들어오던 자리).
            if (isBuildOnlyPackage(name)) { skipped.add(name); continue; }
            let real;
            try { real = realpathSync(join(full, s)); } catch { continue; }
            queue.push({ name, real });
          }
        } else {
          if (isBuildOnlyPackage(e)) { skipped.add(e); continue; }
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
          cpSync(real, dest, { recursive: true, dereference: true, filter: (src) => !isTestArtifact(src) });
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
    if (skipped.size > 0) {
      console.log(`[afterPack] [${label}] skipped ${skipped.size} build-only packages: ${[...skipped].sort().join(', ')}`);
    }
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
            if (isBuildOnlyPackage(name)) continue; // 위 BFS 와 같은 규율 — 빌드 도구는 안 보낸다
            let real;
            try { real = realpathSync(join(full, s)); } catch { continue; }
            seedQueue.push({ name, real });
          }
        } else {
          if (isBuildOnlyPackage(e)) continue;
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
          cpSync(real, dest, { recursive: true, dereference: true, filter: (src) => !isTestArtifact(src) });
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

  // Embed brand bubble icon + our own version resource into Vibisual.exe via rcedit
  // (Windows only). electron-builder.yml sets signAndEditExecutable=false to skip the
  // winCodeSign cache download (its 7z contains macOS symlinks that fail to extract on
  // Windows without Developer Mode). That flag also disables rcedit — so we invoke rcedit
  // ourselves here. Without this the .exe ships with the prebuilt electron binary's own
  // resources: the default atom icon AND the "Electron / GitHub, Inc. / 31.x" version
  // block. That version block is what Windows Task Manager prints in its process Name
  // column (it reads FileDescription, not the file name) and what File Properties shows —
  // so setting only the icon left the running app listed as "Electron".
  if (process.platform === 'win32' && context.electronPlatformName === 'win32') {
    const appInfo = context.packager.appInfo;
    const exeName = `${appInfo.productFilename}.exe`;
    const exePath = join(appOutDir, exeName);
    const iconPath = join(desktopDir, 'resources', 'icons', 'icon.ico');
    if (existsSync(exePath) && existsSync(iconPath)) {
      const rceditPath = findRcedit();
      if (rceditPath) {
        const productName = appInfo.productName || 'Vibisual';
        const args = [exePath, '--set-icon', iconPath];
        const versionStrings = {
          FileDescription: productName,   // ← Task Manager "Name" column
          ProductName: productName,
          InternalName: productName,
          OriginalFilename: exeName,
          CompanyName: appInfo.companyName || productName,
          LegalCopyright: appInfo.copyright,
        };
        for (const [key, value] of Object.entries(versionStrings)) {
          if (value) args.push('--set-version-string', key, String(value));
        }
        // App version (0.1.x), not Electron's runtime version.
        if (appInfo.version) {
          args.push('--set-file-version', appInfo.version, '--set-product-version', appInfo.version);
        }
        const r = spawnSync(rceditPath, args, { stdio: 'inherit' });
        if (r.status === 0) {
          console.log(`[afterPack] embedded icon + "${productName}" version resource → ${exePath} via ${rceditPath}`);
        } else {
          console.warn(`[afterPack] rcedit exit=${r.status} — icon/version resource not embedded`);
        }
      } else {
        console.warn('[afterPack] rcedit not found; icon + version resource left as Electron default. Run an electron-builder build once with signAndEditExecutable=true to populate the cache, then rebuild.');
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
  // Deterministic source: the `rcedit` npm package ships the binary. This is what makes the
  // icon embed work on CI — GitHub Actions runners have no winCodeSign cache (we set
  // signAndEditExecutable=false, which skips that download), so without this the packaged
  // Vibisual.exe shipped with the default Electron icon.
  try {
    const pkgJson = require.resolve('rcedit/package.json');
    const candidate = join(dirname(pkgJson), 'bin', 'rcedit-x64.exe');
    if (existsSync(candidate)) return candidate;
  } catch {
    /* rcedit not installed — fall through to the local cache fallback */
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
