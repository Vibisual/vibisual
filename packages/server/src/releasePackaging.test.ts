import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 배포 산출물이 **Windows 밖에서도 돌아가는지**를 기계가 지킨다.
 *
 * 여기 담긴 것들은 전부 "빌드는 초록인데 앱은 안 뜨는" 부류다 — CI 가 성공으로 끝나고
 * dmg/AppImage 까지 발행되지만, 정작 그것을 연 사람만 아는 실패다. 우리 개발기는 Windows 라
 * 누가 mac 을 꺼내 열어 보기 전까지 아무도 모른다. 그래서 되돌아가면 **여기서** 넘어지게 둔다.
 *
 * 전례: mac 잡은 v0.1.0~v0.1.9 열 번을 연속으로 실패했는데 워크플로 주석이 그 실패를
 * "서명이 없어서"라고 미리 설명해 둔 탓에 아무도 로그를 열지 않았다(실제 원인은 아이콘 크기).
 * **실패를 예상된 것으로 적어 두면 그 실패는 조사되지 않는다** — 그래서 설명 대신 검사를 둔다.
 */

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('release packaging — mac/linux', () => {
  it('afterPack 은 리소스 경로를 electron-builder 에 물어본다 (mac 의 리소스는 .app 안이다)', () => {
    const src = read('packages/desktop/build/after-pack.cjs');
    // mac 의 리소스 디렉터리는 <appOutDir>/<Product>.app/Contents/Resources 다.
    // appOutDir 아래 'resources' 를 하드코딩하면 **mac 에서만** .app 바깥에 복사되고,
    // 그 경로가 없으면 mkdir 로 만들어 버려 경고조차 남지 않는다 → 서버 dist 와 전이
    // 의존성이 통째로 빠진 dmg 가 초록 CI 를 달고 발행된다.
    expect(src).toContain('getResourcesDir');
    expect(src).not.toContain("join(appOutDir, 'resources', 'app'");
  });

  it('mac 타깃에 arch 를 못 박지 않는다 (못 박으면 CLI --arm64/--x64 가 무시된다)', () => {
    const yml = read('packages/desktop/electron-builder.yml');
    const macBlock = yml.slice(yml.indexOf('\nmac:'), yml.indexOf('\nlinux:'));
    expect(macBlock).toContain('dmg');
    // electron-builder 의 computeArchToTargetNamesMap 은 타깃에 적힌 arch 를 CLI 플래그보다
    // 우선한다 — 여기에 arch 를 적어 두면 러너를 아키텍처별로 갈라도 두 잡이 똑같이
    // 두 아키텍처를 다 뽑아, Intel 용 dmg 안에 arm64 네이티브가 들어간다.
    const pinned = macBlock
      .split('\n')
      .filter((line) => !line.trim().startsWith('#') && line.includes('arch:'));
    expect(pinned).toEqual([]);
  });

  it('mac 은 아키텍처마다 그 아키텍처의 러너에서 짓는다', () => {
    const wf = read('.github/workflows/release.yml');
    // 한 러너에서 두 아키텍처를 뽑으면 두 dmg 가 **같은 node_modules** 를 쓰는데, koffi 처럼
    // 설치 시점의 플랫폼·아키텍처 것만 깔리는(@koromix/koffi-<platform>-<arch>) 네이티브가
    // 있어 반대편 아키텍처에서는 제 바이너리를 못 찾고 main 이 뜨자마자 죽는다.
    const armIdx = wf.indexOf('- os: macos-latest');
    const intelIdx = wf.indexOf('- os: macos-15-intel');
    expect(armIdx).toBeGreaterThan(-1);
    expect(intelIdx).toBeGreaterThan(-1);
    expect(wf.slice(armIdx, armIdx + 200)).toContain('release:mac:arm64');
    expect(wf.slice(intelIdx, intelIdx + 200)).toContain('release:mac:x64');
  });

  it('mac 서명 값을 electron-builder 가 읽는 이름으로 env 에 두지 않는다', () => {
    const wf = read('.github/workflows/release.yml');
    const live = wf.split('\n').filter((line) => !line.trim().startsWith('#'));
    // 없는 시크릿을 GitHub 은 "정의 안 됨"이 아니라 **빈 문자열**로 넣는다. electron-builder 는
    // `cscLink == null` 로만 걸러서 그 빈 문자열을 진짜 경로로 받아들이고 projectDir 로 풀어
    // `⨯ <projectDir> not a file` 로 죽는다 — v0.1.15 의 mac 두 잡이 3회 재시도를 다 쓰고
    // 그렇게 전멸했고, win·linux 는 발행됐으므로 릴리스는 "성공"으로 보였다(mac 자산 5종 실종).
    // 셸 가드(`[ -n "${MAC_CSC_LINK:-}" ]`)는 옳게 걸렀지만, env 에 이름이 있는 한
    // electron-builder 는 그 가드를 거치지 않고 제 손으로 읽는다.
    for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
      const leaked = live.some((line) => new RegExp(`^\\s{2,}${name}:`).test(line));
      expect(leaked, `${name} 을 env: 에 직접 두면 빈 시크릿이 빈 문자열로 새어 들어간다`).toBe(false);
    }
    // 대신 MAC_ 접두사로 받아 두고, 비어 있지 않을 때만 electron-builder 의 이름으로 넘긴다.
    expect(wf).toContain('MAC_CSC_LINK: ${{ secrets.MAC_CSC_LINK }}');
    expect(wf).toContain('export CSC_LINK="$MAC_CSC_LINK"');
  });

  it('mac 잡 실패를 continue-on-error 로 덮지 않는다', () => {
    const wf = read('.github/workflows/release.yml');
    const live = wf.split('\n').filter((line) => !line.trim().startsWith('#'));
    expect(live.some((line) => line.includes('continue-on-error'))).toBe(false);
  });

  it('아키텍처별 mac 릴리스 스크립트가 실제로 있다', () => {
    const root = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const desktop = JSON.parse(read('packages/desktop/package.json')) as { scripts: Record<string, string> };
    expect(root.scripts['release:mac:arm64']).toContain('publish:mac:arm64');
    expect(root.scripts['release:mac:x64']).toContain('publish:mac:x64');
    expect(desktop.scripts['publish:mac:arm64']).toContain('--arm64');
    expect(desktop.scripts['publish:mac:x64']).toContain('--x64');
  });

  it('afterPack 이 node-pty spawn-helper 의 실행 권한을 되돌린다 (mac 터미널 전체가 여기 걸린다)', () => {
    const src = read('packages/desktop/build/after-pack.cjs');
    // npm 은 배포 tarball 의 파일 모드를 644 로 눌러 버리고, node-pty 는 그것을 되돌리는
    // 스크립트가 없다. macOS 의 node-pty 는 이 helper 를 실행해 제어 터미널을 얻으므로
    // 권한이 없으면 **모든 pty.spawn 이 `posix_spawnp failed.` 로 죽는다** —
    // 로그인 창·CMD 버블·실행 런처가 통째로 안 뜬다(v0.1.14 실기 확인).
    expect(src).toContain('spawn-helper');
    expect(src).toContain('0o755');
    // 실패를 삼키면 알맹이 빠진 dmg 가 초록 CI 를 달고 나간다 — 못 고치면 빌드를 세운다.
    const fn = src.slice(src.indexOf('function restoreSpawnHelperExecBit'));
    expect(fn).toContain('throw new Error');
  });

  // 파일 모드는 Windows 에 없다 — 실제 권한 확인은 CI 의 ubuntu/macOS 잡에서 돈다.
  const itPosix = process.platform === 'win32' ? it.skip : it;
  itPosix('644 로 들어온 spawn-helper 를 (중첩 사본까지) 755 로 고친다', () => {
    const requireCjs = createRequire(import.meta.url);
    const { restoreSpawnHelperExecBit } = requireCjs(
      path.join(REPO, 'packages/desktop/build/after-pack.cjs'),
    ) as { restoreSpawnHelperExecBit: (resourcesDir: string, platform: string) => void };

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-afterpack-'));
    const put = (rel: string): string => {
      const p = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'x');
      fs.chmodSync(p, 0o644);
      return p;
    };
    const top = put('app/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper');
    // @vibisual/server 아래로도 한 벌 더 들어온다 — 한 곳만 고치면 나머지가 남는다.
    const nested = put('app/node_modules/@vibisual/server/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper');
    const untouched = put('app/node_modules/node-pty/prebuilds/win32-x64/pty.node');

    try {
      restoreSpawnHelperExecBit(tmp, 'darwin');
      expect(fs.statSync(top).mode & 0o111).toBeGreaterThan(0);
      expect(fs.statSync(nested).mode & 0o111).toBeGreaterThan(0);
      // helper 가 아닌 것은 건드리지 않는다(실행 권한을 무차별로 뿌리지 않는다).
      expect(fs.statSync(untouched).mode & 0o111).toBe(0);

      // Windows 빌드에는 helper 자체가 없다 — 헛일하지 않는다.
      fs.chmodSync(top, 0o644);
      restoreSpawnHelperExecBit(tmp, 'win32');
      expect(fs.statSync(top).mode & 0o111).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('터미널 생성 경로에 spawn-helper 권한 방벽이 있다', () => {
    const src = read('packages/desktop/src/main/terminalManager.ts');
    // 패키징을 빠져나온 배치(로컬 설치·손으로 옮긴 앱)까지 구하는 마지막 그물.
    expect(src).toContain('ensureSpawnHelperExecutable');
    // 반드시 spawn **앞**에서 불려야 한다 — 뒤면 첫 터미널은 그대로 실패한다.
    expect(src.indexOf('ensureSpawnHelperExecutable();')).toBeLessThan(src.indexOf('pty.spawn('));
    // win32 는 helper 자체가 없다(ConPTY) — 헛일하지 않게 갈라져 있어야 한다.
    expect(src).toContain("platform === 'win32' || spawnHelperChecked");
  });

  it('폴더 열기는 mac/Linux 에도 길이 있다', () => {
    const src = read('packages/server/src/index.ts');
    const start = src.indexOf("app.post('/api/projects/open-folder'");
    expect(start).toBeGreaterThan(-1);
    // Windows 경로(IFileDialog COM)가 유일한 구현이면 mac/Linux 에서는 powershell 이 없어
    // 500 이 되고, 클라이언트가 그 실패를 조용히 삼켜 **아무 반응 없는 버튼**이 된다
    // = 그 두 플랫폼에는 프로젝트를 추가할 수단이 UI 에 남지 않는다.
    const head = src.slice(start, start + 6000);
    expect(head).toContain('osascript'); // macOS 내장
    expect(head).toContain('zenity'); // Linux — GNOME 계열
    expect(head).toContain('kdialog'); // Linux — KDE 계열
  });
});

/**
 * §4 v2.44 — **발행은 실기 검증을 통과한 결과여야 한다.**
 *
 * v0.1.19 가 이 검사를 만든 사고다. 그때는 태그 push 가 곧 공개 발행이라, Windows 인스톨러가
 * `0xC0000005` 로 죽어 아무것도 설치하지 못한다는 사실을 **이미 공개된 뒤에** 알았다. 자산은
 * 나가 있었고 설치본은 그것을 받아 실패하는 상태였으며, 되돌릴 방법이 없었다.
 *
 * 원인은 그 빌드의 결함이 아니라 **순서**였다 — 검증이 발행보다 뒤에 있으면, 검증이 무엇을
 * 찾아내든 이미 늦다. 그래서 순서를 뒤집었다: 자산은 draft 로 올라가고(업데이터는 draft 를
 * 읽지 못한다), 4종 러너의 실기 설치 + 자산 11종 검사를 통과해야 공개로 바뀐다.
 *
 * 아래 검사들은 그 순서가 **되돌아가지 못하게** 잠근다. 한 줄만 바꿔도 게이트 전체가 사라지는
 * 구조라(예: `releaseType` 을 `release` 로) 사람의 기억에 맡길 수 없다.
 */
describe('release publishing — 검증이 발행보다 앞선다', () => {
  it('자산은 draft 로 올라간다 (draft 면 업데이터가 못 읽는다 = 사용자에게 도달하지 않는다)', () => {
    const yml = read('packages/desktop/electron-builder.yml');
    const live = yml.split('\n').filter((line) => !line.trim().startsWith('#'));
    const releaseType = live.find((line) => line.includes('releaseType:'));
    expect(releaseType).toBeDefined();
    // `release` 로 되돌리면 태그 push 가 다시 곧 공개가 된다 — 그 순간 게이트는 없는 것이다.
    expect(releaseType).toContain('draft');
  });

  it('스모크가 전부 통과해야 공개로 바뀐다 (publish 잡이 smoke 를 needs 로 건다)', () => {
    const wf = read('.github/workflows/smoke.yml');
    expect(wf).toContain('publish:');
    expect(wf).toContain('needs: smoke');
    // 공개 전환은 draft 해제 한 번뿐이다 — 그 명령이 사라지면 릴리스는 영영 draft 로 남는다.
    expect(wf).toContain('--draft=false');
    // draft 를 해제하려면 쓰기 권한이 필요하다. `read` 로 되돌리면 조용히 실패한다.
    expect(wf).toMatch(/permissions:\s*\n\s*contents:\s*write/);
  });

  it('공개 직전에 자산 11종을 센다 (스모크는 실행만 보지 한 종이 통째로 빠진 것은 못 본다)', () => {
    const wf = read('.github/workflows/smoke.yml');
    expect(wf).toContain('check-release-assets.mjs');
    const script = read('.github/scripts/check-release-assets.mjs');
    // draft 를 세야 하므로 태그 단건 조회에 기댈 수 없다 — 그 경로는 draft 에 404 를 준다.
    expect(script).toContain('/releases?per_page=');
    // v0.1.12 가 Intel dmg 없이 발행된 자리 — 그 이름이 목록에서 빠지면 다시 그렇게 된다.
    expect(script).toContain('-arm64.dmg');
    expect(script).toContain('.dmg');
    expect(script).toContain('.deb');
    expect(script).toContain('.rpm');
  });

  it('태그를 못 받았을 때 draft 를 건너뛰는 조회로 떨어지지 않는다', () => {
    const wf = read('.github/workflows/smoke.yml');
    const live = wf.split('\n').filter((line) => !line.trim().startsWith('#'));
    // `gh release view` 는 draft 를 건너뛴다. 그것으로 떨어지면 **방금 올라온 draft 대신
    // 한 판올림 옛 공개본**을 검증하고, 그 통과를 근거로 새 판올림을 공개해 버린다.
    expect(live.filter((line) => line.includes('gh release view'))).toEqual([]);
    expect(wf).toContain('gh release list');
  });

  it('릴리스 본문 생성기가 draft 릴리스를 찾을 수 있다 (본문은 공개보다 먼저 붙는다)', () => {
    const src = read('.github/scripts/release-notes.mjs');
    // 태그 단건 조회만 쓰면 draft 에 404 라 매 릴리스가 본문 없이 지나간다(v0.1.14 의 재발).
    expect(src).toContain('/releases?per_page=');
  });

  it('draft 를 태그에 묶는 스텝이 있다 (GitHub 은 draft 에 태그를 안 붙인다)', () => {
    const wf = read('.github/workflows/release.yml');
    // v0.1.20 이 여기서 통째로 막혔다: 태그를 먼저 밀어 두었는데도 draft 는 `untagged-<id>` 로
    // 남았고, 태그로 찾는 것이 전부 빗나가 스모크 4종이 "release not found" 로 즉사했다.
    // 설치본은 멀쩡했는데 **검증이 시작조차 못 했다.**
    expect(wf).toContain('tag_name=');
    // 묶는 일은 `prepare` 잡이 자산보다 **먼저** 한다 — draft 를 만들 때 tag_name 을 실어 둔다.
    expect(wf).toMatch(/gh api -X POST .*releases[\s\S]*?-f tag_name=/);
    // 묶였는지 확인하지 않고 지나가면 실패가 스모크까지 밀려간다 — 거기서는 원인이 안 보인다.
    expect(wf).toContain('로 묶이지 않았다');
  });

  /**
   * v0.1.21 이 갈라진 자리.
   *
   * 네 OS 잡이 동시에 출발하는데, electron-publish 의 `getOrCreateRelease()` 는 릴리스 목록에서
   * `tag_name` 이 태그(또는 버전)와 같은 것만 재사용한다. GitHub 은 draft 에 태그를 걸지 않으므로
   * (`untagged-<id>`) 먼저 도착한 잡이 만든 draft 를 뒤따라온 잡이 자기 것이 아니라고 보고
   * **새로 만든다.** 실제로 draft 가 둘이 됐고 Linux 자산 4종만 태그 없는 쪽에 남아,
   * 스모크의 `gh release download <TAG> --pattern '*.AppImage'` 가 자산을 못 찾아 죽었다.
   * 검증이 실패했으니 공개 전환도 없었고 사이트의 최신 버전은 v0.1.20 에 멈춰 있었다.
   *
   * 고침은 순서다: 자리를 **먼저 하나 만들고** 태그를 박아 둔다. 그러면 네 잡이 전부 그것을 찾는다.
   * 이 배선이 풀리면 증상이 다음 릴리스에서야, 그것도 스모크 실패라는 엉뚱한 얼굴로 나타난다.
   */
  it('올릴 draft 를 먼저 만드는 준비 잡이 있고, 릴리스 잡 넷이 그것에 매여 있다', () => {
    const wf = read('.github/workflows/release.yml');
    expect(wf).toContain('prepare:');
    // 준비 잡이 릴리스 잡보다 먼저 돌아야 의미가 있다 — 이 줄이 떨어지면 넷이 다시 각자 만든다.
    expect(wf).toMatch(/release:\s*\n\s*needs:\s*prepare/);
  });

  it('자산이 여러 draft 로 갈라지면 릴리스가 실패한다 (조용히 지나가면 스모크에서야 드러난다)', () => {
    const wf = read('.github/workflows/release.yml');
    // 갈라짐을 세려면 draft 를 전부 봐야 한다 — 단건 조회로는 두 번째가 안 보인다.
    expect(wf).toContain('/releases?per_page=');
    expect(wf).toContain('자산이 갈라졌다');
  });
});

describe('release 완수 — 초록을 볼 때까지 간다', () => {
  const loadRetry = async (): Promise<Record<string, any>> =>
    await import(pathToFileURL(path.join(REPO, '.github/scripts/releaseRetry.mjs')).href);

  /** 워크플로 matrix 에서 실제 값들을 뽑는다 — 표가 현실과 어긋나면 재시도가 아무것도 못 짚는다. */
  const smokeLabels = (): string[] =>
    [...read('.github/workflows/smoke.yml').matchAll(/^\s*label:\s*(.+)$/gm)].map((m) => (m[1] ?? '').trim());
  const releaseScripts = (): string[] =>
    [...read('.github/workflows/release.yml').matchAll(/^\s*script:\s*(.+)$/gm)].map((m) => (m[1] ?? '').trim());

  it('재시도 판단표가 smoke.yml 의 실제 잡 라벨과 정확히 짝이다', async () => {
    const { PLATFORMS, platformForSmokeJob } = await loadRetry();
    const labels = smokeLabels();
    expect(labels.length).toBe(PLATFORMS.length);
    // 워크플로에 있는 라벨 하나하나가 표에서 **유일하게** 짚여야 한다. 한쪽만 고치면
    // 재시도는 조용히 "다시 지을 것 없음"으로 지나가고, 릴리스는 영영 draft 에 남는다.
    for (const label of labels) {
      const hit = platformForSmokeJob(`smoke (${label})`);
      expect(hit, `smoke 라벨 "${label}" 을 표가 못 짚는다`).not.toBeNull();
      expect(hit.smokeLabel).toBe(label);
    }
  });

  it('재시도 판단표가 release.yml 의 실제 빌드 잡과 정확히 짝이다', async () => {
    const { PLATFORMS, platformForReleaseJob } = await loadRetry();
    const scripts = releaseScripts();
    expect(scripts.length).toBe(PLATFORMS.length);
    for (const script of scripts) {
      // GitHub 이 조립하는 이름 그대로: `release (<os>, <script>)`
      const hit = platformForReleaseJob(`release (some-runner, ${script})`);
      expect(hit, `release script "${script}" 를 표가 못 짚는다`).not.toBeNull();
      expect(hit.script).toBe(script);
    }
    // mac 둘이 서로를 삼키지 않는가 — 부분문자열이라 가장 조용히 틀리는 자리다.
    expect(platformForReleaseJob('release (macos-15-intel, release:mac:x64)').key).toBe('mac-x64');
    expect(platformForReleaseJob('release (macos-latest, release:mac:arm64)').key).toBe('mac-arm64');
  });

  it('깨진 플랫폼만 다시 짓는다 (넷을 다 짓는 것은 20분이 넘게 든다)', async () => {
    const { planRepair } = await loadRetry();
    const jobs = [
      { name: 'smoke (linux-x64 (AppImage))', conclusion: 'success' },
      { name: 'smoke (mac-arm64 (dmg))', conclusion: 'success' },
      { name: 'smoke (mac-x64 (dmg))', conclusion: 'success' },
      { name: 'smoke (win-x64 (nsis))', conclusion: 'failure' },
      { name: 'publish', conclusion: 'skipped' },
    ];
    const plan = planRepair(jobs);
    expect(plan.kind).toBe('rebuild');
    expect(plan.platforms.map((p: any) => p.key)).toEqual(['win']);
  });

  it('설치는 다 통과했는데 빨가면 먼저 재검증만 한다 (그래도 빨가면 그때 전부 다시 짓는다)', async () => {
    const { planRepair, PLATFORMS } = await loadRetry();
    const jobs = [
      { name: 'smoke (linux-x64 (AppImage))', conclusion: 'success' },
      { name: 'smoke (mac-arm64 (dmg))', conclusion: 'success' },
      { name: 'smoke (mac-x64 (dmg))', conclusion: 'success' },
      { name: 'smoke (win-x64 (nsis))', conclusion: 'success' },
      { name: 'publish', conclusion: 'failure' },
    ];
    expect(planRepair(jobs).kind).toBe('reverify');
    const second = planRepair(jobs, { reverifyTried: true });
    expect(second.kind).toBe('rebuild');
    expect(second.platforms.length).toBe(PLATFORMS.length);
  });

  // ⚠️ `scripts/release.mjs` 는 **개인 자산**이라 공개 저장소에 없다(`.gitignore: /scripts/*.mjs`).
  //    CI 체크아웃에는 파일 자체가 없으니 **있을 때만** 잰다 — 없다고 실패시키면 CI 가 영영 빨갛다.
  //    (위의 표·워크플로 검사는 공개 파일만 보므로 CI 에서도 그대로 돈다. 그래서 표를
  //     `.github/scripts/` 로 옮겼다 — 정작 지켜야 할 어긋남이 저쪽에서 나기 때문이다.)
  const hasReleaseScript = fs.existsSync(path.join(REPO, 'scripts/release.mjs'));
  it.skipIf(!hasReleaseScript)('릴리스 스크립트의 완수 조건은 태그가 아니라 공개다', () => {
    const src = read('scripts/release.mjs');
    // 공개될 때까지 몰고 간다 — 한 번 재고 마는 함수로 되돌리면 "완수"가 다시 태그가 된다.
    expect(src).toContain('driveToPublished');
    // draft 로 끝나면 실패다. exitCode 를 지우면 백그라운드 실행에서 성공으로 읽힌다.
    expect(src).toContain('process.exitCode = 1');
    expect(src).toContain('이 릴리스는 **완수되지 않았다**');
    // 25분짜리 재빌드로 가기 전에 값싼 원인(태그 미결합)을 먼저 배제한다.
    expect(src).toContain('ensureDraftTagBound');
  });
});
