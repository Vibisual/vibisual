/**
 * rescue-engineering — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.rescueEngineering` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Cleaning up quickly built code became a market of its own. The cost of speed did not vanish; it was deferred and comes back with interest.",
    "heading": "Rescue Engineering",
    "level": {
      "fresh": "Nothing yet",
      "prepaid": "Paid in advance",
      "accruing": "Debt accruing"
    },
    "check": {
      "turns": "Turns",
      "prepaid": "Prepaid safeguards"
    },
    "note": "Rule documents, evaluation sets, loss prevention and commit gates are all spending done up front — a fraction of what the rescue costs later."
  },
  "ko": {
    "desc": "급히 만든 코드를 수습하는 일이 하나의 시장이 됐습니다. 빨리 만든 비용이 사라진 게 아니라 이연됐을 뿐이고, 이자가 붙어 돌아옵니다.",
    "heading": "구조 엔지니어링",
    "level": {
      "fresh": "아직 없음",
      "prepaid": "사전 지출됨",
      "accruing": "부채가 쌓이는 중"
    },
    "check": {
      "turns": "턴 수",
      "prepaid": "사전 지출 장치"
    },
    "note": "규칙 문서·평가 셋·손실 방지·커밋 관문은 전부 사전 지출이며, 사후 구조 비용의 몇 십 분의 일입니다."
  },
  "ja": {
    "check": {
      "turns": "ターン数",
      "prepaid": "先払いの備え"
    },
    "heading": "立て直しエンジニアリング",
    "level": {
      "accruing": "負債が積もる",
      "fresh": "まだ何もない",
      "prepaid": "先払い済み"
    },
    "desc": "急いで作ったコードを後から片付ける仕事が一つの市場になりました。速く作った費用は消えたのではなく先送りされただけで、利息を付けて戻ってきます。",
    "note": "ルール文書・評価セット・損失防止・コミット関門はすべて前払いであり、後から立て直す費用の何十分の一です。"
  },
  "zh-CN": {
    "check": {
      "turns": "轮次",
      "prepaid": "预先投入的防护"
    },
    "heading": "救援式工程",
    "level": {
      "accruing": "债务累积中",
      "fresh": "尚无内容",
      "prepaid": "已预先投入"
    },
    "desc": "收拾仓促写成的代码，已经成了一个独立的市场。求快的成本并没有消失，只是被推迟，并带着利息回来。",
    "note": "规则文档、评估集、防丢失措施、提交关口全都是预付，只是日后救火成本的几十分之一。"
  },
  "es": {
    "check": {
      "turns": "Turnos",
      "prepaid": "Salvaguardas anticipadas"
    },
    "heading": "Ingeniería de rescate",
    "level": {
      "accruing": "Deuda acumulándose",
      "fresh": "Nada aún",
      "prepaid": "Pagado por adelantado"
    },
    "desc": "Arreglar código hecho deprisa se convirtió en un mercado propio. El coste de la velocidad no desapareció; se aplazó y vuelve con intereses.",
    "note": "Documentos de reglas, conjuntos de evaluación, prevención de pérdidas y barreras de commit son todo gasto anticipado — una fracción de lo que cuesta el rescate después."
  },
  "es-419": {
    "check": {
      "turns": "Turnos",
      "prepaid": "Salvaguardas anticipadas"
    },
    "heading": "Ingeniería de rescate",
    "level": {
      "accruing": "Deuda acumulándose",
      "fresh": "Nada aún",
      "prepaid": "Pagado por adelantado"
    },
    "desc": "Arreglar código hecho deprisa se convirtió en un mercado propio. El coste de la velocidad no desapareció; se aplazó y vuelve con intereses.",
    "note": "Documentos de reglas, conjuntos de evaluación, prevención de pérdidas y barreras de commit son todo gasto anticipado — una fracción de lo que cuesta el rescate después."
  },
  "fr": {
    "check": {
      "turns": "Tours",
      "prepaid": "Garde-fous anticipés"
    },
    "heading": "Ingénierie de sauvetage",
    "level": {
      "accruing": "Dette en accumulation",
      "fresh": "Rien pour l’instant",
      "prepaid": "Payé d’avance"
    },
    "desc": "Remettre en état du code bâti à la hâte est devenu un marché en soi. Le coût de la vitesse n’a pas disparu ; il a été différé et revient avec des intérêts.",
    "note": "Documents de règles, jeux d’évaluation, prévention des pertes et barrières de commit sont autant de dépenses en amont — une fraction de ce que coûte le sauvetage plus tard."
  },
  "de": {
    "check": {
      "turns": "Züge",
      "prepaid": "Vorab-Absicherungen"
    },
    "heading": "Sanierungs-Engineering",
    "level": {
      "accruing": "Schulden wachsen",
      "fresh": "Noch nichts",
      "prepaid": "Vorab bezahlt"
    },
    "desc": "Schnell gebauten Code aufzuräumen wurde zu einem eigenen Markt. Die Kosten der Geschwindigkeit sind nicht verschwunden; sie wurden aufgeschoben und kommen mit Zinsen zurück.",
    "note": "Regeldokumente, Bewertungssets, Verlustschutz und Commit-Gates sind alles Vorabausgaben — ein Bruchteil dessen, was die Sanierung später kostet."
  },
  "hi": {
    "check": {
      "turns": "टर्न",
      "prepaid": "पूर्व-भुगतान सुरक्षा"
    },
    "heading": "बचाव इंजीनियरिंग",
    "level": {
      "accruing": "ऋण बढ़ रहा",
      "fresh": "अभी कुछ नहीं",
      "prepaid": "पहले चुकाया"
    },
    "desc": "जल्दबाज़ी में बने कोड को सँभालना अपने-आप में एक बाज़ार बन गया है। गति की क़ीमत मिटती नहीं; वह टलती है और ब्याज़ सहित लौटती है।",
    "note": "नियम-दस्तावेज़, मूल्यांकन-संग्रह, हानि-रोकथाम और commit-द्वार — ये सब पहले किया गया ख़र्च हैं, आगे के बचाव-कार्य की लागत का एक अंश।"
  },
  "id": {
    "check": {
      "turns": "Giliran",
      "prepaid": "Pengaman dibayar di muka"
    },
    "heading": "Rekayasa penyelamatan",
    "level": {
      "accruing": "Utang menumpuk",
      "fresh": "Belum ada",
      "prepaid": "Dibayar di muka"
    },
    "desc": "Membereskan kode yang dibuat terburu-buru menjadi pasar tersendiri. Ongkos kecepatan tidak lenyap; ia ditunda dan kembali dengan bunga.",
    "note": "Dokumen aturan, kumpulan evaluasi, pencegahan kehilangan, dan gerbang commit semuanya adalah belanja di muka — sepersekian dari ongkos penyelamatan nanti."
  },
  "it": {
    "check": {
      "turns": "Turni",
      "prepaid": "Salvaguardie anticipate"
    },
    "heading": "Ingegneria di recupero",
    "level": {
      "accruing": "Debito in accumulo",
      "fresh": "Ancora nulla",
      "prepaid": "Pagato in anticipo"
    },
    "desc": "Rimettere in ordine codice fatto in fretta è diventato un mercato a sé. Il costo della velocità non è sparito; è stato rinviato e torna con gli interessi.",
    "note": "Documenti di regole, insiemi di valutazione, prevenzione delle perdite e varchi di commit sono tutte spese anticipate — una frazione di quanto costa il recupero dopo."
  },
  "pt-BR": {
    "check": {
      "turns": "Turnos",
      "prepaid": "Salvaguardas antecipadas"
    },
    "heading": "Engenharia de resgate",
    "level": {
      "accruing": "Dívida acumulando",
      "fresh": "Nada ainda",
      "prepaid": "Pago antecipadamente"
    },
    "desc": "Arrumar código feito às pressas virou um mercado próprio. O custo da velocidade não sumiu; foi adiado e volta com juros.",
    "note": "Documentos de regras, conjuntos de avaliação, prevenção de perdas e portões de commit são todos gasto adiantado — uma fração do que o resgate custa depois."
  }
} as const;
