/**
 * 첨부 썸네일 URL 해석 단위 테스트.
 *
 * 여기서 URL 이 안 나오면 화면에는 **그냥 아무것도 없다**(오류도 빈칸도 아니라 목록에서 걸러진다).
 * 그래서 조용히 틀리기 쉬운 자리다 — 검증 시연 프레임이 실제로 그렇게 한 장도 안 떴다.
 */

import { describe, it, expect } from 'vitest';
import { basenameOf, buildAttachmentFetchUrl } from './attachmentThumb.js';

describe('basenameOf', () => {
  it('윈도·POSIX 구분자를 모두 처리한다', () => {
    expect(basenameOf('C:\\a\\b\\0.png')).toBe('0.png');
    expect(basenameOf('/a/b/0.png')).toBe('0.png');
  });
});

describe('buildAttachmentFetchUrl — paste 첨부', () => {
  it('`<sessionId>/<파일>` 을 세션 라우트로 푼다', () => {
    const url = buildAttachmentFetchUrl('C:/p/.vibisual/attachments/custom-1/abc.png');
    expect(url).toBe('/api/agent-attachments/custom-1/file?rel=abc.png');
  });

  it('하위 폴더(subAgentId)가 끼어도 rel 로 이어 붙인다', () => {
    const url = buildAttachmentFetchUrl('C:\\p\\.vibisual\\attachments\\custom-1\\sub-9\\abc.png');
    expect(url).toBe('/api/agent-attachments/custom-1/file?rel=sub-9%2Fabc.png');
  });

  it('세션 칸만 있고 파일이 없으면 URL 을 만들지 않는다', () => {
    expect(buildAttachmentFetchUrl('C:/p/.vibisual/attachments/custom-1')).toBeNull();
  });
});

describe('buildAttachmentFetchUrl — 시연 프레임(⑨)', () => {
  // 검증 명령은 사본을 뜨지 않고 `.vibisual/verify-demos/<demoId>/N.png` 원본을 그대로 가리킨다.
  // 이 갈래가 없으면 명령 카드에 그림이 한 장도 뜨지 않는다.
  it('시연 폴더 경로를 시연 프레임 라우트로 푼다', () => {
    const url = buildAttachmentFetchUrl('C:/p/.vibisual/verify-demos/demo-77/0.png');
    expect(url).toBe('/api/verification-demos/demo-77/frame?rel=demo-77%2F0.png');
  });

  it('윈도 구분자도 같은 답을 준다', () => {
    expect(buildAttachmentFetchUrl('C:\\p\\.vibisual\\verify-demos\\demo-77\\3.png'))
      .toBe('/api/verification-demos/demo-77/frame?rel=demo-77%2F3.png');
  });

  it('시연 id 만 있고 파일이 없으면 URL 을 만들지 않는다', () => {
    expect(buildAttachmentFetchUrl('C:/p/.vibisual/verify-demos/demo-77')).toBeNull();
  });

  it('두 갈래 어디에도 없으면 null(엉뚱한 경로를 서버에 묻지 않는다)', () => {
    expect(buildAttachmentFetchUrl('C:/p/somewhere/0.png')).toBeNull();
  });
});
