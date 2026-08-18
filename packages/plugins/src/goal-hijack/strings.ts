/**
 * goal-hijack — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.goalHijack` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Once the goal itself is swapped, every later step autonomously helps the attacker — and because the behaviour stays outwardly consistent, people rarely notice.",
    "heading": "Goal Hijack",
    "level": {
      "loose": "Goal not pinned",
      "partial": "Partly pinned",
      "anchored": "Pinned"
    },
    "check": {
      "rules": "Standing rules",
      "plan": "Written plan"
    },
    "yes": "yes",
    "no": "no",
    "note": "Keep the goal somewhere it cannot be rewritten — do not put user instructions and tool results on the same layer."
  },
  "ko": {
    "desc": "목표 자체가 바뀌면 이후 모든 단계가 자율적으로 공격자를 돕고, 행동이 겉보기에 일관되므로 사람이 알아채기 어렵습니다.",
    "heading": "목표 탈취",
    "level": {
      "loose": "목표가 고정 안 됨",
      "partial": "일부만 고정",
      "anchored": "고정됨"
    },
    "check": {
      "rules": "상시 규칙",
      "plan": "적어 둔 계획"
    },
    "yes": "있음",
    "no": "없음",
    "note": "목표는 다시 쓸 수 없는 자리에 두십시오 — 사용자 지시와 도구 결과를 같은 층에 두지 않는 것이 핵심입니다."
  },
  "ja": {
    "check": {
      "rules": "常設ルール",
      "plan": "書かれた計画"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "目標の乗っ取り",
    "level": {
      "loose": "目標が固定されていない",
      "partial": "一部だけ固定",
      "anchored": "固定済み"
    },
    "desc": "目標そのものが差し替えられると、以降のすべての段階が自律的に攻撃者を助けます。しかも振る舞いが外見上は一貫しているため、人は気づきにくいのです。",
    "note": "目標は書き換えられない場所に置いてください — 利用者の指示とツールの結果を同じ層に置かないことが要点です。"
  },
  "zh-CN": {
    "check": {
      "rules": "常驻规则",
      "plan": "已写下的计划"
    },
    "yes": "是",
    "no": "否",
    "heading": "目标劫持",
    "level": {
      "loose": "目标未固定",
      "partial": "部分固定",
      "anchored": "已固定"
    },
    "desc": "一旦目标本身被掉包，之后的每一步都会自主地帮助攻击者 — 而且行为在外表上保持一致，人很难察觉。",
    "note": "把目标放在无法被改写的位置 — 不要把用户指令和工具结果放在同一层，这是关键。"
  },
  "es": {
    "check": {
      "rules": "Reglas permanentes",
      "plan": "Plan escrito"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Secuestro de objetivo",
    "level": {
      "loose": "Objetivo sin fijar",
      "partial": "Fijado en parte",
      "anchored": "Fijado"
    },
    "desc": "Una vez cambiado el objetivo mismo, cada paso posterior ayuda al atacante de forma autónoma — y como el comportamiento se mantiene coherente por fuera, casi nadie lo nota.",
    "note": "Mantén el objetivo en un sitio que no se pueda reescribir — no pongas instrucciones del usuario y resultados de herramientas en la misma capa."
  },
  "es-419": {
    "check": {
      "rules": "Reglas permanentes",
      "plan": "Plan escrito"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Secuestro de objetivo",
    "level": {
      "loose": "Objetivo sin fijar",
      "partial": "Fijado en parte",
      "anchored": "Fijado"
    },
    "desc": "Una vez cambiado el objetivo mismo, cada paso posterior ayuda al atacante de forma autónoma — y como el comportamiento se mantiene coherente por fuera, casi nadie lo nota.",
    "note": "Mantén el objetivo en un sitio que no se pueda reescribir — no pongas instrucciones del usuario y resultados de herramientas en la misma capa."
  },
  "fr": {
    "check": {
      "rules": "Règles permanentes",
      "plan": "Plan écrit"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Détournement d’objectif",
    "level": {
      "loose": "Objectif non figé",
      "partial": "Partiellement figé",
      "anchored": "Figé"
    },
    "desc": "Une fois l’objectif lui-même échangé, chaque étape suivante aide l’attaquant de façon autonome — et comme le comportement reste extérieurement cohérent, on s’en aperçoit rarement.",
    "note": "Gardez l’objectif à un endroit non réinscriptible — ne placez pas les instructions utilisateur et les résultats d’outils sur la même couche."
  },
  "de": {
    "check": {
      "rules": "Dauerregeln",
      "plan": "Schriftlicher Plan"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Zielentführung",
    "level": {
      "loose": "Ziel nicht fixiert",
      "partial": "Teilweise fixiert",
      "anchored": "Fixiert"
    },
    "desc": "Ist das Ziel selbst ausgetauscht, hilft jeder weitere Schritt eigenständig dem Angreifer — und weil das Verhalten nach außen stimmig bleibt, merkt es kaum jemand.",
    "note": "Halten Sie das Ziel an einer Stelle, an der es nicht umgeschrieben werden kann — legen Sie Nutzeranweisungen und Werkzeugergebnisse nicht auf dieselbe Ebene."
  },
  "hi": {
    "check": {
      "rules": "स्थायी नियम",
      "plan": "लिखी योजना"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "लक्ष्य अपहरण",
    "level": {
      "loose": "लक्ष्य स्थिर नहीं",
      "partial": "आंशिक रूप से स्थिर",
      "anchored": "स्थिर"
    },
    "desc": "जैसे ही लक्ष्य ही बदल दिया जाए, आगे का हर कदम अपने-आप हमलावर की मदद करता है — और चूँकि बाहर से व्यवहार सुसंगत दिखता रहता है, शायद ही किसी को पता चलता है।",
    "note": "लक्ष्य ऐसी जगह रखिए जहाँ उसे दोबारा नहीं लिखा जा सके — उपयोगकर्ता के निर्देश और टूल के नतीजे एक ही परत पर मत रखिए।"
  },
  "id": {
    "check": {
      "rules": "Aturan tetap",
      "plan": "Rencana tertulis"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Pembajakan tujuan",
    "level": {
      "loose": "Tujuan tak dipatok",
      "partial": "Sebagian dipatok",
      "anchored": "Dipatok"
    },
    "desc": "Begitu tujuannya sendiri ditukar, tiap langkah berikutnya membantu penyerang secara mandiri — dan karena perilakunya tetap tampak runtut dari luar, jarang ada yang menyadarinya.",
    "note": "Simpan tujuan di tempat yang tak bisa ditulis ulang — jangan menaruh instruksi pengguna dan hasil alat pada lapisan yang sama."
  },
  "it": {
    "check": {
      "rules": "Regole permanenti",
      "plan": "Piano scritto"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Dirottamento dell’obiettivo",
    "level": {
      "loose": "Obiettivo non fissato",
      "partial": "Fissato in parte",
      "anchored": "Fissato"
    },
    "desc": "Una volta scambiato l’obiettivo stesso, ogni passo successivo aiuta l’attaccante in autonomia — e poiché il comportamento resta coerente all’esterno, quasi nessuno se ne accorge.",
    "note": "Tieni l’obiettivo in un punto non riscrivibile — non mettere istruzioni dell’utente e risultati degli strumenti sullo stesso livello."
  },
  "pt-BR": {
    "check": {
      "rules": "Regras permanentes",
      "plan": "Plano escrito"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Sequestro de objetivo",
    "level": {
      "loose": "Objetivo não fixado",
      "partial": "Fixado em parte",
      "anchored": "Fixado"
    },
    "desc": "Uma vez trocado o próprio objetivo, cada passo seguinte ajuda o atacante de forma autônoma — e como o comportamento continua coerente por fora, quase ninguém percebe.",
    "note": "Mantenha o objetivo num lugar que não possa ser reescrito — não ponha instruções do usuário e resultados de ferramentas na mesma camada."
  }
} as const;
