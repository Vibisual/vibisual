/**
 * fan-out — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.fanOut` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts how many branches run at once. Parallelism pays only when the subtasks are genuinely independent; otherwise it produces duplicated work and contradictory conclusions.",
    "heading": "Fan-out",
    "level": {
      "none": "No branches",
      "parallel": "Running in parallel",
      "wide": "Wide fan-out"
    },
    "check": {
      "branches": "Branches",
      "oldest": "Oldest branch"
    },
    "note": "Decide how results will be merged before splitting. Without a merge rule the integration step becomes the bottleneck.",
    "noteWide": "Many branches at once. Ask whether these are truly independent — if they need each other’s results, sequencing is cheaper."
  },
  "ko": {
    "desc": "지금 몇 갈래가 동시에 도는지 셉니다. 병렬은 하위 작업이 진짜로 독립일 때만 이득이고, 아니면 중복 작업과 모순된 결론만 남습니다.",
    "heading": "부채꼴 분기",
    "level": {
      "none": "분기 없음",
      "parallel": "병렬 진행",
      "wide": "넓게 벌어짐"
    },
    "check": {
      "branches": "갈래 수",
      "oldest": "가장 오래된 갈래"
    },
    "note": "쪼개기 전에 합칠 규칙을 먼저 정하십시오. 병합 규칙이 없으면 통합 단계가 병목이 됩니다.",
    "noteWide": "갈래가 많습니다. 정말 서로 독립인지 확인하십시오 — 서로의 결과가 필요하면 순차가 더 쌉니다."
  },
  "ja": {
    "heading": "ファンアウト",
    "check": {
      "branches": "分岐数",
      "oldest": "最古の分岐"
    },
    "level": {
      "none": "分岐なし",
      "parallel": "並行実行中",
      "wide": "広く分岐"
    },
    "desc": "いま何本が同時に走っているかを数えます。並列は下位作業が本当に独立なときだけ得で、そうでなければ重複作業と矛盾した結論だけが残ります。",
    "note": "分ける前に合流のルールを決めてください。併合規則がないと統合の段階がボトルネックになります。",
    "noteWide": "分岐が多い状態です。本当に互いに独立かを確認してください — 互いの結果が必要なら、順番に回す方が安く済みます。"
  },
  "zh-CN": {
    "heading": "扇出并行",
    "check": {
      "branches": "分支数",
      "oldest": "最早分支"
    },
    "level": {
      "none": "无分支",
      "parallel": "并行运行",
      "wide": "扇出较宽"
    },
    "desc": "统计同时有多少条分支在跑。并行只有在子任务真正独立时才划算，否则只会产生重复劳动与互相矛盾的结论。",
    "note": "拆分之前先定好如何合并。没有合并规则，整合环节就会变成瓶颈。",
    "noteWide": "分支很多。请确认它们是否真的彼此独立 — 如果彼此需要对方的结果，顺序执行反而更省。"
  },
  "es": {
    "heading": "Ramificación",
    "check": {
      "branches": "Ramas",
      "oldest": "Rama más antigua"
    },
    "level": {
      "none": "Sin ramas",
      "parallel": "Ejecutando en paralelo",
      "wide": "Ramificación amplia"
    },
    "desc": "Cuenta cuántas ramas corren a la vez. El paralelismo solo rinde si las subtareas son de verdad independientes; si no, produce trabajo duplicado y conclusiones contradictorias.",
    "note": "Decide cómo se fusionará antes de dividir. Sin regla de fusión, la integración se convierte en el cuello de botella.",
    "noteWide": "Muchas ramas a la vez. Comprueba si son realmente independientes — si se necesitan entre sí, ir en secuencia sale más barato."
  },
  "es-419": {
    "heading": "Ramificación",
    "check": {
      "branches": "Ramas",
      "oldest": "Rama más antigua"
    },
    "level": {
      "none": "Sin ramas",
      "parallel": "Ejecutando en paralelo",
      "wide": "Ramificación amplia"
    },
    "desc": "Cuenta cuántas ramas corren a la vez. El paralelismo solo rinde si las subtareas son de verdad independientes; si no, produce trabajo duplicado y conclusiones contradictorias.",
    "note": "Decide cómo se fusionará antes de dividir. Sin regla de fusión, la integración se convierte en el cuello de botella.",
    "noteWide": "Muchas ramas a la vez. Comprueba si son realmente independientes — si se necesitan entre sí, ir en secuencia sale más barato."
  },
  "fr": {
    "heading": "Éventail",
    "check": {
      "branches": "Branches",
      "oldest": "Branche la plus ancienne"
    },
    "level": {
      "none": "Aucune branche",
      "parallel": "Exécution en parallèle",
      "wide": "Éventail large"
    },
    "desc": "Compte combien de branches tournent simultanément. Le parallélisme ne paie que si les sous-tâches sont réellement indépendantes ; sinon il produit du travail en double et des conclusions contradictoires.",
    "note": "Décidez de la façon de fusionner avant de découper. Sans règle de fusion, l’intégration devient le goulot.",
    "noteWide": "Beaucoup de branches à la fois. Vérifiez qu’elles sont vraiment indépendantes — si elles ont besoin l’une de l’autre, le séquentiel revient moins cher."
  },
  "de": {
    "heading": "Fan-out",
    "check": {
      "branches": "Zweige",
      "oldest": "Ältester Zweig"
    },
    "level": {
      "none": "Keine Zweige",
      "parallel": "Läuft parallel",
      "wide": "Breiter Fan-out"
    },
    "desc": "Zählt, wie viele Zweige gleichzeitig laufen. Parallelität lohnt nur, wenn die Teilaufgaben wirklich unabhängig sind; sonst entstehen doppelte Arbeit und widersprüchliche Schlüsse.",
    "note": "Legen Sie vor dem Aufteilen fest, wie zusammengeführt wird. Ohne Merge-Regel wird die Integration zum Engpass.",
    "noteWide": "Viele Zweige auf einmal. Prüfen Sie, ob sie wirklich unabhängig sind — brauchen sie einander, ist Nacheinander günstiger."
  },
  "hi": {
    "heading": "फैन-आउट",
    "check": {
      "branches": "शाखाएँ",
      "oldest": "सबसे पुरानी शाखा"
    },
    "level": {
      "none": "कोई शाखा नहीं",
      "parallel": "समानांतर चल रहा",
      "wide": "व्यापक फैन-आउट"
    },
    "desc": "गिनता है कि कितनी शाखाएँ एक साथ चल रही हैं। समांतरता तभी फ़ायदा देती है जब उप-काम सचमुच स्वतंत्र हों; वरना वह दोहरा काम और आपस में टकराते निष्कर्ष पैदा करती है।",
    "note": "बाँटने से पहले तय कीजिए कि जोड़ेंगे कैसे। जोड़ने का नियम न हो तो एकीकरण ही अड़चन बन जाता है।",
    "noteWide": "एक साथ बहुत सी शाखाएँ। देखिए कि वे सचमुच स्वतंत्र हैं या नहीं — यदि एक-दूसरे का नतीजा चाहिए तो क्रम में चलाना ही सस्ता है।"
  },
  "id": {
    "heading": "Fan-out",
    "check": {
      "branches": "Cabang",
      "oldest": "Cabang tertua"
    },
    "level": {
      "none": "Tanpa cabang",
      "parallel": "Berjalan paralel",
      "wide": "Fan-out lebar"
    },
    "desc": "Menghitung berapa cabang berjalan bersamaan. Paralelisme hanya menguntungkan bila subtugasnya benar-benar mandiri; bila tidak, ia menghasilkan pekerjaan ganda dan kesimpulan yang bertentangan.",
    "note": "Putuskan cara penggabungannya sebelum membelah. Tanpa aturan penggabungan, integrasi menjadi sumbatannya.",
    "noteWide": "Banyak cabang sekaligus. Periksa apakah benar-benar mandiri — kalau saling membutuhkan hasil, berurutan justru lebih murah."
  },
  "it": {
    "heading": "Fan-out",
    "check": {
      "branches": "Rami",
      "oldest": "Ramo più vecchio"
    },
    "level": {
      "none": "Nessun ramo",
      "parallel": "In esecuzione parallela",
      "wide": "Fan-out ampio"
    },
    "desc": "Conta quanti rami girano insieme. Il parallelismo rende solo se i sotto-compiti sono davvero indipendenti; altrimenti produce lavoro doppio e conclusioni contraddittorie.",
    "note": "Decidi come si unirà prima di dividere. Senza regola di unione, l’integrazione diventa il collo di bottiglia.",
    "noteWide": "Molti rami insieme. Verifica se sono davvero indipendenti — se hanno bisogno l’uno dell’altro, procedere in sequenza costa meno."
  },
  "pt-BR": {
    "heading": "Ramificação",
    "check": {
      "branches": "Ramificações",
      "oldest": "Ramificação mais antiga"
    },
    "level": {
      "none": "Sem ramificações",
      "parallel": "Executando em paralelo",
      "wide": "Ramificação ampla"
    },
    "desc": "Conta quantos ramos correm ao mesmo tempo. Paralelismo só compensa quando as subtarefas são de fato independentes; caso contrário, gera trabalho duplicado e conclusões contraditórias.",
    "note": "Decida como será a junção antes de dividir. Sem regra de junção, a integração vira o gargalo.",
    "noteWide": "Muitos ramos de uma vez. Verifique se são mesmo independentes — se precisam uns dos outros, sequencial sai mais barato."
  }
} as const;
