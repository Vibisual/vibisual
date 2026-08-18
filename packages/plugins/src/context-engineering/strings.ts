/**
 * context-engineering — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.contextEngineering` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts how many of the context patterns this agent actually uses — index over injection, tool trimming, active retrieval, thinking control.",
    "heading": "Context Engineering",
    "level": {
      "default": "Defaults only",
      "partial": "Partly applied",
      "designed": "Deliberate"
    },
    "check": {
      "applied": "Patterns applied",
      "tools": "Tools loaded",
      "memory": "Memory injections"
    },
    "note": "The question moved from “how do I word the prompt” to “what do I show it”."
  },
  "ko": {
    "desc": "이 에이전트가 컨텍스트 패턴을 몇 개나 실제로 쓰는지 셉니다 — 밀어넣기 대신 색인, 도구 정리, 능동 검색, 사고 조절.",
    "heading": "컨텍스트 엔지니어링",
    "level": {
      "default": "기본값뿐",
      "partial": "일부 적용",
      "designed": "의도적으로 설계됨"
    },
    "check": {
      "applied": "적용된 패턴",
      "tools": "실린 도구",
      "memory": "기억 주입"
    },
    "note": "질문이 \"프롬프트를 어떻게 쓰나\"에서 \"무엇을 보여줄까\"로 바뀌었습니다."
  },
  "ja": {
    "heading": "コンテキスト設計",
    "check": {
      "applied": "適用パターン",
      "tools": "読み込みツール",
      "memory": "記憶の注入"
    },
    "level": {
      "default": "既定のみ",
      "designed": "意図的な設計",
      "partial": "一部適用"
    },
    "desc": "このエージェントがコンテキストの型をいくつ実際に使っているかを数えます — 押し込みではなく索引、ツールの整理、能動的な検索、思考量の調整。",
    "note": "問いは「プロンプトをどう書くか」から「何を見せるか」へ移りました。"
  },
  "zh-CN": {
    "heading": "上下文工程",
    "check": {
      "applied": "已应用模式",
      "tools": "已载入工具",
      "memory": "记忆注入"
    },
    "level": {
      "default": "仅默认值",
      "designed": "有意设计",
      "partial": "部分应用"
    },
    "desc": "统计这个智能体实际用了几种上下文手法 — 用索引代替推送、精简工具、主动检索、调节思考量。",
    "note": "问题已经从「提示词怎么写」变成了「给它看什么」。"
  },
  "es": {
    "heading": "Ingeniería de contexto",
    "check": {
      "applied": "Patrones aplicados",
      "tools": "Herramientas cargadas",
      "memory": "Inyecciones de memoria"
    },
    "level": {
      "default": "Solo valores por defecto",
      "designed": "Deliberado",
      "partial": "Aplicado en parte"
    },
    "desc": "Cuenta cuántos patrones de contexto usa realmente este agente — índice en vez de inyección, recorte de herramientas, búsqueda activa, control del razonamiento.",
    "note": "La pregunta pasó de «cómo redacto el prompt» a «qué le muestro»."
  },
  "es-419": {
    "heading": "Ingeniería de contexto",
    "check": {
      "applied": "Patrones aplicados",
      "tools": "Herramientas cargadas",
      "memory": "Inyecciones de memoria"
    },
    "level": {
      "default": "Solo valores por defecto",
      "designed": "Deliberado",
      "partial": "Aplicado en parte"
    },
    "desc": "Cuenta cuántos patrones de contexto usa realmente este agente — índice en vez de inyección, recorte de herramientas, búsqueda activa, control del razonamiento.",
    "note": "La pregunta pasó de «cómo redacto el prompt» a «qué le muestro»."
  },
  "fr": {
    "heading": "Ingénierie du contexte",
    "check": {
      "applied": "Motifs appliqués",
      "tools": "Outils chargés",
      "memory": "Injections de mémoire"
    },
    "level": {
      "default": "Valeurs par défaut seulement",
      "designed": "Délibéré",
      "partial": "Partiellement appliqué"
    },
    "desc": "Compte combien de motifs de contexte cet agent utilise réellement — index plutôt qu’injection, élagage des outils, recherche active, contrôle de la réflexion.",
    "note": "La question est passée de « comment formuler le prompt » à « que lui montrer »."
  },
  "de": {
    "heading": "Kontext-Engineering",
    "check": {
      "applied": "Angewandte Muster",
      "tools": "Geladene Werkzeuge",
      "memory": "Gedächtnis-Injektionen"
    },
    "level": {
      "default": "Nur Standardwerte",
      "designed": "Bewusst gestaltet",
      "partial": "Teilweise angewandt"
    },
    "desc": "Zählt, wie viele der Kontextmuster dieser Agent tatsächlich nutzt — Index statt Einspeisung, Werkzeuge ausdünnen, aktives Suchen, Denkmenge steuern.",
    "note": "Die Frage hat sich von „wie formuliere ich den Prompt“ zu „was zeige ich ihm“ verschoben."
  },
  "hi": {
    "heading": "संदर्भ इंजीनियरिंग",
    "check": {
      "applied": "लागू पैटर्न",
      "tools": "लोड टूल",
      "memory": "स्मृति इंजेक्शन"
    },
    "level": {
      "default": "केवल डिफ़ॉल्ट",
      "designed": "सोच-समझकर",
      "partial": "आंशिक रूप से लागू"
    },
    "desc": "गिनता है कि यह एजेंट सचमुच कितने संदर्भ-पैटर्न इस्तेमाल करता है — डालने की जगह सूची, टूल छाँटना, ख़ुद खोजना, तर्क की मात्रा सँभालना।",
    "note": "सवाल «प्रॉम्प्ट कैसे लिखूँ» से खिसककर «मैं दिखाता क्या हूँ» हो जाता है।"
  },
  "id": {
    "heading": "Rekayasa konteks",
    "check": {
      "applied": "Pola diterapkan",
      "tools": "Alat dimuat",
      "memory": "Injeksi memori"
    },
    "level": {
      "default": "Hanya bawaan",
      "designed": "Disengaja",
      "partial": "Sebagian diterapkan"
    },
    "desc": "Menghitung berapa pola konteks yang benar-benar dipakai agen ini — indeks alih-alih injeksi, memangkas alat, pencarian aktif, mengatur banyaknya penalaran.",
    "note": "Pertanyaannya bergeser dari «bagaimana menyusun prompt» menjadi «apa yang saya perlihatkan»."
  },
  "it": {
    "heading": "Ingegneria del contesto",
    "check": {
      "applied": "Pattern applicati",
      "tools": "Strumenti caricati",
      "memory": "Iniezioni di memoria"
    },
    "level": {
      "default": "Solo predefiniti",
      "designed": "Deliberato",
      "partial": "Applicato in parte"
    },
    "desc": "Conta quanti schemi di contesto questo agente usa davvero — indice invece di iniezione, sfoltire gli strumenti, ricerca attiva, controllo del ragionamento.",
    "note": "La domanda è passata da «come formulo il prompt» a «che cosa gli mostro»."
  },
  "pt-BR": {
    "heading": "Engenharia de contexto",
    "check": {
      "applied": "Padrões aplicados",
      "tools": "Ferramentas carregadas",
      "memory": "Injeções de memória"
    },
    "level": {
      "default": "Apenas padrões",
      "designed": "Deliberado",
      "partial": "Aplicado em parte"
    },
    "desc": "Conta quantos padrões de contexto este agente realmente usa — índice em vez de injeção, enxugar ferramentas, busca ativa, controle do raciocínio.",
    "note": "A pergunta passou de «como redijo o prompt» para «o que eu mostro a ele»."
  }
} as const;
