/**
 * review-gate — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.reviewGate` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts whether completion was handed over in a reviewable shape. Long prose reports do not get read; a change list plus check points does.",
    "heading": "Review Gate",
    "level": {
      "none": "No review requested",
      "noPoints": "No check points",
      "present": "Reviewable"
    },
    "check": {
      "reviews": "Review requests",
      "checkpoints": "Check points"
    },
    "note": "What makes review cheap is separating “what changed” from “what to verify”."
  },
  "ko": {
    "desc": "완료가 검수 가능한 형태로 넘어왔는지 셉니다. 긴 서술형 보고는 읽히지 않지만, 변경 목록 + 확인 포인트는 읽힙니다.",
    "heading": "검수 관문",
    "level": {
      "none": "검수 요청 없음",
      "noPoints": "확인 포인트 없음",
      "present": "검수 가능"
    },
    "check": {
      "reviews": "검수 요청",
      "checkpoints": "확인 포인트"
    },
    "note": "검수를 싸게 만드는 것은 \"무엇을 바꿨나\"와 \"무엇을 확인하나\"를 갈라 주는 것입니다."
  },
  "ja": {
    "check": {
      "reviews": "検収リクエスト",
      "checkpoints": "確認ポイント"
    },
    "heading": "検収の関門",
    "level": {
      "none": "検収依頼なし",
      "noPoints": "確認ポイントなし",
      "present": "検収できる"
    },
    "desc": "完了が検収できる形で渡されたかを数えます。長い文章の報告は読まれませんが、変更一覧＋確認ポイントは読まれます。",
    "note": "検収を安くするのは「何を変えたか」と「何を確認するか」を分けて出すことです。"
  },
  "zh-CN": {
    "check": {
      "reviews": "检查请求",
      "checkpoints": "检查要点"
    },
    "heading": "检查关口",
    "level": {
      "none": "未请求检查",
      "noPoints": "无检查要点",
      "present": "可供检查"
    },
    "desc": "统计完成是否以可检查的形式交付。长篇叙述的报告没人读，而「变更清单 + 检查要点」会被读。",
    "note": "让检查变便宜的，是把「改了什么」和「要确认什么」分开呈现。"
  },
  "es": {
    "check": {
      "reviews": "Solicitudes de revisión",
      "checkpoints": "Puntos de verificación"
    },
    "heading": "Puerta de revisión",
    "level": {
      "none": "Sin revisión solicitada",
      "noPoints": "Sin puntos de verificación",
      "present": "Revisable"
    },
    "desc": "Cuenta si la finalización se entregó de forma revisable. Los informes largos en prosa no se leen; una lista de cambios más puntos de verificación, sí.",
    "note": "Lo que abarata la revisión es separar «qué cambió» de «qué hay que verificar»."
  },
  "es-419": {
    "check": {
      "reviews": "Solicitudes de revisión",
      "checkpoints": "Puntos de verificación"
    },
    "heading": "Puerta de revisión",
    "level": {
      "none": "Sin revisión solicitada",
      "noPoints": "Sin puntos de verificación",
      "present": "Revisable"
    },
    "desc": "Cuenta si la finalización se entregó de forma revisable. Los informes largos en prosa no se leen; una lista de cambios más puntos de verificación, sí.",
    "note": "Lo que abarata la revisión es separar «qué cambió» de «qué hay que verificar»."
  },
  "fr": {
    "check": {
      "reviews": "Demandes de revue",
      "checkpoints": "Points de contrôle"
    },
    "heading": "Porte de revue",
    "level": {
      "none": "Aucune revue demandée",
      "noPoints": "Aucun point de contrôle",
      "present": "Vérifiable"
    },
    "desc": "Compte si l’achèvement a été transmis sous une forme vérifiable. Les longs rapports en prose ne sont pas lus ; une liste de changements plus des points de contrôle, si.",
    "note": "Ce qui rend la revue peu coûteuse, c’est de séparer « ce qui a changé » de « ce qu’il faut vérifier »."
  },
  "de": {
    "check": {
      "reviews": "Prüfanfragen",
      "checkpoints": "Prüfpunkte"
    },
    "heading": "Prüf-Gate",
    "level": {
      "none": "Keine Prüfung angefragt",
      "noPoints": "Keine Prüfpunkte",
      "present": "Prüfbar"
    },
    "desc": "Zählt, ob der Abschluss in prüfbarer Form übergeben wurde. Lange Fließtextberichte werden nicht gelesen; eine Änderungsliste plus Prüfpunkte schon.",
    "note": "Prüfen wird dadurch billig, dass „was wurde geändert“ und „was ist zu prüfen“ getrennt dargeboten werden."
  },
  "hi": {
    "check": {
      "reviews": "समीक्षा अनुरोध",
      "checkpoints": "जाँच बिंदु"
    },
    "heading": "समीक्षा द्वार",
    "level": {
      "none": "कोई समीक्षा अनुरोध नहीं",
      "noPoints": "कोई जाँच बिंदु नहीं",
      "present": "समीक्षा योग्य"
    },
    "desc": "गिनता है कि पूर्णता ऐसी शक्ल में सौंपी गई या नहीं जिसकी समीक्षा हो सके। गद्य में लिखी लंबी रिपोर्ट कोई नहीं पढ़ता; बदलावों की सूची और जाँच-बिंदु पढ़े जाते हैं।",
    "note": "समीक्षा को सस्ता «क्या बदला» और «क्या जाँचना है» को अलग रखना ही बनाता है।"
  },
  "id": {
    "check": {
      "reviews": "Permintaan tinjauan",
      "checkpoints": "Titik periksa"
    },
    "heading": "Gerbang tinjauan",
    "level": {
      "none": "Tanpa permintaan tinjauan",
      "noPoints": "Tanpa titik periksa",
      "present": "Bisa ditinjau"
    },
    "desc": "Menghitung apakah penyelesaian diserahkan dalam bentuk yang bisa ditinjau. Laporan panjang berbentuk prosa tidak dibaca; daftar perubahan ditambah titik periksa dibaca.",
    "note": "Yang membuat peninjauan murah adalah memisahkan «apa yang berubah» dari «apa yang perlu diperiksa»."
  },
  "it": {
    "check": {
      "reviews": "Richieste di revisione",
      "checkpoints": "Punti di verifica"
    },
    "heading": "Varco di revisione",
    "level": {
      "none": "Nessuna revisione richiesta",
      "noPoints": "Nessun punto di verifica",
      "present": "Revisionabile"
    },
    "desc": "Conta se il completamento è stato consegnato in forma verificabile. I rapporti lunghi in prosa non si leggono; un elenco di modifiche più punti di verifica sì.",
    "note": "Ciò che rende economica la revisione è separare «che cosa è cambiato» da «che cosa verificare»."
  },
  "pt-BR": {
    "check": {
      "reviews": "Pedidos de revisão",
      "checkpoints": "Pontos de verificação"
    },
    "heading": "Portão de revisão",
    "level": {
      "none": "Sem revisão solicitada",
      "noPoints": "Sem pontos de verificação",
      "present": "Revisável"
    },
    "desc": "Conta se a conclusão foi entregue em formato revisável. Relatórios longos em prosa não são lidos; uma lista de mudanças mais pontos de verificação, sim.",
    "note": "O que barateia a revisão é separar «o que mudou» de «o que verificar»."
  }
} as const;
