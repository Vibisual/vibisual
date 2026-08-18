/**
 * 기본 씬 모음 (SCENARIO.md §5.13 (E)).
 *
 * canvas2d 백엔드에서 바로 쓸 수 있는 씬들이다. 아무 씬도 없이 출발하면 "설치는
 * 했는데 화면에 아무것도 안 나오는" 상태가 기본값이 되므로, 자주 쓰는 형태 몇 개를
 * 처음부터 넣는다.
 *
 * 모든 씬이 지키는 규칙: **시각 t 를 받아 값만 뽑는다.** 안에서 상태를 들거나 매
 * 프레임 새 객체를 만들지 않는다 — 그게 "쓸수록 느려지는" 형태의 시작점이다.
 */

import type { Ctx2D, SceneDrawFn, SceneEnv } from './canvas2d.js';
import { wrapText } from './canvas2d.js';
import type { DrawOp } from './drawList.js';

/** 부드럽게 들어오고 나가는 곡선. 선형 이동은 기계처럼 보인다. */
export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
}

/** 앞부분 `sec` 초 동안의 등장 진행률. */
function intro(op: DrawOp, sec: number): number {
  return sec <= 0 ? 1 : easeOutCubic(Math.min(1, op.localTime / sec));
}

function prop(op: DrawOp, key: string, fallback: string): string {
  const v = op.resolved.item.props?.[key];
  return typeof v === 'string' ? v : fallback;
}

function propNum(op: DrawOp, key: string, fallback: number): number {
  const v = op.resolved.item.props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function propList(op: DrawOp, key: string): string[] {
  const v = op.resolved.item.props?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** 제목 화면 — 큰 제목과 부제가 아래에서 올라온다. */
const title: SceneDrawFn = (ctx, op, env) => {
  const { width, height } = op.transform;
  const t = prop(op, 'title', '');
  const sub = prop(op, 'subtitle', '');
  const color = prop(op, 'color', '#FFFFFF');
  const accent = prop(op, 'accent', '#3B82F6');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.085));
  const p = intro(op, 0.5);

  ctx.save();
  ctx.translate(0, (1 - p) * 40);
  ctx.globalAlpha = p;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px sans-serif`;

  const lines = wrapText(ctx, t, width * 0.82);
  const step = size * 1.18;
  let y = height / 2 - (step * lines.length) / 2 + step / 2 - (sub === '' ? 0 : size * 0.5);
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += step;
  }

  if (sub !== '') {
    ctx.fillStyle = accent;
    ctx.font = `600 ${Math.round(size * 0.42)}px sans-serif`;
    ctx.fillText(sub, width / 2, y + size * 0.35);
  }
  ctx.restore();
};

/** 아래쪽 이름표 — 왼쪽에서 밀려 들어온다. */
const lowerThird: SceneDrawFn = (ctx, op, env) => {
  const { height } = op.transform;
  const name = prop(op, 'name', '');
  const role = prop(op, 'role', '');
  const accent = prop(op, 'accent', '#3B82F6');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.038));
  const p = intro(op, 0.45);

  const padX = size * 0.9;
  const padY = size * 0.6;
  ctx.save();
  ctx.font = `700 ${size}px sans-serif`;
  const nameW = ctx.measureText(name).width;
  ctx.font = `500 ${Math.round(size * 0.66)}px sans-serif`;
  const roleW = role === '' ? 0 : ctx.measureText(role).width;
  const boxW = Math.max(nameW, roleW) + padX * 2;
  const boxH = role === '' ? size + padY * 2 : size * 1.9 + padY * 2;
  const boxX = size * 1.4 - (1 - p) * 80;
  const boxY = height - boxH - size * 2.4;

  ctx.globalAlpha = p;
  ctx.fillStyle = 'rgba(9,12,20,0.86)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(boxX, boxY, boxW, boxH, 10);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.fillRect(boxX, boxY, 5, boxH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${size}px sans-serif`;
  ctx.fillText(name, boxX + padX, boxY + padY + size * 0.82);
  if (role !== '') {
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = `500 ${Math.round(size * 0.66)}px sans-serif`;
    ctx.fillText(role, boxX + padX, boxY + padY + size * 1.72);
  }
  ctx.restore();
};

/** 항목 목록 — 하나씩 차례로 나타난다. */
const bulletList: SceneDrawFn = (ctx, op, env) => {
  const { width, height } = op.transform;
  const heading = prop(op, 'heading', '');
  const items = propList(op, 'items');
  const accent = prop(op, 'accent', '#3B82F6');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.045));
  const stagger = propNum(op, 'stagger', 0.28);

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const left = width * 0.12;
  let y = height * 0.28;

  if (heading !== '') {
    ctx.globalAlpha = intro(op, 0.4);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${Math.round(size * 1.5)}px sans-serif`;
    ctx.fillText(heading, left, y);
    y += size * 2.1;
  }

  ctx.font = `500 ${size}px sans-serif`;
  items.forEach((text, i) => {
    const p = easeOutCubic(Math.min(1, Math.max(0, (op.localTime - 0.35 - i * stagger) / 0.42)));
    if (p <= 0) return;
    ctx.globalAlpha = p;
    const dx = (1 - p) * 26;

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(left + 8 + dx, y, size * 0.19, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    const lines = wrapText(ctx, text, width - left * 2 - size);
    let ly = y;
    for (const line of lines) {
      ctx.fillText(line, left + size * 0.85 + dx, ly);
      ly += size * 1.25;
    }
    y = ly + size * 0.55;
  });

  ctx.restore();
};

/** 코드 상자 — 줄이 위에서부터 타이핑되듯 드러난다. */
const codeBlock: SceneDrawFn = (ctx, op, env) => {
  const { width, height } = op.transform;
  const lines = propList(op, 'lines');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.032));
  const perLine = propNum(op, 'perLine', 0.14);
  const family = prop(op, 'fontFamily', 'ui-monospace, monospace');

  const padding = size * 1.4;
  const boxX = width * 0.08;
  const boxW = width * 0.84;
  const boxH = Math.min(height * 0.8, lines.length * size * 1.55 + padding * 2);
  const boxY = (height - boxH) / 2;

  ctx.save();
  ctx.globalAlpha = intro(op, 0.35);
  ctx.fillStyle = 'rgba(12,16,26,0.94)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(boxX, boxY, boxW, boxH, 14);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = `500 ${size}px ${family}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  lines.forEach((line, i) => {
    const p = Math.min(1, Math.max(0, (op.localTime - 0.3 - i * perLine) / 0.2));
    if (p <= 0) return;
    ctx.globalAlpha = p;
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fillText(String(i + 1).padStart(2, ' '), boxX + padding * 0.6, boxY + padding + i * size * 1.55 + size * 0.5);
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(line, boxX + padding * 2.1, boxY + padding + i * size * 1.55 + size * 0.5);
  });

  ctx.restore();
};

/** 인용 — 큰 따옴표와 함께 가운데. */
const quote: SceneDrawFn = (ctx, op, env) => {
  const { width, height } = op.transform;
  const text = prop(op, 'text', '');
  const by = prop(op, 'by', '');
  const accent = prop(op, 'accent', '#3B82F6');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.058));
  const p = intro(op, 0.5);

  ctx.save();
  ctx.globalAlpha = p;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = accent;
  ctx.font = `800 ${size * 2.4}px Georgia, serif`;
  ctx.fillText('“', width / 2, height * 0.28);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${size}px sans-serif`;
  const lines = wrapText(ctx, text, width * 0.74);
  const step = size * 1.34;
  let y = height / 2 - (step * lines.length) / 2 + step / 2;
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += step;
  }

  if (by !== '') {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `500 ${Math.round(size * 0.5)}px sans-serif`;
    ctx.fillText(`— ${by}`, width / 2, y + size * 0.6);
  }
  ctx.restore();
};

/** 단색 배경 — 다른 것 뒤에 까는 용도. */
const solid: SceneDrawFn = (ctx: Ctx2D, op: DrawOp, _env: SceneEnv) => {
  ctx.fillStyle = prop(op, 'color', '#0B1120');
  ctx.fillRect(0, 0, op.transform.width, op.transform.height);
};

/** 기본으로 딸려 오는 씬들. 호스트가 자기 씬을 더 얹을 수 있다. */
export const BUILTIN_SCENES: Readonly<Record<string, SceneDrawFn>> = {
  title,
  lowerThird,
  bulletList,
  codeBlock,
  quote,
  solid,
};

/** 기본 씬에 호스트 씬을 합친다. 같은 이름이면 호스트 것이 이긴다. */
export function withBuiltinScenes(extra?: Readonly<Record<string, SceneDrawFn>>): Record<string, SceneDrawFn> {
  return { ...BUILTIN_SCENES, ...(extra ?? {}) };
}
