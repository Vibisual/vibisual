import { describe, expect, it } from 'vitest';
import { findAppToolScriptEvidence, readAppToolInvocation } from '@vibisual/shared';
import { VIDEO_AGENT_TOOL_RULE, videoLinkDenyReason, videoLinkPointer } from './agentLink.js';

const script = (text: string): string | null => findAppToolScriptEvidence(text, VIDEO_AGENT_TOOL_RULE);
const direct = (command: string): string | null => readAppToolInvocation('Bash', { command }, VIDEO_AGENT_TOOL_RULE).direct;

describe('Vibistudio 연결 강제 규칙', () => {
  it('프레임을 합치는 렌더 스크립트를 잡는다', () => {
    expect(script(`const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', temp]);`)).toBe('ffmpeg');
  });

  it('소리 마스터링 스크립트는 통과한다', () => {
    expect(script(`subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", "loudnorm", "-c:a", "pcm_s24le", str(out)])`)).toBeNull();
  });

  it('필름 훑기(입력만 영상, 결과는 이미지)는 통과한다', () => {
    const text = `"""Usage: scan_film.py <film.mp4> <out.jpg>"""
command = ["ffmpeg", "-hide_banner", "-i", path, "-vf", "scale=320:-2", "-an", "-f", "null", "-"]
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1", "-i", film, "-frames:v", "1", "-q:v", "3", "a.jpg"])`;
    expect(script(text)).toBeNull();
  });

  it('다른 영상 프레임워크와 라이브러리를 잡는다', () => {
    expect(direct('npx hyperframes render')).toBe('hyperframes');
    expect(direct('pnpm exec remotion render')).toBe('remotion');
    expect(script('from moviepy.editor import concatenate_videoclips')).not.toBeNull();
    expect(script('cv2.VideoWriter(path, fourcc, 30, size)')).toBe('VideoWriter');
  });

  it('GIF·하드웨어 인코더도 영상 출력이다', () => {
    expect(direct('ffmpeg -i a.png b.gif')).toBe('ffmpeg');
    expect(direct('ffmpeg -i a.png -c:v h264_nvenc b.bin')).toBe('ffmpeg');
  });

  it('안내와 거부 사유는 문서를 말하고 토큰 값은 싣지 않는다', () => {
    const target = { id: 'app-a', ref: 'vid-1', projectName: 'demo' };
    for (const text of [videoLinkPointer(target), videoLinkDenyReason(target, 'ffmpeg')]) {
      expect(text).toContain('vid-1');
      expect(text).toContain('/api/app/vibistudio/guide');
      expect(text).toContain('$VIBISUAL_TOKEN');
    }
    expect(videoLinkDenyReason(target, 'ffmpeg')).toContain('NOT run');
  });

  it('문서가 없으면 만드는 길을 말한다', () => {
    expect(videoLinkPointer({ id: 'app-a', projectName: 'demo' })).toContain('/api/app/vibistudio/docs');
  });
});
