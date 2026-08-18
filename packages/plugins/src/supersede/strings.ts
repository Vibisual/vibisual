/**
 * supersede — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.supersede` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "When new knowledge conflicts with old, closing beats deleting. Two timestamps — opened and closed — give an immutable record and a clean present at once.",
    "heading": "Supersede",
    "level": {
      "none": "No memory yet",
      "flat": "No history yet",
      "history": "History kept"
    },
    "check": {
      "stored": "Stored",
      "current": "Current",
      "closed": "Closed"
    },
    "note": "Contradiction is not similarity alone — negation matters, so that “use A” and “never use A” are recognised as the same subject."
  },
  "ko": {
    "desc": "새 지식이 옛 지식과 충돌할 때는 지우는 것보다 닫는 것이 낫습니다. 연 시각과 닫힌 시각 두 축이 불변 기록과 깨끗한 현재를 동시에 줍니다.",
    "heading": "대체",
    "level": {
      "none": "아직 기억 없음",
      "flat": "아직 이력 없음",
      "history": "이력 보존됨"
    },
    "check": {
      "stored": "저장 장수",
      "current": "현재 진실",
      "closed": "닫힌 이력"
    },
    "note": "모순 판정은 유사도만으로는 부족합니다 — 부정 극성까지 봐야 \"A 를 쓴다\"와 \"A 를 쓰지 마라\"가 같은 주제의 대체 관계로 잡힙니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "flat": "履歴はまだない",
      "history": "履歴を保持"
    },
    "heading": "置き換え",
    "check": {
      "stored": "保存数",
      "current": "現在",
      "closed": "閉じた数"
    },
    "desc": "新しい知識が古い知識と衝突したときは、消すより「閉じる」方が良いです。開いた時刻と閉じた時刻の二軸が、不変の記録と綺麗な現在を同時に与えます。",
    "note": "矛盾の判定は類似度だけでは足りません — 否定の極性まで見て初めて「A を使う」と「A を使うな」が同じ主題の置き換えとして捕まります。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "flat": "尚无历史",
      "history": "保留了历史"
    },
    "heading": "取代",
    "check": {
      "stored": "已存",
      "current": "当前",
      "closed": "已关闭"
    },
    "desc": "当新知识与旧知识冲突时，「关闭」比删除更好。开启时刻与关闭时刻这两个轴，同时给出不可变的记录和干净的当前状态。",
    "note": "矛盾判定不能只看相似度 — 还要看否定极性，才能把「使用 A」和「不要使用 A」识别为同一主题的替代关系。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "flat": "Sin historial aún",
      "history": "Historial conservado"
    },
    "heading": "Sustitución",
    "check": {
      "stored": "Guardadas",
      "current": "Actuales",
      "closed": "Cerradas"
    },
    "desc": "Cuando el conocimiento nuevo choca con el viejo, cerrar es mejor que borrar. Dos marcas de tiempo — abierto y cerrado — dan a la vez un registro inmutable y un presente limpio.",
    "note": "La contradicción no es solo parecido — cuenta la negación, para que «usar A» y «no usar nunca A» se reconozcan como el mismo asunto."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "flat": "Sin historial aún",
      "history": "Historial conservado"
    },
    "heading": "Sustitución",
    "check": {
      "stored": "Guardadas",
      "current": "Actuales",
      "closed": "Cerradas"
    },
    "desc": "Cuando el conocimiento nuevo choca con el viejo, cerrar es mejor que borrar. Dos marcas de tiempo — abierto y cerrado — dan a la vez un registro inmutable y un presente limpio.",
    "note": "La contradicción no es solo parecido — cuenta la negación, para que «usar A» y «no usar nunca A» se reconozcan como el mismo asunto."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "flat": "Pas encore d’historique",
      "history": "Historique conservé"
    },
    "heading": "Remplacement",
    "check": {
      "stored": "Stockées",
      "current": "Actuelles",
      "closed": "Fermées"
    },
    "desc": "Quand un savoir nouveau contredit l’ancien, clore vaut mieux que supprimer. Deux horodatages — ouvert et clos — donnent à la fois un enregistrement immuable et un présent propre.",
    "note": "La contradiction ne se réduit pas à la similarité — la négation compte, pour que « utiliser A » et « ne jamais utiliser A » soient reconnus comme le même sujet."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "flat": "Noch kein Verlauf",
      "history": "Verlauf erhalten"
    },
    "heading": "Ablösung",
    "check": {
      "stored": "Gespeichert",
      "current": "Aktuell",
      "closed": "Geschlossen"
    },
    "desc": "Wenn neues Wissen dem alten widerspricht, ist Schließen besser als Löschen. Zwei Zeitpunkte — geöffnet und geschlossen — geben zugleich ein unveränderliches Protokoll und eine saubere Gegenwart.",
    "note": "Widerspruch ist nicht bloß Ähnlichkeit — es zählt die Verneinung, damit „A verwenden“ und „A niemals verwenden“ als dasselbe Thema erkannt werden."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "flat": "अभी इतिहास नहीं",
      "history": "इतिहास सुरक्षित"
    },
    "heading": "प्रतिस्थापन",
    "check": {
      "stored": "संग्रहित",
      "current": "वर्तमान",
      "closed": "बंद"
    },
    "desc": "जब नया ज्ञान पुराने से टकराए, तो मिटाने से बेहतर है बंद करना। दो समय-मुहरें — खुलने की और बंद होने की — अपरिवर्तनीय अभिलेख और साफ़ वर्तमान, दोनों देती हैं।",
    "note": "टकराव केवल समानता नहीं — निषेध भी मायने रखता है, ताकि «A का उपयोग करें» और «A का कभी उपयोग न करें» एक ही विषय के रूप में पहचाने जाएँ।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "flat": "Belum ada riwayat",
      "history": "Riwayat tersimpan"
    },
    "heading": "Penggantian",
    "check": {
      "stored": "Tersimpan",
      "current": "Saat ini",
      "closed": "Ditutup"
    },
    "desc": "Ketika pengetahuan baru berbenturan dengan yang lama, menutup lebih baik daripada menghapus. Dua penanda waktu — dibuka dan ditutup — memberi catatan yang tak berubah sekaligus masa kini yang bersih.",
    "note": "Pertentangan bukan sekadar kemiripan — negasi ikut menentukan, agar «gunakan A» dan «jangan pernah gunakan A» dikenali sebagai pokok yang sama."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "flat": "Ancora nessuno storico",
      "history": "Storico conservato"
    },
    "heading": "Sostituzione",
    "check": {
      "stored": "Memorizzate",
      "current": "Attuali",
      "closed": "Chiuse"
    },
    "desc": "Quando la conoscenza nuova contrasta con la vecchia, chiudere è meglio che cancellare. Due marcature temporali — aperto e chiuso — danno insieme un registro immutabile e un presente pulito.",
    "note": "La contraddizione non è solo somiglianza — conta la negazione, perché «usare A» e «non usare mai A» siano riconosciuti come lo stesso argomento."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "flat": "Ainda sem histórico",
      "history": "Histórico mantido"
    },
    "heading": "Substituição",
    "check": {
      "stored": "Armazenadas",
      "current": "Atuais",
      "closed": "Fechadas"
    },
    "desc": "Quando o conhecimento novo conflita com o antigo, fechar é melhor que apagar. Dois carimbos de tempo — aberto e fechado — dão ao mesmo tempo um registro imutável e um presente limpo.",
    "note": "Contradição não é só semelhança — a negação conta, para que «usar A» e «nunca usar A» sejam reconhecidos como o mesmo assunto."
  }
} as const;
