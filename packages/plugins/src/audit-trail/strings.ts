/**
 * audit-trail — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.auditTrail` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts what is left of this agent’s trace — turns recorded and session IDs preserved — so that “who did this” can still be answered afterwards.",
    "heading": "Audit Trail",
    "level": {
      "traceable": "Traceable",
      "partial": "Partial",
      "empty": "No trace yet"
    },
    "check": {
      "turns": "Recorded turns",
      "sessions": "Session IDs",
      "last": "Last activity"
    },
    "note": "Keeping the original run log, stamping decisions with their source session, and marking commits with the agent as co-author is the minimum set."
  },
  "ko": {
    "desc": "이 에이전트의 흔적이 얼마나 남아 있는지 셉니다 — 기록된 턴과 보존된 세션 ID. 나중에 \"이건 누가 했나\"에 답할 수 있어야 합니다.",
    "heading": "감사 추적",
    "level": {
      "traceable": "추적 가능",
      "partial": "일부만",
      "empty": "아직 흔적 없음"
    },
    "check": {
      "turns": "기록된 턴",
      "sessions": "세션 ID",
      "last": "마지막 활동"
    },
    "note": "원본 실행 로그 보존 · 결정에 출처 세션 ID · 커밋에 에이전트 공동 작성자 표기, 이 셋이 최소 구성입니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "traceable": "追跡できる",
      "empty": "まだ痕跡なし"
    },
    "check": {
      "turns": "記録されたターン",
      "sessions": "セッション ID",
      "last": "最終活動"
    },
    "heading": "監査証跡",
    "desc": "このエージェントの痕跡がどれだけ残っているか（記録されたターンと保存されたセッション ID）を数えます。後から「これは誰がやったのか」に答えられる必要があります。",
    "note": "元の実行ログの保存・決定に出所セッション ID・コミットにエージェントの共同作成者表記、この三つが最小構成です。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "traceable": "可追溯",
      "empty": "尚无痕迹"
    },
    "check": {
      "turns": "已记录轮次",
      "sessions": "会话 ID",
      "last": "最后活动"
    },
    "heading": "审计轨迹",
    "desc": "统计这个智能体留下了多少痕迹（已记录的轮次与保留的会话 ID），以便事后仍能回答「这是谁做的」。",
    "note": "保留原始运行日志、给决策打上来源会话 ID、在提交中标注智能体为共同作者，这三项是最小组合。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "traceable": "Trazable",
      "empty": "Sin rastro aún"
    },
    "check": {
      "turns": "Turnos registrados",
      "sessions": "ID de sesión",
      "last": "Última actividad"
    },
    "heading": "Rastro de auditoría",
    "desc": "Cuenta lo que queda del rastro de este agente — turnos registrados e identificadores de sesión conservados — para que «quién hizo esto» siga siendo respondible después.",
    "note": "Conservar el registro de ejecución original, sellar las decisiones con su sesión de origen y marcar los commits con el agente como coautor: ese es el mínimo."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "traceable": "Trazable",
      "empty": "Sin rastro aún"
    },
    "check": {
      "turns": "Turnos registrados",
      "sessions": "ID de sesión",
      "last": "Última actividad"
    },
    "heading": "Rastro de auditoría",
    "desc": "Cuenta lo que queda del rastro de este agente — turnos registrados e identificadores de sesión conservados — para que «quién hizo esto» siga siendo respondible después.",
    "note": "Conservar el registro de ejecución original, sellar las decisiones con su sesión de origen y marcar los commits con el agente como coautor: ese es el mínimo."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "traceable": "Traçable",
      "empty": "Pas encore de trace"
    },
    "check": {
      "turns": "Tours enregistrés",
      "sessions": "ID de session",
      "last": "Dernière activité"
    },
    "heading": "Piste d’audit",
    "desc": "Compte ce qu’il reste de la trace de cet agent — tours enregistrés et identifiants de session conservés — pour que « qui a fait cela » reste répondable après coup.",
    "note": "Conserver le journal d’exécution d’origine, estampiller les décisions avec leur session source et marquer les commits avec l’agent comme co-auteur : voilà le minimum."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "traceable": "Nachvollziehbar",
      "empty": "Noch keine Spur"
    },
    "check": {
      "turns": "Erfasste Züge",
      "sessions": "Sitzungs-IDs",
      "last": "Letzte Aktivität"
    },
    "heading": "Prüfpfad",
    "desc": "Zählt, was von der Spur dieses Agenten übrig ist — erfasste Züge und erhaltene Sitzungs-IDs — damit „wer hat das getan“ auch später beantwortbar bleibt.",
    "note": "Originales Ausführungsprotokoll behalten, Entscheidungen mit ihrer Quellsitzung stempeln und Commits mit dem Agenten als Mitautor kennzeichnen — das ist die Mindestausstattung."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "traceable": "पता लगाने योग्य",
      "empty": "अभी कोई निशान नहीं"
    },
    "check": {
      "turns": "दर्ज टर्न",
      "sessions": "सत्र ID",
      "last": "अंतिम गतिविधि"
    },
    "heading": "ऑडिट ट्रेल",
    "desc": "इस एजेंट के पीछे बचे निशान गिनता है — दर्ज बारियाँ और सुरक्षित सत्र-पहचान — ताकि «यह किसने किया» बाद में भी उत्तर योग्य बना रहे।",
    "note": "असली निष्पादन-लॉग रखना, निर्णयों पर उनके स्रोत सत्र का निशान लगाना, और commit में एजेंट को सह-लेखक बताना: यही न्यूनतम औज़ार हैं।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "traceable": "Bisa dilacak",
      "empty": "Belum ada jejak"
    },
    "check": {
      "turns": "Giliran tercatat",
      "sessions": "ID sesi",
      "last": "Aktivitas terakhir"
    },
    "heading": "Jejak audit",
    "desc": "Menghitung sisa jejak agen ini — giliran yang tercatat dan ID sesi yang tersimpan — supaya «siapa yang melakukan ini» tetap bisa dijawab kemudian.",
    "note": "Menyimpan log eksekusi asli, menandai keputusan dengan sesi asalnya, dan mencantumkan agen sebagai rekan penulis pada commit: itu perangkat minimalnya."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "traceable": "Tracciabile",
      "empty": "Ancora nessuna traccia"
    },
    "check": {
      "turns": "Turni registrati",
      "sessions": "ID sessione",
      "last": "Ultima attività"
    },
    "heading": "Traccia di audit",
    "desc": "Conta che cosa resta della traccia di questo agente — turni registrati e ID di sessione conservati — perché «chi ha fatto questo» resti una domanda con risposta anche dopo.",
    "note": "Conservare il log di esecuzione originale, marcare le decisioni con la sessione di origine e firmare i commit con l’agente come coautore: questo è il minimo."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "traceable": "Rastreável",
      "empty": "Ainda sem rastro"
    },
    "check": {
      "turns": "Turnos registrados",
      "sessions": "IDs de sessão",
      "last": "Última atividade"
    },
    "heading": "Trilha de auditoria",
    "desc": "Conta o que restou do rastro deste agente — turnos registrados e IDs de sessão preservados — para que «quem fez isso» continue respondível depois.",
    "note": "Guardar o log de execução original, carimbar as decisões com sua sessão de origem e marcar commits com o agente como coautor: esse é o mínimo."
  }
} as const;
