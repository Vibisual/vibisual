/**
 * containment — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.containment` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Assumes the attack succeeds and asks what is still possible. Success comes not from the most aggressive filter but from a structurally limited radius when something does get through.",
    "heading": "Containment",
    "level": {
      "contained": "Contained",
      "partial": "Partly contained",
      "open": "Not contained"
    },
    "check": {
      "leak": "Leak path",
      "radius": "Blast radius",
      "isolation": "Isolation"
    },
    "possible": "possible",
    "broken": "broken",
    "isolated": "worktree",
    "shared": "shared tree",
    "note": "Ask “what is possible once it is through”, not “how do I block it”. If you cannot answer the first, the design is not finished."
  },
  "ko": {
    "desc": "공격이 성공했다고 가정하고 \"그래도 무엇까지 가능한가\"를 묻습니다. 안전한 쪽은 가장 공격적인 필터를 가진 곳이 아니라, 뚫려도 반경이 구조적으로 제한된 곳입니다.",
    "heading": "봉쇄",
    "level": {
      "contained": "봉쇄됨",
      "partial": "일부만 봉쇄",
      "open": "봉쇄되지 않음"
    },
    "check": {
      "leak": "유출 경로",
      "radius": "폭발 반경",
      "isolation": "격리"
    },
    "possible": "성립함",
    "broken": "끊김",
    "isolated": "worktree",
    "shared": "같은 트리",
    "note": "\"어떻게 막을까\"가 아니라 \"뚫렸을 때 무엇까지 가능한가\"를 먼저 물으십시오. 후자에 답할 수 없으면 아직 설계가 끝난 것이 아닙니다."
  },
  "ja": {
    "check": {
      "leak": "漏洩経路",
      "radius": "爆発半径",
      "isolation": "隔離"
    },
    "isolated": "worktree",
    "heading": "封じ込め",
    "level": {
      "contained": "封じ込め済み",
      "partial": "一部だけ封じ込め",
      "open": "封じ込め不足"
    },
    "possible": "成立する",
    "broken": "断たれている",
    "shared": "同じツリー",
    "desc": "攻撃が成功したと仮定して「それでも何ができるか」を問います。安全なのは最も攻撃的なフィルタを持つ側ではなく、破られても被害範囲が構造的に限られている側です。",
    "note": "「どう防ぐか」ではなく「破られたとき何ができるか」を先に問いましょう。後者に答えられなければ、設計はまだ終わっていません。"
  },
  "zh-CN": {
    "check": {
      "leak": "泄露路径",
      "radius": "爆炸半径",
      "isolation": "隔离"
    },
    "isolated": "worktree",
    "heading": "围堵",
    "level": {
      "contained": "已围堵",
      "partial": "部分围堵",
      "open": "未围堵"
    },
    "possible": "可能成立",
    "broken": "已断开",
    "shared": "共享工作树",
    "desc": "假设攻击已经成功，再问「那还能做什么」。安全的一方不是拥有最激进过滤器的一方，而是被突破后影响范围在结构上受限的一方。",
    "note": "先问「被突破后还能做什么」，而不是「怎么防住」。如果答不上前者，设计就还没做完。"
  },
  "es": {
    "check": {
      "leak": "Ruta de fuga",
      "radius": "Radio de explosión",
      "isolation": "Aislamiento"
    },
    "isolated": "worktree",
    "heading": "Contención",
    "level": {
      "contained": "Contenido",
      "partial": "Contenido en parte",
      "open": "No contenido"
    },
    "possible": "posible",
    "broken": "rota",
    "shared": "árbol compartido",
    "desc": "Da por hecho que el ataque tiene éxito y pregunta qué sigue siendo posible. Lo seguro no es tener el filtro más agresivo, sino que el radio quede estructuralmente limitado cuando algo se cuela.",
    "note": "Pregunta «qué es posible una vez dentro», no «cómo lo bloqueo». Si no sabes responder lo primero, el diseño no está terminado."
  },
  "es-419": {
    "check": {
      "leak": "Ruta de fuga",
      "radius": "Radio de explosión",
      "isolation": "Aislamiento"
    },
    "isolated": "worktree",
    "heading": "Contención",
    "level": {
      "contained": "Contenido",
      "partial": "Contenido en parte",
      "open": "No contenido"
    },
    "possible": "posible",
    "broken": "rota",
    "shared": "árbol compartido",
    "desc": "Da por hecho que el ataque tiene éxito y pregunta qué sigue siendo posible. Lo seguro no es tener el filtro más agresivo, sino que el radio quede estructuralmente limitado cuando algo se cuela.",
    "note": "Pregunta «qué es posible una vez dentro», no «cómo lo bloqueo». Si no sabes responder lo primero, el diseño no está terminado."
  },
  "fr": {
    "check": {
      "leak": "Chemin de fuite",
      "radius": "Rayon d’explosion",
      "isolation": "Isolation"
    },
    "isolated": "worktree",
    "heading": "Confinement",
    "level": {
      "contained": "Confiné",
      "partial": "Partiellement confiné",
      "open": "Non confiné"
    },
    "possible": "possible",
    "broken": "rompu",
    "shared": "arbre partagé",
    "desc": "Suppose que l’attaque réussit et demande ce qui reste possible. La sécurité ne vient pas du filtre le plus agressif, mais d’un rayon structurellement limité une fois la brèche ouverte.",
    "note": "Demandez « qu’est-ce qui est possible une fois passé », et non « comment bloquer ». Si vous ne savez pas répondre à la première, la conception n’est pas terminée."
  },
  "de": {
    "check": {
      "leak": "Abflusspfad",
      "radius": "Explosionsradius",
      "isolation": "Isolierung"
    },
    "isolated": "Worktree",
    "heading": "Eindämmung",
    "level": {
      "contained": "Eingedämmt",
      "partial": "Teilweise eingedämmt",
      "open": "Nicht eingedämmt"
    },
    "possible": "möglich",
    "broken": "unterbrochen",
    "shared": "gemeinsamer Baum",
    "desc": "Nimmt an, dass der Angriff gelingt, und fragt, was dann noch möglich ist. Sicher ist nicht, wer den aggressivsten Filter hat, sondern wo der Radius nach einem Durchbruch strukturell begrenzt bleibt.",
    "note": "Fragen Sie „was ist möglich, wenn es durch ist“, nicht „wie blocke ich es“. Wer das Erste nicht beantworten kann, hat den Entwurf nicht fertig."
  },
  "hi": {
    "check": {
      "leak": "रिसाव पथ",
      "radius": "ब्लास्ट रेडियस",
      "isolation": "पृथक्करण"
    },
    "isolated": "worktree",
    "heading": "नियंत्रण-सीमा",
    "level": {
      "contained": "नियंत्रित",
      "partial": "आंशिक रूप से नियंत्रित",
      "open": "नियंत्रित नहीं"
    },
    "possible": "संभव",
    "broken": "टूटा",
    "shared": "साझा ट्री",
    "desc": "हमला सफल मान लेता है और फिर पूछता है कि अब भी क्या संभव है। सुरक्षित वह नहीं जिसके फ़िल्टर सबसे कड़े हैं, बल्कि वह जगह है जहाँ कुछ फिसलने पर दायरा ढाँचे से ही सीमित रहता है।",
    "note": "«कैसे रोकें» नहीं, «भेदने के बाद क्या संभव है» पूछिए। पहला सवाल अनुत्तरित हो तो डिज़ाइन अभी अधूरा है।"
  },
  "id": {
    "check": {
      "leak": "Jalur kebocoran",
      "radius": "Radius ledak",
      "isolation": "Isolasi"
    },
    "isolated": "worktree",
    "heading": "Pembatasan",
    "level": {
      "contained": "Terbatasi",
      "partial": "Sebagian terbatasi",
      "open": "Tidak terbatasi"
    },
    "possible": "mungkin",
    "broken": "putus",
    "shared": "tree bersama",
    "desc": "Menganggap serangan berhasil lalu bertanya apa yang masih mungkin. Yang aman bukan pemilik filter paling agresif, melainkan tempat yang radiusnya terbatas secara struktural ketika ada yang lolos.",
    "note": "Tanyakan «apa yang mungkin setelah tembus», bukan «bagaimana memblokirnya». Kalau yang pertama tak terjawab, rancangannya belum selesai."
  },
  "it": {
    "check": {
      "leak": "Percorso di fuga",
      "radius": "Raggio d’esplosione",
      "isolation": "Isolamento"
    },
    "isolated": "worktree",
    "heading": "Contenimento",
    "level": {
      "contained": "Contenuto",
      "partial": "Contenuto in parte",
      "open": "Non contenuto"
    },
    "possible": "possibile",
    "broken": "interrotto",
    "shared": "albero condiviso",
    "desc": "Dà per scontato che l’attacco riesca e chiede che cosa resti possibile. Sicuro non è chi ha il filtro più aggressivo, ma dove il raggio resta strutturalmente limitato quando qualcosa passa.",
    "note": "Chiediti «che cosa è possibile una volta dentro», non «come lo blocco». Se non sai rispondere alla prima, il progetto non è finito."
  },
  "pt-BR": {
    "check": {
      "leak": "Caminho de vazamento",
      "radius": "Raio de explosão",
      "isolation": "Isolamento"
    },
    "isolated": "worktree",
    "heading": "Contenção",
    "level": {
      "contained": "Contido",
      "partial": "Contido em parte",
      "open": "Não contido"
    },
    "possible": "possível",
    "broken": "rompido",
    "shared": "árvore compartilhada",
    "desc": "Parte do princípio de que o ataque teve êxito e pergunta o que ainda é possível. Seguro não é quem tem o filtro mais agressivo, e sim onde o raio fica estruturalmente limitado quando algo passa.",
    "note": "Pergunte «o que é possível depois de passar», não «como eu bloqueio». Se você não sabe responder à primeira, o projeto não está pronto."
  }
} as const;
