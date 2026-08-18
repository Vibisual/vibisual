/**
 * separation-of-concerns — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.separationOfConcerns` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "When an agent edits one place, the blast radius of side effects is the size of the incident. Kept separate, a wrong edit ends inside its own boundary.",
    "heading": "Separation of Concerns",
    "level": {
      "focused": "Focused",
      "mixed": "Mixed",
      "broad": "Broad and undivided"
    },
    "check": {
      "breadth": "Tool breadth",
      "sessions": "Sessions"
    },
    "note": "The agent version of this principle is context-centric decomposition — the agent that owns a feature also owns its tests."
  },
  "ko": {
    "desc": "에이전트가 한 곳을 고칠 때 부수 효과 반경이 곧 사고 규모입니다. 분리돼 있으면 잘못 고쳐도 그 경계 안에서 끝납니다.",
    "heading": "관심사 분리",
    "level": {
      "focused": "좁게 집중",
      "mixed": "섞여 있음",
      "broad": "넓고 안 나뉨"
    },
    "check": {
      "breadth": "도구 폭",
      "sessions": "세션 수"
    },
    "note": "이 원칙의 에이전트판이 컨텍스트 중심 분해입니다 — 한 기능을 맡은 에이전트가 그 테스트도 맡습니다."
  },
  "ja": {
    "level": {
      "mixed": "混在",
      "focused": "絞られている",
      "broad": "広く未分割"
    },
    "check": {
      "sessions": "セッション数",
      "breadth": "ツールの広さ"
    },
    "heading": "関心の分離",
    "desc": "エージェントが一箇所を直すとき、副作用の及ぶ範囲がそのまま事故の大きさです。分かれていれば、間違って直してもその境界の中で終わります。",
    "note": "この原則のエージェント版がコンテキスト中心の分解です — 一つの機能を担うエージェントがそのテストも担います。"
  },
  "zh-CN": {
    "level": {
      "mixed": "混合",
      "focused": "聚焦",
      "broad": "宽泛未拆分"
    },
    "check": {
      "sessions": "会话数",
      "breadth": "工具广度"
    },
    "heading": "关注点分离",
    "desc": "智能体改动一处时，副作用波及的范围就是事故的规模。彼此分开的话，改错了也只在那个边界内结束。",
    "note": "这一原则的智能体版本是以上下文为中心的分解 — 负责某个功能的智能体同时负责它的测试。"
  },
  "es": {
    "level": {
      "mixed": "Mixto",
      "focused": "Enfocado",
      "broad": "Amplio y sin dividir"
    },
    "check": {
      "sessions": "Sesiones",
      "breadth": "Amplitud de herramientas"
    },
    "heading": "Separación de responsabilidades",
    "desc": "Cuando un agente edita un sitio, el radio de los efectos colaterales es el tamaño del incidente. Bien separado, un cambio equivocado acaba dentro de su propia frontera.",
    "note": "La versión para agentes de este principio es la descomposición centrada en el contexto — el agente dueño de una función también es dueño de sus pruebas."
  },
  "es-419": {
    "level": {
      "mixed": "Mixto",
      "focused": "Enfocado",
      "broad": "Amplio y sin dividir"
    },
    "check": {
      "sessions": "Sesiones",
      "breadth": "Amplitud de herramientas"
    },
    "heading": "Separación de responsabilidades",
    "desc": "Cuando un agente edita un sitio, el radio de los efectos colaterales es el tamaño del incidente. Bien separado, un cambio equivocado acaba dentro de su propia frontera.",
    "note": "La versión para agentes de este principio es la descomposición centrada en el contexto — el agente dueño de una función también es dueño de sus pruebas."
  },
  "fr": {
    "level": {
      "mixed": "Mixte",
      "focused": "Ciblé",
      "broad": "Large et indivis"
    },
    "check": {
      "sessions": "Sessions",
      "breadth": "Étendue des outils"
    },
    "heading": "Séparation des responsabilités",
    "desc": "Quand un agent modifie un endroit, le rayon des effets de bord donne la taille de l’incident. Bien séparé, un mauvais changement s’arrête à l’intérieur de sa frontière.",
    "note": "La version agent de ce principe est la décomposition centrée sur le contexte — l’agent qui possède une fonctionnalité possède aussi ses tests."
  },
  "de": {
    "level": {
      "mixed": "Gemischt",
      "focused": "Fokussiert",
      "broad": "Breit und ungeteilt"
    },
    "check": {
      "sessions": "Sitzungen",
      "breadth": "Werkzeugbreite"
    },
    "heading": "Trennung der Zuständigkeiten",
    "desc": "Wenn ein Agent an einer Stelle ändert, ist der Radius der Nebenwirkungen die Größe des Vorfalls. Getrennt gehalten, endet eine falsche Änderung innerhalb ihrer Grenze.",
    "note": "Die Agentenfassung dieses Prinzips ist kontextzentrierte Zerlegung — der Agent, dem ein Feature gehört, besitzt auch dessen Tests."
  },
  "hi": {
    "level": {
      "mixed": "मिश्रित",
      "focused": "केंद्रित",
      "broad": "व्यापक व अविभाजित"
    },
    "check": {
      "sessions": "सत्र",
      "breadth": "टूल विस्तार"
    },
    "heading": "सरोकारों का पृथक्करण",
    "desc": "जब एजेंट एक जगह संपादन करता है, तो दुष्प्रभाव का दायरा ही घटना का आकार है। साफ़-साफ़ बँटा हो तो ग़लत संपादन अपनी सीमा के भीतर ही रुक जाता है।",
    "note": "इस सिद्धांत का एजेंट-रूप है संदर्भ-केंद्रित विभाजन — जो एजेंट किसी सुविधा का मालिक है, वही उसके टेस्ट का भी मालिक है।"
  },
  "id": {
    "level": {
      "mixed": "Campuran",
      "focused": "Terfokus",
      "broad": "Luas dan tak terbagi"
    },
    "check": {
      "sessions": "Sesi",
      "breadth": "Cakupan alat"
    },
    "heading": "Pemisahan perhatian",
    "desc": "Ketika agen menyunting satu tempat, radius efek sampingnya adalah besarnya insiden. Bila terpisah rapi, suntingan yang salah berhenti di dalam batasnya sendiri.",
    "note": "Versi agen dari prinsip ini adalah pemecahan berpusat konteks — agen yang memiliki sebuah fitur juga memiliki tesnya."
  },
  "it": {
    "level": {
      "mixed": "Misto",
      "focused": "Focalizzato",
      "broad": "Ampio e indiviso"
    },
    "check": {
      "sessions": "Sessioni",
      "breadth": "Ampiezza degli strumenti"
    },
    "heading": "Separazione delle responsabilità",
    "desc": "Quando un agente modifica un punto, il raggio degli effetti collaterali è la dimensione dell’incidente. Tenuti separati, una modifica sbagliata finisce dentro il proprio confine.",
    "note": "La versione per agenti di questo principio è la scomposizione centrata sul contesto — l’agente che possiede una funzionalità possiede anche i suoi test."
  },
  "pt-BR": {
    "level": {
      "mixed": "Misto",
      "focused": "Focado",
      "broad": "Amplo e indiviso"
    },
    "check": {
      "sessions": "Sessões",
      "breadth": "Amplitude de ferramentas"
    },
    "heading": "Separação de responsabilidades",
    "desc": "Quando um agente edita um ponto, o raio dos efeitos colaterais é o tamanho do incidente. Bem separado, uma alteração errada termina dentro da própria fronteira.",
    "note": "A versão para agentes desse princípio é a decomposição centrada em contexto — o agente dono de uma funcionalidade também é dono dos testes dela."
  }
} as const;
