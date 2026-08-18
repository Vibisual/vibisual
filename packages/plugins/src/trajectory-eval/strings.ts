/**
 * trajectory-eval — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.trajectoryEval` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Scores how the answer was reached rather than the answer itself. The same result after 3 tool calls and after 40 are entirely different systems, and outcome-only evaluation cannot see that difference.",
    "heading": "Trajectory Eval",
    "level": {
      "none": "Nothing to score",
      "short": "Direct path",
      "long": "Long path"
    },
    "check": {
      "turns": "Turns",
      "sessions": "Sessions",
      "density": "Turns per session",
      "edges": "Task edges"
    },
    "note": "Looking at the order of tool calls catches wasteful or risky patterns before they reach production."
  },
  "ko": {
    "desc": "최종 답이 아니라 어떻게 도달했는지를 채점합니다. 도구를 3번 부른 경우와 40번 부른 경우는 전혀 다른 시스템인데, 결과만 보는 평가는 그 차이를 못 봅니다.",
    "heading": "궤적 평가",
    "level": {
      "none": "채점할 것 없음",
      "short": "곧게 감",
      "long": "길게 돌아감"
    },
    "check": {
      "turns": "턴 수",
      "sessions": "세션 수",
      "density": "세션당 턴",
      "edges": "Task Edge"
    },
    "note": "도구 호출 순서를 보면 낭비적이거나 위험한 행동 패턴을 실제 사고 전에 잡을 수 있습니다."
  },
  "ja": {
    "check": {
      "turns": "ターン数",
      "sessions": "セッション数",
      "density": "セッション当たりターン",
      "edges": "タスクエッジ"
    },
    "heading": "軌跡評価",
    "level": {
      "short": "まっすぐな経路",
      "long": "長い経路",
      "none": "採点対象なし"
    },
    "desc": "最終的な答えではなく、どうやってそこに至ったかを採点します。ツールを 3 回呼んだ場合と 40 回呼んだ場合はまったく別のシステムで、結果だけ見る評価はその差を見られません。",
    "note": "ツール呼び出しの順序を見れば、むだな行動や危険な行動の型を実際の事故の前に捕まえられます。"
  },
  "zh-CN": {
    "check": {
      "turns": "轮次",
      "sessions": "会话数",
      "density": "每会话轮次",
      "edges": "任务连线"
    },
    "heading": "轨迹评估",
    "level": {
      "short": "路径直接",
      "long": "路径较长",
      "none": "无可评分内容"
    },
    "desc": "评分的是「怎么到达答案」而不是答案本身。调用工具 3 次和 40 次得到相同结果，是完全不同的系统，只看结果的评估看不到这个差别。",
    "note": "观察工具调用的顺序，能在真正出事之前抓住浪费或危险的行为模式。"
  },
  "es": {
    "check": {
      "turns": "Turnos",
      "sessions": "Sesiones",
      "density": "Turnos por sesión",
      "edges": "Conexiones de tarea"
    },
    "heading": "Evaluación de trayectoria",
    "level": {
      "short": "Camino directo",
      "long": "Camino largo",
      "none": "Nada que puntuar"
    },
    "desc": "Puntúa cómo se llegó a la respuesta, no la respuesta misma. El mismo resultado tras 3 y tras 40 llamadas a herramientas son sistemas distintos, y una evaluación solo del resultado no ve esa diferencia.",
    "note": "Mirar el orden de las llamadas atrapa patrones derrochadores o arriesgados antes de que lleguen a producción."
  },
  "es-419": {
    "check": {
      "turns": "Turnos",
      "sessions": "Sesiones",
      "density": "Turnos por sesión",
      "edges": "Conexiones de tarea"
    },
    "heading": "Evaluación de trayectoria",
    "level": {
      "short": "Camino directo",
      "long": "Camino largo",
      "none": "Nada que puntuar"
    },
    "desc": "Puntúa cómo se llegó a la respuesta, no la respuesta misma. El mismo resultado tras 3 y tras 40 llamadas a herramientas son sistemas distintos, y una evaluación solo del resultado no ve esa diferencia.",
    "note": "Mirar el orden de las llamadas atrapa patrones derrochadores o arriesgados antes de que lleguen a producción."
  },
  "fr": {
    "check": {
      "turns": "Tours",
      "sessions": "Sessions",
      "density": "Tours par session",
      "edges": "Liens de tâche"
    },
    "heading": "Évaluation de trajectoire",
    "level": {
      "short": "Trajet direct",
      "long": "Trajet long",
      "none": "Rien à noter"
    },
    "desc": "Note la manière dont la réponse a été atteinte, pas la réponse elle-même. Le même résultat après 3 et après 40 appels d’outils sont deux systèmes différents, et une évaluation du seul résultat ne voit pas cet écart.",
    "note": "Observer l’ordre des appels d’outils attrape les schémas coûteux ou risqués avant qu’ils n’atteignent la production."
  },
  "de": {
    "check": {
      "turns": "Züge",
      "sessions": "Sitzungen",
      "density": "Züge pro Sitzung",
      "edges": "Task-Kanten"
    },
    "heading": "Trajektorien-Bewertung",
    "level": {
      "short": "Direkter Weg",
      "long": "Langer Weg",
      "none": "Nichts zu bewerten"
    },
    "desc": "Bewertet, wie die Antwort zustande kam, nicht die Antwort selbst. Dasselbe Ergebnis nach 3 und nach 40 Werkzeugaufrufen sind völlig verschiedene Systeme, und eine reine Ergebnisbewertung sieht diesen Unterschied nicht.",
    "note": "Die Reihenfolge der Werkzeugaufrufe zeigt verschwenderische oder riskante Muster, bevor sie in den Produktivbetrieb gelangen."
  },
  "hi": {
    "check": {
      "turns": "टर्न",
      "sessions": "सत्र",
      "density": "प्रति सत्र टर्न",
      "edges": "टास्क एज"
    },
    "heading": "प्रक्षेप मूल्यांकन",
    "level": {
      "short": "सीधा पथ",
      "long": "लंबा पथ",
      "none": "अंक देने को कुछ नहीं"
    },
    "desc": "उत्तर नहीं, उस तक पहुँचने का रास्ता आँकता है। 3 टूल-कॉल के बाद और 40 के बाद वही नतीजा दो अलग तंत्र हैं, और सिर्फ़ नतीजे का मूल्यांकन यह फ़र्क़ नहीं देखता।",
    "note": "टूल-कॉल का क्रम देखना फ़िज़ूलख़र्च या जोखिम भरे पैटर्न उत्पादन तक पहुँचने से पहले पकड़ लेता है।"
  },
  "id": {
    "check": {
      "turns": "Giliran",
      "sessions": "Sesi",
      "density": "Giliran per sesi",
      "edges": "Task edge"
    },
    "heading": "Evaluasi lintasan",
    "level": {
      "short": "Jalur langsung",
      "long": "Jalur panjang",
      "none": "Tak ada yang dinilai"
    },
    "desc": "Menilai bagaimana jawabannya dicapai, bukan jawabannya sendiri. Hasil yang sama setelah 3 dan setelah 40 pemanggilan alat adalah dua sistem berbeda, dan penilaian hanya atas hasil tidak melihat perbedaan itu.",
    "note": "Melihat urutan pemanggilan alat menangkap pola boros atau berisiko sebelum sampai ke produksi."
  },
  "it": {
    "check": {
      "turns": "Turni",
      "sessions": "Sessioni",
      "density": "Turni per sessione",
      "edges": "Collegamenti attività"
    },
    "heading": "Valutazione della traiettoria",
    "level": {
      "short": "Percorso diretto",
      "long": "Percorso lungo",
      "none": "Nulla da valutare"
    },
    "desc": "Valuta come si è arrivati alla risposta, non la risposta in sé. Lo stesso esito dopo 3 e dopo 40 chiamate a strumenti sono sistemi diversi, e una valutazione del solo esito non vede quella differenza.",
    "note": "Guardare l’ordine delle chiamate coglie schemi sprecati o rischiosi prima che arrivino in produzione."
  },
  "pt-BR": {
    "check": {
      "turns": "Turnos",
      "sessions": "Sessões",
      "density": "Turnos por sessão",
      "edges": "Conexões de tarefa"
    },
    "heading": "Avaliação de trajetória",
    "level": {
      "short": "Caminho direto",
      "long": "Caminho longo",
      "none": "Nada a pontuar"
    },
    "desc": "Pontua como se chegou à resposta, não a resposta em si. O mesmo resultado após 3 e após 40 chamadas de ferramenta são sistemas diferentes, e uma avaliação só do resultado não enxerga essa diferença.",
    "note": "Olhar a ordem das chamadas pega padrões desperdiçadores ou arriscados antes que cheguem à produção."
  }
} as const;
