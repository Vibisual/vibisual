// main 프로세스가 **직접** 띄우는 것들의 문구 — 네이티브 대화상자 · OS 알림.
//
// 이것들은 렌더러를 거치지 않으므로 i18next 가 닿지 않는다. 그래서 종전에는 한국어 상수가
// 그대로 박혀 있었다 — 영어권 사용자가 앱을 닫으면 읽을 수 없는 경고가 떴고, 그 경고는
// "지금 닫으면 커밋 안 한 편집이 날아간다"는 **가장 중요한** 문장이었다.
//
// 새 레일을 놓지 않는다. `chat/strings.ts`(§4 메신저 브리지) 가 이미 같은 문제를 같은 방법으로
// 풀어 뒀다 — **파일이 자기 문자열을 들고 있고**, 고를 언어는 서버 코어의 `getUiLocale()` 에서
// 읽는다. 자리표시자도 거기와 같은 `{이름}` 하나뿐이다(`fmt` 를 그대로 빌려 쓴다).

import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import type { UiLocale } from '@vibisual/shared';

/** 키가 늘면 12개 로케일을 전부 채워야 타입이 통과한다(그게 목적이다). */
export interface MainStrings {
  // ─ 종료 확인 대화상자 (app.on('before-quit'))
  quitTitle: string;
  quitMessage: string;
  quitBtnCancel: string;
  quitBtnClose: string;
  /** `{count}` */
  quitSessions: string;
  /** `{count}` `{labels}` */
  quitSessionsWithLabels: string;
  /** `{count}` */
  quitBackgroundTasks: string;
  quitDetailNote: string;

  // ─ CMD 터미널이 입력을 기다릴 때의 OS 알림
  /** `{label}` */
  cmdBlockedTitle: string;
  cmdBlockedBody: string;
}

const en: MainStrings = {
  quitTitle: 'Work is still running',
  quitMessage: 'Closing now will also stop the agents that are running.',
  quitBtnCancel: 'Cancel',
  quitBtnClose: 'Close',
  quitSessions: '{count} session(s) running',
  quitSessionsWithLabels: '{count} session(s) running: {labels}',
  quitBackgroundTasks: '{count} background task(s)',
  quitDetailNote: 'Conversations are kept and pick up on the next turn, but edits you have not committed will not come back.',
  cmdBlockedTitle: 'Vibisual — {label} is waiting for input',
  cmdBlockedBody: 'The CMD terminal is waiting for your response.',
};

const ko: MainStrings = {
  quitTitle: '작업이 실행 중입니다',
  quitMessage: '지금 닫으면 실행 중인 에이전트가 함께 종료됩니다.',
  quitBtnCancel: '취소',
  quitBtnClose: '닫기',
  quitSessions: '세션 {count}개 실행 중',
  quitSessionsWithLabels: '세션 {count}개 실행 중: {labels}',
  quitBackgroundTasks: '백그라운드 작업 {count}개',
  quitDetailNote: '대화는 남아 다음 턴에 이어지지만, 커밋하지 않은 편집은 복구되지 않습니다.',
  cmdBlockedTitle: 'Vibisual — {label} 이(가) 입력을 기다립니다',
  cmdBlockedBody: 'CMD 터미널이 사용자 응답을 기다리는 중입니다.',
};

const ja: MainStrings = {
  quitTitle: '作業が実行中です',
  quitMessage: '今閉じると、実行中のエージェントも一緒に終了します。',
  quitBtnCancel: 'キャンセル',
  quitBtnClose: '閉じる',
  quitSessions: 'セッション {count} 件が実行中',
  quitSessionsWithLabels: 'セッション {count} 件が実行中: {labels}',
  quitBackgroundTasks: 'バックグラウンド作業 {count} 件',
  quitDetailNote: '会話は残り次のターンで続きますが、コミットしていない編集は元に戻りません。',
  cmdBlockedTitle: 'Vibisual — {label} が入力を待っています',
  cmdBlockedBody: 'CMD ターミナルが応答を待っています。',
};

const zhCN: MainStrings = {
  quitTitle: '任务仍在运行',
  quitMessage: '现在关闭会同时停止正在运行的智能体。',
  quitBtnCancel: '取消',
  quitBtnClose: '关闭',
  quitSessions: '{count} 个会话正在运行',
  quitSessionsWithLabels: '{count} 个会话正在运行：{labels}',
  quitBackgroundTasks: '{count} 个后台任务',
  quitDetailNote: '对话会保留并在下一轮继续，但尚未提交的修改无法恢复。',
  cmdBlockedTitle: 'Vibisual — {label} 正在等待输入',
  cmdBlockedBody: 'CMD 终端正在等待你的回应。',
};

const es: MainStrings = {
  quitTitle: 'Hay trabajo en ejecución',
  quitMessage: 'Si cierras ahora, también se detendrán los agentes en ejecución.',
  quitBtnCancel: 'Cancelar',
  quitBtnClose: 'Cerrar',
  quitSessions: '{count} sesión(es) en ejecución',
  quitSessionsWithLabels: '{count} sesión(es) en ejecución: {labels}',
  quitBackgroundTasks: '{count} tarea(s) en segundo plano',
  quitDetailNote: 'Las conversaciones se conservan y continúan en el siguiente turno, pero las ediciones sin confirmar no se recuperarán.',
  cmdBlockedTitle: 'Vibisual — {label} está esperando entrada',
  cmdBlockedBody: 'La terminal CMD está esperando tu respuesta.',
};

const es419: MainStrings = {
  quitTitle: 'Hay trabajo en ejecución',
  quitMessage: 'Si cierras ahora, también se detendrán los agentes en ejecución.',
  quitBtnCancel: 'Cancelar',
  quitBtnClose: 'Cerrar',
  quitSessions: '{count} sesión(es) en ejecución',
  quitSessionsWithLabels: '{count} sesión(es) en ejecución: {labels}',
  quitBackgroundTasks: '{count} tarea(s) en segundo plano',
  quitDetailNote: 'Las conversaciones se conservan y continúan en el siguiente turno, pero las ediciones sin confirmar no se recuperarán.',
  cmdBlockedTitle: 'Vibisual — {label} está esperando entrada',
  cmdBlockedBody: 'La terminal CMD está esperando tu respuesta.',
};

const fr: MainStrings = {
  quitTitle: 'Des tâches sont en cours',
  quitMessage: 'Fermer maintenant arrêtera aussi les agents en cours d’exécution.',
  quitBtnCancel: 'Annuler',
  quitBtnClose: 'Fermer',
  quitSessions: '{count} session(s) en cours',
  quitSessionsWithLabels: '{count} session(s) en cours : {labels}',
  quitBackgroundTasks: '{count} tâche(s) en arrière-plan',
  quitDetailNote: 'Les conversations sont conservées et reprennent au tour suivant, mais les modifications non validées ne seront pas récupérées.',
  cmdBlockedTitle: 'Vibisual — {label} attend une saisie',
  cmdBlockedBody: 'Le terminal CMD attend votre réponse.',
};

const de: MainStrings = {
  quitTitle: 'Es laufen noch Aufgaben',
  quitMessage: 'Wenn Sie jetzt schließen, werden auch die laufenden Agenten beendet.',
  quitBtnCancel: 'Abbrechen',
  quitBtnClose: 'Schließen',
  quitSessions: '{count} Sitzung(en) aktiv',
  quitSessionsWithLabels: '{count} Sitzung(en) aktiv: {labels}',
  quitBackgroundTasks: '{count} Hintergrundaufgabe(n)',
  quitDetailNote: 'Unterhaltungen bleiben erhalten und werden im nächsten Zug fortgesetzt, aber nicht committete Änderungen kommen nicht zurück.',
  cmdBlockedTitle: 'Vibisual — {label} wartet auf Eingabe',
  cmdBlockedBody: 'Das CMD-Terminal wartet auf Ihre Antwort.',
};

const hi: MainStrings = {
  quitTitle: 'काम अभी चल रहा है',
  quitMessage: 'अभी बंद करने पर चल रहे एजेंट भी रुक जाएंगे।',
  quitBtnCancel: 'रद्द करें',
  quitBtnClose: 'बंद करें',
  quitSessions: '{count} सत्र चल रहे हैं',
  quitSessionsWithLabels: '{count} सत्र चल रहे हैं: {labels}',
  quitBackgroundTasks: '{count} पृष्ठभूमि कार्य',
  quitDetailNote: 'बातचीत सुरक्षित रहती है और अगली बारी में जारी रहती है, लेकिन बिना कमिट किए बदलाव वापस नहीं आएंगे।',
  cmdBlockedTitle: 'Vibisual — {label} इनपुट का इंतज़ार कर रहा है',
  cmdBlockedBody: 'CMD टर्मिनल आपके उत्तर की प्रतीक्षा कर रहा है।',
};

const id: MainStrings = {
  quitTitle: 'Masih ada pekerjaan berjalan',
  quitMessage: 'Menutup sekarang juga akan menghentikan agen yang sedang berjalan.',
  quitBtnCancel: 'Batal',
  quitBtnClose: 'Tutup',
  quitSessions: '{count} sesi sedang berjalan',
  quitSessionsWithLabels: '{count} sesi sedang berjalan: {labels}',
  quitBackgroundTasks: '{count} tugas latar belakang',
  quitDetailNote: 'Percakapan tetap tersimpan dan dilanjutkan pada giliran berikutnya, tetapi suntingan yang belum di-commit tidak akan kembali.',
  cmdBlockedTitle: 'Vibisual — {label} menunggu masukan',
  cmdBlockedBody: 'Terminal CMD sedang menunggu jawaban Anda.',
};

const it: MainStrings = {
  quitTitle: 'Ci sono attività in corso',
  quitMessage: 'Chiudere ora fermerà anche gli agenti in esecuzione.',
  quitBtnCancel: 'Annulla',
  quitBtnClose: 'Chiudi',
  quitSessions: '{count} sessione/i in esecuzione',
  quitSessionsWithLabels: '{count} sessione/i in esecuzione: {labels}',
  quitBackgroundTasks: '{count} attività in background',
  quitDetailNote: 'Le conversazioni restano e riprendono al turno successivo, ma le modifiche non salvate con commit non torneranno.',
  cmdBlockedTitle: 'Vibisual — {label} è in attesa di input',
  cmdBlockedBody: 'Il terminale CMD è in attesa della tua risposta.',
};

const ptBR: MainStrings = {
  quitTitle: 'Ainda há trabalho em execução',
  quitMessage: 'Fechar agora também encerrará os agentes em execução.',
  quitBtnCancel: 'Cancelar',
  quitBtnClose: 'Fechar',
  quitSessions: '{count} sessão(ões) em execução',
  quitSessionsWithLabels: '{count} sessão(ões) em execução: {labels}',
  quitBackgroundTasks: '{count} tarefa(s) em segundo plano',
  quitDetailNote: 'As conversas são mantidas e continuam no próximo turno, mas as edições sem commit não voltarão.',
  cmdBlockedTitle: 'Vibisual — {label} está aguardando entrada',
  cmdBlockedBody: 'O terminal CMD está aguardando sua resposta.',
};

const TABLE: Record<UiLocale, MainStrings> = {
  en, ko, ja, 'zh-CN': zhCN, es, 'es-419': es419, fr, de, hi, id, it, 'pt-BR': ptBR,
};

/**
 * 그 언어의 문자열 한 벌. 모르는 값이면 `en` 으로 떨어진다
 * (서버 코어가 아직 안 떴을 때도 여기로 온다 — 침묵보다 영어가 낫다).
 */
export function mainStrings(locale: string | null | undefined): MainStrings {
  if (locale && (SUPPORTED_UI_LOCALES as readonly string[]).includes(locale)) {
    return TABLE[locale as UiLocale];
  }
  return TABLE[DEFAULT_UI_LOCALE];
}

/**
 * `{이름}` 자리표시자를 채운다. 값이 없는 자리표시자는 **그대로 둔다** —
 * 지우면 문장이 조용히 뜻을 잃지만, 남아 있으면 어느 키가 빠졌는지 화면에서 바로 보인다.
 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === undefined ? whole : String(v);
  });
}
