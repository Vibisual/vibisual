/**
 * memory-poisoning — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.memoryPoisoning` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Ordinary injection dies with the session; poisoned memory stays and infects future ones. Worse, it is trusted more because it looks like something the system learned.",
    "heading": "Memory Poisoning",
    "level": {
      "none": "No memory yet",
      "clean": "Nothing pending",
      "review": "Pending judgement"
    },
    "check": {
      "contested": "Contested",
      "needsCheck": "Flagged stale",
      "cards": "Cards stored"
    },
    "note": "Promotion into memory needs provenance — a fact from the user and a line read out of an external document must not be stored at the same trust level."
  },
  "ko": {
    "desc": "일반 인젝션은 세션이 끝나면 사라지지만, 오염된 기억은 남아 미래의 세션을 감염시킵니다. 게다가 \"시스템이 학습한 것\"이라 더 신뢰받습니다.",
    "heading": "기억 오염",
    "level": {
      "none": "아직 기억 없음",
      "clean": "대기 중인 것 없음",
      "review": "판단 대기 있음"
    },
    "check": {
      "contested": "값이 갈림",
      "needsCheck": "확인 필요",
      "cards": "저장 장수"
    },
    "note": "기억으로 승급시키는 경로에 출처 검증이 필요합니다 — 사용자 발화에서 나온 사실과 외부 문서에서 읽은 내용을 같은 신뢰도로 저장하면 안 됩니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "clean": "保留なし",
      "review": "判断待ち"
    },
    "check": {
      "contested": "値が割れている",
      "needsCheck": "要確認",
      "cards": "保存カード数"
    },
    "heading": "記憶の汚染",
    "desc": "通常の注入はセッションが終われば消えますが、汚染された記憶は残り、以後のセッションを感染させます。しかも「システムが学習したもの」に見えるぶん、より信頼されてしまいます。",
    "note": "記憶へ昇格させる経路には出所の検証が必要です — 利用者の発話から来た事実と、外部文書から読んだ内容を同じ信頼度で保存してはいけません。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "clean": "无待办",
      "review": "待判断"
    },
    "check": {
      "contested": "存在分歧",
      "needsCheck": "标记为过时",
      "cards": "已存卡片"
    },
    "heading": "记忆投毒",
    "desc": "普通注入随会话结束而消失，被投毒的记忆却会留下并感染未来的会话。更糟的是，它看起来像「系统学到的东西」，因而更受信任。",
    "note": "升格为记忆的通路需要来源验证 — 来自用户发言的事实和从外部文档读到的内容，不能以同等信任度保存。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "clean": "Nada pendiente",
      "review": "Pendiente de juicio"
    },
    "check": {
      "contested": "En disputa",
      "needsCheck": "Marcadas como obsoletas",
      "cards": "Tarjetas guardadas"
    },
    "heading": "Envenenamiento de memoria",
    "desc": "Una inyección corriente muere con la sesión; la memoria envenenada permanece e infecta las futuras. Peor aún, se confía más en ella porque parece algo que el sistema aprendió.",
    "note": "La promoción a memoria exige procedencia — un hecho dicho por el usuario y una línea leída en un documento externo no pueden guardarse con el mismo nivel de confianza."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "clean": "Nada pendiente",
      "review": "Pendiente de juicio"
    },
    "check": {
      "contested": "En disputa",
      "needsCheck": "Marcadas como obsoletas",
      "cards": "Tarjetas guardadas"
    },
    "heading": "Envenenamiento de memoria",
    "desc": "Una inyección corriente muere con la sesión; la memoria envenenada permanece e infecta las futuras. Peor aún, se confía más en ella porque parece algo que el sistema aprendió.",
    "note": "La promoción a memoria exige procedencia — un hecho dicho por el usuario y una línea leída en un documento externo no pueden guardarse con el mismo nivel de confianza."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "clean": "Rien en attente",
      "review": "En attente de décision"
    },
    "check": {
      "contested": "Contesté",
      "needsCheck": "Marquées obsolètes",
      "cards": "Cartes stockées"
    },
    "heading": "Empoisonnement de mémoire",
    "desc": "Une injection ordinaire meurt avec la session ; une mémoire empoisonnée reste et contamine les suivantes. Pire, on lui fait davantage confiance parce qu’elle ressemble à quelque chose que le système a appris.",
    "note": "La promotion en mémoire exige une provenance — un fait issu de l’utilisateur et une ligne lue dans un document externe ne doivent pas être stockés au même niveau de confiance."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "clean": "Nichts offen",
      "review": "Beurteilung ausstehend"
    },
    "check": {
      "contested": "Strittig",
      "needsCheck": "Als veraltet markiert",
      "cards": "Gespeicherte Karten"
    },
    "heading": "Gedächtnisvergiftung",
    "desc": "Gewöhnliche Injection endet mit der Sitzung; vergiftetes Gedächtnis bleibt und infiziert künftige. Schlimmer noch: Es genießt mehr Vertrauen, weil es aussieht wie etwas, das das System gelernt hat.",
    "note": "Der Weg ins Gedächtnis braucht Herkunftsprüfung — eine Tatsache aus Nutzeraussagen und eine aus einem externen Dokument gelesene Zeile dürfen nicht mit gleicher Vertrauensstufe gespeichert werden."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "clean": "कुछ लंबित नहीं",
      "review": "निर्णय लंबित"
    },
    "check": {
      "contested": "विवादित",
      "needsCheck": "पुराना चिह्नित",
      "cards": "संग्रहित कार्ड"
    },
    "heading": "स्मृति विषाक्तता",
    "desc": "साधारण injection सत्र के साथ मर जाता है; विषाक्त स्मृति टिकी रहती है और आगे के सत्रों को भी संक्रमित करती है। इससे भी बुरा यह कि उस पर ज़्यादा भरोसा होता है, क्योंकि वह तंत्र की सीखी हुई चीज़ जैसी दिखती है।",
    "note": "स्मृति में चढ़ाने के लिए उद्गम चाहिए — उपयोगकर्ता के कहे तथ्य और बाहरी दस्तावेज़ से पढ़ी पंक्ति एक ही भरोसे के स्तर पर नहीं रखे जा सकते।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "clean": "Tidak ada tertunda",
      "review": "Menunggu penilaian"
    },
    "check": {
      "contested": "Berbeda",
      "needsCheck": "Ditandai usang",
      "cards": "Kartu tersimpan"
    },
    "heading": "Peracunan memori",
    "desc": "Injeksi biasa mati bersama sesi; memori yang diracuni bertahan dan menulari sesi-sesi berikutnya. Lebih buruk lagi, ia lebih dipercaya karena tampak seperti sesuatu yang dipelajari sistem.",
    "note": "Kenaikan menjadi memori menuntut asal-usul — fakta dari ucapan pengguna dan baris yang dibaca dari dokumen luar tidak boleh disimpan pada tingkat kepercayaan yang sama."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "clean": "Nulla in sospeso",
      "review": "In attesa di giudizio"
    },
    "check": {
      "contested": "Conteso",
      "needsCheck": "Segnate come obsolete",
      "cards": "Schede memorizzate"
    },
    "heading": "Avvelenamento della memoria",
    "desc": "Un’iniezione ordinaria muore con la sessione; una memoria avvelenata resta e infetta quelle future. Peggio: gode di più fiducia perché sembra qualcosa che il sistema ha imparato.",
    "note": "La promozione a memoria richiede provenienza — un fatto detto dall’utente e una riga letta in un documento esterno non possono essere salvati con lo stesso livello di fiducia."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "clean": "Nada pendente",
      "review": "Aguardando julgamento"
    },
    "check": {
      "contested": "Contestado",
      "needsCheck": "Marcadas como obsoletas",
      "cards": "Cartões armazenados"
    },
    "heading": "Envenenamento de memória",
    "desc": "Uma injeção comum morre com a sessão; memória envenenada fica e infecta as futuras. Pior: ela recebe mais confiança porque parece algo que o sistema aprendeu.",
    "note": "A promoção para memória exige procedência — um fato dito pelo usuário e uma linha lida num documento externo não podem ser guardados no mesmo nível de confiança."
  }
} as const;
