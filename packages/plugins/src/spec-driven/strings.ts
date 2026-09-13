/**
 * spec-driven — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.specDriven` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 *
 * 정독 게이트에서 `level`·`check` 가 통째로 바뀌었다. 종전 키(`signals`·`rules`·`plan`)는 곁신호를
 * 세던 시절의 것이고, 그 셋은 기획을 실제로 읽었는지와 아무 상관이 없어서 남겨 둘 이유가 없다.
 */
export const strings = {
  "en": {
    "desc": "A versioned specification becomes the source of truth, and implementation, tests and docs derive from it. Once the spec removes ambiguity the agent works as a fast typist rather than a decision maker.",
    "heading": "Spec-Driven Development",
    "level": {
      "unmeasured": "Not measured yet",
      "off": "Off",
      "noSpec": "No spec found",
      "idle": "Nothing required",
      "read": "Read through",
      "partial": "Partly read",
      "mismatch": "Citation mismatch"
    },
    "check": {
      "index": "Index (docs · sections)",
      "required": "Required this turn",
      "citation": "Citations checked"
    },
    "none": "none",
    "note": "This does not replace TDD — TDD pins behaviour, SDD pins requirements and constraints. They are used together."
  },
  "ko": {
    "desc": "버전 관리되는 명세가 진실 공급원이 되고 구현·테스트·문서가 거기서 파생됩니다. 명세가 모호함을 없애면 에이전트는 결정권자가 아니라 고속 타이피스트로 일합니다.",
    "heading": "명세 주도 개발",
    "level": {
      "unmeasured": "측정 전",
      "off": "꺼짐",
      "noSpec": "기획 문서 없음",
      "idle": "지목 없음",
      "read": "끝까지 읽음",
      "partial": "일부만 읽음",
      "mismatch": "인용 불일치"
    },
    "check": {
      "index": "색인 (문서 · 절)",
      "required": "이번 턴 필수 절",
      "citation": "인용 대조"
    },
    "none": "없음",
    "note": "TDD 를 대체하지 않습니다 — TDD 는 동작을, SDD 는 요구사항과 제약을 고정합니다. 둘은 함께 씁니다."
  },
  "ja": {
    "level": {
      "unmeasured": "未計測",
      "off": "オフ",
      "noSpec": "仕様書なし",
      "idle": "指定なし",
      "read": "最後まで読了",
      "partial": "一部のみ",
      "mismatch": "引用が不一致"
    },
    "check": {
      "index": "索引（文書・節）",
      "required": "今回必須の節",
      "citation": "引用の照合"
    },
    "none": "なし",
    "heading": "仕様駆動開発",
    "desc": "バージョン管理された仕様が真実の供給源になり、実装・テスト・文書がそこから派生します。仕様が曖昧さを消せば、エージェントは決定権者ではなく高速なタイピストとして働きます。",
    "note": "TDD の代わりではありません — TDD は振る舞いを、SDD は要求と制約を固定します。二つは併せて使います。"
  },
  "zh-CN": {
    "level": {
      "unmeasured": "尚未测量",
      "off": "已关闭",
      "noSpec": "未找到规格文档",
      "idle": "本轮无指定",
      "read": "已读到底",
      "partial": "只读了一部分",
      "mismatch": "引用不一致"
    },
    "check": {
      "index": "索引（文档 · 章节）",
      "required": "本轮必读章节",
      "citation": "引用核对"
    },
    "none": "无",
    "heading": "规格驱动开发",
    "desc": "受版本管理的规格成为真实来源，实现、测试与文档都由它派生。规格一旦消除歧义，智能体就从决策者变成高速打字员。",
    "note": "这并不取代 TDD — TDD 固定行为，SDD 固定需求与约束。两者是一起用的。"
  },
  "es": {
    "level": {
      "unmeasured": "Sin medir",
      "off": "Desactivado",
      "noSpec": "Sin especificación",
      "idle": "Nada requerido",
      "read": "Leído hasta el final",
      "partial": "Leído en parte",
      "mismatch": "Cita que no coincide"
    },
    "check": {
      "index": "Índice (docs · secciones)",
      "required": "Requerido en este turno",
      "citation": "Citas verificadas"
    },
    "none": "ninguna",
    "heading": "Desarrollo guiado por especificación",
    "desc": "Una especificación versionada se vuelve la fuente de verdad, y de ella derivan implementación, pruebas y documentación. Una vez que la especificación quita la ambigüedad, el agente trabaja como mecanógrafo veloz y no como decisor.",
    "note": "Esto no sustituye al TDD — el TDD fija el comportamiento, la SDD fija requisitos y restricciones. Se usan juntos."
  },
  "es-419": {
    "level": {
      "unmeasured": "Sin medir",
      "off": "Desactivado",
      "noSpec": "Sin especificación",
      "idle": "Nada requerido",
      "read": "Leído hasta el final",
      "partial": "Leído en parte",
      "mismatch": "Cita que no coincide"
    },
    "check": {
      "index": "Índice (docs · secciones)",
      "required": "Requerido en este turno",
      "citation": "Citas verificadas"
    },
    "none": "ninguna",
    "heading": "Desarrollo guiado por especificación",
    "desc": "Una especificación versionada se vuelve la fuente de verdad, y de ella derivan implementación, pruebas y documentación. Una vez que la especificación quita la ambigüedad, el agente trabaja como mecanógrafo veloz y no como decisor.",
    "note": "Esto no sustituye al TDD — el TDD fija el comportamiento, la SDD fija requisitos y restricciones. Se usan juntos."
  },
  "fr": {
    "level": {
      "unmeasured": "Non mesuré",
      "off": "Désactivé",
      "noSpec": "Aucune spécification",
      "idle": "Rien d’exigé",
      "read": "Lu jusqu’au bout",
      "partial": "Lu en partie",
      "mismatch": "Citation non concordante"
    },
    "check": {
      "index": "Index (docs · sections)",
      "required": "Exigé ce tour-ci",
      "citation": "Citations vérifiées"
    },
    "none": "aucune",
    "heading": "Développement piloté par la spécification",
    "desc": "Une spécification versionnée devient la source de vérité, dont dérivent implémentation, tests et documentation. Une fois l’ambiguïté levée, l’agent travaille en dactylographe rapide plutôt qu’en décideur.",
    "note": "Cela ne remplace pas le TDD — le TDD fige le comportement, la SDD fige exigences et contraintes. Les deux s’utilisent ensemble."
  },
  "de": {
    "level": {
      "unmeasured": "Noch nicht gemessen",
      "off": "Aus",
      "noSpec": "Keine Spezifikation gefunden",
      "idle": "Nichts gefordert",
      "read": "Bis zum Ende gelesen",
      "partial": "Nur teilweise gelesen",
      "mismatch": "Zitat stimmt nicht"
    },
    "check": {
      "index": "Index (Dokumente · Abschnitte)",
      "required": "Diese Runde gefordert",
      "citation": "Geprüfte Zitate"
    },
    "none": "keine",
    "heading": "Spezifikationsgetriebene Entwicklung",
    "desc": "Eine versionierte Spezifikation wird zur Quelle der Wahrheit, aus der sich Implementierung, Tests und Dokumentation ableiten. Nimmt die Spezifikation die Mehrdeutigkeit, arbeitet der Agent als schneller Schreibkraft statt als Entscheider.",
    "note": "Das ersetzt TDD nicht — TDD legt Verhalten fest, SDD legt Anforderungen und Einschränkungen fest. Beide werden zusammen genutzt."
  },
  "hi": {
    "level": {
      "unmeasured": "अभी मापा नहीं",
      "off": "बंद",
      "noSpec": "कोई विनिर्देश नहीं मिला",
      "idle": "इस बार कुछ ज़रूरी नहीं",
      "read": "अंत तक पढ़ा",
      "partial": "आंशिक रूप से पढ़ा",
      "mismatch": "उद्धरण मेल नहीं खाता"
    },
    "check": {
      "index": "सूचकांक (दस्तावेज़ · खंड)",
      "required": "इस बार ज़रूरी खंड",
      "citation": "जाँचे गए उद्धरण"
    },
    "none": "कोई नहीं",
    "heading": "विनिर्देश-चालित विकास",
    "desc": "संस्करण-नियंत्रित विनिर्देश सच का स्रोत बनता है, और उससे कार्यान्वयन, टेस्ट और दस्तावेज़ निकलते हैं। जब विनिर्देश संदेह मिटा देता है, तब एजेंट निर्णायक नहीं, तेज़ टंकक की तरह काम करता है।",
    "note": "यह TDD की जगह नहीं लेता — TDD व्यवहार बाँधता है, SDD आवश्यकताएँ और बंदिशें। दोनों साथ चलते हैं।"
  },
  "id": {
    "level": {
      "unmeasured": "Belum diukur",
      "off": "Nonaktif",
      "noSpec": "Spesifikasi tidak ditemukan",
      "idle": "Tidak ada yang wajib",
      "read": "Dibaca sampai habis",
      "partial": "Baru sebagian dibaca",
      "mismatch": "Kutipan tidak cocok"
    },
    "check": {
      "index": "Indeks (dokumen · bagian)",
      "required": "Wajib giliran ini",
      "citation": "Kutipan yang dicek"
    },
    "none": "tidak ada",
    "heading": "Pengembangan berbasis spesifikasi",
    "desc": "Spesifikasi yang dikelola versi menjadi sumber kebenaran, dan implementasi, tes, serta dokumentasi diturunkan darinya. Begitu spesifikasi menghapus keraguan, agen bekerja sebagai juru ketik cepat, bukan pengambil keputusan.",
    "note": "Ini tidak menggantikan TDD — TDD mengunci perilaku, SDD mengunci kebutuhan dan batasan. Keduanya dipakai bersama."
  },
  "it": {
    "level": {
      "unmeasured": "Non ancora misurato",
      "off": "Disattivato",
      "noSpec": "Nessuna specifica trovata",
      "idle": "Nulla di obbligatorio",
      "read": "Letto fino in fondo",
      "partial": "Letto solo in parte",
      "mismatch": "Citazione non corrispondente"
    },
    "check": {
      "index": "Indice (documenti · sezioni)",
      "required": "Obbligatorio in questo turno",
      "citation": "Citazioni verificate"
    },
    "none": "nessuna",
    "heading": "Sviluppo guidato dalle specifiche",
    "desc": "Una specifica versionata diventa la fonte di verità, e da essa derivano implementazione, test e documentazione. Tolta l’ambiguità, l’agente lavora da dattilografo veloce e non da decisore.",
    "note": "Questo non sostituisce il TDD — il TDD fissa il comportamento, la SDD fissa requisiti e vincoli. Si usano insieme."
  },
  "pt-BR": {
    "level": {
      "unmeasured": "Ainda não medido",
      "off": "Desativado",
      "noSpec": "Nenhuma especificação encontrada",
      "idle": "Nada exigido",
      "read": "Lido até o fim",
      "partial": "Lido só em parte",
      "mismatch": "Citação não confere"
    },
    "check": {
      "index": "Índice (docs · seções)",
      "required": "Exigido nesta rodada",
      "citation": "Citações conferidas"
    },
    "none": "nenhuma",
    "heading": "Desenvolvimento guiado por especificação",
    "desc": "Uma especificação versionada vira a fonte da verdade, e dela derivam implementação, testes e documentação. Assim que a especificação tira a ambiguidade, o agente trabalha como datilógrafo veloz e não como decisor.",
    "note": "Isto não substitui o TDD — o TDD fixa comportamento, a SDD fixa requisitos e restrições. Os dois se usam juntos."
  }
} as const;
