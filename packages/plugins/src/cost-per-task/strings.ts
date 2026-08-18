/**
 * cost-per-task — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.costPerTask` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Looks at cost per completed task rather than per token, and shows tokens per turn — background work that produces little can quietly take most of the bill.",
    "heading": "Cost per Task",
    "level": {
      "idle": "Nothing spent yet",
      "light": "Light",
      "moderate": "Moderate",
      "heavy": "Heavy"
    },
    "check": {
      "tokens": "Input / output",
      "turns": "Turns",
      "perTurn": "Tokens per turn",
      "usd": "Estimated cost"
    },
    "note": "The estimate counts input and output only; cache tokens are not accumulated per session, so the real figure is somewhat higher."
  },
  "ko": {
    "desc": "토큰 단가가 아니라 **완수한 작업 단위**로 비용을 봅니다. 턴당 토큰을 함께 보여주는데, 산출이 거의 없는 배경 작업이 비용의 대부분을 조용히 먹는 경우가 실제로 흔하기 때문입니다.",
    "heading": "작업당 비용",
    "level": {
      "idle": "아직 쓴 것 없음",
      "light": "가벼움",
      "moderate": "보통",
      "heavy": "무거움"
    },
    "check": {
      "tokens": "입력 / 출력",
      "turns": "턴 수",
      "perTurn": "턴당 토큰",
      "usd": "추정 비용"
    },
    "note": "추정치는 입력·출력만 셉니다. 캐시 토큰은 세션별 누적값이 없어 빠져 있으므로 실제 비용은 이보다 조금 높습니다."
  },
  "ja": {
    "level": {
      "moderate": "中程度",
      "light": "軽い",
      "heavy": "重い",
      "idle": "まだ消費なし"
    },
    "check": {
      "turns": "ターン数",
      "tokens": "入力 / 出力",
      "perTurn": "ターン当たりトークン",
      "usd": "推定コスト"
    },
    "heading": "作業当たりコスト",
    "desc": "トークン単価ではなく**完了した作業単位**でコストを見ます。ターン当たりトークンも併せて示すのは、成果がほとんどない裏方処理が費用の大半を静かに食う場合が実際に多いからです。",
    "note": "推定は入力と出力だけを数えます。キャッシュトークンはセッション別の累計がないため含まれておらず、実際の費用はこれより少し高くなります。"
  },
  "zh-CN": {
    "level": {
      "moderate": "中等",
      "light": "较轻",
      "heavy": "偏重",
      "idle": "尚未消耗"
    },
    "check": {
      "turns": "轮次",
      "tokens": "输入 / 输出",
      "perTurn": "每轮令牌",
      "usd": "预估成本"
    },
    "heading": "每任务成本",
    "desc": "按**完成的任务**而不是按令牌看成本，并给出每轮令牌数 — 产出很少的后台处理悄悄吃掉大部分花费，这种情况其实很常见。",
    "note": "估算只统计输入与输出。缓存令牌没有按会话累计，因此实际费用会比这个数略高。"
  },
  "es": {
    "level": {
      "moderate": "Moderado",
      "light": "Bajo",
      "heavy": "Alto",
      "idle": "Nada gastado aún"
    },
    "check": {
      "turns": "Turnos",
      "tokens": "Entrada / salida",
      "perTurn": "Tokens por turno",
      "usd": "Coste estimado"
    },
    "heading": "Coste por tarea",
    "desc": "Mira el coste por **tarea completada** en vez de por token, y muestra tokens por turno — el trabajo de fondo que produce poco puede llevarse en silencio la mayor parte de la factura.",
    "note": "La estimación cuenta solo entrada y salida; los tokens de caché no se acumulan por sesión, así que la cifra real es algo más alta."
  },
  "es-419": {
    "level": {
      "moderate": "Moderado",
      "light": "Bajo",
      "heavy": "Alto",
      "idle": "Nada gastado aún"
    },
    "check": {
      "turns": "Turnos",
      "tokens": "Entrada / salida",
      "perTurn": "Tokens por turno",
      "usd": "Coste estimado"
    },
    "heading": "Coste por tarea",
    "desc": "Mira el coste por **tarea completada** en vez de por token, y muestra tokens por turno — el trabajo de fondo que produce poco puede llevarse en silencio la mayor parte de la factura.",
    "note": "La estimación cuenta solo entrada y salida; los tokens de caché no se acumulan por sesión, así que la cifra real es algo más alta."
  },
  "fr": {
    "level": {
      "moderate": "Modéré",
      "light": "Faible",
      "heavy": "Élevé",
      "idle": "Rien de dépensé"
    },
    "check": {
      "turns": "Tours",
      "tokens": "Entrée / sortie",
      "perTurn": "Jetons par tour",
      "usd": "Coût estimé"
    },
    "heading": "Coût par tâche",
    "desc": "Regarde le coût par **tâche accomplie** plutôt que par jeton, et affiche les jetons par tour — un travail de fond au rendement faible peut absorber discrètement l’essentiel de la facture.",
    "note": "L’estimation ne compte que l’entrée et la sortie ; les jetons de cache ne sont pas cumulés par session, le montant réel est donc un peu plus élevé."
  },
  "de": {
    "level": {
      "moderate": "Mittel",
      "light": "Gering",
      "heavy": "Hoch",
      "idle": "Noch nichts verbraucht"
    },
    "check": {
      "turns": "Züge",
      "tokens": "Eingabe / Ausgabe",
      "perTurn": "Tokens pro Zug",
      "usd": "Geschätzte Kosten"
    },
    "heading": "Kosten pro Aufgabe",
    "desc": "Betrachtet Kosten pro **abgeschlossener Aufgabe** statt pro Token und zeigt Tokens pro Zug — Hintergrundarbeit mit wenig Ertrag frisst still den größten Teil der Rechnung, und zwar häufiger als man denkt.",
    "note": "Die Schätzung zählt nur Ein- und Ausgabe; Cache-Tokens werden nicht pro Sitzung summiert, der reale Betrag liegt also etwas höher."
  },
  "hi": {
    "level": {
      "moderate": "मध्यम",
      "light": "हल्का",
      "heavy": "भारी",
      "idle": "अभी कुछ खर्च नहीं"
    },
    "check": {
      "turns": "टर्न",
      "tokens": "इनपुट / आउटपुट",
      "perTurn": "प्रति टर्न टोकन",
      "usd": "अनुमानित लागत"
    },
    "heading": "प्रति कार्य लागत",
    "desc": "लागत को टोकन के बजाय **पूरे हुए काम** के हिसाब से देखता है, और प्रति बारी टोकन दिखाता है — पीछे चलता काम, जिससे नतीजा कम निकलता है, चुपचाप अधिकांश बिल खा सकता है।",
    "note": "अनुमान केवल इनपुट और आउटपुट गिनता है; cache टोकन प्रति सत्र जोड़े नहीं जाते, इसलिए असली आँकड़ा थोड़ा ऊपर है।"
  },
  "id": {
    "level": {
      "moderate": "Sedang",
      "light": "Ringan",
      "heavy": "Berat",
      "idle": "Belum ada yang terpakai"
    },
    "check": {
      "turns": "Giliran",
      "tokens": "Masukan / keluaran",
      "perTurn": "Token per giliran",
      "usd": "Perkiraan biaya"
    },
    "heading": "Biaya per tugas",
    "desc": "Melihat biaya per **tugas yang selesai** alih-alih per token, dan menampilkan token per giliran — pekerjaan latar yang hasilnya sedikit bisa diam-diam menghabiskan sebagian besar tagihan.",
    "note": "Perkiraan hanya menghitung masukan dan keluaran; token cache tidak diakumulasi per sesi, jadi angka sebenarnya sedikit lebih tinggi."
  },
  "it": {
    "level": {
      "moderate": "Moderato",
      "light": "Basso",
      "heavy": "Alto",
      "idle": "Nulla ancora speso"
    },
    "check": {
      "turns": "Turni",
      "tokens": "Input / output",
      "perTurn": "Token per turno",
      "usd": "Costo stimato"
    },
    "heading": "Costo per attività",
    "desc": "Guarda il costo per **attività completata** invece che per token, e mostra i token per turno — il lavoro di fondo che produce poco può prendersi in silenzio gran parte del conto.",
    "note": "La stima conta solo input e output; i token di cache non sono cumulati per sessione, quindi la cifra reale è un po’ più alta."
  },
  "pt-BR": {
    "level": {
      "moderate": "Moderado",
      "light": "Baixo",
      "heavy": "Alto",
      "idle": "Nada gasto ainda"
    },
    "check": {
      "turns": "Turnos",
      "tokens": "Entrada / saída",
      "perTurn": "Tokens por turno",
      "usd": "Custo estimado"
    },
    "heading": "Custo por tarefa",
    "desc": "Olha o custo por **tarefa concluída** em vez de por token, e mostra tokens por turno — trabalho de fundo que produz pouco pode levar em silêncio a maior parte da conta.",
    "note": "A estimativa conta apenas entrada e saída; tokens de cache não são acumulados por sessão, então o valor real é um pouco maior."
  }
} as const;
