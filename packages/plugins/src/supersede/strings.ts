/**
 * supersede — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.supersede` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows active procedures separately from stopped or replaced procedures. Their files and reasons remain available.",
    "heading": "Supersede",
    "level": {
      "none": "Not enabled",
      "flat": "No stopped procedures",
      "history": "Stopped procedures retained"
    },
    "check": {
      "stored": "Stored patterns",
      "current": "Reviewed and active",
      "closed": "Stopped or replaced"
    },
    "note": "Stopped or replaced procedures remain as history and do not guide execution."
  },
  "ko": {
    "desc": "?? ?? ??? ?????? ??? ?????. ?? ??? ??? ?? ????.",
    "heading": "대체",
    "level": {
      "none": "?? ?? ??",
      "flat": "??? ?? ??",
      "history": "?? ?? ???"
    },
    "check": {
      "stored": "??? ??",
      "current": "?? ????? ?",
      "closed": "?? ??????"
    },
    "note": "????? ??? ??? ???? ?? ?? ???? ???? ????."
  },
  "ja": {
    "desc": "?????????????????????????????????????????????",
    "heading": "置き換え",
    "level": {
      "none": "???",
      "flat": "????????",
      "history": "?????????"
    },
    "check": {
      "stored": "?????????",
      "current": "??????????",
      "closed": "?????????"
    },
    "note": "??????????????????????????????????"
  },
  "zh-CN": {
    "desc": "????????????????????????????????",
    "heading": "取代",
    "level": {
      "none": "???",
      "flat": "???????",
      "history": "????????"
    },
    "check": {
      "stored": "????",
      "current": "???????",
      "closed": "??????"
    },
    "note": "??????????????????????????"
  },
  "es": {
    "desc": "Distingue los procedimientos activos de los detenidos o sustituidos. Sus ficheros y motivos siguen disponibles.",
    "heading": "Sustitución",
    "level": {
      "none": "No activado",
      "flat": "Sin procedimientos detenidos",
      "history": "Procedimientos detenidos conservados"
    },
    "check": {
      "stored": "Patrones guardados",
      "current": "Revisados y en uso",
      "closed": "Detenidos o sustituidos"
    },
    "note": "Los procedimientos detenidos o sustituidos se conservan como historial y no gu?an la ejecuci?n."
  },
  "es-419": {
    "desc": "Distingue los procedimientos activos de los detenidos o reemplazados. Sus archivos y motivos siguen disponibles.",
    "heading": "Sustitución",
    "level": {
      "none": "No activado",
      "flat": "Sin procedimientos detenidos",
      "history": "Procedimientos detenidos conservados"
    },
    "check": {
      "stored": "Patrones guardados",
      "current": "Revisados y en uso",
      "closed": "Detenidos o reemplazados"
    },
    "note": "Los procedimientos detenidos o reemplazados se conservan como historial y no gu?an la ejecuci?n."
  },
  "fr": {
    "desc": "Distingue les proc?dures actives de celles arr?t?es ou remplac?es. Leurs fichiers et motifs restent disponibles.",
    "heading": "Remplacement",
    "level": {
      "none": "Non activ?",
      "flat": "Aucune proc?dure arr?t?e",
      "history": "Proc?dures arr?t?es conserv?es"
    },
    "check": {
      "stored": "Sch?mas stock?s",
      "current": "Examin?es et actives",
      "closed": "Arr?t?es ou remplac?es"
    },
    "note": "Les proc?dures arr?t?es ou remplac?es restent dans l?historique et ne guident pas l?ex?cution."
  },
  "de": {
    "desc": "Zeigt aktive Abl?ufe getrennt von gestoppten oder ersetzten Abl?ufen. Dateien und Gr?nde bleiben erhalten.",
    "heading": "Ablösung",
    "level": {
      "none": "Nicht aktiviert",
      "flat": "Keine gestoppten Abl?ufe",
      "history": "Gestoppte Abl?ufe erhalten"
    },
    "check": {
      "stored": "Gespeicherte Muster",
      "current": "Gepr?ft und aktiv",
      "closed": "Gestoppt oder ersetzt"
    },
    "note": "Gestoppte oder ersetzte Abl?ufe bleiben im Verlauf und leiten keine Ausf?hrung an."
  },
  "hi": {
    "desc": "?????? ??????????? ?? ??? ?? ???? ?? ??????????? ?? ??? ?????? ??? ???? ??????? ?? ???? ?????? ???? ????",
    "heading": "प्रतिस्थापन",
    "level": {
      "none": "?????? ????",
      "flat": "??? ??? ????????? ????",
      "history": "??? ??????????? ????????"
    },
    "check": {
      "stored": "???????? ??????",
      "current": "???????? ?? ??????",
      "closed": "??? ?? ???? ??"
    },
    "note": "??? ?? ???? ?? ??????????? ?????? ??? ???? ??? ?? ??? ?? ?????????? ???? ??????"
  },
  "id": {
    "desc": "Memisahkan prosedur aktif dari yang dihentikan atau digantikan. Berkas dan alasannya tetap tersedia.",
    "heading": "Penggantian",
    "level": {
      "none": "Belum aktif",
      "flat": "Tidak ada prosedur dihentikan",
      "history": "Prosedur dihentikan tetap tersimpan"
    },
    "check": {
      "stored": "Pola tersimpan",
      "current": "Ditinjau dan aktif",
      "closed": "Dihentikan atau digantikan"
    },
    "note": "Prosedur yang dihentikan atau digantikan tetap menjadi riwayat dan tidak memandu eksekusi."
  },
  "it": {
    "desc": "Distingue le procedure attive da quelle interrotte o sostituite. File e motivazioni restano disponibili.",
    "heading": "Sostituzione",
    "level": {
      "none": "Non attivato",
      "flat": "Nessuna procedura interrotta",
      "history": "Procedure interrotte conservate"
    },
    "check": {
      "stored": "Schemi memorizzati",
      "current": "Verificate e attive",
      "closed": "Interrotte o sostituite"
    },
    "note": "Le procedure interrotte o sostituite restano nello storico e non guidano l?esecuzione."
  },
  "pt-BR": {
    "desc": "Distingue procedimentos ativos dos interrompidos ou substitu?dos. Seus arquivos e motivos continuam dispon?veis.",
    "heading": "Substituição",
    "level": {
      "none": "N?o ativado",
      "flat": "Nenhum procedimento interrompido",
      "history": "Procedimentos interrompidos mantidos"
    },
    "check": {
      "stored": "Padr?es armazenados",
      "current": "Revisados e ativos",
      "closed": "Interrompidos ou substitu?dos"
    },
    "note": "Procedimentos interrompidos ou substitu?dos permanecem no hist?rico e n?o orientam a execu??o."
  }
} as const;
