/**
 * memory-drift — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.memoryDrift` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Repeatedly rewriting a memory polishes it away from the original until invented detail hardens into fact. The defence is to keep entries immutable.",
    "heading": "Memory Drift",
    "level": {
      "none": "No memory yet",
      "immutable": "Immutable entries",
      "queued": "Waiting on judgement"
    },
    "check": {
      "rewrite": "Rewrite path",
      "review": "Awaiting judgement",
      "unseen": "Unseen"
    },
    "noRewritePath": "none by design",
    "note": "Updates are a new entry plus closing the old one. There is no path where the model rewrites an existing body."
  },
  "ko": {
    "desc": "기억을 반복해 다시 쓰면 매번 조금씩 다듬어지다 원본에 없던 내용이 사실로 굳습니다. 가장 확실한 방어는 항목을 불변으로 두는 것입니다.",
    "heading": "기억 표류",
    "level": {
      "none": "아직 기억 없음",
      "immutable": "불변 저장",
      "queued": "판단 대기 있음"
    },
    "check": {
      "rewrite": "재작성 경로",
      "review": "판단 대기",
      "unseen": "미확인"
    },
    "noRewritePath": "설계상 없음",
    "note": "갱신은 새 항목 추가 + 옛 항목 닫기로 처리합니다. 모델이 기존 본문을 다시 쓰는 경로 자체를 만들지 않았습니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "immutable": "不変の項目",
      "queued": "判断待ち"
    },
    "check": {
      "review": "判断待ち",
      "rewrite": "再作成の経路",
      "unseen": "未確認"
    },
    "heading": "記憶の漂流",
    "noRewritePath": "設計上ない",
    "desc": "記憶を繰り返し書き直すと、そのたび少しずつ整えられて原本から離れ、元になかった内容が事実として固まります。最も確実な防御は項目を不変に保つことです。",
    "note": "更新は新しい項目の追加＋古い項目を閉じる、で処理します。モデルが既存の本文を書き直す経路そのものを作っていません。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "immutable": "不可变条目",
      "queued": "等待判断"
    },
    "check": {
      "review": "等待判断",
      "rewrite": "重写路径",
      "unseen": "未查看"
    },
    "heading": "记忆漂移",
    "noRewritePath": "设计上不存在",
    "desc": "反复重写记忆会让它每次被打磨得离原文更远，最终把原本不存在的内容固化成事实。最可靠的防御是让条目保持不可变。",
    "note": "更新的方式是新增条目 + 关闭旧条目。我们根本没有让模型重写既有正文的路径。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "immutable": "Entradas inmutables",
      "queued": "A la espera de juicio"
    },
    "check": {
      "review": "Esperando juicio",
      "rewrite": "Vía de reescritura",
      "unseen": "Sin ver"
    },
    "heading": "Deriva de memoria",
    "noRewritePath": "inexistente por diseño",
    "desc": "Reescribir una y otra vez una memoria la va puliendo lejos del original hasta que un detalle inventado se endurece en hecho. La defensa es mantener las entradas inmutables.",
    "note": "Actualizar es añadir una entrada nueva y cerrar la vieja. No existe ninguna vía por la que el modelo reescriba un cuerpo existente."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "immutable": "Entradas inmutables",
      "queued": "A la espera de juicio"
    },
    "check": {
      "review": "Esperando juicio",
      "rewrite": "Vía de reescritura",
      "unseen": "Sin ver"
    },
    "heading": "Deriva de memoria",
    "noRewritePath": "inexistente por diseño",
    "desc": "Reescribir una y otra vez una memoria la va puliendo lejos del original hasta que un detalle inventado se endurece en hecho. La defensa es mantener las entradas inmutables.",
    "note": "Actualizar es añadir una entrada nueva y cerrar la vieja. No existe ninguna vía por la que el modelo reescriba un cuerpo existente."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "immutable": "Entrées immuables",
      "queued": "En attente de jugement"
    },
    "check": {
      "review": "En attente de décision",
      "rewrite": "Voie de réécriture",
      "unseen": "Non vues"
    },
    "heading": "Dérive de mémoire",
    "noRewritePath": "inexistant par conception",
    "desc": "Réécrire sans cesse une mémoire la polit jusqu’à l’éloigner de l’original, et des détails inventés finissent par durcir en faits. La défense est de garder les entrées immuables.",
    "note": "Mettre à jour, c’est ajouter une entrée et clore l’ancienne. Il n’existe aucun chemin où le modèle réécrit un texte existant."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "immutable": "Unveränderliche Einträge",
      "queued": "Wartet auf Urteil"
    },
    "check": {
      "review": "Wartet auf Beurteilung",
      "rewrite": "Umschreibpfad",
      "unseen": "Ungesehen"
    },
    "heading": "Gedächtnisdrift",
    "noRewritePath": "bewusst nicht vorhanden",
    "desc": "Wiederholtes Umschreiben poliert eine Erinnerung vom Original weg, bis erfundene Details zu Fakten erstarren. Die Verteidigung ist, Einträge unveränderlich zu halten.",
    "note": "Aktualisieren heißt: neuer Eintrag plus Schließen des alten. Es gibt keinen Pfad, auf dem das Modell einen bestehenden Text umschreibt."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "immutable": "अपरिवर्तनीय प्रविष्टियाँ",
      "queued": "निर्णय की प्रतीक्षा"
    },
    "check": {
      "review": "निर्णय प्रतीक्षित",
      "rewrite": "पुनर्लेखन पथ",
      "unseen": "अनदेखे"
    },
    "heading": "स्मृति बहाव",
    "noRewritePath": "डिज़ाइन से अनुपस्थित",
    "desc": "स्मृति को बार-बार दोबारा लिखना उसे मूल से दूर घिसता जाता है, जब तक गढ़ा हुआ ब्योरा तथ्य बनकर जम न जाए। बचाव है प्रविष्टियों को अपरिवर्तनीय रखना।",
    "note": "अद्यतन का अर्थ है नई प्रविष्टि जोड़ना और पुरानी बंद करना। ऐसा कोई रास्ता नहीं जहाँ मॉडल मौजूदा सामग्री पर दोबारा लिखे।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "immutable": "Entri tak berubah",
      "queued": "Menunggu penilaian"
    },
    "check": {
      "review": "Menunggu penilaian",
      "rewrite": "Jalur penulisan ulang",
      "unseen": "Belum dilihat"
    },
    "heading": "Pergeseran memori",
    "noRewritePath": "sengaja tidak ada",
    "desc": "Menulis ulang memori berkali-kali memolesnya menjauh dari aslinya, sampai detail yang dikarang mengeras menjadi fakta. Pertahanannya adalah menjaga entri tetap tak berubah.",
    "note": "Memperbarui berarti menambah entri baru dan menutup yang lama. Tidak ada jalur di mana model menulis ulang isi yang sudah ada."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "immutable": "Voci immutabili",
      "queued": "In attesa di giudizio"
    },
    "check": {
      "review": "In attesa di giudizio",
      "rewrite": "Percorso di riscrittura",
      "unseen": "Non viste"
    },
    "heading": "Deriva della memoria",
    "noRewritePath": "assente per progetto",
    "desc": "Riscrivere di continuo una memoria la leviga allontanandola dall’originale, finché un dettaglio inventato si indurisce in fatto. La difesa è mantenere le voci immutabili.",
    "note": "Aggiornare significa aggiungere una voce e chiudere la vecchia. Non esiste alcun percorso in cui il modello riscriva un testo esistente."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "immutable": "Entradas imutáveis",
      "queued": "Aguardando julgamento"
    },
    "check": {
      "review": "Aguardando julgamento",
      "rewrite": "Caminho de reescrita",
      "unseen": "Não vistas"
    },
    "heading": "Deriva de memória",
    "noRewritePath": "inexistente por projeto",
    "desc": "Reescrever uma memória repetidamente a poli para longe do original, até um detalhe inventado endurecer como fato. A defesa é manter as entradas imutáveis.",
    "note": "Atualizar é acrescentar uma entrada e fechar a antiga. Não existe caminho em que o modelo reescreva um corpo existente."
  }
} as const;
