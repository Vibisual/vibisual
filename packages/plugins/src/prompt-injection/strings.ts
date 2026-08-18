/**
 * prompt-injection — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.promptInjection` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts the paths through which outside text reaches this agent. The cause is structural — a model receives instructions and data on the same token stream and cannot tell them apart in principle.",
    "heading": "Prompt Injection",
    "level": {
      "sealed": "No ingress",
      "narrow": "Narrow ingress",
      "wide": "Wide ingress"
    },
    "check": {
      "paths": "Ingress paths",
      "web": "Reaches the web"
    },
    "yes": "yes",
    "no": "no",
    "note": "Every external text an agent reads is a potential path — search results, opened files, dependency READMEs, even what a tool returned."
  },
  "ko": {
    "desc": "외부 텍스트가 이 에이전트로 들어오는 경로를 셉니다. 원인이 구조적입니다 — 모델은 명령과 데이터를 같은 토큰 스트림으로 받아 원리적으로 구분할 수 없습니다.",
    "heading": "프롬프트 인젝션",
    "level": {
      "sealed": "유입 경로 없음",
      "narrow": "좁음",
      "wide": "넓음"
    },
    "check": {
      "paths": "유입 경로",
      "web": "웹까지 닿음"
    },
    "yes": "예",
    "no": "아니오",
    "note": "에이전트가 읽는 모든 외부 텍스트가 잠재 경로입니다 — 검색 결과, 열어 본 파일, 의존성의 README, 도구가 돌려준 응답까지."
  },
  "ja": {
    "yes": "はい",
    "no": "いいえ",
    "heading": "プロンプトインジェクション",
    "check": {
      "paths": "流入経路",
      "web": "ウェブに届く"
    },
    "level": {
      "sealed": "流入経路なし",
      "narrow": "流入が狭い",
      "wide": "流入が広い"
    },
    "desc": "外部のテキストがこのエージェントへ入ってくる経路を数えます。原因は構造的です — モデルは命令とデータを同じトークン列で受け取るため、原理的に区別できません。",
    "note": "エージェントが読むすべての外部テキストが潜在的な経路です — 検索結果、開いたファイル、依存関係の README、ツールが返した応答まで。"
  },
  "zh-CN": {
    "yes": "是",
    "no": "否",
    "heading": "提示词注入",
    "check": {
      "paths": "流入路径",
      "web": "可触达网络"
    },
    "level": {
      "sealed": "无流入路径",
      "narrow": "流入较窄",
      "wide": "流入较宽"
    },
    "desc": "统计外部文本进入这个智能体的通路有几条。原因是结构性的 — 模型在同一条令牌流上接收指令与数据，原理上无法区分。",
    "note": "智能体读到的每一段外部文本都是潜在通路 — 搜索结果、打开的文件、依赖的 README，乃至工具返回的响应。"
  },
  "es": {
    "yes": "sí",
    "no": "no",
    "heading": "Inyección de prompts",
    "check": {
      "paths": "Vías de entrada",
      "web": "Alcanza la web"
    },
    "level": {
      "sealed": "Sin vías de entrada",
      "narrow": "Entrada estrecha",
      "wide": "Entrada amplia"
    },
    "desc": "Cuenta las vías por las que texto externo llega a este agente. La causa es estructural — un modelo recibe instrucciones y datos en el mismo flujo de tokens y no puede, en principio, distinguirlos.",
    "note": "Todo texto externo que un agente lee es una vía potencial — resultados de búsqueda, archivos abiertos, README de dependencias, hasta lo que devolvió una herramienta."
  },
  "es-419": {
    "yes": "sí",
    "no": "no",
    "heading": "Inyección de prompts",
    "check": {
      "paths": "Vías de entrada",
      "web": "Alcanza la web"
    },
    "level": {
      "sealed": "Sin vías de entrada",
      "narrow": "Entrada estrecha",
      "wide": "Entrada amplia"
    },
    "desc": "Cuenta las vías por las que texto externo llega a este agente. La causa es estructural — un modelo recibe instrucciones y datos en el mismo flujo de tokens y no puede, en principio, distinguirlos.",
    "note": "Todo texto externo que un agente lee es una vía potencial — resultados de búsqueda, archivos abiertos, README de dependencias, hasta lo que devolvió una herramienta."
  },
  "fr": {
    "yes": "oui",
    "no": "non",
    "heading": "Injection de prompt",
    "check": {
      "paths": "Voies d’entrée",
      "web": "Atteint le web"
    },
    "level": {
      "sealed": "Aucune voie d’entrée",
      "narrow": "Entrée étroite",
      "wide": "Entrée large"
    },
    "desc": "Compte les chemins par lesquels du texte extérieur atteint cet agent. La cause est structurelle — un modèle reçoit instructions et données sur le même flux de jetons et ne peut, par principe, les distinguer.",
    "note": "Tout texte externe qu’un agent lit est un chemin potentiel — résultats de recherche, fichiers ouverts, README de dépendances, jusqu’à ce qu’un outil a renvoyé."
  },
  "de": {
    "yes": "ja",
    "no": "nein",
    "heading": "Prompt-Injection",
    "check": {
      "paths": "Eingangswege",
      "web": "Erreicht das Web"
    },
    "level": {
      "sealed": "Keine Eingangswege",
      "narrow": "Enger Eingang",
      "wide": "Weiter Eingang"
    },
    "desc": "Zählt die Wege, über die fremder Text zu diesem Agenten gelangt. Die Ursache ist strukturell — ein Modell empfängt Anweisungen und Daten im selben Token-Strom und kann sie prinzipiell nicht unterscheiden.",
    "note": "Jeder externe Text, den ein Agent liest, ist ein möglicher Weg — Suchergebnisse, geöffnete Dateien, READMEs von Abhängigkeiten, selbst das, was ein Werkzeug zurückgab."
  },
  "hi": {
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "प्रॉम्प्ट इंजेक्शन",
    "check": {
      "paths": "प्रवेश पथ",
      "web": "वेब तक पहुँच"
    },
    "level": {
      "sealed": "कोई प्रवेश पथ नहीं",
      "narrow": "संकीर्ण प्रवेश",
      "wide": "व्यापक प्रवेश"
    },
    "desc": "गिनता है कि बाहरी पाठ इस एजेंट तक किन-किन रास्तों से आता है। कारण ढाँचागत है — मॉडल निर्देश और डेटा एक ही टोकन-धारा पर पाता है और मूल रूप से उन्हें अलग नहीं कर सकता।",
    "note": "एजेंट जो भी बाहरी पाठ पढ़ता है वह संभावित रास्ता है — खोज के नतीजे, खोली गई फ़ाइलें, निर्भरता का README, और यहाँ तक कि किसी टूल का लौटाया हुआ उत्तर भी।"
  },
  "id": {
    "yes": "ya",
    "no": "tidak",
    "heading": "Injeksi prompt",
    "check": {
      "paths": "Jalur masuk",
      "web": "Menjangkau web"
    },
    "level": {
      "sealed": "Tanpa jalur masuk",
      "narrow": "Jalur masuk sempit",
      "wide": "Jalur masuk lebar"
    },
    "desc": "Menghitung jalur yang dilalui teks luar untuk sampai ke agen ini. Penyebabnya struktural — model menerima instruksi dan data pada aliran token yang sama dan pada dasarnya tak bisa membedakannya.",
    "note": "Setiap teks luar yang dibaca agen adalah jalur potensial — hasil pencarian, berkas yang dibuka, README dependensi, bahkan yang dikembalikan sebuah alat."
  },
  "it": {
    "yes": "sì",
    "no": "no",
    "heading": "Prompt injection",
    "check": {
      "paths": "Vie di ingresso",
      "web": "Raggiunge il web"
    },
    "level": {
      "sealed": "Nessuna via d’ingresso",
      "narrow": "Ingresso stretto",
      "wide": "Ingresso ampio"
    },
    "desc": "Conta le vie attraverso cui testo esterno raggiunge questo agente. La causa è strutturale — un modello riceve istruzioni e dati sullo stesso flusso di token e non può, in linea di principio, distinguerli.",
    "note": "Ogni testo esterno che un agente legge è una via possibile — risultati di ricerca, file aperti, README delle dipendenze, perfino ciò che uno strumento ha restituito."
  },
  "pt-BR": {
    "yes": "sim",
    "no": "não",
    "heading": "Injeção de prompt",
    "check": {
      "paths": "Vias de entrada",
      "web": "Alcança a web"
    },
    "level": {
      "sealed": "Sem vias de entrada",
      "narrow": "Entrada estreita",
      "wide": "Entrada ampla"
    },
    "desc": "Conta os caminhos pelos quais texto externo chega a este agente. A causa é estrutural — um modelo recebe instruções e dados no mesmo fluxo de tokens e não consegue, em princípio, distingui-los.",
    "note": "Todo texto externo que um agente lê é um caminho possível — resultados de busca, arquivos abertos, READMEs de dependências, até o que uma ferramenta devolveu."
  }
} as const;
