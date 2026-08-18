/**
 * agent-card — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agentCard` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "A machine-readable statement of what an agent can do. It only becomes usable for automatic selection once cost, latency and failure modes are written down too.",
    "heading": "Agent Card",
    "level": {
      "thin": "Thin",
      "partial": "Partial",
      "complete": "Well specified"
    },
    "check": {
      "filled": "Fields filled",
      "purpose": "Purpose",
      "limits": "Limits"
    },
    "stated": "stated",
    "unstated": "not stated",
    "set": "set",
    "unset": "not set",
    "note": "Not every agent needs a full discovery stack — for simple setups a short instruction file is enough."
  },
  "ko": {
    "desc": "이 에이전트가 무엇을 할 수 있는지의 기계가 읽는 명세입니다. 비용·지연·실패 모드까지 적혀야 비로소 자동 선택에 쓸 수 있습니다.",
    "heading": "에이전트 카드",
    "level": {
      "thin": "빈약함",
      "partial": "일부만",
      "complete": "잘 명세됨"
    },
    "check": {
      "filled": "채워진 항목",
      "purpose": "목적",
      "limits": "상한"
    },
    "stated": "적혀 있음",
    "unstated": "없음",
    "set": "설정됨",
    "unset": "없음",
    "note": "모든 에이전트가 정식 발견 스택을 갖출 필요는 없습니다 — 간단한 배치에는 짧은 지침 파일로 충분합니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "thin": "内容が薄い",
      "complete": "よく記述されている"
    },
    "heading": "エージェントカード",
    "check": {
      "filled": "埋まった項目",
      "purpose": "目的",
      "limits": "上限"
    },
    "stated": "記載あり",
    "unstated": "記載なし",
    "set": "設定済み",
    "unset": "未設定",
    "desc": "エージェントが何をできるかを機械が読める形で述べた仕様です。費用・遅延・失敗の型まで書かれて初めて、自動選択に使えるようになります。",
    "note": "すべてのエージェントが本格的な発見スタックを備える必要はありません — 単純な構成なら短い指示ファイルで十分です。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "thin": "内容单薄",
      "complete": "描述完整"
    },
    "heading": "智能体名片",
    "check": {
      "filled": "已填字段",
      "purpose": "用途",
      "limits": "上限"
    },
    "stated": "已说明",
    "unstated": "未说明",
    "set": "已设置",
    "unset": "未设置",
    "desc": "以机器可读的方式说明一个智能体能做什么。只有把成本、延迟和失败模式也写进去，它才真正可用于自动选择。",
    "note": "并非每个智能体都需要完整的发现栈 — 简单的配置下，一份简短的指令文件就够了。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "thin": "Escaso",
      "complete": "Bien especificado"
    },
    "heading": "Ficha del agente",
    "check": {
      "filled": "Campos completados",
      "purpose": "Propósito",
      "limits": "Límites"
    },
    "stated": "indicado",
    "unstated": "sin indicar",
    "set": "definido",
    "unset": "sin definir",
    "desc": "Una declaración legible por máquina de lo que un agente sabe hacer. Solo sirve para selección automática cuando también se anotan coste, latencia y modos de fallo.",
    "note": "No todo agente necesita una pila de descubrimiento completa — para montajes sencillos basta un archivo corto de instrucciones."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "thin": "Escaso",
      "complete": "Bien especificado"
    },
    "heading": "Ficha del agente",
    "check": {
      "filled": "Campos completados",
      "purpose": "Propósito",
      "limits": "Límites"
    },
    "stated": "indicado",
    "unstated": "sin indicar",
    "set": "definido",
    "unset": "sin definir",
    "desc": "Una declaración legible por máquina de lo que un agente sabe hacer. Solo sirve para selección automática cuando también se anotan coste, latencia y modos de fallo.",
    "note": "No todo agente necesita una pila de descubrimiento completa — para montajes sencillos basta un archivo corto de instrucciones."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "thin": "Maigre",
      "complete": "Bien spécifié"
    },
    "heading": "Fiche d’agent",
    "check": {
      "filled": "Champs remplis",
      "purpose": "Objectif",
      "limits": "Limites"
    },
    "stated": "indiqué",
    "unstated": "non indiqué",
    "set": "défini",
    "unset": "non défini",
    "desc": "Un énoncé lisible par la machine de ce qu’un agent sait faire. Il ne devient exploitable pour une sélection automatique qu’une fois coût, latence et modes de défaillance également consignés.",
    "note": "Tous les agents n’ont pas besoin d’une pile de découverte complète — pour des montages simples, un court fichier d’instructions suffit."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "thin": "Dünn",
      "complete": "Gut spezifiziert"
    },
    "heading": "Agent-Karte",
    "check": {
      "filled": "Ausgefüllte Felder",
      "purpose": "Zweck",
      "limits": "Grenzen"
    },
    "stated": "angegeben",
    "unstated": "nicht angegeben",
    "set": "gesetzt",
    "unset": "nicht gesetzt",
    "desc": "Eine maschinenlesbare Angabe dessen, was ein Agent kann. Erst wenn Kosten, Latenz und Fehlermodi ebenfalls festgehalten sind, taugt sie zur automatischen Auswahl.",
    "note": "Nicht jeder Agent braucht einen vollen Discovery-Stack — für einfache Aufbauten genügt eine kurze Anweisungsdatei."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "thin": "पतला",
      "complete": "अच्छी तरह निर्दिष्ट"
    },
    "heading": "एजेंट कार्ड",
    "check": {
      "filled": "भरे फ़ील्ड",
      "purpose": "उद्देश्य",
      "limits": "सीमाएँ"
    },
    "stated": "बताया गया",
    "unstated": "नहीं बताया",
    "set": "सेट",
    "unset": "सेट नहीं",
    "desc": "मशीन-पठनीय घोषणा कि कोई एजेंट क्या कर सकता है। यह स्वतः चयन के काम तभी आती है जब लागत, विलंब और विफलता के रूप भी दर्ज हों।",
    "note": "हर एजेंट को पूरा discovery ढाँचा नहीं चाहिए — साधारण व्यवस्था के लिए एक छोटी निर्देश-फ़ाइल काफ़ी है।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "thin": "Tipis",
      "complete": "Terinci baik"
    },
    "heading": "Kartu agen",
    "check": {
      "filled": "Bidang terisi",
      "purpose": "Tujuan",
      "limits": "Batas"
    },
    "stated": "dinyatakan",
    "unstated": "tidak dinyatakan",
    "set": "diatur",
    "unset": "belum diatur",
    "desc": "Pernyataan yang bisa dibaca mesin tentang apa yang bisa dilakukan sebuah agen. Ia baru berguna untuk pemilihan otomatis setelah biaya, latensi, dan mode kegagalan ikut dicatat.",
    "note": "Tidak setiap agen butuh tumpukan discovery lengkap — untuk susunan sederhana, satu berkas instruksi pendek sudah cukup."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "thin": "Scarno",
      "complete": "Ben specificato"
    },
    "heading": "Scheda dell’agente",
    "check": {
      "filled": "Campi compilati",
      "purpose": "Scopo",
      "limits": "Limiti"
    },
    "stated": "indicato",
    "unstated": "non indicato",
    "set": "impostato",
    "unset": "non impostato",
    "desc": "Una dichiarazione leggibile dalla macchina di ciò che un agente sa fare. Diventa utilizzabile per la selezione automatica solo quando sono annotati anche costo, latenza e modalità di guasto.",
    "note": "Non ogni agente ha bisogno di uno stack di discovery completo — per configurazioni semplici basta un breve file di istruzioni."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "thin": "Escasso",
      "complete": "Bem especificado"
    },
    "heading": "Ficha do agente",
    "check": {
      "filled": "Campos preenchidos",
      "purpose": "Propósito",
      "limits": "Limites"
    },
    "stated": "informado",
    "unstated": "não informado",
    "set": "definido",
    "unset": "não definido",
    "desc": "Uma declaração legível por máquina do que um agente sabe fazer. Só serve para seleção automática quando custo, latência e modos de falha também estão anotados.",
    "note": "Nem todo agente precisa de uma pilha completa de descoberta — para montagens simples, um arquivo curto de instruções basta."
  }
} as const;
