/**
 * reflexion — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.reflexion` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Self-critique works when it rests on an executable signal such as a failing test. Reflection without evidence is plausible noise.",
    "heading": "Reflexion",
    "level": {
      "none": "No reports",
      "noLessons": "No lessons recorded",
      "accruing": "Lessons accruing"
    },
    "check": {
      "reports": "Work reports",
      "learned": "Lessons recorded"
    },
    "note": "This pattern works best in coding, where tests act as an objective judge. Where no such judge exists, its value drops sharply."
  },
  "ko": {
    "desc": "자기 비평은 테스트 실패 같은 실행 가능한 신호에 근거할 때 작동합니다. 근거 없는 반성은 그럴듯한 소음입니다.",
    "heading": "리플렉션",
    "level": {
      "none": "신고 없음",
      "noLessons": "교훈 기록 없음",
      "accruing": "교훈 적립 중"
    },
    "check": {
      "reports": "작업 신고",
      "learned": "기록된 교훈"
    },
    "note": "이 패턴은 테스트라는 객관적 판정자가 있는 코딩에서 가장 잘 먹히고, 판정 근거가 없는 도메인에서는 효과가 급감합니다."
  },
  "ja": {
    "check": {
      "reports": "作業報告",
      "learned": "記録された教訓"
    },
    "heading": "自己批評（Reflexion）",
    "level": {
      "none": "報告なし",
      "noLessons": "教訓の記録なし",
      "accruing": "教訓が積もる"
    },
    "desc": "自己批評は、テスト失敗のような実行可能な合図に基づくときに機能します。根拠のない反省はもっともらしい雑音です。",
    "note": "このパターンはテストという客観的な判定者があるコーディングで最もよく効き、そうした判定者がない領域では効果が急落します。"
  },
  "zh-CN": {
    "check": {
      "reports": "工作汇报",
      "learned": "已记录的教训"
    },
    "heading": "自我反思",
    "level": {
      "none": "无汇报",
      "noLessons": "未记录教训",
      "accruing": "教训在积累"
    },
    "desc": "自我批评只有建立在可执行信号（例如测试失败）之上才有效。没有依据的反省是似是而非的噪声。",
    "note": "这一模式在有测试作为客观裁判的编码领域最有效；在没有这类裁判的领域，其价值会急剧下降。"
  },
  "es": {
    "check": {
      "reports": "Informes de trabajo",
      "learned": "Lecciones registradas"
    },
    "heading": "Autocrítica (Reflexion)",
    "level": {
      "none": "Sin informes",
      "noLessons": "Sin lecciones registradas",
      "accruing": "Lecciones acumulándose"
    },
    "desc": "La autocrítica funciona cuando se apoya en una señal ejecutable, como una prueba que falla. La reflexión sin evidencia es ruido plausible.",
    "note": "Este patrón rinde sobre todo al programar, donde las pruebas actúan de juez objetivo. Donde no existe tal juez, su valor cae en picado."
  },
  "es-419": {
    "check": {
      "reports": "Informes de trabajo",
      "learned": "Lecciones registradas"
    },
    "heading": "Autocrítica (Reflexion)",
    "level": {
      "none": "Sin informes",
      "noLessons": "Sin lecciones registradas",
      "accruing": "Lecciones acumulándose"
    },
    "desc": "La autocrítica funciona cuando se apoya en una señal ejecutable, como una prueba que falla. La reflexión sin evidencia es ruido plausible.",
    "note": "Este patrón rinde sobre todo al programar, donde las pruebas actúan de juez objetivo. Donde no existe tal juez, su valor cae en picado."
  },
  "fr": {
    "check": {
      "reports": "Rapports de travail",
      "learned": "Leçons consignées"
    },
    "heading": "Autocritique (Reflexion)",
    "level": {
      "none": "Aucun rapport",
      "noLessons": "Aucune leçon consignée",
      "accruing": "Leçons en accumulation"
    },
    "desc": "L’autocritique fonctionne quand elle repose sur un signal exécutable, comme un test qui échoue. Une réflexion sans preuve n’est qu’un bruit plausible.",
    "note": "Ce motif fonctionne surtout en programmation, où les tests jouent le juge objectif. Là où un tel juge manque, sa valeur chute fortement."
  },
  "de": {
    "check": {
      "reports": "Arbeitsberichte",
      "learned": "Erfasste Lehren"
    },
    "heading": "Selbstkritik (Reflexion)",
    "level": {
      "none": "Keine Berichte",
      "noLessons": "Keine Lehren erfasst",
      "accruing": "Lehren sammeln sich"
    },
    "desc": "Selbstkritik wirkt, wenn sie auf einem ausführbaren Signal wie einem fehlgeschlagenen Test ruht. Reflexion ohne Beleg ist plausibles Rauschen.",
    "note": "Dieses Muster wirkt am besten beim Programmieren, wo Tests als objektiver Richter dienen. Fehlt ein solcher Richter, fällt sein Wert stark ab."
  },
  "hi": {
    "check": {
      "reports": "कार्य रिपोर्ट",
      "learned": "दर्ज सबक"
    },
    "heading": "आत्म-समीक्षा",
    "level": {
      "none": "कोई रिपोर्ट नहीं",
      "noLessons": "कोई सबक दर्ज नहीं",
      "accruing": "सबक जमा हो रहे"
    },
    "desc": "आत्म-समीक्षा तब काम करती है जब वह चलने वाले संकेत पर टिकी हो, जैसे विफल टेस्ट। बिना प्रमाण की समीक्षा बस प्रशंसनीय लगने वाला शोर है।",
    "note": "यह पैटर्न प्रोग्रामिंग में सबसे अच्छा चलता है, जहाँ टेस्ट वस्तुनिष्ठ न्यायाधीश का काम करते हैं। जिन क्षेत्रों में ऐसा न्यायाधीश नहीं, वहाँ इसका मूल्य गिर जाता है।"
  },
  "id": {
    "check": {
      "reports": "Laporan kerja",
      "learned": "Pelajaran tercatat"
    },
    "heading": "Refleksi diri",
    "level": {
      "none": "Tanpa laporan",
      "noLessons": "Tidak ada pelajaran tercatat",
      "accruing": "Pelajaran menumpuk"
    },
    "desc": "Kritik diri bekerja bila bertumpu pada sinyal yang bisa dijalankan, seperti tes yang gagal. Refleksi tanpa bukti hanyalah derau yang terdengar masuk akal.",
    "note": "Pola ini paling berhasil dalam pemrograman, di mana tes berperan sebagai hakim objektif. Di ranah tanpa hakim semacam itu, nilainya anjlok."
  },
  "it": {
    "check": {
      "reports": "Rapporti di lavoro",
      "learned": "Lezioni registrate"
    },
    "heading": "Autocritica (Reflexion)",
    "level": {
      "none": "Nessun rapporto",
      "noLessons": "Nessuna lezione registrata",
      "accruing": "Lezioni in accumulo"
    },
    "desc": "L’autocritica funziona quando poggia su un segnale eseguibile, come un test che fallisce. Una riflessione senza prove è rumore plausibile.",
    "note": "Questo schema rende soprattutto nella programmazione, dove i test fanno da giudice oggettivo. Dove un giudice simile manca, il suo valore crolla."
  },
  "pt-BR": {
    "check": {
      "reports": "Relatórios de trabalho",
      "learned": "Lições registradas"
    },
    "heading": "Autocrítica (Reflexion)",
    "level": {
      "none": "Sem relatórios",
      "noLessons": "Sem lições registradas",
      "accruing": "Lições acumulando"
    },
    "desc": "A autocrítica funciona quando se apoia num sinal executável, como um teste que falha. Reflexão sem evidência é ruído plausível.",
    "note": "Este padrão rende melhor ao programar, onde os testes fazem o papel de juiz objetivo. Onde não existe tal juiz, seu valor cai bruscamente."
  }
} as const;
