/**
 * computer-use — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.computerUse` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Driving software by looking at the screen reaches everything that has no API, but every step depends on visual grounding, which makes it slow and brittle.",
    "heading": "Computer Use",
    "level": {
      "none": "No captures",
      "watching": "Watching a window",
      "controlling": "Whole screen captured"
    },
    "check": {
      "captures": "Capture bubbles",
      "screens": "Full-screen captures"
    },
    "note": "If it can be done through CLI or API, do not do it through the GUI. Irreversible clicks belong behind a human confirmation."
  },
  "ko": {
    "desc": "화면을 보고 조작하는 방식은 API 가 없는 모든 것에 닿지만, 매 단계가 시각적 근거 잡기에 의존해 느리고 깨지기 쉽습니다.",
    "heading": "컴퓨터 사용",
    "level": {
      "none": "캡처 없음",
      "watching": "창 하나 보는 중",
      "controlling": "화면 전체 캡처"
    },
    "check": {
      "captures": "캡처 버블",
      "screens": "전체 화면 캡처"
    },
    "note": "CLI·API 로 할 수 있으면 GUI 로 하지 마십시오. 되돌릴 수 없는 클릭은 사람 확인 뒤에 두어야 합니다."
  },
  "ja": {
    "heading": "コンピュータ操作",
    "check": {
      "captures": "キャプチャバブル",
      "screens": "画面全体のキャプチャ"
    },
    "level": {
      "none": "キャプチャなし",
      "watching": "ウィンドウを見ている",
      "controlling": "画面全体を取得"
    },
    "desc": "画面を見て操作する方式は API のないすべてに届きますが、各段階が視覚的な位置合わせに依存するため遅く壊れやすいです。",
    "note": "CLI や API でできるなら GUI でやらないでください。取り消せないクリックは人の確認の後ろに置くべきです。"
  },
  "zh-CN": {
    "heading": "计算机操作",
    "check": {
      "captures": "截屏气泡",
      "screens": "全屏截取"
    },
    "level": {
      "none": "无截屏",
      "watching": "仅观察某窗口",
      "controlling": "截取整个屏幕"
    },
    "desc": "靠看屏幕来操作软件，能触达所有没有 API 的地方，但每一步都依赖视觉定位，因而缓慢且脆弱。",
    "note": "能用 CLI 或 API 做到的就不要用 GUI 做。不可逆的点击应该放在人工确认之后。"
  },
  "es": {
    "heading": "Uso del ordenador",
    "check": {
      "captures": "Burbujas de captura",
      "screens": "Capturas de pantalla completa"
    },
    "level": {
      "none": "Sin capturas",
      "watching": "Observando una ventana",
      "controlling": "Pantalla completa capturada"
    },
    "desc": "Manejar software mirando la pantalla alcanza todo lo que no tiene API, pero cada paso depende de ubicar cosas visualmente, lo que lo hace lento y frágil.",
    "note": "Lo que se pueda hacer por CLI o API no debería hacerse por la interfaz gráfica. Los clics irreversibles van detrás de una confirmación humana."
  },
  "es-419": {
    "heading": "Uso del ordenador",
    "check": {
      "captures": "Burbujas de captura",
      "screens": "Capturas de pantalla completa"
    },
    "level": {
      "none": "Sin capturas",
      "watching": "Observando una ventana",
      "controlling": "Pantalla completa capturada"
    },
    "desc": "Manejar software mirando la pantalla alcanza todo lo que no tiene API, pero cada paso depende de ubicar cosas visualmente, lo que lo hace lento y frágil.",
    "note": "Lo que se pueda hacer por CLI o API no debería hacerse por la interfaz gráfica. Los clics irreversibles van detrás de una confirmación humana."
  },
  "fr": {
    "heading": "Utilisation de l’ordinateur",
    "check": {
      "captures": "Bulles de capture",
      "screens": "Captures plein écran"
    },
    "level": {
      "none": "Aucune capture",
      "watching": "Observe une fenêtre",
      "controlling": "Écran entier capturé"
    },
    "desc": "Piloter un logiciel en regardant l’écran atteint tout ce qui n’a pas d’API, mais chaque étape dépend d’un repérage visuel, ce qui rend le procédé lent et fragile.",
    "note": "Ce qui peut passer par CLI ou API ne devrait pas passer par l’interface graphique. Les clics irréversibles se placent derrière une confirmation humaine."
  },
  "de": {
    "heading": "Computernutzung",
    "check": {
      "captures": "Capture-Blasen",
      "screens": "Vollbild-Aufnahmen"
    },
    "level": {
      "none": "Keine Aufnahmen",
      "watching": "Beobachtet ein Fenster",
      "controlling": "Ganzer Bildschirm erfasst"
    },
    "desc": "Software über den Bildschirm zu bedienen erreicht alles, was keine API hat, aber jeder Schritt hängt an visueller Verortung, was es langsam und brüchig macht.",
    "note": "Was über CLI oder API geht, sollte nicht über die GUI laufen. Unumkehrbare Klicks gehören hinter eine menschliche Bestätigung."
  },
  "hi": {
    "heading": "कंप्यूटर उपयोग",
    "check": {
      "captures": "कैप्चर बबल",
      "screens": "पूर्ण-स्क्रीन कैप्चर"
    },
    "level": {
      "none": "कोई कैप्चर नहीं",
      "watching": "एक विंडो देख रहा",
      "controlling": "पूरी स्क्रीन कैप्चर"
    },
    "desc": "पर्दा देखकर सॉफ़्टवेयर चलाना उस हर चीज़ तक पहुँचता है जिसका API नहीं, पर हर कदम दृश्य पहचान पर टिका होता है, इसलिए यह धीमा और भंगुर है।",
    "note": "जो CLI या API से हो सकता है, वह ग्राफ़िकल इंटरफ़ेस से न हो। जो क्लिक पलटी नहीं जा सकती, वह मनुष्य की पुष्टि के पीछे बैठे।"
  },
  "id": {
    "heading": "Penggunaan komputer",
    "check": {
      "captures": "Bubble tangkapan",
      "screens": "Tangkapan layar penuh"
    },
    "level": {
      "none": "Tanpa tangkapan",
      "watching": "Mengamati satu jendela",
      "controlling": "Seluruh layar ditangkap"
    },
    "desc": "Mengendalikan perangkat lunak dengan melihat layar menjangkau semua yang tak punya API, tetapi tiap langkah bergantung pada pengenalan visual, sehingga lambat dan rapuh.",
    "note": "Yang bisa lewat CLI atau API sebaiknya tidak lewat antarmuka grafis. Klik yang tak terbalikkan ditempatkan di balik konfirmasi manusia."
  },
  "it": {
    "heading": "Uso del computer",
    "check": {
      "captures": "Bolle di cattura",
      "screens": "Catture a schermo intero"
    },
    "level": {
      "none": "Nessuna cattura",
      "watching": "Osserva una finestra",
      "controlling": "Schermo intero catturato"
    },
    "desc": "Guidare il software guardando lo schermo raggiunge tutto ciò che non ha API, ma ogni passo dipende dal riconoscere le cose a vista, il che lo rende lento e fragile.",
    "note": "Ciò che si può fare da CLI o API non dovrebbe passare dall’interfaccia grafica. I clic irreversibili stanno dietro una conferma umana."
  },
  "pt-BR": {
    "heading": "Uso do computador",
    "check": {
      "captures": "Bolhas de captura",
      "screens": "Capturas de tela cheia"
    },
    "level": {
      "none": "Sem capturas",
      "watching": "Observando uma janela",
      "controlling": "Tela inteira capturada"
    },
    "desc": "Operar software olhando a tela alcança tudo o que não tem API, mas cada passo depende de localizar coisas visualmente, o que torna o processo lento e frágil.",
    "note": "O que dá para fazer por CLI ou API não deveria passar pela interface gráfica. Cliques irreversíveis ficam atrás de uma confirmação humana."
  }
} as const;
