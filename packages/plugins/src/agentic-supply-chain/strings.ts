/**
 * agentic-supply-chain — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agenticSupplyChain` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Compromise arrives through what the agent depends on — malicious tools, untrusted servers, tampered skill files. A tool description is itself a prompt, so a hostile tool can hide instructions in it.",
    "heading": "Agentic Supply Chain",
    "level": {
      "builtin": "Built-in only",
      "skills": "Skills attached",
      "external": "External tools"
    },
    "check": {
      "external": "External tools",
      "skills": "Skills",
      "builtin": "Built-in tools"
    },
    "note": "Treat an outside tool server as a delegation of authority, not a dependency — pin the source and version, and re-review on change."
  },
  "ko": {
    "desc": "침해는 에이전트가 의존하는 것을 통해 들어옵니다 — 악성 도구, 신뢰할 수 없는 서버, 변조된 스킬 파일. 도구 설명문 자체가 프롬프트라 악의적 도구는 설명란에 지시를 숨길 수 있습니다.",
    "heading": "에이전트 공급망",
    "level": {
      "builtin": "내장 도구만",
      "skills": "스킬 붙음",
      "external": "외부 도구 있음"
    },
    "check": {
      "external": "외부 도구",
      "skills": "스킬",
      "builtin": "내장 도구"
    },
    "note": "외부 도구 서버는 의존성이 아니라 권한 위임으로 취급해야 합니다 — 출처·버전을 고정하고 변경 시 재검토하십시오."
  },
  "ja": {
    "level": {
      "builtin": "内蔵のみ",
      "skills": "スキルあり",
      "external": "外部ツール"
    },
    "check": {
      "external": "外部ツール",
      "skills": "スキル",
      "builtin": "内蔵ツール"
    },
    "heading": "エージェントのサプライチェーン",
    "desc": "侵害はエージェントが依存するものを通って入ってきます — 悪意あるツール、信頼できないサーバー、改ざんされたスキルファイル。ツールの説明文自体がプロンプトなので、悪意あるツールは説明欄に指示を隠せます。",
    "note": "外部のツールサーバーは依存関係ではなく権限の委譲として扱ってください — 出所とバージョンを固定し、変更時に見直します。"
  },
  "zh-CN": {
    "level": {
      "builtin": "仅内置",
      "skills": "已附加技能",
      "external": "外部工具"
    },
    "check": {
      "external": "外部工具",
      "skills": "技能",
      "builtin": "内置工具"
    },
    "heading": "智能体供应链",
    "desc": "入侵通过智能体所依赖的东西进来 — 恶意工具、不可信服务端、被篡改的技能文件。工具说明本身就是提示词，因此恶意工具能把指令藏在说明栏里。",
    "note": "把外部工具服务端当作权限委托而不是依赖项 — 固定来源与版本，变更时重新审查。"
  },
  "es": {
    "level": {
      "builtin": "Solo integradas",
      "skills": "Con habilidades",
      "external": "Herramientas externas"
    },
    "check": {
      "external": "Herramientas externas",
      "skills": "Habilidades",
      "builtin": "Herramientas integradas"
    },
    "heading": "Cadena de suministro agéntica",
    "desc": "El compromiso llega por aquello de lo que el agente depende — herramientas maliciosas, servidores no confiables, archivos de habilidades manipulados. La descripción de una herramienta es en sí un prompt, así que una hostil puede esconder instrucciones ahí.",
    "note": "Trata un servidor de herramientas externo como delegación de autoridad, no como dependencia — fija origen y versión, y revísalo de nuevo al cambiar."
  },
  "es-419": {
    "level": {
      "builtin": "Solo integradas",
      "skills": "Con habilidades",
      "external": "Herramientas externas"
    },
    "check": {
      "external": "Herramientas externas",
      "skills": "Habilidades",
      "builtin": "Herramientas integradas"
    },
    "heading": "Cadena de suministro agéntica",
    "desc": "El compromiso llega por aquello de lo que el agente depende — herramientas maliciosas, servidores no confiables, archivos de habilidades manipulados. La descripción de una herramienta es en sí un prompt, así que una hostil puede esconder instrucciones ahí.",
    "note": "Trata un servidor de herramientas externo como delegación de autoridad, no como dependencia — fija origen y versión, y revísalo de nuevo al cambiar."
  },
  "fr": {
    "level": {
      "builtin": "Intégrés seulement",
      "skills": "Compétences attachées",
      "external": "Outils externes"
    },
    "check": {
      "external": "Outils externes",
      "skills": "Compétences",
      "builtin": "Outils intégrés"
    },
    "heading": "Chaîne d’approvisionnement agentique",
    "desc": "La compromission arrive par ce dont l’agent dépend — outils malveillants, serveurs non fiables, fichiers de compétences altérés. La description d’un outil est elle-même un prompt : un outil hostile peut y cacher des instructions.",
    "note": "Traitez un serveur d’outils externe comme une délégation d’autorité, pas comme une dépendance — figez la source et la version, et réexaminez à chaque changement."
  },
  "de": {
    "level": {
      "builtin": "Nur eingebaut",
      "skills": "Skills angehängt",
      "external": "Externe Werkzeuge"
    },
    "check": {
      "external": "Externe Werkzeuge",
      "skills": "Skills",
      "builtin": "Eingebaute Werkzeuge"
    },
    "heading": "Agentische Lieferkette",
    "desc": "Kompromittierung kommt über das, wovon der Agent abhängt — bösartige Werkzeuge, nicht vertrauenswürdige Server, manipulierte Skill-Dateien. Eine Werkzeugbeschreibung ist selbst ein Prompt, also kann ein feindliches Werkzeug Anweisungen darin verstecken.",
    "note": "Behandeln Sie einen externen Werkzeugserver als Übertragung von Befugnis, nicht als Abhängigkeit — Quelle und Version festnageln und bei Änderungen erneut prüfen."
  },
  "hi": {
    "level": {
      "builtin": "केवल अंतर्निहित",
      "skills": "स्किल संलग्न",
      "external": "बाहरी टूल"
    },
    "check": {
      "external": "बाहरी टूल",
      "skills": "स्किल",
      "builtin": "अंतर्निहित टूल"
    },
    "heading": "एजेंटिक आपूर्ति शृंखला",
    "desc": "सेंध उन्हीं चीज़ों से आती है जिन पर एजेंट टिका है — दूषित टूल, अविश्वसनीय सर्वर, छेड़ी गई skill फ़ाइल। टूल का विवरण ख़ुद एक प्रॉम्प्ट है, इसलिए दुर्भावी टूल वहीं निर्देश छिपा सकता है।",
    "note": "बाहरी टूल-सर्वर को निर्भरता नहीं, अधिकार का सौंपना मानिए — उनका स्रोत और संस्करण बाँध दीजिए, और बदलने पर फिर से देखिए।"
  },
  "id": {
    "level": {
      "builtin": "Hanya bawaan",
      "skills": "Skill terpasang",
      "external": "Alat eksternal"
    },
    "check": {
      "external": "Alat eksternal",
      "skills": "Skill",
      "builtin": "Alat bawaan"
    },
    "heading": "Rantai pasok agentik",
    "desc": "Pembobolan datang lewat hal-hal yang menjadi sandaran agen — alat berbahaya, server tak tepercaya, berkas skill yang diutak-atik. Deskripsi alat itu sendiri adalah prompt, jadi alat yang jahat bisa menyembunyikan instruksi di sana.",
    "note": "Perlakukan server alat eksternal sebagai pendelegasian wewenang, bukan sebagai dependensi — kunci sumber dan versinya, dan tinjau ulang saat berubah."
  },
  "it": {
    "level": {
      "builtin": "Solo integrati",
      "skills": "Competenze allegate",
      "external": "Strumenti esterni"
    },
    "check": {
      "external": "Strumenti esterni",
      "skills": "Competenze",
      "builtin": "Strumenti integrati"
    },
    "heading": "Catena di fornitura agentica",
    "desc": "La compromissione arriva da ciò da cui l’agente dipende — strumenti malevoli, server non affidabili, file di competenza manomessi. La descrizione di uno strumento è essa stessa un prompt, quindi uno ostile può nascondervi istruzioni.",
    "note": "Tratta un server di strumenti esterno come delega di autorità, non come dipendenza — fissa origine e versione e riesamina a ogni cambiamento."
  },
  "pt-BR": {
    "level": {
      "builtin": "Apenas integradas",
      "skills": "Com habilidades",
      "external": "Ferramentas externas"
    },
    "check": {
      "external": "Ferramentas externas",
      "skills": "Habilidades",
      "builtin": "Ferramentas integradas"
    },
    "heading": "Cadeia de suprimentos agêntica",
    "desc": "O comprometimento chega por aquilo de que o agente depende — ferramentas maliciosas, servidores não confiáveis, arquivos de habilidade adulterados. A descrição de uma ferramenta é ela mesma um prompt, então uma hostil pode esconder instruções ali.",
    "note": "Trate um servidor de ferramentas externo como delegação de autoridade, não como dependência — fixe origem e versão e revise de novo a cada mudança."
  }
} as const;
