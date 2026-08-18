/**
 * verifier-critic — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.verifierCritic` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Checks whether the writer and the checker are separate. A critic that shares the writer’s blind spots simply stamps bad answers as good.",
    "heading": "Verifier and Critic",
    "level": {
      "selfReview": "Self-review only",
      "separated": "Separated"
    },
    "check": {
      "critiques": "Critique edges",
      "incoming": "Incoming critique"
    },
    "note": "Executable verification — tests, lint, typecheck — is cheaper and more accurate than a critic, so put it first.",
    "noteSelf": "No critique edge. Reviewing one’s own output usually ends in a formal pass; a separate critic or an executable check is what catches things."
  },
  "ko": {
    "desc": "작성하는 쪽과 검사하는 쪽이 갈려 있는지 봅니다. 같은 맹점을 공유하는 비평자는 나쁜 답에 그대로 도장을 찍습니다.",
    "heading": "검증자·비평자",
    "level": {
      "selfReview": "자기 검토뿐",
      "separated": "분리됨"
    },
    "check": {
      "critiques": "비평 엣지",
      "incoming": "받는 비평"
    },
    "note": "테스트·린트·타입체크 같은 실행 가능한 검증이 비평자보다 싸고 정확하므로 먼저 두십시오.",
    "noteSelf": "비평 엣지가 없습니다. 자기 결과를 자기가 리뷰하는 것은 대개 형식적 통과로 끝나고, 별도 비평자나 실행 검증이 실제로 잡아냅니다."
  },
  "ja": {
    "check": {
      "critiques": "批評エッジ",
      "incoming": "受け取る批評"
    },
    "heading": "検証者と批評者",
    "level": {
      "selfReview": "自己検収のみ",
      "separated": "分離済み"
    },
    "desc": "書く側と検査する側が分かれているかを見ます。書き手と同じ盲点を持つ批評者は、悪い答えにそのまま判を押します。",
    "note": "テスト・リント・型チェックのような実行可能な検証は批評者より安く正確なので、先に置いてください。",
    "noteSelf": "批評エッジがありません。自分の結果を自分で見直すのは大抵形式的な通過で終わり、別の批評者か実行可能な検査が実際に捕まえます。"
  },
  "zh-CN": {
    "check": {
      "critiques": "批评连线",
      "incoming": "收到的批评"
    },
    "heading": "验证者与批评者",
    "level": {
      "selfReview": "仅自我检查",
      "separated": "已分离"
    },
    "desc": "检查写的一方和查的一方是否分开。与作者共享同样盲点的批评者，只会给糟糕的答案盖上通过章。",
    "note": "测试、lint、类型检查这类可执行的验证比批评者更便宜也更准确，应该放在前面。",
    "noteSelf": "没有批评连线。自己检查自己的结果通常只会形式性通过；真正抓住问题的是独立的批评者或可执行的检查。"
  },
  "es": {
    "check": {
      "critiques": "Conexiones de crítica",
      "incoming": "Crítica recibida"
    },
    "heading": "Verificador y crítico",
    "level": {
      "selfReview": "Solo autorrevisión",
      "separated": "Separado"
    },
    "desc": "Comprueba que quien escribe y quien revisa estén separados. Un crítico que comparte los puntos ciegos del autor se limita a sellar respuestas malas.",
    "note": "La verificación ejecutable — pruebas, lint, comprobación de tipos — es más barata y precisa que un crítico, así que va delante.",
    "noteSelf": "No hay conexión de crítica. Revisar el propio resultado suele acabar en aprobación formal; lo que de verdad atrapa es un crítico aparte o una comprobación ejecutable."
  },
  "es-419": {
    "check": {
      "critiques": "Conexiones de crítica",
      "incoming": "Crítica recibida"
    },
    "heading": "Verificador y crítico",
    "level": {
      "selfReview": "Solo autorrevisión",
      "separated": "Separado"
    },
    "desc": "Comprueba que quien escribe y quien revisa estén separados. Un crítico que comparte los puntos ciegos del autor se limita a sellar respuestas malas.",
    "note": "La verificación ejecutable — pruebas, lint, comprobación de tipos — es más barata y precisa que un crítico, así que va delante.",
    "noteSelf": "No hay conexión de crítica. Revisar el propio resultado suele acabar en aprobación formal; lo que de verdad atrapa es un crítico aparte o una comprobación ejecutable."
  },
  "fr": {
    "check": {
      "critiques": "Liens de critique",
      "incoming": "Critique reçue"
    },
    "heading": "Vérificateur et critique",
    "level": {
      "selfReview": "Auto-revue seulement",
      "separated": "Séparé"
    },
    "desc": "Vérifie que celui qui écrit et celui qui contrôle sont séparés. Un critique partageant les angles morts de l’auteur se contente de tamponner de mauvaises réponses.",
    "note": "La vérification exécutable — tests, lint, typage — est moins chère et plus juste qu’un critique ; placez-la avant.",
    "noteSelf": "Aucun lien de critique. Relire son propre résultat finit généralement en validation formelle ; ce qui attrape vraiment, c’est un critique distinct ou une vérification exécutable."
  },
  "de": {
    "check": {
      "critiques": "Kritik-Kanten",
      "incoming": "Eingehende Kritik"
    },
    "heading": "Prüfer und Kritiker",
    "level": {
      "selfReview": "Nur Selbstprüfung",
      "separated": "Getrennt"
    },
    "desc": "Prüft, ob schreibende und prüfende Seite getrennt sind. Ein Kritiker mit denselben blinden Flecken wie der Autor stempelt schlechte Antworten einfach ab.",
    "note": "Ausführbare Prüfung — Tests, Lint, Typecheck — ist günstiger und genauer als ein Kritiker und gehört daher davor.",
    "noteSelf": "Keine Kritik-Kante vorhanden. Das eigene Ergebnis selbst zu prüfen endet meist in formalem Durchwinken; es fängt entweder ein eigener Kritiker oder eine ausführbare Prüfung."
  },
  "hi": {
    "check": {
      "critiques": "समीक्षा एज",
      "incoming": "प्राप्त समीक्षा"
    },
    "heading": "सत्यापक और समीक्षक",
    "level": {
      "selfReview": "केवल स्व-समीक्षा",
      "separated": "पृथक"
    },
    "desc": "जाँचता है कि लिखने वाला और जाँचने वाला अलग हैं या नहीं। जिस समीक्षक की अंध-बिंदु लेखक जैसी ही हों, वह बुरे उत्तर पर भी पास की मुहर लगा देता है।",
    "note": "चलाई जा सकने वाली जाँच — टेस्ट, lint, टाइप-जाँच — समीक्षक से सस्ती और सटीक है, इसलिए उसे पहले रखिए।",
    "noteSelf": "कोई समीक्षा-किनारा नहीं है। अपना नतीजा ख़ुद देखना आम तौर पर औपचारिक पास में बदल जाता है; असल में पकड़ अलग समीक्षक या चलने वाली जाँच ही करती है।"
  },
  "id": {
    "check": {
      "critiques": "Edge kritik",
      "incoming": "Kritik masuk"
    },
    "heading": "Verifikator dan kritikus",
    "level": {
      "selfReview": "Hanya tinjauan sendiri",
      "separated": "Terpisah"
    },
    "desc": "Memeriksa apakah yang menulis dan yang memeriksa terpisah. Kritikus yang berbagi titik buta dengan penulis hanya mengecap jawaban buruk sebagai lolos.",
    "note": "Verifikasi yang bisa dijalankan — tes, lint, pemeriksaan tipe — lebih murah dan lebih tepat daripada kritikus, jadi tempatkan lebih dulu.",
    "noteSelf": "Tidak ada edge kritik. Meninjau hasil sendiri biasanya berakhir sebagai kelulusan formal; yang benar-benar menangkap adalah kritikus terpisah atau pemeriksaan yang bisa dijalankan."
  },
  "it": {
    "check": {
      "critiques": "Collegamenti di critica",
      "incoming": "Critica ricevuta"
    },
    "heading": "Verificatore e critico",
    "level": {
      "selfReview": "Solo autorevisione",
      "separated": "Separato"
    },
    "desc": "Verifica che chi scrive e chi controlla siano separati. Un critico che condivide i punti ciechi dell’autore si limita a timbrare risposte sbagliate.",
    "note": "La verifica eseguibile — test, lint, controllo dei tipi — costa meno ed è più precisa di un critico, quindi va messa prima.",
    "noteSelf": "Nessun collegamento di critica. Rivedere il proprio risultato finisce di solito in un via libera formale; ciò che davvero coglie è un critico separato o un controllo eseguibile."
  },
  "pt-BR": {
    "check": {
      "critiques": "Conexões de crítica",
      "incoming": "Crítica recebida"
    },
    "heading": "Verificador e crítico",
    "level": {
      "selfReview": "Apenas autorrevisão",
      "separated": "Separado"
    },
    "desc": "Verifica se quem escreve e quem confere estão separados. Um crítico que compartilha os pontos cegos do autor apenas carimba respostas ruins.",
    "note": "Verificação executável — testes, lint, checagem de tipos — é mais barata e precisa que um crítico, então venha antes.",
    "noteSelf": "Nenhuma conexão de crítica. Revisar o próprio resultado costuma acabar em aprovação formal; o que realmente pega é um crítico separado ou uma checagem executável."
  }
} as const;
