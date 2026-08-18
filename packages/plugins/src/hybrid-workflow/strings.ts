/**
 * hybrid-workflow — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.hybridWorkflow` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Pure specification is slow and pure improvisation collapses, so where you draw the line is the skill. Interfaces, data models and permission boundaries call for a spec; the implementation inside can stay free.",
    "heading": "Hybrid Workflow",
    "level": {
      "free": "Improvised",
      "leaning": "Leaning one way",
      "balanced": "Spec plus freedom"
    },
    "check": {
      "spec": "Standing rules",
      "plan": "Written plan"
    },
    "yes": "yes",
    "no": "no",
    "note": "You can switch between the two within a single project as the phase changes — that is the point of the hybrid."
  },
  "ko": {
    "desc": "순수 명세는 느리고 순수 즉흥은 무너지므로 어디에 선을 긋느냐가 실력입니다. 인터페이스·데이터 모델·권한 경계는 명세, 그 안쪽 구현은 자유가 실무 기준입니다.",
    "heading": "혼합 워크플로",
    "level": {
      "free": "즉흥",
      "leaning": "한쪽으로 치우침",
      "balanced": "명세 + 자유"
    },
    "check": {
      "spec": "상시 규칙",
      "plan": "적어 둔 계획"
    },
    "yes": "있음",
    "no": "없음",
    "note": "같은 프로젝트 안에서도 단계에 따라 둘을 갈아탈 수 있다는 것이 혼합의 요점입니다."
  },
  "ja": {
    "check": {
      "spec": "常設ルール",
      "plan": "書かれた計画"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "ハイブリッドな進め方",
    "level": {
      "free": "即興",
      "leaning": "片方に寄っている",
      "balanced": "仕様と自由の両立"
    },
    "desc": "純粋な仕様は遅く、純粋な即興は崩れるので、どこに線を引くかが実力になります。インターフェース・データモデル・権限の境界は仕様、その内側の実装は自由が実務の基準です。",
    "note": "同じプロジェクトの中でも段階に応じて二つを乗り換えられる、というのが混合の要点です。"
  },
  "zh-CN": {
    "check": {
      "spec": "常驻规则",
      "plan": "已写下的计划"
    },
    "yes": "是",
    "no": "否",
    "heading": "混合工作流",
    "level": {
      "free": "即兴",
      "leaning": "偏向一侧",
      "balanced": "规格与自由并存"
    },
    "desc": "纯规格慢，纯即兴会垮，所以在哪里划线才是功力。接口、数据模型和权限边界需要规格，其内部的实现可以自由。",
    "note": "在同一个项目里也能随阶段在两者之间切换，这正是混合方式的要点。"
  },
  "es": {
    "check": {
      "spec": "Reglas permanentes",
      "plan": "Plan escrito"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Flujo de trabajo híbrido",
    "level": {
      "free": "Improvisado",
      "leaning": "Inclinado a un lado",
      "balanced": "Especificación y libertad"
    },
    "desc": "La especificación pura es lenta y la improvisación pura se derrumba, así que dónde trazas la línea es la destreza. Interfaces, modelos de datos y fronteras de permisos piden especificación; la implementación interior puede quedar libre.",
    "note": "Se puede alternar entre ambas dentro de un mismo proyecto según la fase — ese es el sentido de lo híbrido."
  },
  "es-419": {
    "check": {
      "spec": "Reglas permanentes",
      "plan": "Plan escrito"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Flujo de trabajo híbrido",
    "level": {
      "free": "Improvisado",
      "leaning": "Inclinado a un lado",
      "balanced": "Especificación y libertad"
    },
    "desc": "La especificación pura es lenta y la improvisación pura se derrumba, así que dónde trazas la línea es la destreza. Interfaces, modelos de datos y fronteras de permisos piden especificación; la implementación interior puede quedar libre.",
    "note": "Se puede alternar entre ambas dentro de un mismo proyecto según la fase — ese es el sentido de lo híbrido."
  },
  "fr": {
    "check": {
      "spec": "Règles permanentes",
      "plan": "Plan écrit"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Flux de travail hybride",
    "level": {
      "free": "Improvisé",
      "leaning": "Penché d’un côté",
      "balanced": "Spécification et liberté"
    },
    "desc": "La spécification pure est lente et l’improvisation pure s’effondre : savoir où tracer la ligne fait la compétence. Interfaces, modèles de données et frontières de permission appellent une spécification ; l’implémentation intérieure peut rester libre.",
    "note": "On peut basculer de l’un à l’autre au sein d’un même projet selon la phase — c’est tout l’intérêt de l’hybride."
  },
  "de": {
    "check": {
      "spec": "Dauerregeln",
      "plan": "Schriftlicher Plan"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Hybrider Arbeitsablauf",
    "level": {
      "free": "Improvisiert",
      "leaning": "Einseitig geneigt",
      "balanced": "Spezifikation plus Freiheit"
    },
    "desc": "Reine Spezifikation ist langsam, reine Improvisation bricht zusammen — wo Sie die Linie ziehen, ist das Können. Schnittstellen, Datenmodelle und Berechtigungsgrenzen verlangen eine Spezifikation; die Implementierung darin darf frei bleiben.",
    "note": "Man kann innerhalb eines Projekts je nach Phase zwischen beiden wechseln — das ist der Sinn des Hybriden."
  },
  "hi": {
    "check": {
      "spec": "स्थायी नियम",
      "plan": "लिखी योजना"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "हाइब्रिड कार्यप्रवाह",
    "level": {
      "free": "तात्कालिक",
      "leaning": "एक ओर झुका",
      "balanced": "विनिर्देश व स्वतंत्रता"
    },
    "desc": "शुद्ध विनिर्देश धीमा है और शुद्ध तात्कालिकता ढह जाती है, इसलिए रेखा कहाँ खींचते हैं वही कौशल है। इंटरफ़ेस, डेटा-मॉडल और अनुमति की सीमाएँ विनिर्देश माँगती हैं; उनके भीतर कार्यान्वयन स्वतंत्र हो सकता है।",
    "note": "एक ही परियोजना में चरण के हिसाब से दोनों के बीच आ-जा सकते हैं — मिश्रित तरीक़े का मर्म यही है।"
  },
  "id": {
    "check": {
      "spec": "Aturan tetap",
      "plan": "Rencana tertulis"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Alur kerja hibrida",
    "level": {
      "free": "Improvisasi",
      "leaning": "Condong sebelah",
      "balanced": "Spesifikasi plus kebebasan"
    },
    "desc": "Spesifikasi murni lambat dan improvisasi murni runtuh, jadi di mana Anda menarik garis itulah keahliannya. Antarmuka, model data, dan batas izin menuntut spesifikasi; implementasi di dalamnya boleh bebas.",
    "note": "Anda bisa berpindah di antara keduanya dalam satu proyek sesuai tahapannya — itulah inti dari pendekatan hibrida."
  },
  "it": {
    "check": {
      "spec": "Regole permanenti",
      "plan": "Piano scritto"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Flusso di lavoro ibrido",
    "level": {
      "free": "Improvvisato",
      "leaning": "Sbilanciato da un lato",
      "balanced": "Specifica più libertà"
    },
    "desc": "La specifica pura è lenta e l’improvvisazione pura crolla, quindi dove tracci la linea fa l’abilità. Interfacce, modelli di dati e confini dei permessi chiedono una specifica; l’implementazione interna può restare libera.",
    "note": "Si può passare dall’una all’altra dentro lo stesso progetto a seconda della fase — è questo il senso dell’ibrido."
  },
  "pt-BR": {
    "check": {
      "spec": "Regras permanentes",
      "plan": "Plano escrito"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Fluxo de trabalho híbrido",
    "level": {
      "free": "Improvisado",
      "leaning": "Inclinado para um lado",
      "balanced": "Especificação e liberdade"
    },
    "desc": "Especificação pura é lenta e improviso puro desmorona, então onde você traça a linha é a perícia. Interfaces, modelos de dados e fronteiras de permissão pedem especificação; a implementação de dentro pode ficar livre.",
    "note": "Dá para alternar entre os dois dentro de um mesmo projeto conforme a fase — esse é o ponto do híbrido."
  }
} as const;
