import { SHELF_EXPORT_VERSION } from '@vibisual/shared';
import type { ShelfExport, ShelfItem } from '@vibisual/shared';

/**
 * §5.20 — 선반 내보내기·가져오기(파일 입출력).
 *
 * 파일을 만드는 것과 고르는 것은 브라우저(렌더러)만 할 수 있으므로 **여기가 클라이언트 몫**이고,
 * 가져온 내용의 판정은 서버가 shared 순수 함수 `normalizeShelfImport` 로 한다(§7.18) — 이 파일은
 * 읽고 넘길 뿐 항목을 만들지 않는다.
 */

/** 내보낼 때 런타임 필드는 담지 않는다 — 남의 기계에서 의미가 없거나 우리 상태를 덮어쓴다. */
export function toShelfExport(title: string, items: ShelfItem[]): ShelfExport {
  return {
    version: SHELF_EXPORT_VERSION,
    ...(title.trim() ? { title: title.trim() } : {}),
    items: items.map((i) => ({
      label: i.label,
      kind: i.kind,
      ...(i.kind === 'command' ? { command: i.command ?? '' } : { prompt: i.prompt ?? '' }),
      icon: i.icon,
      color: i.color,
    })),
  };
}

function slugify(title: string): string {
  const base = title.trim().replace(/[^\w가-힣-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'shelf';
}

/** 선반 한 장을 JSON 파일로 내려받는다. */
export function exportShelfFile(input: { version: number; title: string; items: ShelfItem[] }): void {
  const payload = toShelfExport(input.title, input.items);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(input.title)}.shelf.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 revoke 하면 브라우저에 따라 다운로드가 취소된다 — 한 틱 뒤에 푼다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 선반 파일 한 장을 고르게 하고 **원문 그대로** 돌려준다(판정은 서버가 한다).
 * 취소하거나 JSON 이 아니면 `null`.
 */
export function pickShelfFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => {
        try {
          resolve(JSON.parse(text) as unknown);
        } catch {
          resolve(null);
        }
      }).catch(() => resolve(null));
    };
    // 사용자가 창을 그냥 닫으면 change 가 안 오므로 열어 두고 기다린다(다음 시도에서 새 input 을 만든다).
    input.click();
  });
}
