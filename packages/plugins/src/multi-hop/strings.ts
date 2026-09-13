/**
 * multi-hop — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.multiHop` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Work that one pass cannot finish comes back a second and a third time. This counts the longest run of repeats, because that is the work worth writing down.",
    "heading": "Multi-hop Retrieval",
    "level": {
      "none": "Nothing repeated",
      "single": "Seen once",
      "multi": "Keeps coming back"
    },
    "check": {
      "hops": "Longest repeat run",
      "total": "All repeats"
    },
    "note": "Coming back is a sign the job was never one step — usually a good sign, not a wasted pass."
  },
  "ko": {
    "desc": "한 번에 끝나지 않는 일은 두 번, 세 번 되돌아옵니다. 여기서는 가장 길게 되풀이된 횟수를 셉니다 — 그게 적어 둘 값어치가 있는 일이기 때문입니다.",
    "heading": "다단 검색",
    "level": {
      "none": "되풀이 없음",
      "single": "한 번뿐",
      "multi": "계속 되돌아옴"
    },
    "check": {
      "hops": "최다 되풀이",
      "total": "되풀이 총합"
    },
    "note": "되돌아왔다는 것은 그 일이 애초에 한 단계가 아니었다는 신호입니다 — 대개 낭비가 아니라 좋은 징후입니다."
  },
  "ja": {
    "level": {
      "none": "検索なし",
      "multi": "多段",
      "single": "一段のみ"
    },
    "check": {
      "hops": "エージェント検索",
      "total": "注入すべて"
    },
    "heading": "多段検索",
    "desc": "一度の検索で答えが出ない問いは、見つけたものを根拠にもう一度尋ねて初めて解けます。ここではエージェントが何度探し直したかを数えます。",
    "note": "探し直したということは、根拠が足りないと自分で気づいたという合図です — 大抵はむだではなく良い兆候です。"
  },
  "zh-CN": {
    "level": {
      "none": "无检索",
      "multi": "多跳",
      "single": "仅一跳"
    },
    "check": {
      "hops": "智能体检索",
      "total": "全部注入"
    },
    "heading": "多跳检索",
    "desc": "一次检索答不上来的问题，需要以第一次找到的内容为依据再问一次。这里统计智能体回头再找了多少次。",
    "note": "回头再找说明智能体自己意识到依据不足 — 这通常是好迹象，而不是浪费的一步。"
  },
  "es": {
    "level": {
      "none": "Sin búsquedas",
      "multi": "Varios saltos",
      "single": "Un solo salto"
    },
    "check": {
      "hops": "Búsquedas del agente",
      "total": "Todas las inyecciones"
    },
    "heading": "Recuperación en varios pasos",
    "desc": "Las preguntas que una sola búsqueda no responde necesitan una segunda consulta construida sobre lo que encontró la primera. Aquí se cuenta cuántas veces el agente volvió.",
    "note": "Volver es señal de que el agente notó que su evidencia estaba incompleta — normalmente buena señal, no un paso desperdiciado."
  },
  "es-419": {
    "level": {
      "none": "Sin búsquedas",
      "multi": "Varios saltos",
      "single": "Un solo salto"
    },
    "check": {
      "hops": "Búsquedas del agente",
      "total": "Todas las inyecciones"
    },
    "heading": "Recuperación en varios pasos",
    "desc": "Las preguntas que una sola búsqueda no responde necesitan una segunda consulta construida sobre lo que encontró la primera. Aquí se cuenta cuántas veces el agente volvió.",
    "note": "Volver es señal de que el agente notó que su evidencia estaba incompleta — normalmente buena señal, no un paso desperdiciado."
  },
  "fr": {
    "level": {
      "none": "Aucune recherche",
      "multi": "Plusieurs sauts",
      "single": "Un seul saut"
    },
    "check": {
      "hops": "Recherches de l’agent",
      "total": "Toutes les injections"
    },
    "heading": "Recherche multi-étapes",
    "desc": "Les questions auxquelles une seule recherche ne répond pas exigent une deuxième requête bâtie sur ce que la première a trouvé. On compte ici combien de fois l’agent y est retourné.",
    "note": "Y retourner signale que l’agent a remarqué que ses preuves étaient incomplètes — d’ordinaire bon signe, non une étape perdue."
  },
  "de": {
    "level": {
      "none": "Keine Suchen",
      "multi": "Mehrere Sprünge",
      "single": "Ein Sprung"
    },
    "check": {
      "hops": "Agentensuchen",
      "total": "Alle Injektionen"
    },
    "heading": "Mehrstufige Suche",
    "desc": "Fragen, die eine Suche nicht beantwortet, brauchen eine zweite Anfrage, die auf dem Gefundenen aufbaut. Hier wird gezählt, wie oft der Agent zurückgegangen ist.",
    "note": "Zurückzugehen ist ein Zeichen, dass der Agent bemerkt hat, dass seine Belege unvollständig waren — meist ein gutes Zeichen, kein verschwendeter Schritt."
  },
  "hi": {
    "level": {
      "none": "कोई खोज नहीं",
      "multi": "कई चरण",
      "single": "एक ही चरण"
    },
    "check": {
      "hops": "एजेंट खोज",
      "total": "सभी इंजेक्शन"
    },
    "heading": "बहु-चरण पुनर्प्राप्ति",
    "desc": "जिस सवाल का उत्तर एक खोज से न मिले, उसे दूसरी कुंजी चाहिए जो पहली की खोज पर टिकी हो। यहाँ गिना जाता है कि एजेंट कितनी बार दोबारा खोजने गया।",
    "note": "दोबारा खोजना इस बात का संकेत है कि एजेंट ने पहचाना कि प्रमाण अधूरा है — यह आम तौर पर अच्छा लक्षण है, बर्बाद कदम नहीं।"
  },
  "id": {
    "level": {
      "none": "Tanpa pencarian",
      "multi": "Beberapa lompatan",
      "single": "Satu lompatan"
    },
    "check": {
      "hops": "Pencarian agen",
      "total": "Semua injeksi"
    },
    "heading": "Pengambilan multi-langkah",
    "desc": "Pertanyaan yang tak terjawab oleh satu pencarian butuh kueri kedua yang dibangun di atas temuan pertama. Di sini dihitung berapa kali agen kembali mencari.",
    "note": "Kembali mencari adalah tanda agen menyadari buktinya belum lengkap — biasanya pertanda baik, bukan langkah yang terbuang."
  },
  "it": {
    "level": {
      "none": "Nessuna ricerca",
      "multi": "Più salti",
      "single": "Un solo salto"
    },
    "check": {
      "hops": "Ricerche dell’agente",
      "total": "Tutte le iniezioni"
    },
    "heading": "Recupero multi-passo",
    "desc": "Le domande a cui una sola ricerca non risponde richiedono una seconda interrogazione costruita su ciò che la prima ha trovato. Qui si conta quante volte l’agente è tornato indietro.",
    "note": "Tornare indietro è segno che l’agente ha notato che le sue prove erano incomplete — di solito un buon segno, non un passo sprecato."
  },
  "pt-BR": {
    "level": {
      "none": "Sem buscas",
      "multi": "Vários saltos",
      "single": "Um único salto"
    },
    "check": {
      "hops": "Buscas do agente",
      "total": "Todas as injeções"
    },
    "heading": "Recuperação em várias etapas",
    "desc": "Perguntas que uma busca só não responde precisam de uma segunda consulta construída sobre o que a primeira encontrou. Aqui se conta quantas vezes o agente voltou.",
    "note": "Voltar é sinal de que o agente percebeu que suas evidências estavam incompletas — em geral bom sinal, não um passo desperdiçado."
  }
} as const;
