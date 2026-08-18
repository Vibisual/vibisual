/**
 * mcp-client-inventory — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.mcpClientInventory` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts external tool servers attached to this agent. One install line can bring in arbitrary code and tool definitions, so the list itself is worth inspecting.",
    "heading": "MCP Inventory",
    "level": {
      "none": "Built-in only",
      "attached": "External attached"
    },
    "check": {
      "servers": "External tools",
      "builtin": "Built-in tools"
    },
    "note": "An untrusted server is a supply-chain risk, not a convenience. Pin source and version, and re-review on change."
  },
  "ko": {
    "desc": "이 에이전트에 붙은 외부 도구 서버를 셉니다. 설치 한 줄로 임의 코드와 도구 정의가 들어오므로, 목록 자체가 점검 대상입니다.",
    "heading": "MCP 인벤토리",
    "level": {
      "none": "내장 도구만",
      "attached": "외부 붙음"
    },
    "check": {
      "servers": "외부 도구",
      "builtin": "내장 도구"
    },
    "note": "신뢰하지 않는 서버는 편의가 아니라 공급망 위험입니다. 출처·버전을 고정하고 변경 시 재검토하십시오."
  },
  "ja": {
    "level": {
      "none": "内蔵のみ",
      "attached": "外部が接続"
    },
    "check": {
      "servers": "外部ツール",
      "builtin": "内蔵ツール"
    },
    "heading": "MCP インベントリ",
    "desc": "このエージェントに付いた外部のツールサーバーを数えます。インストール一行で任意のコードとツール定義が入ってくるため、一覧そのものが点検の対象です。",
    "note": "信頼していないサーバーは利便ではなく供給網のリスクです。出所とバージョンを固定し、変更時に見直してください。"
  },
  "zh-CN": {
    "level": {
      "none": "仅内置",
      "attached": "已接外部"
    },
    "check": {
      "servers": "外部工具",
      "builtin": "内置工具"
    },
    "heading": "MCP 清单",
    "desc": "统计挂在这个智能体上的外部工具服务端。一行安装就能引入任意代码与工具定义，所以这份清单本身就值得检查。",
    "note": "不受信任的服务端不是便利而是供应链风险。固定来源与版本，变更时重新审查。"
  },
  "es": {
    "level": {
      "none": "Solo integradas",
      "attached": "Externas conectadas"
    },
    "check": {
      "servers": "Herramientas externas",
      "builtin": "Herramientas integradas"
    },
    "heading": "Inventario MCP",
    "desc": "Cuenta los servidores de herramientas externos enganchados a este agente. Una línea de instalación puede meter código arbitrario y definiciones de herramientas, así que la lista misma merece revisión.",
    "note": "Un servidor no confiable es un riesgo de cadena de suministro, no una comodidad. Fija origen y versión, y revísalo de nuevo al cambiar."
  },
  "es-419": {
    "level": {
      "none": "Solo integradas",
      "attached": "Externas conectadas"
    },
    "check": {
      "servers": "Herramientas externas",
      "builtin": "Herramientas integradas"
    },
    "heading": "Inventario MCP",
    "desc": "Cuenta los servidores de herramientas externos enganchados a este agente. Una línea de instalación puede meter código arbitrario y definiciones de herramientas, así que la lista misma merece revisión.",
    "note": "Un servidor no confiable es un riesgo de cadena de suministro, no una comodidad. Fija origen y versión, y revísalo de nuevo al cambiar."
  },
  "fr": {
    "level": {
      "none": "Intégrés seulement",
      "attached": "Externes attachés"
    },
    "check": {
      "servers": "Outils externes",
      "builtin": "Outils intégrés"
    },
    "heading": "Inventaire MCP",
    "desc": "Compte les serveurs d’outils externes rattachés à cet agent. Une ligne d’installation peut faire entrer du code arbitraire et des définitions d’outils : la liste elle-même mérite un examen.",
    "note": "Un serveur non fiable est un risque de chaîne d’approvisionnement, pas une commodité. Figez source et version, et réexaminez à chaque changement."
  },
  "de": {
    "level": {
      "none": "Nur eingebaut",
      "attached": "Externe angebunden"
    },
    "check": {
      "servers": "Externe Werkzeuge",
      "builtin": "Eingebaute Werkzeuge"
    },
    "heading": "MCP-Inventar",
    "desc": "Zählt externe Werkzeugserver, die an diesem Agenten hängen. Eine Installationszeile kann beliebigen Code und Werkzeugdefinitionen hereinholen, deshalb lohnt schon die Liste selbst eine Prüfung.",
    "note": "Ein nicht vertrauenswürdiger Server ist ein Lieferkettenrisiko, keine Bequemlichkeit. Quelle und Version festnageln und bei Änderungen erneut prüfen."
  },
  "hi": {
    "level": {
      "none": "केवल अंतर्निहित",
      "attached": "बाहरी जुड़ा"
    },
    "check": {
      "servers": "बाहरी टूल",
      "builtin": "अंतर्निहित टूल"
    },
    "heading": "MCP सूची",
    "desc": "इस एजेंट से जुड़े बाहरी टूल-सर्वर गिनता है। स्थापना की एक पंक्ति मनमाना कोड और टूल-परिभाषाएँ भीतर ला सकती है, इसलिए यह सूची ख़ुद देखने लायक है।",
    "note": "अविश्वसनीय सर्वर सुविधा नहीं, आपूर्ति-शृंखला का जोखिम है। उनका स्रोत और संस्करण बाँधिए, और बदलने पर फिर से देखिए।"
  },
  "id": {
    "level": {
      "none": "Hanya bawaan",
      "attached": "Eksternal terpasang"
    },
    "check": {
      "servers": "Alat eksternal",
      "builtin": "Alat bawaan"
    },
    "heading": "Inventaris MCP",
    "desc": "Menghitung server alat eksternal yang terpasang pada agen ini. Satu baris pemasangan bisa membawa masuk kode sembarang dan definisi alat, jadi daftarnya sendiri layak diperiksa.",
    "note": "Server yang tak tepercaya adalah risiko rantai pasok, bukan kemudahan. Kunci sumber dan versinya, dan tinjau ulang saat berubah."
  },
  "it": {
    "level": {
      "none": "Solo integrati",
      "attached": "Esterni collegati"
    },
    "check": {
      "servers": "Strumenti esterni",
      "builtin": "Strumenti integrati"
    },
    "heading": "Inventario MCP",
    "desc": "Conta i server di strumenti esterni agganciati a questo agente. Una riga di installazione può portare dentro codice arbitrario e definizioni di strumenti, quindi la lista stessa merita un esame.",
    "note": "Un server non affidabile è un rischio di catena di fornitura, non una comodità. Fissa origine e versione e riesamina a ogni cambiamento."
  },
  "pt-BR": {
    "level": {
      "none": "Apenas integradas",
      "attached": "Externas conectadas"
    },
    "check": {
      "servers": "Ferramentas externas",
      "builtin": "Ferramentas integradas"
    },
    "heading": "Inventário MCP",
    "desc": "Conta os servidores de ferramentas externos ligados a este agente. Uma linha de instalação pode trazer código arbitrário e definições de ferramentas, então a própria lista merece inspeção.",
    "note": "Um servidor não confiável é risco de cadeia de suprimentos, não conveniência. Fixe origem e versão e revise de novo a cada mudança."
  }
} as const;
