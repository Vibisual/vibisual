import { useTranslation } from 'react-i18next';

import { useGraphStore } from '../../stores/graphStore.js';
import { formatBytes } from '../../hooks/useLocalLlm.js';
import { LimitGauge } from './LimitGauge.js';
import { CpuIcon, RamIcon, DeviceIcon } from './resourceIcons.js';

/**
 * 사용량 팝업의 **올모델 탭** — 이 PC 의 자원 계기판 (§5.19 (F) 「자원은 한 벌뿐」).
 *
 * 이 탭은 오래 "구독 한도가 없습니다" 한 줄이었다. 틀린 말은 아니지만, 사용량 팝업이 답해야 할
 * 질문은 "이 엔진을 굴리는 데 무엇이 드는가"다 — 클로드·코덱스에서 그 답이 구독 한도일 뿐,
 * **로컬 모델에서 그 답은 이 PC 의 자원**이다(모델은 내 CPU·메모리·VRAM 으로 돈다).
 *
 * §5.19 (F) 가 세워 둔 "버블 셋이 서로 다른 모델을 물면 메모리가 세 배 필요하다"는 사실을
 * 사용자가 눈으로 확인하는 자리도 여기다 — `LocalLlmState.loaded` 는 그 표시를 위해 진작
 * 실려 오고 있었는데 그리는 자리가 없었다.
 *
 * **모르면 모른다고 한다** — 못 잰 값은 0% 가 아니라 `--%` 다(§5.19 (E) 와 같은 규율).
 */

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

/**
 * `formatBytes` 는 0 에 **빈 문자열**을 준다(카탈로그에서 "크기 미상"을 빈칸으로 두려던 규약).
 * 여기서는 0 이 미상이 아니라 **실제로 0바이트**다 — 아무도 안 쓰는 가속 장치가 그렇다.
 * 빈칸을 그대로 흘리면 "의 24GB 사용"처럼 앞이 뜯긴 문장이 된다.
 */
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
