/**
 * working-memory — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.workingMemory` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Fast, and gone when the session ends. This alone never becomes a system that gets smarter with use — but trying to promote everything to long-term memory fails just as surely.",
    "heading": "Working Memory",
    "level": {
      "empty": "Nothing loaded",
      "live": "Loaded"
    },
    "check": {
      "context": "Context in use",
      "injected": "Cards injected",
      "events": "Injection events"
    },
    "note": "Most of a conversation should be consumed and discarded. Deciding what gets promoted is the first step of memory design."
  },
  "ko": {
    "desc": "빠르지만 세션이 끝나면 사라집니다. 이것만으로는 쓸수록 똑똑해지는 시스템이 안 되고, 반대로 모든 것을 장기 기억으로 만들려는 것도 실패합니다.",
    "heading": "작업 기억",
    "level": {
      "empty": "실린 것 없음",
      "live": "실려 있음"
    },
    "check": {
      "context": "사용 중 컨텍스트",
      "injected": "주입된 카드",
      "events": "주입 이벤트"
    },
    "note": "대화의 대부분은 그 자리에서 소비되고 버려져야 정상입니다. 무엇을 장기 기억으로 넘길지의 승급 기준이 기억 설계의 첫 단추입니다."
  },
  "ja": {
    "level": {
      "live": "読み込み済み",
      "empty": "読み込みなし"
    },
    "check": {
      "context": "使用中のコンテキスト",
      "events": "注入イベント",
      "injected": "注入されたカード"
    },
    "heading": "作業記憶",
    "desc": "速い代わりにセッションが終われば消えます。これだけでは「使うほど賢くなる」仕組みにはならず、逆にすべてを長期記憶にしようとするのも失敗します。",
    "note": "会話の大半はその場で消費されて捨てられるのが正常です。何を長期記憶へ上げるかの基準が、記憶設計の最初の一歩です。"
  },
  "zh-CN": {
    "level": {
      "live": "已载入",
      "empty": "未载入"
    },
    "check": {
      "context": "使用中的上下文",
      "events": "注入事件",
      "injected": "注入的卡片"
    },
    "heading": "工作记忆",
    "desc": "快，但会话结束就消失。仅靠它无法形成「越用越聪明」的系统；反过来，试图把一切都变成长期记忆同样会失败。",
    "note": "对话的大部分本应就地消耗并丢弃。决定什么被提升为长期记忆，是记忆设计的第一步。"
  },
  "es": {
    "level": {
      "live": "Cargado",
      "empty": "Nada cargado"
    },
    "check": {
      "context": "Contexto en uso",
      "events": "Eventos de inyección",
      "injected": "Tarjetas inyectadas"
    },
    "heading": "Memoria de trabajo",
    "desc": "Rápida, y desaparecida al terminar la sesión. Por sí sola nunca da un sistema que mejore con el uso — pero intentar promover todo a memoria a largo plazo fracasa igual.",
    "note": "La mayor parte de una conversación debe consumirse y desecharse. Decidir qué asciende es el primer paso del diseño de memoria."
  },
  "es-419": {
    "level": {
      "live": "Cargado",
      "empty": "Nada cargado"
    },
    "check": {
      "context": "Contexto en uso",
      "events": "Eventos de inyección",
      "injected": "Tarjetas inyectadas"
    },
    "heading": "Memoria de trabajo",
    "desc": "Rápida, y desaparecida al terminar la sesión. Por sí sola nunca da un sistema que mejore con el uso — pero intentar promover todo a memoria a largo plazo fracasa igual.",
    "note": "La mayor parte de una conversación debe consumirse y desecharse. Decidir qué asciende es el primer paso del diseño de memoria."
  },
  "fr": {
    "level": {
      "live": "Chargé",
      "empty": "Rien de chargé"
    },
    "check": {
      "context": "Contexte utilisé",
      "events": "Événements d’injection",
      "injected": "Cartes injectées"
    },
    "heading": "Mémoire de travail",
    "desc": "Rapide, et disparue à la fin de la session. Elle seule ne fera jamais un système qui s’améliore à l’usage — mais vouloir tout promouvoir en mémoire longue échoue tout autant.",
    "note": "L’essentiel d’une conversation doit être consommé puis jeté. Décider de ce qui est promu est la première étape de la conception mémoire."
  },
  "de": {
    "level": {
      "live": "Geladen",
      "empty": "Nichts geladen"
    },
    "check": {
      "context": "Genutzter Kontext",
      "events": "Injektionsereignisse",
      "injected": "Eingespeiste Karten"
    },
    "heading": "Arbeitsgedächtnis",
    "desc": "Schnell — und mit dem Sitzungsende verschwunden. Allein daraus wird nie ein System, das mit dem Gebrauch klüger wird; umgekehrt scheitert auch der Versuch, alles ins Langzeitgedächtnis zu heben.",
    "note": "Der größte Teil eines Gesprächs soll verbraucht und verworfen werden. Zu entscheiden, was aufsteigt, ist der erste Schritt des Gedächtnisdesigns."
  },
  "hi": {
    "level": {
      "live": "लोड किया",
      "empty": "कुछ लोड नहीं"
    },
    "check": {
      "context": "उपयोग में संदर्भ",
      "events": "इंजेक्शन घटनाएँ",
      "injected": "इंजेक्ट किए कार्ड"
    },
    "heading": "कार्यशील स्मृति",
    "desc": "तेज़, और सत्र ख़त्म होते ही ग़ायब। अकेले यह कभी ऐसा तंत्र नहीं बनेगा जो उपयोग के साथ समझदार होता जाए — पर सब कुछ दीर्घकालिक स्मृति में चढ़ाने की कोशिश भी विफल होती है।",
    "note": "अधिकांश बातचीत को इस्तेमाल करके छोड़ देना ही ठीक है। क्या ऊपर चढ़ेगा, यह तय करना स्मृति-डिज़ाइन का पहला कदम है।"
  },
  "id": {
    "level": {
      "live": "Dimuat",
      "empty": "Tidak ada yang dimuat"
    },
    "check": {
      "context": "Konteks terpakai",
      "events": "Peristiwa injeksi",
      "injected": "Kartu diinjeksi"
    },
    "heading": "Memori kerja",
    "desc": "Cepat, dan lenyap begitu sesi berakhir. Ia sendiri tidak akan pernah menjadi sistem yang makin pintar seiring dipakai — tetapi mencoba menaikkan semuanya ke memori jangka panjang juga gagal.",
    "note": "Sebagian besar percakapan memang seharusnya dipakai lalu dibuang. Menentukan apa yang naik adalah langkah pertama perancangan memori."
  },
  "it": {
    "level": {
      "live": "Caricato",
      "empty": "Nulla caricato"
    },
    "check": {
      "context": "Contesto in uso",
      "events": "Eventi di iniezione",
      "injected": "Schede iniettate"
    },
    "heading": "Memoria di lavoro",
    "desc": "Veloce, e sparita alla fine della sessione. Da sola non produce mai un sistema che migliora con l’uso — ma anche voler promuovere tutto a memoria di lungo periodo fallisce allo stesso modo.",
    "note": "La maggior parte di una conversazione va consumata e scartata. Decidere che cosa sale è il primo passo della progettazione della memoria."
  },
  "pt-BR": {
    "level": {
      "live": "Carregado",
      "empty": "Nada carregado"
    },
    "check": {
      "context": "Contexto em uso",
      "events": "Eventos de injeção",
      "injected": "Cartões injetados"
    },
    "heading": "Memória de trabalho",
    "desc": "Rápida, e some quando a sessão termina. Sozinha nunca vira um sistema que fica mais esperto com o uso — mas tentar promover tudo para memória de longo prazo falha do mesmo jeito.",
    "note": "A maior parte de uma conversa deve ser consumida e descartada. Decidir o que sobe é o primeiro passo do desenho de memória."
  }
} as const;
