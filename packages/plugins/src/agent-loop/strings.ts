/**
 * agent-loop — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agentLoop` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows the rhythm of the loop and whether it has a stopping condition. A loop that cannot stop itself makes turn caps and kill switches safety devices rather than conveniences.",
    "heading": "Agent Loop",
    "level": {
      "idle": "Not running",
      "capped": "Capped",
      "uncapped": "No turn cap"
    },
    "check": {
      "turns": "Turns",
      "avg": "Average gap",
      "cap": "Turn cap"
    },
    "none": "none",
    "note": "Measuring cost and time per loop iteration is where operating an agent starts.",
    "noteUncapped": "No turn cap is set. Without one, the only thing that stops a loop is you noticing it."
  },
  "ko": {
    "desc": "루프의 리듬과 종료 조건이 있는지 보여줍니다. 스스로 멈추지 못하는 루프에서는 턴 상한과 긴급 정지가 편의 기능이 아니라 안전장치가 됩니다.",
    "heading": "에이전트 루프",
    "level": {
      "idle": "도는 중 아님",
      "capped": "상한 있음",
      "uncapped": "턴 상한 없음"
    },
    "check": {
      "turns": "턴 수",
      "avg": "평균 간격",
      "cap": "턴 상한"
    },
    "none": "없음",
    "note": "루프 한 회차의 비용과 시간을 계측하는 것이 에이전트 운영의 출발점입니다.",
    "noteUncapped": "턴 상한이 없습니다. 상한이 없으면 루프를 멈추는 것은 사용자가 알아채는 순간뿐입니다."
  },
  "ja": {
    "check": {
      "turns": "ターン数",
      "cap": "ターン上限",
      "avg": "平均間隔"
    },
    "none": "なし",
    "heading": "エージェントループ",
    "level": {
      "capped": "上限あり",
      "idle": "稼働していない",
      "uncapped": "ターン上限なし"
    },
    "desc": "ループのリズムと停止条件の有無を示します。自分で止まれないループでは、ターン上限と緊急停止が便利機能ではなく安全装置になります。",
    "note": "ループ一周の費用と時間を計測することが、エージェント運用の出発点です。",
    "noteUncapped": "ターン上限がありません。上限がなければ、ループを止めるのは利用者が気づいた瞬間だけです。"
  },
  "zh-CN": {
    "check": {
      "turns": "轮次",
      "cap": "轮次上限",
      "avg": "平均间隔"
    },
    "none": "无",
    "heading": "智能体循环",
    "level": {
      "capped": "有上限",
      "idle": "未运行",
      "uncapped": "无轮次上限"
    },
    "desc": "显示循环的节奏以及是否有终止条件。无法自行停止的循环，会让轮次上限和紧急停止从便利功能变成安全装置。",
    "note": "计量循环一轮的成本与时间，是运营智能体的起点。",
    "noteUncapped": "没有设置轮次上限。没有上限时，能停下循环的只有你自己察觉的那一刻。"
  },
  "es": {
    "check": {
      "turns": "Turnos",
      "cap": "Límite de turnos",
      "avg": "Intervalo medio"
    },
    "none": "ninguno",
    "heading": "Bucle del agente",
    "level": {
      "capped": "Con tope",
      "idle": "Sin ejecutar",
      "uncapped": "Sin límite de turnos"
    },
    "desc": "Muestra el ritmo del bucle y si tiene condición de parada. Un bucle incapaz de detenerse convierte el tope de turnos y la parada de emergencia en dispositivos de seguridad, no en comodidades.",
    "note": "Medir coste y tiempo por vuelta de bucle es el punto de partida de operar un agente.",
    "noteUncapped": "No hay tope de turnos. Sin él, lo único que detiene el bucle es que tú lo notes."
  },
  "es-419": {
    "check": {
      "turns": "Turnos",
      "cap": "Límite de turnos",
      "avg": "Intervalo medio"
    },
    "none": "ninguno",
    "heading": "Bucle del agente",
    "level": {
      "capped": "Con tope",
      "idle": "Sin ejecutar",
      "uncapped": "Sin límite de turnos"
    },
    "desc": "Muestra el ritmo del bucle y si tiene condición de parada. Un bucle incapaz de detenerse convierte el tope de turnos y la parada de emergencia en dispositivos de seguridad, no en comodidades.",
    "note": "Medir coste y tiempo por vuelta de bucle es el punto de partida de operar un agente.",
    "noteUncapped": "No hay tope de turnos. Sin él, lo único que detiene el bucle es que tú lo notes."
  },
  "fr": {
    "check": {
      "turns": "Tours",
      "cap": "Plafond de tours",
      "avg": "Écart moyen"
    },
    "none": "aucun",
    "heading": "Boucle d’agent",
    "level": {
      "capped": "Plafonné",
      "idle": "Pas en cours",
      "uncapped": "Sans plafond de tours"
    },
    "desc": "Montre le rythme de la boucle et si elle possède une condition d’arrêt. Une boucle incapable de s’arrêter elle-même transforme plafond de tours et arrêt d’urgence en dispositifs de sécurité, non en commodités.",
    "note": "Mesurer le coût et le temps d’un tour de boucle est le point de départ de l’exploitation d’un agent.",
    "noteUncapped": "Aucun plafond de tours n’est défini. Sans plafond, la seule chose qui arrête la boucle, c’est que vous le remarquiez."
  },
  "de": {
    "check": {
      "turns": "Züge",
      "cap": "Zugbegrenzung",
      "avg": "Mittlerer Abstand"
    },
    "none": "keine",
    "heading": "Agentenschleife",
    "level": {
      "capped": "Begrenzt",
      "idle": "Läuft nicht",
      "uncapped": "Keine Zugbegrenzung"
    },
    "desc": "Zeigt den Rhythmus der Schleife und ob sie eine Abbruchbedingung hat. Eine Schleife, die sich nicht selbst stoppen kann, macht Zugbegrenzung und Not-Aus zu Sicherheitseinrichtungen statt zu Komfort.",
    "note": "Kosten und Zeit einer Schleifenrunde zu messen ist der Ausgangspunkt des Agentenbetriebs.",
    "noteUncapped": "Es ist keine Zugbegrenzung gesetzt. Ohne sie stoppt die Schleife nur, wenn Sie es bemerken."
  },
  "hi": {
    "check": {
      "turns": "टर्न",
      "cap": "टर्न सीमा",
      "avg": "औसत अंतराल"
    },
    "none": "कोई नहीं",
    "heading": "एजेंट लूप",
    "level": {
      "capped": "सीमित",
      "idle": "चल नहीं रहा",
      "uncapped": "कोई टर्न सीमा नहीं"
    },
    "desc": "लूप की लय दिखाता है और यह कि उसकी कोई रुकने की शर्त है या नहीं। जो लूप ख़ुद को नहीं रोक सकता, उसमें बारी-सीमा और आपात-रोक सुविधा नहीं, सुरक्षा-उपकरण बन जाते हैं।",
    "note": "एक लूप-चक्कर की लागत और समय नापना एजेंट चलाने का शुरुआती बिंदु है।",
    "noteUncapped": "कोई बारी-सीमा तय नहीं है। उसके बिना लूप को रोकने वाली एकमात्र चीज़ आपका ध्यान देना है।"
  },
  "id": {
    "check": {
      "turns": "Giliran",
      "cap": "Batas giliran",
      "avg": "Jeda rata-rata"
    },
    "none": "tidak ada",
    "heading": "Loop agen",
    "level": {
      "capped": "Ada batas",
      "idle": "Tidak berjalan",
      "uncapped": "Tanpa batas giliran"
    },
    "desc": "Menunjukkan irama loop dan apakah ia punya kondisi berhenti. Loop yang tak bisa menghentikan diri sendiri mengubah batas giliran dan tombol henti darurat menjadi perangkat keselamatan, bukan kenyamanan.",
    "note": "Mengukur biaya dan waktu satu putaran loop adalah titik awal mengoperasikan agen.",
    "noteUncapped": "Tidak ada batas giliran yang disetel. Tanpa itu, satu-satunya yang menghentikan loop adalah Anda menyadarinya."
  },
  "it": {
    "check": {
      "turns": "Turni",
      "cap": "Limite di turni",
      "avg": "Intervallo medio"
    },
    "none": "nessuno",
    "heading": "Ciclo dell’agente",
    "level": {
      "capped": "Limitato",
      "idle": "Non in esecuzione",
      "uncapped": "Nessun limite di turni"
    },
    "desc": "Mostra il ritmo del ciclo e se ha una condizione di arresto. Un ciclo che non sa fermarsi da solo trasforma tetto di turni e arresto di emergenza in dispositivi di sicurezza, non in comodità.",
    "note": "Misurare costo e tempo di un giro di ciclo è il punto di partenza per far funzionare un agente.",
    "noteUncapped": "Non è impostato alcun tetto di turni. Senza, l’unica cosa che ferma il ciclo è che tu te ne accorga."
  },
  "pt-BR": {
    "check": {
      "turns": "Turnos",
      "cap": "Limite de turnos",
      "avg": "Intervalo médio"
    },
    "none": "nenhum",
    "heading": "Laço do agente",
    "level": {
      "capped": "Com teto",
      "idle": "Não está rodando",
      "uncapped": "Sem limite de turnos"
    },
    "desc": "Mostra o ritmo do laço e se ele tem condição de parada. Um laço incapaz de se deter transforma teto de turnos e parada de emergência em dispositivos de segurança, não em conveniências.",
    "note": "Medir custo e tempo por volta do laço é o ponto de partida para operar um agente.",
    "noteUncapped": "Não há teto de turnos definido. Sem ele, a única coisa que para o laço é você perceber."
  }
} as const;
