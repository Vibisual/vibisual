/**
 * human-in-the-loop — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.humanInTheLoop` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Checks whether a human confirmation stands in front of irreversible actions. Approving everything makes approval meaningless; approving nothing causes incidents. The test is reversibility.",
    "heading": "Human in the Loop",
    "level": {
      "notNeeded": "Not needed here",
      "present": "Confirmation stands",
      "absent": "No confirmation"
    },
    "check": {
      "irreversible": "Irreversible tools",
      "prompt": "Approval prompt",
      "reversible": "Work is reversible"
    },
    "yes": "yes",
    "no": "no",
    "note": "Better than adding approvals is making actions undoable — trash instead of delete, versions instead of overwrite, draft instead of send."
  },
  "ko": {
    "desc": "되돌릴 수 없는 동작 앞에 사람의 확인이 있는지 봅니다. 전부에 승인을 걸면 승인이 무의미해지고 아무 데도 안 걸면 사고가 납니다 — 기준은 가역성입니다.",
    "heading": "사람 개입 지점",
    "level": {
      "notNeeded": "필요 없음",
      "present": "확인 지점 있음",
      "absent": "확인 지점 없음"
    },
    "check": {
      "irreversible": "되돌릴 수 없는 도구",
      "prompt": "승인 팝업",
      "reversible": "작업이 되돌려짐"
    },
    "yes": "예",
    "no": "아니오",
    "note": "승인을 늘리는 것보다 되돌릴 수 있게 만드는 편이 낫습니다 — 삭제 대신 휴지통, 덮어쓰기 대신 버전, 전송 대신 초안."
  },
  "ja": {
    "yes": "はい",
    "no": "いいえ",
    "heading": "人の介在点",
    "check": {
      "irreversible": "取り消せないツール",
      "prompt": "承認ダイアログ",
      "reversible": "作業を戻せる"
    },
    "level": {
      "present": "確認がある",
      "absent": "確認なし",
      "notNeeded": "ここでは不要"
    },
    "desc": "取り消せない操作の手前に人の確認があるかを見ます。すべてに承認を掛けると承認が無意味になり、どこにも掛けないと事故が起きます — 基準は「戻せるかどうか」です。",
    "note": "承認を増やすより、戻せるようにする方が有効です — 削除の代わりにゴミ箱、上書きの代わりにバージョン、送信の代わりに下書き。"
  },
  "zh-CN": {
    "yes": "是",
    "no": "否",
    "heading": "人工介入点",
    "check": {
      "irreversible": "不可逆工具",
      "prompt": "审批提示",
      "reversible": "工作可撤销"
    },
    "level": {
      "present": "有确认环节",
      "absent": "无确认",
      "notNeeded": "此处不需要"
    },
    "desc": "检查不可逆操作之前是否有人工确认。全部都要审批会让审批失去意义，全都不审批则会出事故 — 判断标准是「能否撤销」。",
    "note": "比增加审批更有效的是让操作可撤销 — 用回收站代替删除，用版本代替覆盖，用草稿代替发送。"
  },
  "es": {
    "yes": "sí",
    "no": "no",
    "heading": "Intervención humana",
    "check": {
      "irreversible": "Herramientas irreversibles",
      "prompt": "Solicitud de aprobación",
      "reversible": "El trabajo es reversible"
    },
    "level": {
      "present": "Hay confirmación",
      "absent": "Sin confirmación",
      "notNeeded": "Aquí no hace falta"
    },
    "desc": "Comprueba si hay una confirmación humana delante de las acciones irreversibles. Aprobarlo todo vacía de sentido la aprobación; no aprobar nada provoca incidentes — el criterio es la reversibilidad.",
    "note": "Mejor que añadir aprobaciones es hacer que las acciones se puedan deshacer — papelera en vez de borrado, versiones en vez de sobrescritura, borrador en vez de envío."
  },
  "es-419": {
    "yes": "sí",
    "no": "no",
    "heading": "Intervención humana",
    "check": {
      "irreversible": "Herramientas irreversibles",
      "prompt": "Solicitud de aprobación",
      "reversible": "El trabajo es reversible"
    },
    "level": {
      "present": "Hay confirmación",
      "absent": "Sin confirmación",
      "notNeeded": "Aquí no hace falta"
    },
    "desc": "Comprueba si hay una confirmación humana delante de las acciones irreversibles. Aprobarlo todo vacía de sentido la aprobación; no aprobar nada provoca incidentes — el criterio es la reversibilidad.",
    "note": "Mejor que añadir aprobaciones es hacer que las acciones se puedan deshacer — papelera en vez de borrado, versiones en vez de sobrescritura, borrador en vez de envío."
  },
  "fr": {
    "yes": "oui",
    "no": "non",
    "heading": "Intervention humaine",
    "check": {
      "irreversible": "Outils irréversibles",
      "prompt": "Demande d’approbation",
      "reversible": "Travail réversible"
    },
    "level": {
      "present": "Confirmation présente",
      "absent": "Aucune confirmation",
      "notNeeded": "Pas nécessaire ici"
    },
    "desc": "Vérifie qu’une confirmation humaine se trouve devant les actions irréversibles. Tout approuver rend l’approbation vide de sens ; ne rien approuver provoque des incidents — le critère est la réversibilité.",
    "note": "Mieux que d’ajouter des approbations : rendre les actions annulables — corbeille au lieu de suppression, versions au lieu d’écrasement, brouillon au lieu d’envoi."
  },
  "de": {
    "yes": "ja",
    "no": "nein",
    "heading": "Mensch im Ablauf",
    "check": {
      "irreversible": "Unumkehrbare Werkzeuge",
      "prompt": "Freigabeabfrage",
      "reversible": "Arbeit umkehrbar"
    },
    "level": {
      "present": "Bestätigung vorhanden",
      "absent": "Keine Bestätigung",
      "notNeeded": "Hier nicht nötig"
    },
    "desc": "Prüft, ob vor unumkehrbaren Aktionen eine menschliche Bestätigung steht. Alles freizugeben macht Freigaben bedeutungslos, nichts freizugeben führt zu Vorfällen — der Maßstab ist Umkehrbarkeit.",
    "note": "Besser als mehr Freigaben ist, Aktionen rückgängig machbar zu gestalten — Papierkorb statt Löschen, Versionen statt Überschreiben, Entwurf statt Senden."
  },
  "hi": {
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "मानव हस्तक्षेप",
    "check": {
      "irreversible": "अपरिवर्तनीय टूल",
      "prompt": "स्वीकृति संकेत",
      "reversible": "कार्य वापस लिया जा सकता"
    },
    "level": {
      "present": "पुष्टि मौजूद",
      "absent": "कोई पुष्टि नहीं",
      "notNeeded": "यहाँ ज़रूरत नहीं"
    },
    "desc": "जाँचता है कि जो काम पलटा नहीं जा सकता उसके आगे मनुष्य की पुष्टि है या नहीं। सब कुछ मंज़ूर करने से मंज़ूरी का अर्थ मिट जाता है; कुछ भी मंज़ूर न करने से घटनाएँ होती हैं — पैमाना है पलटने की गुंजाइश।",
    "note": "अनुमति जोड़ने से बेहतर है काम को वापस लेने योग्य बनाना — मिटाने की जगह कूड़ेदान, ऊपर लिखने की जगह संस्करण, भेजने की जगह मसौदा।"
  },
  "id": {
    "yes": "ya",
    "no": "tidak",
    "heading": "Campur tangan manusia",
    "check": {
      "irreversible": "Alat tak terbalikkan",
      "prompt": "Permintaan persetujuan",
      "reversible": "Pekerjaan bisa dibatalkan"
    },
    "level": {
      "present": "Ada konfirmasi",
      "absent": "Tanpa konfirmasi",
      "notNeeded": "Tidak diperlukan di sini"
    },
    "desc": "Memeriksa apakah ada konfirmasi manusia di depan tindakan yang tak terbalikkan. Menyetujui semuanya membuat persetujuan kehilangan makna; tidak menyetujui apa pun menimbulkan insiden — ukurannya adalah keterbalikan.",
    "note": "Lebih baik daripada menambah persetujuan adalah membuat tindakan bisa dibatalkan — tempat sampah alih-alih hapus, versi alih-alih timpa, draf alih-alih kirim."
  },
  "it": {
    "yes": "sì",
    "no": "no",
    "heading": "Intervento umano",
    "check": {
      "irreversible": "Strumenti irreversibili",
      "prompt": "Richiesta di approvazione",
      "reversible": "Lavoro reversibile"
    },
    "level": {
      "present": "C’è conferma",
      "absent": "Nessuna conferma",
      "notNeeded": "Qui non serve"
    },
    "desc": "Verifica se davanti alle azioni irreversibili c’è una conferma umana. Approvare tutto svuota di senso l’approvazione; non approvare nulla provoca incidenti — il criterio è la reversibilità.",
    "note": "Meglio che aggiungere approvazioni è rendere le azioni annullabili — cestino invece di eliminazione, versioni invece di sovrascrittura, bozza invece di invio."
  },
  "pt-BR": {
    "yes": "sim",
    "no": "não",
    "heading": "Intervenção humana",
    "check": {
      "irreversible": "Ferramentas irreversíveis",
      "prompt": "Pedido de aprovação",
      "reversible": "Trabalho reversível"
    },
    "level": {
      "present": "Há confirmação",
      "absent": "Sem confirmação",
      "notNeeded": "Não é preciso aqui"
    },
    "desc": "Verifica se há confirmação humana diante de ações irreversíveis. Aprovar tudo esvazia a aprovação de sentido; não aprovar nada causa incidentes — o critério é a reversibilidade.",
    "note": "Melhor do que acrescentar aprovações é tornar as ações desfazíveis — lixeira em vez de exclusão, versões em vez de sobrescrita, rascunho em vez de envio."
  }
} as const;
