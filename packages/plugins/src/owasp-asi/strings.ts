/**
 * owasp-asi — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.owaspAsi` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Re-groups the earlier judgements along the agent-specific risk axes. What stands out is that more than half of those risks live in the harness rather than in the model — which is why this can be self-checked.",
    "heading": "OWASP ASI Top 10",
    "level": {
      "clear": "Nothing flagged",
      "some": "Some flags",
      "many": "Several flags"
    },
    "check": {
      "flags": "Flags raised",
      "trifecta": "Leak path",
      "radius": "Blast radius"
    },
    "note": "Goal hijack, tool misuse, identity, memory poisoning and rogue agents are the items that come up most often in practice."
  },
  "ko": {
    "desc": "앞선 판정들을 에이전트 전용 위험 축으로 다시 묶습니다. 눈여겨볼 점은 그 위험의 절반 이상이 모델이 아니라 하네스에 있다는 것 — 그래서 우리 설정만으로 자가 점검이 됩니다.",
    "heading": "OWASP ASI Top 10",
    "level": {
      "clear": "표시된 것 없음",
      "some": "일부 표시됨",
      "many": "여러 개 표시됨"
    },
    "check": {
      "flags": "표시된 항목",
      "trifecta": "유출 경로",
      "radius": "폭발 반경"
    },
    "note": "목표 탈취 · 도구 오남용 · 신원 · 기억 오염 · 통제 이탈이 실무에서 가장 자주 부딪히는 항목입니다."
  },
  "ja": {
    "level": {
      "clear": "指摘なし",
      "some": "該当が一部",
      "many": "該当が複数"
    },
    "check": {
      "trifecta": "漏洩経路",
      "radius": "爆発半径",
      "flags": "該当した項目"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "先の判定をエージェント特有のリスク軸で束ね直します。目を引くのは、それらのリスクの半分以上がモデルではなくハーネス側にあることで、だからこそ自前で点検できます。",
    "note": "目標の乗っ取り・ツールの誤用・識別子・記憶の汚染・通制を離れたエージェントが、実務で最もよく当たる項目です。"
  },
  "zh-CN": {
    "level": {
      "clear": "无标记",
      "some": "部分触发",
      "many": "多项触发"
    },
    "check": {
      "trifecta": "泄露路径",
      "radius": "爆炸半径",
      "flags": "触发的项"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "把前面的判定按智能体特有的风险轴重新归类。值得注意的是，其中超过一半的风险出在框架而不是模型上 — 正因如此才能自查。",
    "note": "目标劫持、工具滥用、身份、记忆投毒、失控智能体，是实务中最常遇到的几项。"
  },
  "es": {
    "level": {
      "clear": "Nada marcado",
      "some": "Algunas señales",
      "many": "Varias señales"
    },
    "check": {
      "trifecta": "Ruta de fuga",
      "radius": "Radio de explosión",
      "flags": "Señales activadas"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "Reagrupa los juicios anteriores según los ejes de riesgo propios de los agentes. Lo llamativo es que más de la mitad de esos riesgos viven en el arnés y no en el modelo — por eso esto se puede autocomprobar.",
    "note": "Secuestro de objetivo, uso indebido de herramientas, identidad, envenenamiento de memoria y agentes fuera de control son los puntos más frecuentes en la práctica."
  },
  "es-419": {
    "level": {
      "clear": "Nada marcado",
      "some": "Algunas señales",
      "many": "Varias señales"
    },
    "check": {
      "trifecta": "Ruta de fuga",
      "radius": "Radio de explosión",
      "flags": "Señales activadas"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "Reagrupa los juicios anteriores según los ejes de riesgo propios de los agentes. Lo llamativo es que más de la mitad de esos riesgos viven en el arnés y no en el modelo — por eso esto se puede autocomprobar.",
    "note": "Secuestro de objetivo, uso indebido de herramientas, identidad, envenenamiento de memoria y agentes fuera de control son los puntos más frecuentes en la práctica."
  },
  "fr": {
    "level": {
      "clear": "Rien de signalé",
      "some": "Quelques signaux",
      "many": "Plusieurs signaux"
    },
    "check": {
      "trifecta": "Chemin de fuite",
      "radius": "Rayon d’explosion",
      "flags": "Signaux levés"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "Regroupe les jugements précédents selon les axes de risque propres aux agents. Ce qui frappe, c’est que plus de la moitié de ces risques se situent dans le harnais et non dans le modèle — d’où la possibilité de s’auto-évaluer.",
    "note": "Détournement d’objectif, mésusage des outils, identité, empoisonnement de mémoire et agents hors contrôle sont les points les plus fréquents en pratique."
  },
  "de": {
    "level": {
      "clear": "Nichts markiert",
      "some": "Einige Hinweise",
      "many": "Mehrere Hinweise"
    },
    "check": {
      "trifecta": "Abflusspfad",
      "radius": "Explosionsradius",
      "flags": "Ausgelöste Hinweise"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "Gruppiert die früheren Beurteilungen entlang agentenspezifischer Risikoachsen neu. Auffällig ist, dass mehr als die Hälfte dieser Risiken in der Harness und nicht im Modell liegt — deshalb lässt sich das selbst prüfen.",
    "note": "Zielentführung, Werkzeugmissbrauch, Identität, Gedächtnisvergiftung und außer Kontrolle geratene Agenten sind die Punkte, die in der Praxis am häufigsten auftreten."
  },
  "hi": {
    "level": {
      "clear": "कुछ चिह्नित नहीं",
      "some": "कुछ संकेत",
      "many": "कई संकेत"
    },
    "check": {
      "trifecta": "रिसाव पथ",
      "radius": "ब्लास्ट रेडियस",
      "flags": "उठे संकेत"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "पिछले आकलनों को एजेंट-विशिष्ट जोखिम-अक्षों पर फिर से जमाता है। ख़ास बात यह कि आधे से ज़्यादा जोखिम मॉडल में नहीं, harness में बसते हैं — इसीलिए इसे ख़ुद जाँचा जा सकता है।",
    "note": "लक्ष्य का अपहरण, टूल का दुरुपयोग, पहचान, स्मृति का विषाक्तीकरण और बेकाबू एजेंट — व्यवहार में यही मदें सबसे अधिक सामने आती हैं।"
  },
  "id": {
    "level": {
      "clear": "Tidak ada tanda",
      "some": "Beberapa tanda",
      "many": "Beberapa tanda"
    },
    "check": {
      "trifecta": "Jalur kebocoran",
      "radius": "Radius ledak",
      "flags": "Tanda muncul"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "Mengelompokkan ulang penilaian sebelumnya menurut sumbu risiko khas agen. Yang menonjol, lebih dari separuh risiko itu tinggal di harness dan bukan di model — karena itulah hal ini bisa diperiksa sendiri.",
    "note": "Pembajakan tujuan, penyalahgunaan alat, identitas, peracunan memori, dan agen lepas kendali adalah butir yang paling sering muncul dalam praktik."
  },
  "it": {
    "level": {
      "clear": "Nulla segnalato",
      "some": "Alcuni segnali",
      "many": "Diversi segnali"
    },
    "check": {
      "trifecta": "Percorso di fuga",
      "radius": "Raggio d’esplosione",
      "flags": "Segnali attivati"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "Raggruppa di nuovo i giudizi precedenti lungo gli assi di rischio propri degli agenti. Colpisce che più della metà di quei rischi stia nell’harness e non nel modello — per questo ci si può autovalutare.",
    "note": "Dirottamento dell’obiettivo, uso improprio degli strumenti, identità, avvelenamento della memoria e agenti fuori controllo sono le voci più frequenti nella pratica."
  },
  "pt-BR": {
    "level": {
      "clear": "Nada sinalizado",
      "some": "Alguns sinais",
      "many": "Vários sinais"
    },
    "check": {
      "trifecta": "Caminho de vazamento",
      "radius": "Raio de explosão",
      "flags": "Sinais levantados"
    },
    "heading": "OWASP ASI Top 10",
    "desc": "Reagrupa os julgamentos anteriores pelos eixos de risco próprios de agentes. Chama atenção que mais da metade desses riscos mora no arreio e não no modelo — por isso dá para autoavaliar.",
    "note": "Sequestro de objetivo, uso indevido de ferramentas, identidade, envenenamento de memória e agentes fora de controle são os itens mais frequentes na prática."
  }
} as const;
