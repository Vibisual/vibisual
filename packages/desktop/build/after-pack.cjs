// electron-builder afterPack hook — SCENARIO.md §3.7.
// electron-builder's file walk + pnpm symlinks misses the server's dist/ and node_modules/ (.gitignore excludes them; symlinks confuse
// the walker), so this copies the real files (symlinks dereferenced) into the packaged tree.
// Source : <repo>/packages/server/{dist, node_modules}
// Dest   : <resourcesDir>/app/node_modules/@vibisual/server/{dist, node_modules}
//          (resourcesDir = win/linux 는 <appOutDir>/resources, mac 은 <Product>.app/Contents/Resources)

const { cpSync, existsSync, readdirSync, readlinkSync, realpathSync, rmSync, mkdirSync, lstatSync, statSync, chmodSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

// 빌드에만 쓰는 패키지는 설치본에 싣지 않는다. 이 훅은 pnpm 링크를 풀어 복사하는데 `node_modules` 엔 devDependency 도 링크돼 있다 —
// 2026-08-21 실측: 설치본 917MB 중 `@vibisual/video` 가 물고 있던 electron 270MB, typescript 23MB × 여러 벌, vite/vitest/rollup/esbuild/lightningcss 약 35MB.
// 이름 목록인 이유: "devDependency 전부 빼기"는 pnpm 링크 구조상 판정이 어렵고, 하나만 잘못 빼도 사용자 PC 에서 실행 시점에 죽는다 —
// **런타임에 안 부르는 것이 확인된 것만** 넣는다(확인은 빌드 산출물의 참조 검사). `electron` 은 메인이 내장 모듈로 받고(npm 은 바이너리 받기용 껍데기),
// `vitest`/`vite` 는 실행되지 않는 `*.test.js` 만 참조하며, 나머지(typescript·rollup·esbuild·lightningcss·jiti·tsx)는 참조 0.
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
 * BFS 의 이름 검사만으로는 부족하다(2026-08-21 실측) — electron 270MB 는 첫 단계의 통짜 복사로 들어온다: `server/node_modules/@vibisual/video` 를
 * dereference 하면 워크스페이스 실물이라 그 안의 `node_modules/electron`(devDependency)까지 따라온다.
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

/**
 * 패키징된 앱의 리소스 디렉터리를 플랫폼 규칙대로 돌려준다.
 * `<appOutDir>/resources` 로 못 박으면 **macOS 에서만 조용히 빗나간다** — mac 은 `<appOutDir>/<Product>.app/Contents/Resources` 이고 그 바깥은 dmg 에 안 담긴다.
 * 빌드는 초록(없는 경로는 mkdir 로 만든다)인데 설치본에 서버 dist·전이 의존성이 빠진 채 발행된다. 판정은 electron-builder 공개 API(`getResourcesDir`)에 맡긴다.
 */
function resolveResourcesDir(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  if (packager && typeof packager.getResourcesDir === 'function') {
    try {
      return packager.getResourcesDir(appOutDir);
    } catch (err) {
      console.warn(`[afterPack] getResourcesDir failed (${err.message}) — 플랫폼 규칙으로 폴백`);
    }
  }
  if (electronPlatformName === 'darwin') {
    const product = (packager && packager.appInfo && packager.appInfo.productFilename) || 'Vibisual';
    return join(appOutDir, `${product}.app`, 'Contents', 'Resources');
  }
  return join(appOutDir, 'resources');
}

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  // 리소스 경로를 먼저 확정한다. 존재하지 않으면 **여기서 빌드를 세운다** — 조용히 mkdir 하면
  // 알맹이 빠진 설치본이 그대로 발행된다(mac 이 정확히 그 경로로 10번 넘게 지나갔다).
  const resourcesDir = resolveResourcesDir(context);
  if (!existsSync(resourcesDir)) {
    throw new Error(
      `[afterPack] resources dir not found: ${resourcesDir} ` +
      `(platform=${context.electronPlatformName}, appOutDir=${appOutDir}) — ` +
      '서버 dist/의존성을 넣을 자리를 못 찾았다. 이대로 두면 알맹이 없는 설치본이 나간다.',
    );
  }
  const desktopDir = __dirname.replace(/[\\/]build$/, '');
  const serverDir = join(desktopDir, '..', 'server');

  const appNodeModules = join(resourcesDir, 'app', 'node_modules', '@vibisual', 'server');
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

  // pnpm transitive deps — BFS over .pnpm sibling buckets. <pkg>/node_modules/<dep> is a junction into .pnpm/<pkg>@<ver>/node_modules/<pkg>;
  // siblings in that bucket are the package's real runtime deps, but cpSync(dereference:true) copies only the junction target, so deep chains
  // (express → finalhandler → debug → ms) break. Copy each junction + every sibling in its bucket, then enqueue each sibling so its bucket is visited too.
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

  // Desktop's direct prod deps (light-my-request) are copied by electron-builder, but their transitive deps (cookie, process-warning,
  // set-cookie-parser, ...) are missed (pnpm symlinks confuse the walker). BFS only the prod-dep subgraph — NOT all of desktop/node_modules
  // (electron/vite/tsx/tailwind devDeps) — into top-level resources/app/node_modules so externalized desktop deps resolve at runtime.
  const desktopPkg = require(join(desktopDir, 'package.json'));
  const desktopProdDeps = Object.keys(desktopPkg.dependencies || {})
    .filter((n) => !n.startsWith('@vibisual/'));
  if (desktopProdDeps.length) {
    const seedDestNm = join(resourcesDir, 'app', 'node_modules');
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
  // §3.7 — server 에는 네이티브 의존성이 없다: 런타임 deps(express·multer·cors·chokidar)가 전부 순수 JS 라 위 pnpm-sibling BFS 만으로 패키징이 닫힌다.

  // Embed the brand bubble icon + our own version resource into the exe via rcedit (Windows only). electron-builder.yml sets
  // signAndEditExecutable=false to skip the winCodeSign download (its 7z holds macOS symlinks that fail to extract on Windows without
  // Developer Mode), which also disables rcedit — so we run it here. Without it the .exe keeps electron's default icon AND its
  // "Electron / GitHub, Inc." version block, which Task Manager prints in its Name column (it reads FileDescription) and File Properties shows.
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

  restoreSpawnHelperExecBit(resourcesDir, context.electronPlatformName);
};

/**
 * node-pty 의 `spawn-helper` 에 실행 권한을 돌려준다(mac/linux 패키징).
 * ⚠ 빼면 **macOS 에서 터미널이 하나도 안 뜬다** — 로그인 창·CMD 버블·실행 런처가 전부 죽는다(2026-08-29 실기 확인).
 * npm 이 배포 tarball 을 만들 때 모드를 644 로 눌러 node-pty 1.1.0 의 `prebuilds/darwin-<arch>/spawn-helper` 가 `-rw-r--r--` 이고, 패키지 install 스크립트도 되돌리지 않는다.
 * mac node-pty 는 이 helper 를 `posix_spawnp` 로 실행하므로 권한이 없으면 `pty.spawn` 이 "posix_spawnp failed." 하나만 남기고 실패한다.
 * 리눅스는 prebuild 가 없어 소스 빌드라 문제가 없지만 같이 훑는다. 빌드는 초록이고 dmg 도 발행되므로 놓치면 연 사람만 아는 실패다.
 */
function restoreSpawnHelperExecBit(resourcesDir, electronPlatformName) {
  if (electronPlatformName === 'win32') return;
  const appModules = join(resourcesDir, 'app', 'node_modules');
  if (!existsSync(appModules)) return;

  // 사본이 여러 벌일 수 있다(@vibisual/server/node_modules 아래에도 들어온다) — 이름이
  //   `node-pty` 인 폴더를 깊이를 묶어 찾고, 그 안의 helper 를 전부 손본다.
  const ptyDirs = [];
  const findPtyDirs = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.name === 'node-pty') { ptyDirs.push(full); continue; }
      // 스코프 폴더(@vibisual 등)와 중첩 node_modules 만 더 들어간다 — 전체 트리를 훑으면
      //   수천 폴더를 헛돈다.
      if (e.name.startsWith('@') || e.name === 'node_modules') findPtyDirs(full, depth + 1);
      else findPtyDirs(join(full, 'node_modules'), depth + 1);
    }
  };
  findPtyDirs(appModules, 0);

  let fixed = 0;
  for (const ptyDir of ptyDirs) {
    const candidates = [join(ptyDir, 'build', 'Release', 'spawn-helper')];
    const prebuilds = join(ptyDir, 'prebuilds');
    try {
      for (const e of readdirSync(prebuilds, { withFileTypes: true })) {
        if (e.isDirectory()) candidates.push(join(prebuilds, e.name, 'spawn-helper'));
      }
    } catch { /* prebuilds 가 없는 배치(소스 빌드) — build/Release 만 본다 */ }
    for (const helper of candidates) {
      if (!existsSync(helper)) continue;
      try {
        if (statSync(helper).mode & 0o111) continue;
        chmodSync(helper, 0o755);
        fixed += 1;
        console.log(`[afterPack] chmod 755 ${helper} (npm tarball 이 644 로 눌러 놓은 것)`);
      } catch (err) {
        // 여기서 조용히 지나가면 mac 설치본의 터미널이 통째로 죽는다 — 빌드를 세운다.
        throw new Error(`[afterPack] spawn-helper 실행 권한 복구 실패: ${helper} — ${err.message}`);
      }
    }
  }
  console.log(`[afterPack] spawn-helper: node-pty ${ptyDirs.length}곳 확인, ${fixed}개 실행 권한 복구`);
}

// Locate an rcedit binary. Priority:
//   1. RCEDIT_PATH env override (manual install)
//   2. electron-builder winCodeSign cache (any extracted variant)
function findRcedit() {
  if (process.env.RCEDIT_PATH && existsSync(process.env.RCEDIT_PATH)) {
    return process.env.RCEDIT_PATH;
  }
  // Deterministic source: the `rcedit` npm package ships the binary. CI runners have no winCodeSign cache (signAndEditExecutable=false
  // skips that download), so without this the packaged exe keeps the default Electron icon.
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

// 테스트에서 실제 파일 모드로 확인할 수 있게 내보낸다(electron-builder 는 `.default` 만 본다).
exports.restoreSpawnHelperExecBit = restoreSpawnHelperExecBit;
