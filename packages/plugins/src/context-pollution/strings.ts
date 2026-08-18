/**
 * context-pollution — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.contextPollution` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Rot is about length; pollution is about mixing. Failed attempts, abandoned approaches and verbose tool output linger — and a wrong intermediate conclusion keeps being treated as fact.",
    "heading": "Context Pollution",
    "level": {
      "clean": "Clean",
      "ok": "Acceptable",
      "mixed": "Heavily mixed"
    },
    "check": {
      "sessions": "Sessions",
      "turns": "Turns",
      "perSession": "Turns per session"
    },
    "note": "This is the real reason to use subagents — not speed, but letting each subtask start from a clean context.",
    "noteMixed": "Many turns are piling into few sessions. Splitting the next subtask into its own session keeps the wrong middles from following along."
  },
  "ko": {
    "desc": "부패가 길이의 문제라면 오염은 혼입의 문제입니다. 실패한 시도의 로그와 버려진 접근이 남고, 특히 틀린 중간 결론이 남으면 모델이 그것을 계속 사실로 취급합니다.",
    "heading": "컨텍스트 오염",
    "level": {
      "clean": "깨끗함",
      "ok": "괜찮음",
      "mixed": "많이 섞임"
    },
    "check": {
      "sessions": "세션 수",
      "turns": "턴 수",
      "perSession": "세션당 턴"
    },
    "note": "서브에이전트를 쓰는 진짜 이유가 이것입니다 — 성능이 아니라, 각 하위 작업이 깨끗한 컨텍스트에서 시작하게 만드는 것.",
    "noteMixed": "적은 세션에 턴이 몰려 있습니다. 다음 하위 작업을 별도 세션으로 떼면 틀린 중간 결론이 따라붙지 않습니다."
  },
  "ja": {
    "check": {
      "sessions": "セッション数",
      "turns": "ターン数",
      "perSession": "セッション当たりターン"
    },
    "heading": "コンテキスト汚染",
    "level": {
      "clean": "問題なし",
      "ok": "許容範囲",
      "mixed": "かなり混在"
    },
    "desc": "劣化が長さの問題なら、汚染は混入の問題です。失敗した試行のログや捨てた方針が残り、特に誤った途中結論が残るとモデルはそれを事実として扱い続けます。",
    "note": "サブエージェントを使う本当の理由がこれです — 速度ではなく、各下位作業が綺麗なコンテキストから始められるようにすることです。",
    "noteMixed": "少ないセッションにターンが集中しています。次の下位作業を別セッションに切り出せば、誤った途中結論が付いて回りません。"
  },
  "zh-CN": {
    "check": {
      "sessions": "会话数",
      "turns": "轮次",
      "perSession": "每会话轮次"
    },
    "heading": "上下文污染",
    "level": {
      "clean": "干净",
      "ok": "可接受",
      "mixed": "混杂较重"
    },
    "desc": "腐化是长度问题，污染是混入问题。失败尝试的日志、被放弃的思路会滞留下来 — 尤其错误的中间结论一旦留下，模型会持续把它当作事实。",
    "note": "这才是使用子智能体的真正理由 — 不是为了速度，而是让每个子任务从干净的上下文开始。",
    "noteMixed": "轮次集中堆在少数会话里。把下一个子任务拆到独立会话，错误的中间结论就不会一路跟着走。"
  },
  "es": {
    "check": {
      "sessions": "Sesiones",
      "turns": "Turnos",
      "perSession": "Turnos por sesión"
    },
    "heading": "Contaminación del contexto",
    "level": {
      "clean": "Limpio",
      "ok": "Aceptable",
      "mixed": "Muy mezclado"
    },
    "desc": "El deterioro es cuestión de longitud; la contaminación, de mezcla. Registros de intentos fallidos y enfoques abandonados se quedan — y una conclusión intermedia errónea se sigue tratando como un hecho.",
    "note": "Esta es la verdadera razón de usar subagentes — no la velocidad, sino que cada subtarea arranque desde un contexto limpio.",
    "noteMixed": "Muchos turnos se acumulan en pocas sesiones. Separar la siguiente subtarea en su propia sesión evita que los intermedios equivocados la sigan."
  },
  "es-419": {
    "check": {
      "sessions": "Sesiones",
      "turns": "Turnos",
      "perSession": "Turnos por sesión"
    },
    "heading": "Contaminación del contexto",
    "level": {
      "clean": "Limpio",
      "ok": "Aceptable",
      "mixed": "Muy mezclado"
    },
    "desc": "El deterioro es cuestión de longitud; la contaminación, de mezcla. Registros de intentos fallidos y enfoques abandonados se quedan — y una conclusión intermedia errónea se sigue tratando como un hecho.",
    "note": "Esta es la verdadera razón de usar subagentes — no la velocidad, sino que cada subtarea arranque desde un contexto limpio.",
    "noteMixed": "Muchos turnos se acumulan en pocas sesiones. Separar la siguiente subtarea en su propia sesión evita que los intermedios equivocados la sigan."
  },
  "fr": {
    "check": {
      "sessions": "Sessions",
      "turns": "Tours",
      "perSession": "Tours par session"
    },
    "heading": "Pollution du contexte",
    "level": {
      "clean": "Propre",
      "ok": "Acceptable",
      "mixed": "Très mélangé"
    },
    "desc": "La dégradation est une affaire de longueur, la pollution une affaire de mélange. Journaux d’essais ratés et approches abandonnées s’attardent — et une conclusion intermédiaire fausse continue d’être tenue pour un fait.",
    "note": "C’est la vraie raison d’utiliser des sous-agents — non la vitesse, mais permettre à chaque sous-tâche de partir d’un contexte propre.",
    "noteMixed": "Beaucoup de tours s’accumulent dans peu de sessions. Isoler la prochaine sous-tâche dans sa propre session empêche les mauvais milieux de suivre."
  },
  "de": {
    "check": {
      "sessions": "Sitzungen",
      "turns": "Züge",
      "perSession": "Züge pro Sitzung"
    },
    "heading": "Kontextverschmutzung",
    "level": {
      "clean": "Sauber",
      "ok": "Vertretbar",
      "mixed": "Stark vermischt"
    },
    "desc": "Verfall ist eine Frage der Länge, Verschmutzung eine der Vermischung. Protokolle gescheiterter Versuche und verworfene Ansätze bleiben liegen — und ein falscher Zwischenschluss wird weiter als Tatsache behandelt.",
    "note": "Das ist der eigentliche Grund für Subagenten — nicht Tempo, sondern dass jede Teilaufgabe aus einem sauberen Kontext startet.",
    "noteMixed": "Viele Züge häufen sich in wenigen Sitzungen. Die nächste Teilaufgabe in eine eigene Sitzung zu trennen hält falsche Zwischenstände davon ab, mitzureisen."
  },
  "hi": {
    "check": {
      "sessions": "सत्र",
      "turns": "टर्न",
      "perSession": "प्रति सत्र टर्न"
    },
    "heading": "संदर्भ प्रदूषण",
    "level": {
      "clean": "साफ़",
      "ok": "स्वीकार्य",
      "mixed": "बहुत मिश्रित"
    },
    "desc": "क्षय लंबाई की बात है; प्रदूषण मिलावट की। असफल कोशिशों के लॉग और छोड़ दिए गए रास्ते जमे रह जाते हैं — और ग़लत बीच के निष्कर्ष तथ्य की तरह बरते जाते रहते हैं।",
    "note": "उप-एजेंट इस्तेमाल करने की असली वजह यही है — गति नहीं, बल्कि यह कि हर उप-काम साफ़ संदर्भ से शुरू हो।",
    "noteMixed": "थोड़े से सत्रों में बहुत सी बारियाँ जमा हैं। अगला उप-काम अपने अलग सत्र में डालने से ग़लत बीच के निष्कर्ष साथ नहीं जाते।"
  },
  "id": {
    "check": {
      "sessions": "Sesi",
      "turns": "Giliran",
      "perSession": "Giliran per sesi"
    },
    "heading": "Polusi konteks",
    "level": {
      "clean": "Bersih",
      "ok": "Bisa diterima",
      "mixed": "Sangat tercampur"
    },
    "desc": "Pembusukan soal panjang; polusi soal percampuran. Log percobaan gagal dan pendekatan yang ditinggalkan tetap mengendap — dan kesimpulan antara yang keliru terus diperlakukan sebagai fakta.",
    "note": "Inilah alasan sebenarnya memakai subagen — bukan kecepatan, melainkan agar tiap subtugas mulai dari konteks yang bersih.",
    "noteMixed": "Banyak giliran menumpuk di sedikit sesi. Memisahkan subtugas berikutnya ke sesinya sendiri mencegah kesimpulan antara yang keliru ikut terbawa."
  },
  "it": {
    "check": {
      "sessions": "Sessioni",
      "turns": "Turni",
      "perSession": "Turni per sessione"
    },
    "heading": "Inquinamento del contesto",
    "level": {
      "clean": "Pulito",
      "ok": "Accettabile",
      "mixed": "Molto mescolato"
    },
    "desc": "Il degrado è questione di lunghezza; l’inquinamento è questione di mescolanza. Log di tentativi falliti e approcci abbandonati restano — e una conclusione intermedia sbagliata continua a essere trattata come un fatto.",
    "note": "È questa la vera ragione per usare i subagenti — non la velocità, ma far partire ogni sotto-compito da un contesto pulito.",
    "noteMixed": "Molti turni si accumulano in poche sessioni. Separare il prossimo sotto-compito in una sessione propria impedisce agli intermedi sbagliati di seguirlo."
  },
  "pt-BR": {
    "check": {
      "sessions": "Sessões",
      "turns": "Turnos",
      "perSession": "Turnos por sessão"
    },
    "heading": "Poluição do contexto",
    "level": {
      "clean": "Limpo",
      "ok": "Aceitável",
      "mixed": "Muito misturado"
    },
    "desc": "Deterioração é questão de comprimento; poluição é questão de mistura. Logs de tentativas fracassadas e abordagens abandonadas ficam — e uma conclusão intermediária errada continua sendo tratada como fato.",
    "note": "Esta é a verdadeira razão de usar subagentes — não a velocidade, mas deixar cada subtarefa começar de um contexto limpo.",
    "noteMixed": "Muitos turnos se acumulam em poucas sessões. Separar a próxima subtarefa em sessão própria evita que os intermediários errados venham junto."
  }
} as const;
