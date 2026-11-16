/** §5.13 (G)(T-2)(W) 37-16 — 에이전트가 읽는 규약 글(핵심·주제·합본·컴포지션 가이드·연출 규약). */
import type { Express } from 'express';
import { engineChromium } from './composition.js';
import {
  MOTION_CRAFT_GUIDE, VIBISTUDIO_AGENT_GUIDE, VIBISTUDIO_GUIDE_TOPICS, compositionGuideFor, fullGuideFor, guideTopicFor,
} from '../index.js';

const MARKDOWN = 'text/markdown; charset=utf-8';

export function mountGuideRoutes(app: Express): void {
  // 37-16 (A)(B) — 첫 바퀴에 읽는 핵심 글. 브리프·스튜디오 문맥·연결 강제 글이 모두 이 주소를 가리키므로 핵심이어야 첫 읽기가 준다.
  app.get('/guide', (_req, res) => {
    res.type(MARKDOWN).send(VIBISTUDIO_AGENT_GUIDE);
  });

  // 37-16 (A) — 주제 하나, `all` 이면 핵심 + 전 주제. 모르는 주제는 404 와 주제 목록(에이전트가 스스로 고쳐 부르게).
  app.get('/guide/:topic', (req, res) => {
    const topic = req.params.topic;
    const text = topic === 'all' ? fullGuideFor(engineChromium()) : guideTopicFor(topic, engineChromium());
    if (text === undefined) {
      res.status(404).type(MARKDOWN).send(`Unknown topic. Topics: ${VIBISTUDIO_GUIDE_TOPICS.map((t) => t.id).join(', ')}, all\n`);
      return;
    }
    res.type(MARKDOWN).send(text);
  });

  // §5.13 (W) 38-9 — 규약 글 끝에 렌더 엔진 줄(이 실행본의 Chromium)을 붙여 내준다. 37-16 (B) — 종전 글과 같은 바이트.
  app.get('/composition/guide', (_req, res) => {
    res.type(MARKDOWN).send(compositionGuideFor(engineChromium()));
  });

  // §5.13 (W) 38-8 — 연출 규약("어떻게 잘 만드나"). 컴포지션을 쓰기 전에 읽는다.
  app.get('/craft', (_req, res) => {
    res.type(MARKDOWN).send(MOTION_CRAFT_GUIDE);
  });
}
