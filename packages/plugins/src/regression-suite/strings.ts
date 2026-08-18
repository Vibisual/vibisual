/**
 * regression-suite — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.regressionSuite` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Agents often undo an earlier fix because the reason for it is not in their context. A regression test stands in for that memory — documents may go unread, a failing test cannot.",
    "heading": "Regression Suite",
    "level": {
      "none": "Nothing accrued",
      "accruing": "Accruing"
    },
    "check": {
      "lessons": "Lessons recorded",
      "checkpoints": "Check points"
    },
    "note": "The subtler the fix, the more it needs a test. “Change this and that breaks” survives far better as a test than as a comment."
  },
  "ko": {
    "desc": "에이전트는 예전에 고쳤던 것을 되돌리는 일이 잦습니다 — 왜 그렇게 됐는지가 컨텍스트에 없기 때문입니다. 회귀 테스트가 그 기억을 대신합니다.",
    "heading": "회귀 스위트",
    "level": {
      "none": "적립된 것 없음",
      "accruing": "적립 중"
    },
    "check": {
      "lessons": "기록된 교훈",
      "checkpoints": "확인 포인트"
    },
    "note": "미묘한 수정일수록 테스트를 남기십시오. \"이렇게 고치면 저게 깨진다\"는 지식은 주석보다 테스트로 훨씬 오래 갑니다."
  },
  "ja": {
    "level": {
      "none": "蓄積なし",
      "accruing": "蓄積中"
    },
    "check": {
      "lessons": "記録された教訓",
      "checkpoints": "確認ポイント"
    },
    "heading": "回帰テスト群",
    "desc": "エージェントは以前直したものを元に戻しがちです — なぜそうしたかの文脈がコンテキストにないからです。回帰テストがその記憶を代わりに担います。",
    "note": "微妙な修正ほどテストを残してください。「こう直すとあれが壊れる」という知識は、コメントよりテストの方がはるかに長持ちします。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无积累",
      "accruing": "正在积累"
    },
    "check": {
      "lessons": "已记录的教训",
      "checkpoints": "检查要点"
    },
    "heading": "回归测试集",
    "desc": "智能体常常把先前修好的东西改回去 — 因为「当初为什么这么改」不在它的上下文里。回归测试代替了那份记忆。",
    "note": "越是微妙的修改越要留测试。「这么改那边就会坏」这种知识，写成测试远比写成注释活得久。"
  },
  "es": {
    "level": {
      "none": "Nada acumulado",
      "accruing": "Acumulando"
    },
    "check": {
      "lessons": "Lecciones registradas",
      "checkpoints": "Puntos de verificación"
    },
    "heading": "Suite de regresión",
    "desc": "Los agentes deshacen a menudo una corrección anterior porque el motivo no está en su contexto. Una prueba de regresión hace las veces de esa memoria.",
    "note": "Cuanto más sutil la corrección, más necesita una prueba. «Cambia esto y aquello se rompe» sobrevive mucho mejor como prueba que como comentario."
  },
  "es-419": {
    "level": {
      "none": "Nada acumulado",
      "accruing": "Acumulando"
    },
    "check": {
      "lessons": "Lecciones registradas",
      "checkpoints": "Puntos de verificación"
    },
    "heading": "Suite de regresión",
    "desc": "Los agentes deshacen a menudo una corrección anterior porque el motivo no está en su contexto. Una prueba de regresión hace las veces de esa memoria.",
    "note": "Cuanto más sutil la corrección, más necesita una prueba. «Cambia esto y aquello se rompe» sobrevive mucho mejor como prueba que como comentario."
  },
  "fr": {
    "level": {
      "none": "Rien d’accumulé",
      "accruing": "En accumulation"
    },
    "check": {
      "lessons": "Leçons consignées",
      "checkpoints": "Points de contrôle"
    },
    "heading": "Suite de régression",
    "desc": "Les agents défont souvent une correction antérieure parce que la raison n’est pas dans leur contexte. Un test de régression tient lieu de cette mémoire.",
    "note": "Plus la correction est subtile, plus elle a besoin d’un test. « Change ceci et cela casse » survit bien mieux en test qu’en commentaire."
  },
  "de": {
    "level": {
      "none": "Nichts angesammelt",
      "accruing": "Sammelt sich"
    },
    "check": {
      "lessons": "Erfasste Lehren",
      "checkpoints": "Prüfpunkte"
    },
    "heading": "Regressionssuite",
    "desc": "Agenten machen frühere Korrekturen oft rückgängig, weil der Grund dafür nicht in ihrem Kontext steht. Ein Regressionstest übernimmt diese Erinnerung.",
    "note": "Je feiner die Korrektur, desto eher braucht sie einen Test. „Änderst du das, bricht jenes“ überlebt als Test weit besser denn als Kommentar."
  },
  "hi": {
    "level": {
      "none": "कुछ जमा नहीं",
      "accruing": "जमा हो रहा"
    },
    "check": {
      "lessons": "दर्ज सबक",
      "checkpoints": "जाँच बिंदु"
    },
    "heading": "रिग्रेशन सूट",
    "desc": "एजेंट पिछली मरम्मत अक्सर इसलिए पलट देते हैं कि उसकी वजह उनके संदर्भ में नहीं होती। प्रतिगमन-टेस्ट उसी याद की जगह लेते हैं।",
    "note": "मरम्मत जितनी सूक्ष्म, टेस्ट की ज़रूरत उतनी ज़्यादा। «इसे बदलोगे तो वह टूटेगा» टिप्पणी के बजाय टेस्ट के रूप में कहीं बेहतर टिकता है।"
  },
  "id": {
    "level": {
      "none": "Belum terkumpul",
      "accruing": "Terkumpul"
    },
    "check": {
      "lessons": "Pelajaran tercatat",
      "checkpoints": "Titik periksa"
    },
    "heading": "Suite regresi",
    "desc": "Agen sering membatalkan perbaikan sebelumnya karena alasannya tidak ada di konteksnya. Tes regresi menggantikan ingatan itu.",
    "note": "Makin halus perbaikannya, makin butuh tes. «Ubah ini maka itu rusak» bertahan jauh lebih baik sebagai tes daripada sebagai komentar."
  },
  "it": {
    "level": {
      "none": "Nulla accumulato",
      "accruing": "In accumulo"
    },
    "check": {
      "lessons": "Lezioni registrate",
      "checkpoints": "Punti di verifica"
    },
    "heading": "Suite di regressione",
    "desc": "Gli agenti disfano spesso una correzione precedente perché il motivo non è nel loro contesto. Un test di regressione fa le veci di quella memoria.",
    "note": "Più la correzione è sottile, più ha bisogno di un test. «Cambia questo e quello si rompe» sopravvive molto meglio come test che come commento."
  },
  "pt-BR": {
    "level": {
      "none": "Nada acumulado",
      "accruing": "Acumulando"
    },
    "check": {
      "lessons": "Lições registradas",
      "checkpoints": "Pontos de verificação"
    },
    "heading": "Suíte de regressão",
    "desc": "Agentes desfazem com frequência uma correção anterior porque o motivo não está no contexto deles. Um teste de regressão faz as vezes dessa memória.",
    "note": "Quanto mais sutil a correção, mais ela precisa de um teste. «Mude isto e aquilo quebra» sobrevive muito melhor como teste do que como comentário."
  }
} as const;
