/**
 * allowlist — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.allowlist` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows how close this agent is to “only these are allowed”. A blocklist leaks through whatever you forgot; an allowlist fails toward safety as time passes.",
    "heading": "Allowlist",
    "level": {
      "narrow": "Narrow",
      "partial": "Partial",
      "all": "Everything granted"
    },
    "check": {
      "granted": "Granted",
      "denied": "Explicitly blocked",
      "missing": "Not granted"
    },
    "note": "The highest-value place to apply an allowlist is network destinations — that alone narrows the last leg of a leak."
  },
  "ko": {
    "desc": "이 에이전트의 도구 정책이 \"이것만 된다\"에 얼마나 가까운지 보여줍니다. 차단 목록은 빠뜨린 것이 곧 구멍이지만, 허용 목록은 시간이 지나도 안전 쪽으로 실패합니다.",
    "heading": "허용 목록",
    "level": {
      "narrow": "좁음",
      "partial": "일부만",
      "all": "전부 부여됨"
    },
    "check": {
      "granted": "부여된 도구",
      "denied": "명시적으로 차단",
      "missing": "주지 않은 도구"
    },
    "note": "허용 목록이 가장 크게 먹히는 곳은 네트워크 목적지입니다 — 그것만으로 유출의 마지막 다리가 좁아집니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "narrow": "狭い",
      "all": "すべて付与"
    },
    "check": {
      "denied": "明示的に禁止",
      "granted": "付与済み",
      "missing": "未付与"
    },
    "heading": "許可リスト",
    "desc": "このエージェントの道具方針が「これだけ許す」にどれだけ近いかを示します。禁止リストは書き漏らしがそのまま穴になりますが、許可リストは時間が経っても安全側に倒れます。",
    "note": "許可リストが最も効くのはネットワークの宛先です — それだけで漏洩の最後の一本が細くなります。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "narrow": "较窄",
      "all": "全部授予"
    },
    "check": {
      "denied": "已明确禁用",
      "granted": "已授予",
      "missing": "未授予"
    },
    "heading": "允许列表",
    "desc": "显示该智能体的工具策略离「只允许这些」有多近。禁用清单漏掉的就是缺口，而允许清单随时间推移会朝安全一侧失败。",
    "note": "允许清单最有价值的落点是网络目的地 — 仅此一项就能收窄泄露的最后一环。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "narrow": "Estrecho",
      "all": "Todo concedido"
    },
    "check": {
      "denied": "Bloqueadas explícitamente",
      "granted": "Concedidas",
      "missing": "No concedidas"
    },
    "heading": "Lista de permitidos",
    "desc": "Muestra cuánto se acerca este agente a «solo esto está permitido». Una lista de bloqueo deja pasar lo que olvidaste; una lista de permitidos falla hacia el lado seguro con el tiempo.",
    "note": "Donde más rinde una lista de permitidos es en los destinos de red — solo eso ya estrecha la última etapa de una fuga."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "narrow": "Estrecho",
      "all": "Todo concedido"
    },
    "check": {
      "denied": "Bloqueadas explícitamente",
      "granted": "Concedidas",
      "missing": "No concedidas"
    },
    "heading": "Lista de permitidos",
    "desc": "Muestra cuánto se acerca este agente a «solo esto está permitido». Una lista de bloqueo deja pasar lo que olvidaste; una lista de permitidos falla hacia el lado seguro con el tiempo.",
    "note": "Donde más rinde una lista de permitidos es en los destinos de red — solo eso ya estrecha la última etapa de una fuga."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "narrow": "Étroit",
      "all": "Tout accordé"
    },
    "check": {
      "denied": "Bloqués explicitement",
      "granted": "Accordés",
      "missing": "Non accordés"
    },
    "heading": "Liste d’autorisation",
    "desc": "Montre à quel point cet agent se rapproche de « seuls ceux-ci sont autorisés ». Une liste de blocage laisse passer ce qu’on a oublié ; une liste d’autorisation échoue du côté sûr avec le temps.",
    "note": "L’endroit où une liste d’autorisation rapporte le plus, ce sont les destinations réseau — cela seul rétrécit la dernière étape d’une fuite."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "narrow": "Eng",
      "all": "Alles gewährt"
    },
    "check": {
      "denied": "Ausdrücklich gesperrt",
      "granted": "Gewährt",
      "missing": "Nicht gewährt"
    },
    "heading": "Zulassungsliste",
    "desc": "Zeigt, wie nah dieser Agent an „nur das ist erlaubt“ liegt. Eine Sperrliste hat genau dort ein Loch, wo etwas vergessen wurde; eine Zulassungsliste fällt mit der Zeit zur sicheren Seite aus.",
    "note": "Am meisten bringt eine Zulassungsliste bei Netzwerkzielen — allein das verengt die letzte Etappe eines Abflusses."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "narrow": "संकीर्ण",
      "all": "सब कुछ दिया"
    },
    "check": {
      "denied": "स्पष्ट रूप से अवरुद्ध",
      "granted": "दिए गए",
      "missing": "नहीं दिए"
    },
    "heading": "अनुमति सूची",
    "desc": "दिखाता है कि यह एजेंट «सिर्फ़ यही चलेगा» के कितने पास है। रोक-सूची उसी से रिसती है जो भूल गया, जबकि अनुमति-सूची समय के साथ सुरक्षित दिशा में गिरती है।",
    "note": "अनुमति-सूची सबसे अच्छा काम नेटवर्क गंतव्यों पर करती है — अकेले वही रिसाव के आख़िरी चरण को सीमित कर देती है।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "narrow": "Sempit",
      "all": "Semua diberikan"
    },
    "check": {
      "denied": "Diblokir eksplisit",
      "granted": "Diberikan",
      "missing": "Tidak diberikan"
    },
    "heading": "Daftar izin",
    "desc": "Menunjukkan seberapa dekat agen ini dengan «hanya ini yang diizinkan». Daftar blokir bocor justru lewat yang terlupa; daftar izin seiring waktu gagal ke sisi aman.",
    "note": "Tempat daftar izin paling berhasil adalah tujuan jaringan — itu saja sudah mempersempit tahap terakhir sebuah kebocoran."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "narrow": "Stretto",
      "all": "Tutto concesso"
    },
    "check": {
      "denied": "Bloccati esplicitamente",
      "granted": "Concessi",
      "missing": "Non concessi"
    },
    "heading": "Lista consentiti",
    "desc": "Mostra quanto questo agente si avvicina a «solo questi sono ammessi». Una lista di blocco lascia passare proprio ciò che hai dimenticato; una lista di permessi col tempo fallisce dal lato sicuro.",
    "note": "Dove una lista di permessi rende di più è nelle destinazioni di rete — solo questo restringe l’ultimo tratto di una fuga."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "narrow": "Estreito",
      "all": "Tudo concedido"
    },
    "check": {
      "denied": "Bloqueadas explicitamente",
      "granted": "Concedidas",
      "missing": "Não concedidas"
    },
    "heading": "Lista de permissões",
    "desc": "Mostra o quanto este agente se aproxima de «só isto é permitido». Uma lista de bloqueio vaza justamente pelo que você esqueceu; uma lista de permissões falha para o lado seguro com o tempo.",
    "note": "Onde uma lista de permissões mais rende é nos destinos de rede — só isso já estreita a última etapa de um vazamento."
  }
} as const;
