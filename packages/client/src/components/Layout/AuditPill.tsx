import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { DEFAULT_AUDIT_BOUNDARY } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { findAuditLog } from '../../utils/auditLog.js';
import { AuditShieldGlyph } from '../AuditShieldGlyph.js';
import { AuditTimelinePopup } from '../Panel/AuditTimelinePopup.js';

// SCENARIO.md §5.22 / §7.20 — 헤더 감사 필.
//
// 비용 필(§7.19) 오른쪽에 붙어 **오늘 위험 호출 수** 한 값만 보여준다. 값이 없어도 숨기지
// 않는다 — 필이 사라지면 타임라인으로 들어갈 입구도 같이 사라지기 때문이고, 그 상태에선
// dim 한 `—` 로 둔다. 경계가 꺼진 프로젝트에서는 방패에 사선을 그어 "지금은 안 묻는다"를
// 필 하나로 알린다(§5.22 — **기본이 꺼짐**이라 손대지 않은 프로젝트는 사선이 정상이다).

export function AuditPill(): React.JSX.Element {
  const { t } = useTranslation();
  const auditLogs = useGraphStore((s) => s.auditLogs);
  const activeProject = useGraphStore((s) => s.activeProject);
  const open = useGraphStore((s) => s.auditPopupOpen);
  const setOpen = useGraphStore((s) => s.setAuditPopupOpen);

  const log = findAuditLog(auditLogs, activeProject);
  const todayRisky = log?.counts.todayRisky ?? 0;
  // 원장이 아직 없는 프로젝트도 **기본값 하나**를 따른다 — 여기서 종전 기본을 따로 적으면
  // 켠 적 없는 프로젝트가 필과 팝업에서 서로 다른 상태로 보인다(§5.22).
  const boundaryOff = !(log?.boundary.escalateRisky ?? DEFAULT_AUDIT_BOUNDARY.escalateRisky);

  // 색은 세 갈래뿐이다 — 경계가 꺼졌으면 회색(믿을 수 없다는 뜻이 아니라 "안 묻는다"),
  // 오늘 위험이 있으면 amber, 그 외는 dim.
  const tone = boundaryOff
    ? 'text-gray-500'
    : todayRisky > 0
      ? 'text-amber-400'
      : 'text-gray-500';
  const label = log && todayRisky > 0 ? String(todayRisky) : '—';
  const title = boundaryOff
    ? t('panel.audit.pillOff')
    : todayRisky > 0
      ? `${t('panel.audit.pillLabel')}: ${todayRisky}`
      : t('panel.audit.pillEmpty');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`app-nodrag flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold tabular-nums transition-colors duration-150 hover:bg-white/[0.08] ${tone}`}
      >
        <AuditShieldGlyph off={boundaryOff} />
        <span>{label}</span>
      </button>

      {/* Header 의 backdrop-filter 가 fixed 자식의 containing block 이 되므로 팝업은 body 로 portal 한다
          (§7.19 CostPill 과 같은 함정). */}
      {open && createPortal(<AuditTimelinePopup onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
