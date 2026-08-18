/**
 * forgetting-policy — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.forgettingPolicy` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Storage policy is easier than forgetting policy. Memory that only grows loses retrieval precision until it is worse than having none.",
    "heading": "Forgetting Policy",
    "level": {
      "none": "No memory yet",
      "room": "Within budget",
      "full": "Near the budget"
    },
    "check": {
      "used": "Used of budget",
      "share": "Share",
      "archived": "Archived"
    },
    "note": "The safe shape is a total budget with overflow moved to archive rather than deleted — automatic permanent deletion leaves no way back."
  },
  "ko": {
    "desc": "저장 정책보다 망각 정책이 더 어렵습니다. 기억이 쌓기만 하면 검색 정밀도가 떨어져 결국 기억이 없느니만 못한 상태가 됩니다.",
    "heading": "망각 정책",
    "level": {
      "none": "아직 기억 없음",
      "room": "예산 안",
      "full": "예산에 근접"
    },
    "check": {
      "used": "예산 대비 적재",
      "share": "비율",
      "archived": "보관됨"
    },
    "note": "안전한 형태는 총량 예산 + 넘치면 삭제가 아니라 **보관으로 이동**입니다 — 자동 영구 삭제는 사고 시 복구 수단이 없습니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "full": "予算に近い",
      "room": "予算内"
    },
    "check": {
      "archived": "保管済み",
      "used": "予算に対する使用量",
      "share": "割合"
    },
    "heading": "忘却ポリシー",
    "desc": "保存方針より忘却方針の方が難しいものです。増えるだけの記憶は検索の精度を落とし、しまいには記憶がない方がましな状態になります。",
    "note": "安全な形は総量予算＋溢れたら削除ではなく**保管へ移動**です — 自動の永久削除は事故のとき戻す手段がありません。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "full": "接近预算",
      "room": "预算内"
    },
    "check": {
      "archived": "已归档",
      "used": "预算占用",
      "share": "占比"
    },
    "heading": "遗忘策略",
    "desc": "相比保存策略，遗忘策略更难。只增不减的记忆会拉低检索精度，最终变成还不如没有记忆。",
    "note": "安全的形态是总量预算 + 溢出时**移入归档**而非删除 — 自动永久删除在出事时没有任何回退手段。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "full": "Cerca del presupuesto",
      "room": "Dentro del presupuesto"
    },
    "check": {
      "archived": "Archivadas",
      "used": "Uso del presupuesto",
      "share": "Proporción"
    },
    "heading": "Política de olvido",
    "desc": "Una política de guardado es más fácil que una política de olvido. La memoria que solo crece pierde precisión de recuperación hasta valer menos que no tener ninguna.",
    "note": "La forma segura es un presupuesto total cuyo exceso **pasa al archivo en vez de borrarse** — el borrado permanente automático no deja vuelta atrás."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "full": "Cerca del presupuesto",
      "room": "Dentro del presupuesto"
    },
    "check": {
      "archived": "Archivadas",
      "used": "Uso del presupuesto",
      "share": "Proporción"
    },
    "heading": "Política de olvido",
    "desc": "Una política de guardado es más fácil que una política de olvido. La memoria que solo crece pierde precisión de recuperación hasta valer menos que no tener ninguna.",
    "note": "La forma segura es un presupuesto total cuyo exceso **pasa al archivo en vez de borrarse** — el borrado permanente automático no deja vuelta atrás."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "full": "Proche du budget",
      "room": "Dans le budget"
    },
    "check": {
      "archived": "Archivées",
      "used": "Utilisation du budget",
      "share": "Part"
    },
    "heading": "Politique d’oubli",
    "desc": "Une politique de stockage est plus simple qu’une politique d’oubli. Une mémoire qui ne fait que croître perd en précision de recherche jusqu’à valoir moins que pas de mémoire du tout.",
    "note": "La forme sûre est un budget global dont le débordement **part à l’archive au lieu d’être supprimé** — une suppression définitive automatique ne laisse aucun retour possible."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "full": "Nahe am Budget",
      "room": "Im Budget"
    },
    "check": {
      "archived": "Archiviert",
      "used": "Budgetnutzung",
      "share": "Anteil"
    },
    "heading": "Vergessensrichtlinie",
    "desc": "Eine Speicherrichtlinie ist leichter als eine Vergessensrichtlinie. Gedächtnis, das nur wächst, verliert an Trefferpräzision, bis es schlechter ist als gar keines.",
    "note": "Die sichere Form ist ein Gesamtbudget, dessen Überlauf **ins Archiv wandert statt gelöscht zu werden** — automatisches endgültiges Löschen lässt keinen Rückweg."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "full": "बजट के करीब",
      "room": "बजट के भीतर"
    },
    "check": {
      "archived": "संग्रहीत",
      "used": "बजट उपयोग",
      "share": "हिस्सा"
    },
    "heading": "विस्मरण नीति",
    "desc": "सहेजने की नीति भूलने की नीति से आसान है। केवल बढ़ती स्मृति खोज की सटीकता तब तक खोती है जब तक वह बिना स्मृति के भी कम मूल्य की न रह जाए।",
    "note": "सुरक्षित रूप है कुल बजट जिसका अतिरिक्त हिस्सा **मिटाया नहीं, संग्रह में भेजा जाए** — अपने-आप होता स्थायी विलोपन वापसी का कोई रास्ता नहीं छोड़ता।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "full": "Dekat batas anggaran",
      "room": "Dalam anggaran"
    },
    "check": {
      "archived": "Diarsipkan",
      "used": "Pemakaian anggaran",
      "share": "Porsi"
    },
    "heading": "Kebijakan lupa",
    "desc": "Kebijakan penyimpanan lebih mudah daripada kebijakan melupakan. Memori yang hanya bertambah kehilangan ketepatan pencarian sampai bernilai lebih rendah daripada tanpa memori sama sekali.",
    "note": "Bentuk amannya adalah anggaran total yang kelebihannya **dipindahkan ke arsip alih-alih dihapus** — penghapusan permanen otomatis tidak menyisakan jalan kembali."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "full": "Vicino al budget",
      "room": "Nel budget"
    },
    "check": {
      "archived": "Archiviate",
      "used": "Uso del budget",
      "share": "Quota"
    },
    "heading": "Politica di oblio",
    "desc": "Una politica di archiviazione è più semplice di una politica di oblio. Una memoria che solo cresce perde precisione di recupero fino a valere meno di nessuna memoria.",
    "note": "La forma sicura è un budget complessivo la cui eccedenza **va in archivio invece di essere cancellata** — la cancellazione definitiva automatica non lascia vie di ritorno."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "full": "Perto do orçamento",
      "room": "Dentro do orçamento"
    },
    "check": {
      "archived": "Arquivadas",
      "used": "Uso do orçamento",
      "share": "Proporção"
    },
    "heading": "Política de esquecimento",
    "desc": "Uma política de armazenamento é mais fácil que uma política de esquecimento. Memória que só cresce perde precisão de recuperação até valer menos do que não ter nenhuma.",
    "note": "A forma segura é um orçamento total cujo excedente **vai para o arquivo em vez de ser apagado** — exclusão permanente automática não deixa caminho de volta."
  }
} as const;
