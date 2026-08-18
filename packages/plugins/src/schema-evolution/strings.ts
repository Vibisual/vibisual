/**
 * schema-evolution — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.schemaEvolution` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Add fields optionally with defaults and older saved state stays readable by newer code. Vibisual keeps checkpoints on that rule.",
    "heading": "Schema Evolution",
    "level": {
      "fresh": "Nothing saved yet",
      "persisted": "Persisted"
    },
    "check": {
      "sessions": "Sessions",
      "policy": "Field policy"
    },
    "optional": "optional + defaults",
    "note": "Breaking backward compatibility means old checkpoints stop loading — which is exactly when a crash turns into lost work."
  },
  "ko": {
    "desc": "필드를 선택적으로 더하고 기본값을 두면 옛 저장본을 새 코드가 그대로 읽습니다. Vibisual 의 체크포인트가 그 규약 위에 있습니다.",
    "heading": "스키마 진화",
    "level": {
      "fresh": "아직 저장 없음",
      "persisted": "저장됨"
    },
    "check": {
      "sessions": "세션 수",
      "policy": "필드 정책"
    },
    "optional": "선택적 + 기본값",
    "note": "하위호환을 깨면 옛 체크포인트가 안 열립니다 — 그 순간이 바로 크래시가 작업 손실로 바뀌는 지점입니다."
  },
  "ja": {
    "check": {
      "sessions": "セッション数",
      "policy": "フィールド方針"
    },
    "heading": "スキーマ進化",
    "level": {
      "fresh": "まだ保存なし",
      "persisted": "保存済み"
    },
    "optional": "任意＋既定値",
    "desc": "フィールドは任意で足して既定値を置けば、古い保存物を新しいコードがそのまま読めます。Vibisual のチェックポイントはその規約の上にあります。",
    "note": "後方互換を壊すと古いチェックポイントが開かなくなります — まさにその瞬間が、クラッシュが作業の損失に変わる地点です。"
  },
  "zh-CN": {
    "check": {
      "sessions": "会话数",
      "policy": "字段策略"
    },
    "heading": "模式演进",
    "level": {
      "fresh": "尚未保存",
      "persisted": "已持久化"
    },
    "optional": "可选 + 默认值",
    "desc": "以可选字段加默认值的方式扩展，旧的存档就能被新代码继续读取。Vibisual 的检查点建立在这个约定之上。",
    "note": "破坏向后兼容意味着旧检查点打不开 — 而那一刻，正是崩溃变成工作丢失的时刻。"
  },
  "es": {
    "check": {
      "sessions": "Sesiones",
      "policy": "Política de campos"
    },
    "heading": "Evolución del esquema",
    "level": {
      "fresh": "Nada guardado aún",
      "persisted": "Persistido"
    },
    "optional": "opcional + valores por defecto",
    "desc": "Añade campos opcionales con valores por defecto y el estado guardado antiguo sigue siendo legible por código nuevo. Vibisual mantiene sus puntos de guardado sobre esa regla.",
    "note": "Romper la compatibilidad hacia atrás significa que los puntos de guardado antiguos dejan de cargar — justo cuando un cuelgue se convierte en trabajo perdido."
  },
  "es-419": {
    "check": {
      "sessions": "Sesiones",
      "policy": "Política de campos"
    },
    "heading": "Evolución del esquema",
    "level": {
      "fresh": "Nada guardado aún",
      "persisted": "Persistido"
    },
    "optional": "opcional + valores por defecto",
    "desc": "Añade campos opcionales con valores por defecto y el estado guardado antiguo sigue siendo legible por código nuevo. Vibisual mantiene sus puntos de guardado sobre esa regla.",
    "note": "Romper la compatibilidad hacia atrás significa que los puntos de guardado antiguos dejan de cargar — justo cuando un cuelgue se convierte en trabajo perdido."
  },
  "fr": {
    "check": {
      "sessions": "Sessions",
      "policy": "Politique des champs"
    },
    "heading": "Évolution du schéma",
    "level": {
      "fresh": "Rien d’enregistré",
      "persisted": "Persisté"
    },
    "optional": "optionnel + valeurs par défaut",
    "desc": "Ajoutez des champs facultatifs avec valeurs par défaut et l’état sauvegardé plus ancien reste lisible par du code plus récent. Vibisual tient ses points de reprise sur cette règle.",
    "note": "Casser la compatibilité ascendante signifie que d’anciens points de reprise ne se chargent plus — précisément le moment où un plantage se transforme en travail perdu."
  },
  "de": {
    "check": {
      "sessions": "Sitzungen",
      "policy": "Feldrichtlinie"
    },
    "heading": "Schema-Evolution",
    "level": {
      "fresh": "Noch nichts gespeichert",
      "persisted": "Persistiert"
    },
    "optional": "optional + Standardwerte",
    "desc": "Felder optional mit Standardwerten hinzufügen, dann bleibt älterer gespeicherter Zustand für neueren Code lesbar. Vibisual hält seine Checkpoints an dieser Regel.",
    "note": "Rückwärtskompatibilität zu brechen bedeutet, dass alte Checkpoints nicht mehr laden — genau dann wird aus einem Absturz verlorene Arbeit."
  },
  "hi": {
    "check": {
      "sessions": "सत्र",
      "policy": "फ़ील्ड नीति"
    },
    "heading": "स्कीमा विकास",
    "level": {
      "fresh": "अभी कुछ सहेजा नहीं",
      "persisted": "सहेजा गया"
    },
    "optional": "वैकल्पिक + डिफ़ॉल्ट",
    "desc": "नए खाने वैकल्पिक और डिफ़ॉल्ट मान के साथ जोड़िए, तो पुरानी सहेजी स्थिति नए कोड से भी पढ़ी जाती रहेगी। Vibisual अपने checkpoint इसी नियम पर रखता है।",
    "note": "पिछली अनुकूलता तोड़ने का अर्थ है पुराने checkpoint लदना बंद — ठीक उसी क्षण जब कोई crash खोए हुए काम में बदल जाता है।"
  },
  "id": {
    "check": {
      "sessions": "Sesi",
      "policy": "Kebijakan bidang"
    },
    "heading": "Evolusi skema",
    "level": {
      "fresh": "Belum ada yang disimpan",
      "persisted": "Tersimpan"
    },
    "optional": "opsional + nilai bawaan",
    "desc": "Tambahkan bidang secara opsional dengan nilai bawaan, maka keadaan tersimpan yang lebih lama tetap terbaca oleh kode yang lebih baru. Vibisual menjaga checkpoint-nya di atas aturan itu.",
    "note": "Merusak kompatibilitas mundur berarti checkpoint lama berhenti dimuat — persis saat sebuah crash berubah menjadi pekerjaan yang hilang."
  },
  "it": {
    "check": {
      "sessions": "Sessioni",
      "policy": "Politica dei campi"
    },
    "heading": "Evoluzione dello schema",
    "level": {
      "fresh": "Nulla ancora salvato",
      "persisted": "Persistito"
    },
    "optional": "opzionale + predefiniti",
    "desc": "Aggiungi campi opzionali con valori predefiniti e lo stato salvato più vecchio resta leggibile da codice più nuovo. Vibisual tiene i propri checkpoint su questa regola.",
    "note": "Rompere la compatibilità all’indietro significa che i vecchi checkpoint non si caricano più — proprio quando un crash si trasforma in lavoro perduto."
  },
  "pt-BR": {
    "check": {
      "sessions": "Sessões",
      "policy": "Política de campos"
    },
    "heading": "Evolução do esquema",
    "level": {
      "fresh": "Nada salvo ainda",
      "persisted": "Persistido"
    },
    "optional": "opcional + padrões",
    "desc": "Acrescente campos opcionais com valores padrão e o estado salvo mais antigo continua legível por código mais novo. O Vibisual mantém seus checkpoints sobre essa regra.",
    "note": "Quebrar a compatibilidade retroativa significa que checkpoints antigos deixam de carregar — exatamente quando um travamento vira trabalho perdido."
  }
} as const;
