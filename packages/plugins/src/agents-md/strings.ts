/**
 * agents-md — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agentsMd` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "A single instruction file at the repository root became the de-facto standard, but longer is not better — past roughly 150 lines the returns drop sharply while inference cost keeps rising.",
    "heading": "Agent Instructions",
    "level": {
      "none": "No standing rules",
      "short": "Well sized",
      "long": "Long"
    },
    "check": {
      "chars": "Rule characters",
      "threshold": "Threshold"
    },
    "note": "Short instructions with links to detail is the right shape. Pasting whole documents in manufactures context rot.",
    "noteLong": "These rules are long enough to cost on every turn while the later parts get diluted first. Move detail out and link to it."
  },
  "ko": {
    "desc": "저장소 루트의 단일 지침 파일이 사실상 표준이 됐지만 길수록 좋은 게 아닙니다 — 대략 150줄을 넘으면 수익이 급감하고 추론 비용만 계속 늡니다.",
    "heading": "지침 파일",
    "level": {
      "none": "상시 규칙 없음",
      "short": "적당한 크기",
      "long": "김"
    },
    "check": {
      "chars": "규칙 글자 수",
      "threshold": "문턱"
    },
    "note": "짧은 지침 + 상세는 링크가 정답 형태입니다. 상세 문서를 통째로 붙여넣는 것은 컨텍스트 부패를 스스로 만드는 짓입니다.",
    "noteLong": "매 턴 비용을 치를 만큼 길고, 뒷부분부터 먼저 희석됩니다. 상세는 밖으로 빼고 링크로 거십시오."
  },
  "ja": {
    "level": {
      "none": "常設ルールなし",
      "long": "長い",
      "short": "ちょうどよい"
    },
    "check": {
      "chars": "ルール文字数",
      "threshold": "しきい値"
    },
    "heading": "エージェント指示ファイル",
    "desc": "リポジトリ直下の単一指示ファイルが事実上の標準になりましたが、長いほど良いわけではありません — おおよそ 150 行を超えると効果が急減し、推論コストだけが増え続けます。",
    "note": "短い指示＋詳細はリンク、が正しい形です。詳細な文書を丸ごと貼り付けるのはコンテキストの劣化を自作する行為です。",
    "noteLong": "毎ターン費用を払うほど長く、後半から先に薄まります。詳細は外へ出してリンクで繋いでください。"
  },
  "zh-CN": {
    "level": {
      "none": "无常驻规则",
      "long": "较长",
      "short": "长度合适"
    },
    "check": {
      "chars": "规则字数",
      "threshold": "阈值"
    },
    "heading": "智能体指令文件",
    "desc": "仓库根目录下的单一指令文件已成事实标准，但并非越长越好 — 超过大约 150 行后收益急剧下降，而推理成本仍在上升。",
    "note": "简短指令加上指向细节的链接，才是正确形态。把整份文档粘进去，等于自己制造上下文腐化。",
    "noteLong": "它长到每轮都要付出成本，而靠后的部分会最先被稀释。把细节移出去，用链接连接。"
  },
  "es": {
    "level": {
      "none": "Sin reglas permanentes",
      "long": "Largo",
      "short": "Bien dimensionado"
    },
    "check": {
      "chars": "Caracteres de reglas",
      "threshold": "Umbral"
    },
    "heading": "Instrucciones del agente",
    "desc": "Un único archivo de instrucciones en la raíz del repositorio se volvió el estándar de facto, pero más largo no es mejor — pasadas unas 150 líneas el rendimiento cae con fuerza mientras el coste de inferencia sigue subiendo.",
    "note": "Instrucciones cortas con enlaces al detalle: esa es la forma correcta. Pegar documentos enteros fabrica deterioro de contexto.",
    "noteLong": "Estas reglas son lo bastante largas como para costar en cada turno, mientras las partes finales se diluyen primero. Saca el detalle fuera y enlázalo."
  },
  "es-419": {
    "level": {
      "none": "Sin reglas permanentes",
      "long": "Largo",
      "short": "Bien dimensionado"
    },
    "check": {
      "chars": "Caracteres de reglas",
      "threshold": "Umbral"
    },
    "heading": "Instrucciones del agente",
    "desc": "Un único archivo de instrucciones en la raíz del repositorio se volvió el estándar de facto, pero más largo no es mejor — pasadas unas 150 líneas el rendimiento cae con fuerza mientras el coste de inferencia sigue subiendo.",
    "note": "Instrucciones cortas con enlaces al detalle: esa es la forma correcta. Pegar documentos enteros fabrica deterioro de contexto.",
    "noteLong": "Estas reglas son lo bastante largas como para costar en cada turno, mientras las partes finales se diluyen primero. Saca el detalle fuera y enlázalo."
  },
  "fr": {
    "level": {
      "none": "Aucune règle permanente",
      "long": "Long",
      "short": "Bien dimensionné"
    },
    "check": {
      "chars": "Caractères de règles",
      "threshold": "Seuil"
    },
    "heading": "Instructions d’agent",
    "desc": "Un fichier d’instructions unique à la racine du dépôt s’est imposé de fait, mais plus long ne veut pas dire meilleur — au-delà d’environ 150 lignes le rendement chute nettement tandis que le coût d’inférence continue de monter.",
    "note": "Des instructions courtes avec des liens vers le détail : voilà la bonne forme. Coller des documents entiers fabrique de la dégradation de contexte.",
    "noteLong": "Ces règles sont assez longues pour coûter à chaque tour, tandis que les parties finales se diluent en premier. Sortez le détail et reliez-le."
  },
  "de": {
    "level": {
      "none": "Keine Dauerregeln",
      "long": "Lang",
      "short": "Gut bemessen"
    },
    "check": {
      "chars": "Regelzeichen",
      "threshold": "Schwelle"
    },
    "heading": "Agent-Anweisungen",
    "desc": "Eine einzelne Anweisungsdatei im Repository-Wurzelverzeichnis wurde zum De-facto-Standard, aber länger ist nicht besser — jenseits von etwa 150 Zeilen fällt der Ertrag stark, während die Inferenzkosten weiter steigen.",
    "note": "Kurze Anweisungen mit Links zu Details sind die richtige Form. Ganze Dokumente einzufügen erzeugt Kontextverfall.",
    "noteLong": "Diese Regeln sind lang genug, um in jedem Zug zu kosten, während die späteren Teile zuerst verwässern. Verlagern Sie Details nach außen und verlinken Sie sie."
  },
  "hi": {
    "level": {
      "none": "कोई स्थायी नियम नहीं",
      "long": "लंबा",
      "short": "उपयुक्त आकार"
    },
    "check": {
      "chars": "नियम अक्षर",
      "threshold": "सीमा"
    },
    "heading": "एजेंट निर्देश",
    "desc": "भंडार की जड़ में एक निर्देश-फ़ाइल वास्तविक मानक बन गई है, पर लंबा होना बेहतर होना नहीं — लगभग 150 पंक्तियों के बाद नतीजा तेज़ी से गिरता है जबकि अनुमान की लागत चढ़ती रहती है।",
    "note": "छोटा निर्देश और ब्योरे की कड़ियाँ: यही सही रूप है। पूरा दस्तावेज़ चिपकाना उल्टा संदर्भ-क्षय बनाता है।",
    "noteLong": "ये नियम इतने लंबे हैं कि हर बारी में शुल्क लगाते हैं, जबकि इनका पिछला हिस्सा सबसे पहले पतला पड़ता है। ब्योरा बाहर ले जाइए और कड़ी दीजिए।"
  },
  "id": {
    "level": {
      "none": "Tidak ada aturan tetap",
      "long": "Panjang",
      "short": "Ukuran pas"
    },
    "check": {
      "chars": "Karakter aturan",
      "threshold": "Ambang"
    },
    "heading": "Instruksi agen",
    "desc": "Satu berkas instruksi di akar repositori menjadi standar de facto, tetapi lebih panjang bukan berarti lebih baik — melewati sekitar 150 baris, hasilnya turun tajam sementara biaya inferensi terus naik.",
    "note": "Instruksi pendek dengan tautan ke rinciannya: itulah bentuk yang benar. Menempelkan dokumen utuh justru menciptakan pembusukan konteks.",
    "noteLong": "Aturan ini cukup panjang untuk menagih biaya di tiap giliran, sementara bagian belakangnya paling dulu mengencer. Pindahkan rinciannya ke luar lalu tautkan."
  },
  "it": {
    "level": {
      "none": "Nessuna regola permanente",
      "long": "Lungo",
      "short": "Ben dimensionato"
    },
    "check": {
      "chars": "Caratteri regole",
      "threshold": "Soglia"
    },
    "heading": "Istruzioni dell’agente",
    "desc": "Un unico file di istruzioni nella radice del repository è diventato lo standard di fatto, ma più lungo non è meglio — oltre circa 150 righe il rendimento cala nettamente mentre il costo di inferenza continua a salire.",
    "note": "Istruzioni brevi con collegamenti al dettaglio: questa è la forma giusta. Incollare interi documenti fabbrica degrado del contesto.",
    "noteLong": "Queste regole sono abbastanza lunghe da costare a ogni turno, mentre le parti finali si diluiscono per prime. Sposta il dettaglio fuori e collegalo."
  },
  "pt-BR": {
    "level": {
      "none": "Sem regras permanentes",
      "long": "Longo",
      "short": "Bem dimensionado"
    },
    "check": {
      "chars": "Caracteres das regras",
      "threshold": "Limiar"
    },
    "heading": "Instruções do agente",
    "desc": "Um único arquivo de instruções na raiz do repositório virou padrão de fato, mas mais longo não é melhor — passadas cerca de 150 linhas o retorno cai forte enquanto o custo de inferência continua subindo.",
    "note": "Instruções curtas com links para o detalhe: essa é a forma certa. Colar documentos inteiros fabrica deterioração de contexto.",
    "noteLong": "Estas regras são longas o bastante para custar em cada turno, enquanto as partes finais se diluem primeiro. Tire o detalhe para fora e ligue por link."
  }
} as const;
