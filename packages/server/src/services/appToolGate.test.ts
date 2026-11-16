import { describe, expect, it } from 'vitest';
import { findAppToolScriptEvidence, readAppToolInvocation, scriptLocalImports, type AppToolRule } from '@vibisual/shared';

const RULE: AppToolRule = {
  commands: ['remotion', 'manim'],
  outputCommands: ['ffmpeg'],
  outputPattern: /\.(?:mp4|mov|webm|gif)\b|\blibx26[45]\b|(?:^|\s|['"])-c:v\b/i,
  scriptMarkers: [/\bmoviepy\b/i],
};

const direct = (command: string, tool = 'Bash'): string | null => readAppToolInvocation(tool, { command }, RULE).direct;

describe('readAppToolInvocation — 앱 밖에서 결과물을 굽는 호출', () => {
  it('영상을 내는 ffmpeg 는 막고, 앞에 cd·변수가 있어도 본다', () => {
    expect(direct('ffmpeg -i a.png -c:v libx264 out.mp4')).toBe('ffmpeg');
    expect(direct('cd "C:/p" && E=ep; ffmpeg -y -i $E/a.wav $E/final.mp4')).toBe('ffmpeg');
    expect(direct('& "C:\\tools\\ffmpeg.exe" -i a.png out.webm', 'PowerShell')).toBe('ffmpeg');
    expect(direct(`bash -lc 'ffmpeg -i a.png out.mp4'`)).toBe('ffmpeg');
  });

  it('영상이 입력일 뿐인 분석·소리 추출·정지 화면은 통과한다', () => {
    expect(direct('ffmpeg -hide_banner -i final.mp4 -map 0:a -af ebur128=peak=true -f null -')).toBeNull();
    expect(direct('ffmpeg -i final.mp4 -vn out.wav')).toBeNull();
    expect(direct('ffmpeg -ss 10 -i final.mp4 -frames:v 1 still.png')).toBeNull();
    expect(direct('ffprobe -v error final.mp4')).toBeNull();
  });

  it('다른 영상 도구는 명령 자리에 서면 막고, 인자로 스치기만 하면 통과한다', () => {
    expect(direct('manim -ql scene.py')).toBe('manim');
    expect(direct('npx remotion render')).toBe('remotion');
    expect(direct('pnpm dlx @remotion/cli render')).toBe('remotion');
    expect(direct('grep -r remotion src')).toBeNull();
    expect(direct('echo ffmpeg out.mp4')).toBeNull();
  });

  it('셸 도구가 아니면 보지 않는다', () => {
    expect(readAppToolInvocation('Read', { command: 'ffmpeg out.mp4' }, RULE).direct).toBeNull();
  });

  it('스크립트 파일은 cd·변수를 풀어 읽을 자리로 돌려준다', () => {
    const got = readAppToolInvocation('Bash', { command: 'cd /work && S=.claude/scripts; python -I -X utf8 $S/render.py --final' }, RULE);
    expect(got.scripts).toEqual(['/work/.claude/scripts/render.py']);
    expect(readAppToolInvocation('PowerShell', { command: '$S = "tools"; node $S/r.mjs' }, RULE).scripts).toEqual(['tools/r.mjs']);
    expect(readAppToolInvocation('Bash', { command: 'bun run tools/r.ts' }, RULE).scripts).toEqual(['tools/r.ts']);
  });

  it('heredoc·인라인 코드를 표시하고, npm run 은 패키지 스크립트로 돌려준다', () => {
    expect(readAppToolInvocation('Bash', { command: "python -I - <<'EOF'\nprint(1)\nEOF" }, RULE).inlineCode).toBe(true);
    expect(readAppToolInvocation('Bash', { command: 'python -c "print(1)"' }, RULE).inlineCode).toBe(true);
    expect(readAppToolInvocation('Bash', { command: 'cd web && npm run render' }, RULE).packageScripts).toEqual([{ dir: 'web', name: 'render' }]);
  });
});

describe('findAppToolScriptEvidence — 스크립트 내용', () => {
  it('영상을 내는 ffmpeg 호출과 라이브러리 표지를 잡는다', () => {
    expect(findAppToolScriptEvidence(`spawn('ffmpeg', ['-c:v', 'libx264', 'x.mp4'])`, RULE)).toBe('ffmpeg');
    expect(findAppToolScriptEvidence('from moviepy.editor import VideoFileClip', RULE)).toBe('moviepy');
    expect(findAppToolScriptEvidence(`subprocess.run(['manim', '-ql', 'a.py'])`, RULE)).toBe('manim');
  });

  it('소리만 다루는 ffmpeg 는 통과한다', () => {
    expect(findAppToolScriptEvidence(`subprocess.run(["ffmpeg", "-i", "-", "-c:a", "pcm_f32le", "voice.wav"])`, RULE)).toBeNull();
  });

  it('주석·문서 문자열의 파일 이름은 코드가 아니다', () => {
    const scan = `"""Usage: scan.py <film.mp4> <out.jpg>"""\n# writes out.mp4 someday\nsubprocess.run(["ffmpeg", "-i", film, "-frames:v", "1", "a.jpg"])`;
    expect(findAppToolScriptEvidence(scan, RULE)).toBeNull();
  });

  it('변수 이름에 스치기만 한 도구 이름은 잡지 않는다', () => {
    expect(findAppToolScriptEvidence('const remotion = 1; const manimal = 2;', RULE)).toBeNull();
  });
});

describe('scriptLocalImports', () => {
  it('파이썬은 파이썬 import 만, JS 는 상대 경로만 본다', () => {
    expect(scriptLocalImports('import os\nfrom planlib import Plan', 'a.py')).toEqual(['os.py', 'planlib.py']);
    expect(scriptLocalImports(`import fs from 'node:fs';\nimport { x } from './lib.mjs';\nrequire('./util');`, 'a.mjs'))
      .toEqual(['./lib.mjs', './util.js', './util.mjs', './util.cjs', './util.ts']);
  });
});
