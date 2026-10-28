import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isMobileAddressReachable, type MobileAddressEntry, type MobileAddressKind } from '@vibisual/shared';

// §4 — 모바일 접속 주소 목록. 진짜 랜·Tailscale·WSL 주소가 구별되게, 서버(desktop main)가 판정한 `MobileAddressEntry` 를 가공 없이 셋으로 그린다
// (추천 하나 · 조건부 · 폰에서 안 되는 것은 접어서 — 지우지 않는다: 감추면 되는 예외까지 사라진다).

/** 종류 배지 문구의 i18n 키 — QR 대상 칩도 같은 말을 써야 두 목록이 어긋나지 않는다. */
export function mobileAddressKindLabelKey(kind: MobileAddressKind): string {
  return `panel.mobileAccess.addr.kind.${kind}`;
}

/** 종류별 아이콘 — lucide 톤 stroke SVG(이모지 ❌). 색은 `currentColor` 라 부모가 정한다. */
function KindIcon({ kind, className }: { kind: MobileAddressKind; className: string }): React.JSX.Element {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.5',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'lan': // wifi
      return (
        <svg {...common}>
          <path d="M5 13a10 10 0 0 1 14 0" /><path d="M8.5 16.5a5 5 0 0 1 7 0" />
          <path d="M2 8.82a15 15 0 0 1 20 0" /><path d="M12 20h.01" />
        </svg>
      );
    case 'vpn': // shield
      return (
        <svg {...common}>
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'external': // globe
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" /><path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case 'virtual': // box
      return (
        <svg {...common}>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
        </svg>
      );
    case 'linkLocal': // unplug
      return (
        <svg {...common}>
          <path d="m19 5 3-3" /><path d="m2 22 3-3" />
          <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
          <path d="M7.5 13.5 10 11" /><path d="M10.5 16.5 13 14" />
          <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
        </svg>
      );
    default: // circle-help
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
        </svg>
      );
  }
}

/** 종류별 색 — 되는 것(초록)·조건부(하늘)·안 되는 것(회색) 세 톤만 쓴다. */
function toneOf(kind: MobileAddressKind): { text: string; border: string; bg: string } {
  if (kind === 'lan') return { text: 'text-emerald-300', border: 'border-emerald-500/25', bg: 'bg-emerald-500/[0.07]' };
  if (kind === 'vpn' || kind === 'external') return { text: 'text-sky-300', border: 'border-sky-500/25', bg: 'bg-sky-500/[0.07]' };
  return { text: 'text-gray-400', border: 'border-white/[0.06]', bg: 'bg-black/20' };
}

function CopyButton({ url, copied, onCopy }: { url: string; copied: boolean; onCopy: (url: string) => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => onCopy(url)}
      title={copied ? t('panel.mobileAccess.addr.copied') : t('panel.mobileAccess.addr.copy')}
      aria-label={copied ? t('panel.mobileAccess.addr.copied') : t('panel.mobileAccess.addr.copy')}
      className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12px] transition-colors pointer-coarse:py-2 ${
        copied ? 'text-emerald-300' : 'text-gray-400 hover:bg-white/[0.08] hover:text-gray-200'
      }`}
    >
      {copied ? (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
      {copied ? t('panel.mobileAccess.addr.copied') : t('panel.mobileAccess.addr.copy')}
    </button>
  );
}

/** 이 주소가 무엇이고 언제 열리는지 한 줄. 제품 이름을 알아냈으면 그 이름으로 말한다. */
function KindHint({ entry }: { entry: MobileAddressEntry }): React.JSX.Element {
  const { t } = useTranslation();
  const { kind, product } = entry;
  if (kind === 'vpn') {
    return (
      <>
        {product !== null
          ? t('panel.mobileAccess.addr.hint.vpnNamed', { product })
          : t('panel.mobileAccess.addr.hint.vpn')}
      </>
    );
  }
  if (kind === 'virtual') {
    return (
      <>
        {product !== null
          ? t('panel.mobileAccess.addr.hint.virtualNamed', { product })
          : t('panel.mobileAccess.addr.hint.virtual')}
      </>
    );
  }
  return <>{t(`panel.mobileAccess.addr.hint.${kind}`)}</>;
}

/** 어댑터 이름 꼬리표 — 사용자가 자기 PC 의 네트워크 목록에서 본 그 이름과 이어 준다. */
function AdapterTag({ entry }: { entry: MobileAddressEntry }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (entry.adapter.trim() === '') return null;
  return (
    <span className="text-[12px] text-gray-500">
      {t('panel.mobileAccess.addr.adapter', { name: entry.adapter })}
    </span>
  );
}

interface RowProps {
  entry: MobileAddressEntry;
  copiedUrl: string | null;
  onCopy: (url: string) => void;
}

/** 추천 주소 — 이 창에서 사용자가 볼 단 하나의 답. 크게, 복사 버튼과 함께. */
function RecommendedCard({ entry, copiedUrl, onCopy }: RowProps): React.JSX.Element {
  const { t } = useTranslation();
  const tone = toneOf(entry.kind);
  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg} px-3 py-2.5`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <KindIcon kind={entry.kind} className={`h-3.5 w-3.5 shrink-0 ${tone.text}`} />
        <span className={`text-[12px] font-semibold ${tone.text}`}>
          {t('panel.mobileAccess.addr.recommended')}
        </span>
        <span className="text-[12px] text-gray-500">·</span>
        <span className="text-[12px] text-gray-400">{t(mobileAddressKindLabelKey(entry.kind))}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 break-all font-mono text-[14px] font-medium text-white">{entry.url}</span>
        <CopyButton url={entry.url} copied={copiedUrl === entry.url} onCopy={onCopy} />
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-gray-400">
        <KindHint entry={entry} />
      </p>
      <div className="mt-0.5">
        <AdapterTag entry={entry} />
      </div>
    </div>
  );
}

/** 추천이 아닌 주소 한 줄 — 조건이 붙지만 실제로 열릴 수 있는 것들. */
function AddressRow({ entry, copiedUrl, onCopy }: RowProps): React.JSX.Element {
  const { t } = useTranslation();
  const tone = toneOf(entry.kind);
  return (
    <div className="rounded-md border border-white/[0.06] bg-black/25 px-3 py-2">
      {/* 폰 폭에서는 주소가 종류·[복사] 사이에 100px 남짓만 받아 포트가 잘렸다 — 그때는 주소를 아랫줄로 내려
          한 줄을 다 쓰고 줄을 바꾼다(주소는 사용자가 옮겨 적는 값이라 … 로 자르면 안 된다). */}
      <div className="flex items-center gap-2 max-md:flex-wrap">
        <KindIcon kind={entry.kind} className={`h-3.5 w-3.5 shrink-0 ${tone.text}`} />
        <span className={`shrink-0 text-[12px] font-medium max-md:flex-1 ${tone.text}`}>
          {t(mobileAddressKindLabelKey(entry.kind))}
        </span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[13px] text-gray-300 max-md:order-last max-md:basis-full max-md:whitespace-normal max-md:break-all max-md:text-left" title={entry.url}>
          {entry.url}
        </span>
        <CopyButton url={entry.url} copied={copiedUrl === entry.url} onCopy={onCopy} />
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
        <KindHint entry={entry} />
      </p>
      <div>
        <AdapterTag entry={entry} />
      </div>
    </div>
  );
}

/** 폰에서 구조적으로 안 되는 주소들 — 기본 접힘. 왜 안 되는지는 펼치면 각자 말한다. */
function BlockedGroup({ entries }: { entries: MobileAddressEntry[] }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] text-gray-500 transition-colors hover:text-gray-300"
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        {t('panel.mobileAccess.addr.blockedToggle', { count: entries.length })}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {entries.map((entry) => (
            <div key={entry.url} className="rounded-md border border-white/[0.05] bg-black/20 px-3 py-2">
              <div className="flex items-center gap-2">
                <KindIcon kind={entry.kind} className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                <span className="shrink-0 text-[12px] text-gray-500">
                  {entry.product ?? t(mobileAddressKindLabelKey(entry.kind))}
                </span>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-gray-500" title={entry.url}>
                  {entry.address}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                <KindHint entry={entry} />
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MobileAddressListProps {
  /** 서버가 판정·정렬해 넘긴 목록 그대로. 여기서 다시 거르거나 순서를 바꾸지 않는다. */
  addresses: MobileAddressEntry[];
}

export function MobileAddressList({ addresses }: MobileAddressListProps): React.JSX.Element {
  const { t } = useTranslation();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const handleCopy = useCallback((url: string) => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 1_500);
    }).catch(() => {
      // 클립보드 권한이 없는 환경 — 주소는 화면에 그대로 있으므로 조용히 넘어간다.
    });
  }, []);

  const usable = addresses.filter((a) => isMobileAddressReachable(a.kind));
  const blocked = addresses.filter((a) => !isMobileAddressReachable(a.kind));
  const recommended = usable.find((a) => a.recommended) ?? null;
  const others = usable.filter((a) => a !== recommended);

  return (
    <div>
      {recommended !== null && (
        <RecommendedCard entry={recommended} copiedUrl={copiedUrl} onCopy={handleCopy} />
      )}

      {usable.length === 0 && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-300">
          {t('panel.mobileAccess.addr.noneUsable')}
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-gray-500">
            {t('panel.mobileAccess.addr.others')}
          </div>
          <div className="space-y-1">
            {others.map((entry) => (
              <AddressRow key={entry.url} entry={entry} copiedUrl={copiedUrl} onCopy={handleCopy} />
            ))}
          </div>
        </div>
      )}

      {blocked.length > 0 && <BlockedGroup entries={blocked} />}
    </div>
  );
}
