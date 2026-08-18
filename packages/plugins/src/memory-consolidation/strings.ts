/**
 * memory-consolidation — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.memoryConsolidation` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Distilling episodes into facts is not free — it is a lossy operation. Keep the original and add the distillation rather than replacing it.",
    "heading": "Memory Consolidation",
    "level": {
      "none": "No memory yet",
      "pending": "New cards unseen",
      "settled": "Reviewed"
    },
    "check": {
      "unseen": "Unseen cards",
      "recent": "Most recent",
      "archived": "Archived"
    },
    "note": "Two traps: naive summarisation loses encoded facts, and weak deduplication lets new records overwrite old ones that were still true."
  },
  "ko": {
    "desc": "일화를 사실로 증류하는 일은 공짜가 아니라 손실이 있는 연산입니다. 원본을 지우고 요약만 남기는 대신, 원본을 둔 채 증류본을 더해야 합니다.",
    "heading": "기억 통합",
    "level": {
      "none": "아직 기억 없음",
      "pending": "미확인 카드 있음",
      "settled": "확인됨"
    },
    "check": {
      "unseen": "미확인 카드",
      "recent": "최근 카드",
      "archived": "보관됨"
    },
    "note": "함정이 둘입니다 — 단순 요약은 인코딩된 사실을 잃고, 중복 제거를 소홀히 하면 새 기록이 아직 유효한 옛 기록을 덮어씁니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "pending": "未確認の新カード",
      "settled": "確認済み"
    },
    "check": {
      "recent": "最新",
      "archived": "保管済み",
      "unseen": "未確認カード"
    },
    "heading": "記憶の統合",
    "desc": "出来事を事実へ蒸留する作業はただではなく、損失のある演算です。原本を消して要約だけ残すのではなく、原本を置いたまま蒸留物を足す形で回すべきです。",
    "note": "落とし穴が二つあります — 単純な要約は符号化された事実を失い、重複排除を怠ると新しい記録がまだ有効な古い記録を上書きします。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "pending": "有未查看的新卡片",
      "settled": "已查看"
    },
    "check": {
      "recent": "最近一次",
      "archived": "已归档",
      "unseen": "未查看卡片"
    },
    "heading": "记忆整合",
    "desc": "把事件蒸馏为事实并不免费，这是一个有损运算。不要删掉原文只留摘要，而应保留原文并追加蒸馏结果。",
    "note": "有两个陷阱 — 简单摘要会丢失已编码的事实；去重不到位，新记录会覆盖仍然有效的旧记录。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "pending": "Tarjetas nuevas sin ver",
      "settled": "Revisado"
    },
    "check": {
      "recent": "Más reciente",
      "archived": "Archivadas",
      "unseen": "Tarjetas sin ver"
    },
    "heading": "Consolidación de memoria",
    "desc": "Destilar episodios en hechos no es gratis — es una operación con pérdida. Conserva el original y añade la destilación en lugar de sustituirlo.",
    "note": "Dos trampas: el resumen ingenuo pierde hechos codificados, y una deduplicación floja deja que registros nuevos pisen otros viejos que seguían siendo ciertos."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "pending": "Tarjetas nuevas sin ver",
      "settled": "Revisado"
    },
    "check": {
      "recent": "Más reciente",
      "archived": "Archivadas",
      "unseen": "Tarjetas sin ver"
    },
    "heading": "Consolidación de memoria",
    "desc": "Destilar episodios en hechos no es gratis — es una operación con pérdida. Conserva el original y añade la destilación en lugar de sustituirlo.",
    "note": "Dos trampas: el resumen ingenuo pierde hechos codificados, y una deduplicación floja deja que registros nuevos pisen otros viejos que seguían siendo ciertos."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "pending": "Nouvelles cartes non vues",
      "settled": "Revu"
    },
    "check": {
      "recent": "Le plus récent",
      "archived": "Archivées",
      "unseen": "Cartes non vues"
    },
    "heading": "Consolidation de mémoire",
    "desc": "Distiller des épisodes en faits n’est pas gratuit — c’est une opération avec perte. Gardez l’original et ajoutez la distillation au lieu de la remplacer.",
    "note": "Deux pièges : un résumé naïf perd des faits encodés, et une déduplication faible laisse de nouveaux enregistrements écraser d’anciens encore valides."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "pending": "Neue Karten ungesehen",
      "settled": "Geprüft"
    },
    "check": {
      "recent": "Zuletzt",
      "archived": "Archiviert",
      "unseen": "Ungesehene Karten"
    },
    "heading": "Gedächtniskonsolidierung",
    "desc": "Episoden zu Fakten zu destillieren ist nicht umsonst — es ist eine verlustbehaftete Operation. Behalten Sie das Original und fügen Sie die Destillation hinzu, statt sie zu ersetzen.",
    "note": "Zwei Fallen: naives Zusammenfassen verliert kodierte Fakten, und schwache Deduplizierung lässt neue Einträge alte überschreiben, die noch galten."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "pending": "नए कार्ड अनदेखे",
      "settled": "समीक्षित"
    },
    "check": {
      "recent": "सबसे हाल का",
      "archived": "संग्रहीत",
      "unseen": "अनदेखे कार्ड"
    },
    "heading": "स्मृति संघटन",
    "desc": "घटनाओं को तथ्यों में उतारना मुफ़्त नहीं — यह हानि वाली क्रिया है। मूल रखिए और सार को उसकी जगह लेने के बजाय साथ जोड़िए।",
    "note": "दो जाल हैं: भोला सारांश पहले से दर्ज तथ्य खो देता है, और कमज़ोर दोहराव-हटाव नई प्रविष्टि को उस पुरानी पर लिख देता है जो अब भी सही थी।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "pending": "Kartu baru belum dilihat",
      "settled": "Ditinjau"
    },
    "check": {
      "recent": "Terbaru",
      "archived": "Diarsipkan",
      "unseen": "Kartu belum dilihat"
    },
    "heading": "Konsolidasi memori",
    "desc": "Menyuling peristiwa menjadi fakta tidaklah gratis — itu operasi yang mengandung kehilangan. Simpan aslinya dan tambahkan hasil sulingan alih-alih menggantinya.",
    "note": "Ada dua jebakan: ringkasan naif kehilangan fakta yang sudah terkodekan, dan deduplikasi yang lemah membiarkan catatan baru menimpa catatan lama yang masih benar."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "pending": "Nuove schede non viste",
      "settled": "Revisionato"
    },
    "check": {
      "recent": "Più recente",
      "archived": "Archiviate",
      "unseen": "Schede non viste"
    },
    "heading": "Consolidamento della memoria",
    "desc": "Distillare episodi in fatti non è gratis — è un’operazione con perdita. Conserva l’originale e aggiungi la distillazione invece di sostituirlo.",
    "note": "Due trappole: il riassunto ingenuo perde fatti codificati, e una deduplicazione debole lascia che i nuovi record sovrascrivano vecchi ancora validi."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "pending": "Cartões novos não vistos",
      "settled": "Revisado"
    },
    "check": {
      "recent": "Mais recente",
      "archived": "Arquivadas",
      "unseen": "Cartões não vistos"
    },
    "heading": "Consolidação de memória",
    "desc": "Destilar episódios em fatos não é de graça — é uma operação com perda. Mantenha o original e acrescente a destilação em vez de substituí-lo.",
    "note": "Duas armadilhas: o resumo ingênuo perde fatos codificados, e uma deduplicação fraca deixa registros novos sobrescreverem antigos que ainda valiam."
  }
} as const;
