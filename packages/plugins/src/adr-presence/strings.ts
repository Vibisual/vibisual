/**
 * adr-presence — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.adrPresence` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Without a record of what was rejected and why, an agent will propose an already-discarded design in good faith. A decision record is where “do not do this” lives with its reason.",
    "heading": "Decision Records",
    "level": {
      "none": "Nothing recorded",
      "recorded": "Recorded"
    },
    "check": {
      "decided": "Settled decisions",
      "lessons": "Lessons"
    },
    "note": "Keeping decisions next to the code and referencing them from the instruction file is the standard layout."
  },
  "ko": {
    "desc": "무엇을 왜 기각했는지가 없으면 에이전트가 이미 버린 설계를 선의로 다시 제안합니다. 결정 기록은 \"하지 마라\"를 근거와 함께 남기는 자리입니다.",
    "heading": "결정 기록",
    "level": {
      "none": "기록 없음",
      "recorded": "기록됨"
    },
    "check": {
      "decided": "확정된 결정",
      "lessons": "교훈"
    },
    "note": "결정을 코드 옆에 두고 지침 파일에서 참조하게 하는 것이 표준 배치입니다."
  },
  "ja": {
    "level": {
      "none": "記録なし",
      "recorded": "記録済み"
    },
    "heading": "決定記録",
    "check": {
      "decided": "確定した決定",
      "lessons": "教訓"
    },
    "desc": "何をなぜ却下したかの記録がないと、エージェントはすでに捨てた設計を善意で再び提案します。決定記録は「やるな」を理由とともに置いておく場所です。",
    "note": "決定をコードの隣に置き、指示ファイルから参照させるのが標準的な配置です。"
  },
  "zh-CN": {
    "level": {
      "none": "无记录",
      "recorded": "已记录"
    },
    "heading": "决策记录",
    "check": {
      "decided": "已确定的决策",
      "lessons": "教训"
    },
    "desc": "没有「否决了什么、为什么否决」的记录，智能体就会善意地重新提出早已被丢弃的设计。决策记录是把「别这么做」连同理由一起留下的地方。",
    "note": "把决策放在代码旁边，并从指令文件中引用，是标准的布局。"
  },
  "es": {
    "level": {
      "none": "Nada registrado",
      "recorded": "Registrado"
    },
    "heading": "Registros de decisiones",
    "check": {
      "decided": "Decisiones fijadas",
      "lessons": "Lecciones"
    },
    "desc": "Sin registro de qué se descartó y por qué, un agente propondrá de buena fe un diseño ya desechado. Un registro de decisiones es donde vive «no hagas esto» junto con su razón.",
    "note": "Guardar las decisiones junto al código y referenciarlas desde el archivo de instrucciones es la disposición habitual."
  },
  "es-419": {
    "level": {
      "none": "Nada registrado",
      "recorded": "Registrado"
    },
    "heading": "Registros de decisiones",
    "check": {
      "decided": "Decisiones fijadas",
      "lessons": "Lecciones"
    },
    "desc": "Sin registro de qué se descartó y por qué, un agente propondrá de buena fe un diseño ya desechado. Un registro de decisiones es donde vive «no hagas esto» junto con su razón.",
    "note": "Guardar las decisiones junto al código y referenciarlas desde el archivo de instrucciones es la disposición habitual."
  },
  "fr": {
    "level": {
      "none": "Rien d’enregistré",
      "recorded": "Enregistré"
    },
    "heading": "Registres de décisions",
    "check": {
      "decided": "Décisions arrêtées",
      "lessons": "Leçons"
    },
    "desc": "Sans trace de ce qui a été rejeté et pourquoi, un agent reproposera de bonne foi une conception déjà écartée. Un registre de décisions est l’endroit où « ne fais pas cela » vit avec sa raison.",
    "note": "Garder les décisions près du code et y renvoyer depuis le fichier d’instructions est la disposition habituelle."
  },
  "de": {
    "level": {
      "none": "Nichts erfasst",
      "recorded": "Erfasst"
    },
    "heading": "Entscheidungsprotokolle",
    "check": {
      "decided": "Festgelegte Entscheidungen",
      "lessons": "Lehren"
    },
    "desc": "Ohne Aufzeichnung dessen, was verworfen wurde und warum, schlägt ein Agent guten Glaubens einen längst verworfenen Entwurf erneut vor. Ein Entscheidungsprotokoll ist der Ort, an dem „tu das nicht“ mitsamt Begründung steht.",
    "note": "Entscheidungen neben dem Code zu halten und aus der Anweisungsdatei darauf zu verweisen ist die übliche Anordnung."
  },
  "hi": {
    "level": {
      "none": "कुछ दर्ज नहीं",
      "recorded": "दर्ज"
    },
    "heading": "निर्णय अभिलेख",
    "check": {
      "decided": "तय निर्णय",
      "lessons": "सबक"
    },
    "desc": "क्या ठुकराया गया और क्यों — यह दर्ज न हो तो एजेंट सद्भावना से वही छोड़ा हुआ डिज़ाइन फिर सुझा देगा। निर्णय-अभिलेख वह जगह है जहाँ «यह मत करो» अपनी वजह के साथ रहता है।",
    "note": "निर्णय कोड के बग़ल में रखना और निर्देश-फ़ाइल से उनका हवाला देना आम व्यवस्था है।"
  },
  "id": {
    "level": {
      "none": "Tidak ada catatan",
      "recorded": "Tercatat"
    },
    "heading": "Catatan keputusan",
    "check": {
      "decided": "Keputusan tetap",
      "lessons": "Pelajaran"
    },
    "desc": "Tanpa catatan apa yang ditolak dan mengapa, agen akan dengan niat baik mengusulkan lagi rancangan yang sudah dibuang. Catatan keputusan adalah tempat «jangan lakukan ini» tinggal bersama alasannya.",
    "note": "Menyimpan keputusan di samping kode dan merujuknya dari berkas instruksi adalah susunan yang lazim."
  },
  "it": {
    "level": {
      "none": "Nulla registrato",
      "recorded": "Registrato"
    },
    "heading": "Registri delle decisioni",
    "check": {
      "decided": "Decisioni stabilite",
      "lessons": "Lezioni"
    },
    "desc": "Senza traccia di ciò che è stato scartato e perché, un agente riproporrà in buona fede un progetto già abbandonato. Un registro delle decisioni è dove «non fare questo» vive insieme alla sua ragione.",
    "note": "Tenere le decisioni accanto al codice e richiamarle dal file di istruzioni è la disposizione consueta."
  },
  "pt-BR": {
    "level": {
      "none": "Nada registrado",
      "recorded": "Registrado"
    },
    "heading": "Registros de decisão",
    "check": {
      "decided": "Decisões firmadas",
      "lessons": "Lições"
    },
    "desc": "Sem registro do que foi rejeitado e por quê, um agente vai propor de boa-fé um desenho já descartado. Um registro de decisão é onde «não faça isso» mora junto com o motivo.",
    "note": "Manter as decisões ao lado do código e referenciá-las a partir do arquivo de instruções é a disposição habitual."
  }
} as const;
