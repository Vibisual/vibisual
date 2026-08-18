/**
 * acp-anp — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.acpAnp` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "The shared limitation of interoperability protocols is governance: they standardise what can connect to what, not who is allowed to do what.",
    "heading": "ACP and ANP",
    "level": {
      "none": "Neither set",
      "partial": "Partly set",
      "governed": "Authority and audit"
    },
    "check": {
      "authority": "Authority",
      "audit": "Audit trail"
    },
    "note": "Adopting a protocol does not give you permission or audit design — those still have to be built separately."
  },
  "ko": {
    "desc": "상호운용 규약들의 공통 한계는 거버넌스입니다 — 무엇이 무엇에 연결될 수 있는지는 표준화했지만, 누가 무엇을 해도 되는지는 표현하지 못합니다.",
    "heading": "ACP · ANP",
    "level": {
      "none": "둘 다 없음",
      "partial": "일부만",
      "governed": "권한 + 감사"
    },
    "check": {
      "authority": "권한",
      "audit": "감사 기록"
    },
    "note": "규약을 채택해도 권한과 감사 설계는 따로 해야 합니다 — 프로토콜이 보안을 대신해 주지 않습니다."
  },
  "ja": {
    "check": {
      "authority": "権限",
      "audit": "監査証跡"
    },
    "heading": "ACP と ANP",
    "level": {
      "none": "どちらも未設定",
      "governed": "権限と監査",
      "partial": "一部だけ設定"
    },
    "desc": "相互運用規約に共通する限界は統治です — 何が何につながれるかは標準化しましたが、誰が何をしてよいかは表現できません。",
    "note": "規約を採用しても権限と監査の設計は別に必要です — プロトコルがセキュリティを肩代わりしてはくれません。"
  },
  "zh-CN": {
    "check": {
      "authority": "权限",
      "audit": "审计轨迹"
    },
    "heading": "ACP 与 ANP",
    "level": {
      "none": "两者皆无",
      "governed": "权限与审计",
      "partial": "部分设置"
    },
    "desc": "互操作规约的共同局限在于治理：它们标准化了「什么能连到什么」，却表达不了「谁被允许做什么」。",
    "note": "采用了规约并不等于有了权限与审计设计 — 那些仍然要单独构建。"
  },
  "es": {
    "check": {
      "authority": "Autoridad",
      "audit": "Rastro de auditoría"
    },
    "heading": "ACP y ANP",
    "level": {
      "none": "Ninguno definido",
      "governed": "Autoridad y auditoría",
      "partial": "Definido en parte"
    },
    "desc": "La limitación común de los protocolos de interoperabilidad es la gobernanza: estandarizan qué puede conectarse con qué, no quién tiene permitido hacer qué.",
    "note": "Adoptar un protocolo no te da diseño de permisos ni de auditoría — eso sigue habiendo que construirlo aparte."
  },
  "es-419": {
    "check": {
      "authority": "Autoridad",
      "audit": "Rastro de auditoría"
    },
    "heading": "ACP y ANP",
    "level": {
      "none": "Ninguno definido",
      "governed": "Autoridad y auditoría",
      "partial": "Definido en parte"
    },
    "desc": "La limitación común de los protocolos de interoperabilidad es la gobernanza: estandarizan qué puede conectarse con qué, no quién tiene permitido hacer qué.",
    "note": "Adoptar un protocolo no te da diseño de permisos ni de auditoría — eso sigue habiendo que construirlo aparte."
  },
  "fr": {
    "check": {
      "authority": "Autorité",
      "audit": "Piste d’audit"
    },
    "heading": "ACP et ANP",
    "level": {
      "none": "Aucun des deux",
      "governed": "Autorité et audit",
      "partial": "Partiellement défini"
    },
    "desc": "La limite commune des protocoles d’interopérabilité est la gouvernance : ils normalisent ce qui peut se connecter à quoi, pas qui a le droit de faire quoi.",
    "note": "Adopter un protocole ne vous donne ni conception des permissions ni audit — cela reste à construire séparément."
  },
  "de": {
    "check": {
      "authority": "Befugnis",
      "audit": "Prüfpfad"
    },
    "heading": "ACP und ANP",
    "level": {
      "none": "Beides fehlt",
      "governed": "Befugnis und Audit",
      "partial": "Teilweise gesetzt"
    },
    "desc": "Die gemeinsame Grenze von Interoperabilitätsprotokollen ist Governance: Sie standardisieren, was sich womit verbinden kann, nicht wer was tun darf.",
    "note": "Ein Protokoll zu übernehmen liefert kein Berechtigungs- oder Auditdesign — das muss weiterhin separat gebaut werden."
  },
  "hi": {
    "check": {
      "authority": "अधिकार",
      "audit": "ऑडिट ट्रेल"
    },
    "heading": "ACP और ANP",
    "level": {
      "none": "दोनों नहीं",
      "governed": "अधिकार और ऑडिट",
      "partial": "आंशिक रूप से सेट"
    },
    "desc": "अंतर-संचालन प्रोटोकॉल की साझा सीमा शासन है: वे यह मानकीकृत करते हैं कि क्या किससे जुड़ सकता है, यह नहीं कि किसे क्या करने की अनुमति है।",
    "note": "प्रोटोकॉल अपनाने से न अनुमति का डिज़ाइन मिलता है, न ऑडिट का — वे दोनों अलग से बनाने पड़ते हैं।"
  },
  "id": {
    "check": {
      "authority": "Wewenang",
      "audit": "Jejak audit"
    },
    "heading": "ACP dan ANP",
    "level": {
      "none": "Keduanya belum",
      "governed": "Wewenang dan audit",
      "partial": "Sebagian diatur"
    },
    "desc": "Keterbatasan bersama protokol interoperabilitas adalah tata kelola: mereka membakukan apa yang bisa terhubung ke apa, bukan siapa yang boleh melakukan apa.",
    "note": "Mengadopsi protokol tidak memberi Anda rancangan izin maupun audit — keduanya tetap harus dibangun terpisah."
  },
  "it": {
    "check": {
      "authority": "Autorità",
      "audit": "Traccia di audit"
    },
    "heading": "ACP e ANP",
    "level": {
      "none": "Nessuno dei due",
      "governed": "Autorità e audit",
      "partial": "Impostato in parte"
    },
    "desc": "Il limite comune dei protocolli di interoperabilità è la governance: standardizzano che cosa può collegarsi a che cosa, non chi è autorizzato a fare che cosa.",
    "note": "Adottare un protocollo non ti dà la progettazione dei permessi né dell’audit — quelle restano da costruire a parte."
  },
  "pt-BR": {
    "check": {
      "authority": "Autoridade",
      "audit": "Trilha de auditoria"
    },
    "heading": "ACP e ANP",
    "level": {
      "none": "Nenhum definido",
      "governed": "Autoridade e auditoria",
      "partial": "Definido em parte"
    },
    "desc": "A limitação comum dos protocolos de interoperabilidade é a governança: padronizam o que pode se conectar a quê, não quem tem permissão para fazer o quê.",
    "note": "Adotar um protocolo não entrega desenho de permissões nem de auditoria — isso continua a ser construído à parte."
  }
} as const;
