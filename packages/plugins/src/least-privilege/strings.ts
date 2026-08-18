/**
 * least-privilege — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.leastPrivilege` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Splits the tools granted to an agent by what they can actually do — irreversible changes, reach to the outside, read-only — so over-granting is visible. Judged from the tool list alone.",
    "heading": "Least Privilege",
    "level": {
      "tight": "Tight",
      "broad": "Broad",
      "wide": "Wide open"
    },
    "badge": {
      "broad": "{{count}} powerful tools granted",
      "wide": "{{count}} powerful tools — consider taking some back"
    },
    "class": {
      "mutating": "Irreversible change",
      "reach": "Reach outside",
      "read": "Read only"
    },
    "denied": "Explicitly blocked",
    "lockedNote": "{{tools}} cannot be removed from the UI — the delegation path depends on it. Use Disallowed Tools instead if this agent must not have it.",
    "none": "none",
    "displayOnly": "Display only — this section never changes settings."
  },
  "ko": {
    "desc": "에이전트에 부여된 도구를 성격별로 갈라 보여줍니다 — 되돌릴 수 없는 변경 / 바깥에 닿는 힘 / 읽기 전용. 과잉 부여가 눈에 보이게 하는 것이 목적이며, 판정은 도구 목록만 봅니다.",
    "heading": "최소 권한",
    "level": {
      "tight": "좁음",
      "broad": "넓음",
      "wide": "매우 넓음"
    },
    "badge": {
      "broad": "강한 도구 {{count}}개가 부여됨",
      "wide": "강한 도구 {{count}}개 — 일부는 회수를 검토하십시오"
    },
    "class": {
      "mutating": "되돌릴 수 없는 변경",
      "reach": "바깥에 닿는 힘",
      "read": "읽기 전용"
    },
    "denied": "명시적으로 막은 도구",
    "lockedNote": "{{tools}} 는 UI 에서 제거할 수 없습니다 — 위임 경로가 의존하기 때문입니다. 정말 빼야 한다면 차단 도구에 넣으십시오.",
    "none": "없음",
    "displayOnly": "표시 전용 — 이 섹션은 설정을 바꾸지 않습니다."
  },
  "ja": {
    "desc": "エージェントに付与されたツールを性質別に分けて表示します — 取り消せない変更 / 外部への到達 / 読み取り専用。過剰付与を可視化するのが目的で、判定はツール一覧のみを見ます。",
    "heading": "最小権限",
    "level": {
      "tight": "狭い",
      "broad": "広い",
      "wide": "非常に広い"
    },
    "badge": {
      "broad": "強いツール {{count}} 個が付与されている",
      "wide": "強いツール {{count}} 個 — 一部の回収を検討してください"
    },
    "class": {
      "mutating": "取り消せない変更",
      "reach": "外部への到達",
      "read": "読み取り専用"
    },
    "denied": "明示的に禁止",
    "lockedNote": "{{tools}} は UI から削除できません — 委任経路が依存しているためです。本当に外すなら禁止ツールに入れてください。",
    "none": "なし",
    "displayOnly": "表示専用 — このセクションは設定を変更しません。"
  },
  "zh-CN": {
    "desc": "把授予智能体的工具按性质拆开显示 — 不可逆更改 / 触达外部 / 只读，从而让过度授权一目了然。判定只看工具列表。",
    "heading": "最小权限",
    "level": {
      "tight": "较窄",
      "broad": "较宽",
      "wide": "很宽"
    },
    "badge": {
      "broad": "已授予 {{count}} 个强力工具",
      "wide": "{{count}} 个强力工具 — 建议收回部分权限"
    },
    "class": {
      "mutating": "不可逆更改",
      "reach": "触达外部",
      "read": "只读"
    },
    "denied": "已明确禁用",
    "lockedNote": "{{tools}} 无法从界面移除 — 委派路径依赖它。若确实不需要，请加入禁用工具。",
    "none": "无",
    "displayOnly": "仅用于显示 — 此区块不会更改设置。"
  },
  "es": {
    "desc": "Separa las herramientas concedidas al agente según lo que permiten: cambios irreversibles, alcance al exterior y solo lectura, para que el exceso de permisos se vea. Se juzga solo por la lista de herramientas.",
    "heading": "Privilegio mínimo",
    "level": {
      "tight": "Ajustado",
      "broad": "Amplio",
      "wide": "Muy amplio"
    },
    "badge": {
      "broad": "{{count}} herramientas potentes concedidas",
      "wide": "{{count}} herramientas potentes — considera retirar algunas"
    },
    "class": {
      "mutating": "Cambio irreversible",
      "reach": "Alcance al exterior",
      "read": "Solo lectura"
    },
    "denied": "Bloqueadas explícitamente",
    "lockedNote": "{{tools}} no se puede quitar desde la interfaz porque la ruta de delegación depende de ella. Si este agente no debe tenerla, añádela a herramientas bloqueadas.",
    "none": "ninguna",
    "displayOnly": "Solo informativo: esta sección nunca cambia ajustes."
  },
  "es-419": {
    "desc": "Separa las herramientas concedidas al agente según lo que permiten: cambios irreversibles, alcance al exterior y solo lectura, para que el exceso de permisos se vea. Se juzga solo por la lista de herramientas.",
    "heading": "Privilegio mínimo",
    "level": {
      "tight": "Ajustado",
      "broad": "Amplio",
      "wide": "Muy amplio"
    },
    "badge": {
      "broad": "{{count}} herramientas potentes concedidas",
      "wide": "{{count}} herramientas potentes — considera retirar algunas"
    },
    "class": {
      "mutating": "Cambio irreversible",
      "reach": "Alcance al exterior",
      "read": "Solo lectura"
    },
    "denied": "Bloqueadas explícitamente",
    "lockedNote": "{{tools}} no se puede quitar desde la interfaz porque la ruta de delegación depende de ella. Si este agente no debe tenerla, añádela a herramientas bloqueadas.",
    "none": "ninguna",
    "displayOnly": "Solo informativo: esta sección nunca cambia ajustes."
  },
  "fr": {
    "desc": "Sépare les outils accordés à l’agent selon leur nature : changements irréversibles, portée vers l’extérieur, lecture seule — pour rendre visible l’excès de droits. Jugé sur la seule liste d’outils.",
    "heading": "Moindre privilège",
    "level": {
      "tight": "Restreint",
      "broad": "Large",
      "wide": "Très large"
    },
    "badge": {
      "broad": "{{count}} outils puissants accordés",
      "wide": "{{count}} outils puissants — envisagez d’en retirer"
    },
    "class": {
      "mutating": "Changement irréversible",
      "reach": "Portée extérieure",
      "read": "Lecture seule"
    },
    "denied": "Bloqués explicitement",
    "lockedNote": "{{tools}} ne peut pas être retiré depuis l’interface : le chemin de délégation en dépend. Ajoutez-le aux outils interdits si cet agent ne doit pas l’avoir.",
    "none": "aucun",
    "displayOnly": "Affichage seul — cette section ne modifie jamais les réglages."
  },
  "de": {
    "desc": "Teilt die einem Agenten gewährten Werkzeuge nach ihrer Wirkung auf — unumkehrbare Änderungen, Reichweite nach außen, nur Lesen — damit Überberechtigung sichtbar wird. Beurteilt allein anhand der Werkzeugliste.",
    "heading": "Minimale Rechte",
    "level": {
      "tight": "Eng",
      "broad": "Breit",
      "wide": "Sehr breit"
    },
    "badge": {
      "broad": "{{count}} mächtige Werkzeuge gewährt",
      "wide": "{{count}} mächtige Werkzeuge — erwägen Sie, welche zurückzunehmen"
    },
    "class": {
      "mutating": "Unumkehrbare Änderung",
      "reach": "Reichweite nach außen",
      "read": "Nur Lesen"
    },
    "denied": "Ausdrücklich gesperrt",
    "lockedNote": "{{tools}} lässt sich nicht über die Oberfläche entfernen — der Delegationspfad hängt davon ab. Nutzen Sie stattdessen die verbotenen Werkzeuge.",
    "none": "keine",
    "displayOnly": "Nur Anzeige — dieser Abschnitt ändert keine Einstellungen."
  },
  "hi": {
    "desc": "एजेंट को दिए गए टूल्स को उनकी प्रकृति से बाँटकर दिखाता है — अपरिवर्तनीय बदलाव / बाहर तक पहुँच / केवल पढ़ना — ताकि अतिरिक्त अनुमति दिखे। निर्णय केवल टूल सूची से।",
    "heading": "न्यूनतम विशेषाधिकार",
    "level": {
      "tight": "सीमित",
      "broad": "व्यापक",
      "wide": "बहुत व्यापक"
    },
    "badge": {
      "broad": "{{count}} शक्तिशाली टूल दिए गए",
      "wide": "{{count}} शक्तिशाली टूल — कुछ वापस लेने पर विचार करें"
    },
    "class": {
      "mutating": "अपरिवर्तनीय बदलाव",
      "reach": "बाहर तक पहुँच",
      "read": "केवल पढ़ना"
    },
    "denied": "स्पष्ट रूप से अवरुद्ध",
    "lockedNote": "{{tools}} को UI से हटाया नहीं जा सकता — डेलिगेशन पथ इस पर निर्भर है। ज़रूरी हो तो प्रतिबंधित टूल्स में जोड़ें।",
    "none": "कोई नहीं",
    "displayOnly": "केवल प्रदर्शन — यह अनुभाग सेटिंग्स नहीं बदलता।"
  },
  "id": {
    "desc": "Memisahkan alat yang diberikan ke agen berdasarkan sifatnya — perubahan tak terbalikkan, jangkauan ke luar, hanya baca — agar pemberian berlebih terlihat. Dinilai hanya dari daftar alat.",
    "heading": "Hak minimum",
    "level": {
      "tight": "Sempit",
      "broad": "Luas",
      "wide": "Sangat luas"
    },
    "badge": {
      "broad": "{{count}} alat kuat diberikan",
      "wide": "{{count}} alat kuat — pertimbangkan menarik sebagian"
    },
    "class": {
      "mutating": "Perubahan tak terbalikkan",
      "reach": "Jangkauan ke luar",
      "read": "Hanya baca"
    },
    "denied": "Diblokir eksplisit",
    "lockedNote": "{{tools}} tidak bisa dihapus dari UI — jalur delegasi bergantung padanya. Gunakan daftar alat yang dilarang bila perlu.",
    "none": "tidak ada",
    "displayOnly": "Hanya tampilan — bagian ini tidak mengubah pengaturan."
  },
  "it": {
    "desc": "Divide gli strumenti concessi all’agente per natura — modifiche irreversibili, portata verso l’esterno, sola lettura — così l’eccesso di permessi si vede. Valutato solo dalla lista degli strumenti.",
    "heading": "Privilegio minimo",
    "level": {
      "tight": "Ristretto",
      "broad": "Ampio",
      "wide": "Molto ampio"
    },
    "badge": {
      "broad": "{{count}} strumenti potenti concessi",
      "wide": "{{count}} strumenti potenti — valuta di revocarne alcuni"
    },
    "class": {
      "mutating": "Modifica irreversibile",
      "reach": "Portata esterna",
      "read": "Sola lettura"
    },
    "denied": "Bloccati esplicitamente",
    "lockedNote": "{{tools}} non è rimovibile dall’interfaccia: il percorso di delega ne dipende. Usa gli strumenti vietati se serve.",
    "none": "nessuno",
    "displayOnly": "Solo visualizzazione — questa sezione non modifica le impostazioni."
  },
  "pt-BR": {
    "desc": "Separa as ferramentas concedidas ao agente pelo que permitem — mudanças irreversíveis, alcance externo e somente leitura — para que o excesso de permissão fique visível. Julgado apenas pela lista de ferramentas.",
    "heading": "Privilégio mínimo",
    "level": {
      "tight": "Restrito",
      "broad": "Amplo",
      "wide": "Muito amplo"
    },
    "badge": {
      "broad": "{{count}} ferramentas potentes concedidas",
      "wide": "{{count}} ferramentas potentes — considere revogar algumas"
    },
    "class": {
      "mutating": "Mudança irreversível",
      "reach": "Alcance externo",
      "read": "Somente leitura"
    },
    "denied": "Bloqueadas explicitamente",
    "lockedNote": "{{tools}} não pode ser removida pela interface — o caminho de delegação depende dela. Use as ferramentas bloqueadas se necessário.",
    "none": "nenhum",
    "displayOnly": "Apenas exibição — esta seção nunca altera ajustes."
  }
} as const;
