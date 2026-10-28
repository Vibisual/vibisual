import { useTranslation } from 'react-i18next';

import { useGraphStore } from '../../stores/graphStore.js';
import { formatBytes } from '../../hooks/useLocalLlm.js';
import { LimitGauge } from './LimitGauge.js';
import { CpuIcon, RamIcon, DeviceIcon } from './resourceIcons.js';

/** 올모델 탭 — 이 PC 의 자원 계기판(§5.19 (F)): 로컬 모델의 비용은 CPU·메모리·VRAM 이다. 못 잰 값은 `--%`(§5.19 (E)). */

/** 라벨 앞 글리프 한 칸 — 게이지는 라벨을 문자열로만 받으므로 여기서 감싼다. */
function ResourceRow({ icon, children }: { icon: React.JSX.Element; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-gray-500">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** 쓴 비율(0~100). 전체가 0이면 잴 수 없다는 뜻이라 `undefined`(= `--%`). */
function usedPercentOf(totalBytes: number, freeBytes: number): number | undefined {
  if (totalBytes <= 0) return undefined;
  return ((totalBytes - freeBytes) / totalBytes) * 100;
}

/** `formatBytes` 는 0 에 빈 문자열을 준다 — 여기 0 은 실제 0바이트라 `0B` 로 채운다. */
const bytes = (n: number): string => formatBytes(n) || '0B';

export function LocalResourceSection(): React.JSX.Element {
  const { t } = useTranslation();
  const local = useGraphStore((s) => s.localLlm);
  const hw = local?.hardware ?? null;
  const models = local?.models ?? [];
  const loadedIds = local?.loaded ?? [];

  // id 만으로는 무엇이 메모리를 쥐고 있는지 사용자가 알 수 없다 — 목록에서 이름을 되찾는다.
  const loadedList = loadedIds.map((id) => ({ id, name: models.find((m) => m.id === id)?.name ?? id }));

  if (!hw) {
    return <p className="p-4 text-xs text-gray-400">{t('panel.usage.hwUnknown')}</p>;
  }

  const cpuKnown = hw.cpuCores > 0 && hw.cpuUsagePercent >= 0;
  const cpuHint = hw.cpuCores > 0
    ? (hw.cpuModel
        ? t('panel.usage.hwCpuHint', { model: hw.cpuModel, cores: hw.cpuCores })
        : t('panel.usage.hwCores', { cores: hw.cpuCores }))
    : t('panel.usage.hwCpuUnreadable');

  return (
    <div className="flex flex-col gap-4 p-4">
      <ResourceRow icon={<CpuIcon />}>
        <LimitGauge label={t('panel.usage.hwCpu')} used={cpuKnown ? hw.cpuUsagePercent : undefined} hint={cpuHint} />
      </ResourceRow>

      <ResourceRow icon={<RamIcon />}>
        <LimitGauge
          label={t('panel.usage.hwRam')}
          used={usedPercentOf(hw.totalRamBytes, hw.freeRamBytes)}
          hint={hw.totalRamBytes > 0
            ? t('panel.usage.hwBytes', {
                used: bytes(hw.totalRamBytes - hw.freeRamBytes),
                total: bytes(hw.totalRamBytes),
              })
            : undefined}
        />
      </ResourceRow>

      {hw.devices.map((d) => (
        <ResourceRow key={d.name} icon={<DeviceIcon />}>
          <LimitGauge
            label={d.name}
            used={usedPercentOf(d.totalBytes, d.freeBytes)}
            hint={t('panel.usage.hwBytes', {
              used: bytes(d.totalBytes - d.freeBytes),
              total: bytes(d.totalBytes),
            })}
            subdued
          />
        </ResourceRow>
      ))}

      {/* 가속 장치가 없는 것과 아직 못 읽은 것은 다르다 — 엔진이 있어야 장치를 물어볼 수 있다. */}
      {hw.devices.length === 0 && (
        <p className="text-[12px] text-gray-500">
          {hw.measuredAt > 0 ? t('panel.usage.hwNoDevice') : t('panel.usage.hwDevicesUnknown')}
        </p>
      )}

      {/* §5.19 (F) — 같은 모델을 문 버블들은 한 인스턴스를 공유하고, 다른 모델은 각자 메모리를 쥔다. */}
      <div className="flex flex-col gap-1.5 border-t border-gray-700/70 pt-3">
        <span className="text-xs font-semibold text-gray-200">{t('panel.usage.hwLoaded')}</span>
        {loadedList.length === 0
          ? <span className="text-[12px] text-gray-500">{t('panel.usage.hwLoadedNone')}</span>
          : <div className="flex flex-wrap gap-1">
              {loadedList.map((m) => (
                <span key={m.id} className="max-w-full truncate rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[12px] text-gray-300" title={m.name}>
                  {m.name}
                </span>
              ))}
            </div>}
      </div>

      <p className="text-[12px] leading-relaxed text-gray-500">{t('panel.usage.hwHint')}</p>
    </div>
  );
}
