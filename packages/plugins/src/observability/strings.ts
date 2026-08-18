/**
 * observability — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.observability` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Being able to reconstruct “why did it do that” afterwards is what makes a non-deterministic system fixable. A bug you cannot reproduce cannot be fixed without records.",
    "heading": "Observability",
    "level": {
      "blind": "No signals",
      "partial": "Partial",
      "full": "Logs, sessions, reports"
    },
    "check": {
      "turns": "Turns",
      "sessions": "Sessions",
      "reports": "Reports"
    },
    "note": "Observation can kill the app — a synchronous disk write on every tool event becomes the bottleneck itself. Sampling, debounce and batching are the basic devices."
  },
  "ko": {
    "desc": "\"왜 그랬지\"를 사후에 재구성할 수 있어야 비결정적 시스템을 고칠 수 있습니다. 재현이 안 되는 문제를 기록 없이 고치는 것은 불가능합니다.",
    "heading": "관측 가능성",
    "level": {
      "blind": "신호 없음",
      "partial": "일부만",
      "full": "로그·세션·신고"
    },
    "check": {
      "turns": "턴",
      "sessions": "세션",
      "reports": "신고"
    },
    "note": "관측이 앱을 죽일 수 있습니다 — 도구 이벤트마다 동기 디스크 쓰기를 하면 그 자체가 병목이 됩니다. 샘플링·디바운스·배치가 기본입니다."
  },
  "ja": {
    "heading": "可観測性",
    "level": {
      "partial": "一部のみ",
      "blind": "信号なし",
      "full": "ログ・セッション・報告"
    },
    "check": {
      "turns": "ターン数",
      "sessions": "セッション数",
      "reports": "報告"
    },
    "desc": "「なぜそうしたのか」を後から再構成できることが、非決定的なシステムを直せるようにします。再現しない不具合は記録なしには直せません。",
    "note": "観測がアプリを殺すことがあります — ツールイベントごとに同期でディスクへ書けば、それ自体がボトルネックになります。サンプリング・デバウンス・バッチが基本の装置です。"
  },
  "zh-CN": {
    "heading": "可观测性",
    "level": {
      "partial": "部分",
      "blind": "无信号",
      "full": "日志·会话·汇报"
    },
    "check": {
      "turns": "轮次",
      "sessions": "会话数",
      "reports": "汇报"
    },
    "desc": "能在事后重建「它当时为什么那么做」，才让非确定性的系统变得可修。无法复现的问题，没有记录就修不了。",
    "note": "观测可能拖垮应用 — 每个工具事件都同步写盘，那本身就成了瓶颈。采样、去抖和批处理是基本手段。"
  },
  "es": {
    "heading": "Observabilidad",
    "level": {
      "partial": "Parcial",
      "blind": "Sin señales",
      "full": "Registros, sesiones, informes"
    },
    "check": {
      "turns": "Turnos",
      "sessions": "Sesiones",
      "reports": "Informes"
    },
    "desc": "Poder reconstruir después «por qué hizo eso» es lo que hace reparable un sistema no determinista. Un fallo que no se reproduce no se arregla sin registros.",
    "note": "La observación puede matar la app — una escritura síncrona a disco en cada evento de herramienta se convierte ella misma en el cuello. Muestreo, antirrebote y lotes son los recursos básicos."
  },
  "es-419": {
    "heading": "Observabilidad",
    "level": {
      "partial": "Parcial",
      "blind": "Sin señales",
      "full": "Registros, sesiones, informes"
    },
    "check": {
      "turns": "Turnos",
      "sessions": "Sesiones",
      "reports": "Informes"
    },
    "desc": "Poder reconstruir después «por qué hizo eso» es lo que hace reparable un sistema no determinista. Un fallo que no se reproduce no se arregla sin registros.",
    "note": "La observación puede matar la app — una escritura síncrona a disco en cada evento de herramienta se convierte ella misma en el cuello. Muestreo, antirrebote y lotes son los recursos básicos."
  },
  "fr": {
    "heading": "Observabilité",
    "level": {
      "partial": "Partiel",
      "blind": "Aucun signal",
      "full": "Journaux, sessions, rapports"
    },
    "check": {
      "turns": "Tours",
      "sessions": "Sessions",
      "reports": "Rapports"
    },
    "desc": "Pouvoir reconstruire après coup « pourquoi il a fait cela » est ce qui rend réparable un système non déterministe. Un bug non reproductible ne se corrige pas sans enregistrements.",
    "note": "L’observation peut tuer l’application — une écriture disque synchrone à chaque événement d’outil devient elle-même le goulot. Échantillonnage, anti-rebond et lots sont les dispositifs de base."
  },
  "de": {
    "heading": "Observability",
    "level": {
      "partial": "Teilweise",
      "blind": "Keine Signale",
      "full": "Logs, Sitzungen, Berichte"
    },
    "check": {
      "turns": "Züge",
      "sessions": "Sitzungen",
      "reports": "Berichte"
    },
    "desc": "Nachträglich rekonstruieren zu können, „warum es das getan hat“, macht ein nicht deterministisches System reparierbar. Einen nicht reproduzierbaren Fehler kann man ohne Aufzeichnungen nicht beheben.",
    "note": "Beobachtung kann die App umbringen — ein synchroner Schreibvorgang bei jedem Werkzeugereignis wird selbst zum Engpass. Sampling, Entprellen und Bündeln sind die Grundmittel."
  },
  "hi": {
    "heading": "ऑब्ज़र्वेबिलिटी",
    "level": {
      "partial": "आंशिक",
      "blind": "कोई संकेत नहीं",
      "full": "लॉग · सत्र · रिपोर्ट"
    },
    "check": {
      "turns": "टर्न",
      "sessions": "सत्र",
      "reports": "रिपोर्ट"
    },
    "desc": "बाद में «उसने ऐसा क्यों किया» दोबारा खड़ा कर पाना ही अनिश्चयात्मक तंत्र को सुधारने योग्य बनाता है। जो दोष दोहराया न जा सके, उसे बिना अभिलेख के ठीक नहीं किया जा सकता।",
    "note": "अवलोकन ऐप को मार भी सकता है — हर टूल-घटना पर तुल्यकालिक डिस्क-लेखन ख़ुद अड़चन बन जाता है। नमूनाकरण, debounce और समूहन इसके बुनियादी औज़ार हैं।"
  },
  "id": {
    "heading": "Observabilitas",
    "level": {
      "partial": "Sebagian",
      "blind": "Tanpa sinyal",
      "full": "Log, sesi, laporan"
    },
    "check": {
      "turns": "Giliran",
      "sessions": "Sesi",
      "reports": "Laporan"
    },
    "desc": "Bisa merekonstruksi «kenapa ia melakukan itu» sesudahnya adalah yang membuat sistem non-deterministik bisa diperbaiki. Galat yang tak bisa direproduksi tak bisa diperbaiki tanpa catatan.",
    "note": "Pengamatan bisa membunuh aplikasi — penulisan disk sinkron pada tiap peristiwa alat menjadi sumbatannya sendiri. Pencuplikan, debounce, dan pengelompokan adalah perangkat dasarnya."
  },
  "it": {
    "heading": "Osservabilità",
    "level": {
      "partial": "Parziale",
      "blind": "Nessun segnale",
      "full": "Log, sessioni, rapporti"
    },
    "check": {
      "turns": "Turni",
      "sessions": "Sessioni",
      "reports": "Rapporti"
    },
    "desc": "Poter ricostruire dopo «perché ha fatto così» è ciò che rende riparabile un sistema non deterministico. Un difetto che non si riproduce non si corregge senza registrazioni.",
    "note": "L’osservazione può uccidere l’app — una scrittura sincrona su disco a ogni evento di strumento diventa essa stessa il collo di bottiglia. Campionamento, debounce e batch sono gli strumenti base."
  },
  "pt-BR": {
    "heading": "Observabilidade",
    "level": {
      "partial": "Parcial",
      "blind": "Sem sinais",
      "full": "Logs, sessões, relatórios"
    },
    "check": {
      "turns": "Turnos",
      "sessions": "Sessões",
      "reports": "Relatórios"
    },
    "desc": "Poder reconstruir depois «por que ele fez aquilo» é o que torna um sistema não determinístico consertável. Um bug que não se reproduz não se conserta sem registros.",
    "note": "A observação pode matar o app — uma escrita síncrona em disco a cada evento de ferramenta vira ela mesma o gargalo. Amostragem, debounce e lotes são os recursos básicos."
  }
} as const;
