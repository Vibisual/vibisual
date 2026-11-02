import { isFolderContextMenuEnabled, type FolderContextMenuStatus, type UiLocale } from '@vibisual/shared';
import { userDefaultsService } from './userDefaultsService.js';

/** §4 폴더 우클릭으로 프로젝트 열기 — desktop main 이 OS 메뉴를 적을 때 따르는 값. 메뉴 글자는 UI 언어로 쓴다. */
export interface FolderContextMenuWish {
  enabled: boolean;
  locale: UiLocale;
}

/**
 * 서버는 OS 메뉴를 직접 만지지 않는다 — 바람을 desktop main 에 넘기고, main 이 적은 결과(상태)를 받아 옵션창에 보인다.
 * 언어는 user-defaults 를 먼저 본다: `PUT /api/ui-locale` 은 user-defaults 를 저장한 **뒤** graphManager 를 바꿔, 알림 시점엔 그쪽이 옛 값이다.
 */
export class FolderContextMenuService {
  private status: FolderContextMenuStatus | null = null;

  constructor(private readonly fallbackLocale: () => UiLocale) {}

  wish(): FolderContextMenuWish {
    const defaults = userDefaultsService.get();
    return {
      enabled: isFolderContextMenuEnabled(defaults),
      locale: defaults.appearance?.uiLocale ?? this.fallbackLocale(),
    };
  }

  /** 켬·언어가 실제로 바뀐 때만 부른다(다른 설정 저장마다 메뉴를 다시 적지 않게). */
  subscribe(cb: (wish: FolderContextMenuWish) => void): () => void {
    let last = JSON.stringify(this.wish());
    return userDefaultsService.subscribe(() => {
      const next = this.wish();
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      cb(next);
    });
  }

  setStatus(status: FolderContextMenuStatus): void {
    this.status = status;
  }

  /** 데스크톱이 아니면(브라우저 dev) 한 번도 채워지지 않아 null 이다. */
  getStatus(): FolderContextMenuStatus | null {
    return this.status;
  }
}
