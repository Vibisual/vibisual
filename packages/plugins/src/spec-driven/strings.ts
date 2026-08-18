/**
 * spec-driven — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.specDriven` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "A versioned specification becomes the source of truth, and implementation, tests and docs derive from it. Once the spec removes ambiguity the agent works as a fast typist rather than a decision maker.",
    "heading": "Spec-Driven Development",
    "level": {
      "prompt": "Prompt-driven",
      "partial": "Partial",
      "spec": "Spec-driven"
    },
    "check": {
      "signals": "Signals present",
      "rules": "Standing rules",
      "plan": "Written plan"
    },
    "yes": "yes",
    "no": "no",
    "note": "This does not replace TDD — TDD pins behaviour, SDD pins requirements and constraints. They are used together."
  },
  "ko": {
    "desc": "버전 관리되는 명세가 진실 공급원이 되고 구현·테스트·문서가 거기서 파생됩니다. 명세가 모호함을 없애면 에이전트는 결정권자가 아니라 고속 타이피스트로 일합니다.",
    "heading": "명세 주도 개발",
    "level": {
      "prompt": "프롬프트 주도",
      "partial": "일부만",
      "spec": "명세 주도"
    },
    "check": {
      "signals": "갖춰진 신호",
      "rules": "상시 규칙",
      "plan": "적어 둔 계획"
    },
    "yes": "있음",
    "no": "없음",
    "note": "TDD 를 대체하지 않습니다 — TDD 는 동작을, SDD 는 요구사항과 제약을 고정합니다. 둘은 함께 씁니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "prompt": "プロンプト主導",
      "spec": "仕様主導"
    },
    "check": {
      "signals": "揃った要素",
      "rules": "常設ルール",
      "plan": "書かれた計画"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "仕様駆動開発",
    "desc": "バージョン管理された仕様が真実の供給源になり、実装・テスト・文書がそこから派生します。仕様が曖昧さを消せば、エージェントは決定権者ではなく高速なタイピストとして働きます。",
    "note": "TDD の代わりではありません — TDD は振る舞いを、SDD は要求と制約を固定します。二つは併せて使います。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "prompt": "提示词驱动",
      "spec": "规格驱动"
    },
    "check": {
      "signals": "具备的信号",
      "rules": "常驻规则",
      "plan": "已写下的计划"
    },
    "yes": "是",
    "no": "否",
    "heading": "规格驱动开发",
    "desc": "受版本管理的规格成为真实来源，实现、测试与文档都由它派生。规格一旦消除歧义，智能体就从决策者变成高速打字员。",
    "note": "这并不取代 TDD — TDD 固定行为，SDD 固定需求与约束。两者是一起用的。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "prompt": "Guiado por prompts",
      "spec": "Guiado por especificación"
    },
    "check": {
      "signals": "Señales presentes",
      "rules": "Reglas permanentes",
      "plan": "Plan escrito"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Desarrollo guiado por especificación",
    "desc": "Una especificación versionada se vuelve la fuente de verdad, y de ella derivan implementación, pruebas y documentación. Una vez que la especificación quita la ambigüedad, el agente trabaja como mecanógrafo veloz y no como decisor.",
    "note": "Esto no sustituye al TDD — el TDD fija el comportamiento, la SDD fija requisitos y restricciones. Se usan juntos."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "prompt": "Guiado por prompts",
      "spec": "Guiado por especificación"
    },
    "check": {
      "signals": "Señales presentes",
      "rules": "Reglas permanentes",
      "plan": "Plan escrito"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Desarrollo guiado por especificación",
    "desc": "Una especificación versionada se vuelve la fuente de verdad, y de ella derivan implementación, pruebas y documentación. Una vez que la especificación quita la ambigüedad, el agente trabaja como mecanógrafo veloz y no como decisor.",
    "note": "Esto no sustituye al TDD — el TDD fija el comportamiento, la SDD fija requisitos y restricciones. Se usan juntos."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "prompt": "Piloté par prompts",
      "spec": "Piloté par spécification"
    },
    "check": {
      "signals": "Signaux présents",
      "rules": "Règles permanentes",
      "plan": "Plan écrit"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Développement piloté par la spécification",
    "desc": "Une spécification versionnée devient la source de vérité, dont dérivent implémentation, tests et documentation. Une fois l’ambiguïté levée, l’agent travaille en dactylographe rapide plutôt qu’en décideur.",
    "note": "Cela ne remplace pas le TDD — le TDD fige le comportement, la SDD fige exigences et contraintes. Les deux s’utilisent ensemble."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "prompt": "Prompt-getrieben",
      "spec": "Spezifikationsgetrieben"
    },
    "check": {
      "signals": "Vorhandene Signale",
      "rules": "Dauerregeln",
      "plan": "Schriftlicher Plan"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Spezifikationsgetriebene Entwicklung",
    "desc": "Eine versionierte Spezifikation wird zur Quelle der Wahrheit, aus der sich Implementierung, Tests und Dokumentation ableiten. Nimmt die Spezifikation die Mehrdeutigkeit, arbeitet der Agent als schneller Schreibkraft statt als Entscheider.",
    "note": "Das ersetzt TDD nicht — TDD legt Verhalten fest, SDD legt Anforderungen und Einschränkungen fest. Beide werden zusammen genutzt."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "prompt": "प्रॉम्प्ट-चालित",
      "spec": "विनिर्देश-चालित"
    },
    "check": {
      "signals": "मौजूद संकेत",
      "rules": "स्थायी नियम",
      "plan": "लिखी योजना"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "विनिर्देश-चालित विकास",
    "desc": "संस्करण-नियंत्रित विनिर्देश सच का स्रोत बनता है, और उससे कार्यान्वयन, टेस्ट और दस्तावेज़ निकलते हैं। जब विनिर्देश संदेह मिटा देता है, तब एजेंट निर्णायक नहीं, तेज़ टंकक की तरह काम करता है।",
    "note": "यह TDD की जगह नहीं लेता — TDD व्यवहार बाँधता है, SDD आवश्यकताएँ और बंदिशें। दोनों साथ चलते हैं।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "prompt": "Berbasis prompt",
      "spec": "Berbasis spesifikasi"
    },
    "check": {
      "signals": "Sinyal ada",
      "rules": "Aturan tetap",
      "plan": "Rencana tertulis"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Pengembangan berbasis spesifikasi",
    "desc": "Spesifikasi yang dikelola versi menjadi sumber kebenaran, dan implementasi, tes, serta dokumentasi diturunkan darinya. Begitu spesifikasi menghapus keraguan, agen bekerja sebagai juru ketik cepat, bukan pengambil keputusan.",
    "note": "Ini tidak menggantikan TDD — TDD mengunci perilaku, SDD mengunci kebutuhan dan batasan. Keduanya dipakai bersama."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "prompt": "Guidato dai prompt",
      "spec": "Guidato dalle specifiche"
    },
    "check": {
      "signals": "Segnali presenti",
      "rules": "Regole permanenti",
      "plan": "Piano scritto"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Sviluppo guidato dalle specifiche",
    "desc": "Una specifica versionata diventa la fonte di verità, e da essa derivano implementazione, test e documentazione. Tolta l’ambiguità, l’agente lavora da dattilografo veloce e non da decisore.",
    "note": "Questo non sostituisce il TDD — il TDD fissa il comportamento, la SDD fissa requisiti e vincoli. Si usano insieme."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "prompt": "Guiado por prompts",
      "spec": "Guiado por especificação"
    },
    "check": {
      "signals": "Sinais presentes",
      "rules": "Regras permanentes",
      "plan": "Plano escrito"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Desenvolvimento guiado por especificação",
    "desc": "Uma especificação versionada vira a fonte da verdade, e dela derivam implementação, testes e documentação. Assim que a especificação tira a ambiguidade, o agente trabalha como datilógrafo veloz e não como decisor.",
    "note": "Isto não substitui o TDD — o TDD fixa comportamento, a SDD fixa requisitos e restrições. Os dois se usam juntos."
  }
} as const;
