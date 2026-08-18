/**
 * memory-invalidation — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.memoryInvalidation` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Missing memory makes a model say it does not know; stale memory makes it confidently wrong. Marking rather than deleting lets the next person judge.",
    "heading": "Memory Invalidation",
    "level": {
      "none": "No memory yet",
      "clean": "Nothing flagged",
      "pending": "Needs checking"
    },
    "check": {
      "needsCheck": "Flagged stale",
      "review": "Awaiting judgement",
      "cards": "Stored cards"
    },
    "note": "In code, a change to the linked file is the most accurate staleness signal — path matching leaves almost no false positives.",
    "notePending": "Some cards were flagged because their linked files changed. Compare them with the current code and confirm or retire them."
  },
  "ko": {
    "desc": "없는 기억은 모델이 모른다고 말하게 하지만, 낡은 기억은 확신에 찬 오답을 만듭니다. 즉시 지우지 않고 표시해 두면 다음 사람이 판정할 수 있습니다.",
    "heading": "기억 무효화",
    "level": {
      "none": "아직 기억 없음",
      "clean": "표시된 것 없음",
      "pending": "확인 필요"
    },
    "check": {
      "needsCheck": "확인 필요",
      "review": "판단 대기",
      "cards": "저장 장수"
    },
    "note": "코드에서는 연결된 파일의 변경이 가장 정확한 낡음 신호입니다 — 경로 일치라 오탐이 거의 없습니다.",
    "notePending": "연결된 파일이 바뀌어 확인 필요로 표시된 카드가 있습니다. 지금 코드와 대조해 유효/무효를 확정해 주십시오."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "clean": "指摘なし",
      "pending": "要確認"
    },
    "check": {
      "needsCheck": "要確認",
      "review": "判断待ち",
      "cards": "保存カード数"
    },
    "heading": "記憶の無効化",
    "desc": "ない記憶はモデルに「知らない」と言わせますが、古い記憶は自信のある誤答を作ります。すぐ消さず印を付けておけば、次の人が判定できます。",
    "note": "コードでは、紐づくファイルの変更が最も正確な陳腐化の合図です — パス一致なので誤検出がほとんどありません。",
    "notePending": "紐づくファイルが変わったため「要確認」になったカードがあります。いまのコードと突き合わせて、有効か無効かを確定してください。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "clean": "无标记",
      "pending": "需要确认"
    },
    "check": {
      "needsCheck": "标记为过时",
      "review": "等待判断",
      "cards": "已存卡片"
    },
    "heading": "记忆失效",
    "desc": "没有的记忆会让模型说「不知道」，而过时的记忆会造出自信的错误答案。不立即删除而是打上标记，下一个人才能判定。",
    "note": "在代码领域，关联文件的变更是最准确的过时信号 — 基于路径匹配，几乎没有误报。",
    "notePending": "有卡片因关联文件发生变更而被标为「需确认」。请与当前代码比对，确定其有效或作废。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "clean": "Nada marcado",
      "pending": "Requiere revisión"
    },
    "check": {
      "needsCheck": "Marcadas como obsoletas",
      "review": "Esperando juicio",
      "cards": "Tarjetas guardadas"
    },
    "heading": "Invalidación de memoria",
    "desc": "La memoria ausente hace que el modelo diga que no sabe; la memoria caducada produce errores dichos con seguridad. Marcar en lugar de borrar deja juzgar a la siguiente persona.",
    "note": "En código, un cambio en el archivo vinculado es la señal de caducidad más precisa — al coincidir por ruta, apenas deja falsos positivos.",
    "notePending": "Algunas tarjetas se marcaron porque cambiaron sus archivos vinculados. Compáralas con el código actual y confírmalas o retíralas."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "clean": "Nada marcado",
      "pending": "Requiere revisión"
    },
    "check": {
      "needsCheck": "Marcadas como obsoletas",
      "review": "Esperando juicio",
      "cards": "Tarjetas guardadas"
    },
    "heading": "Invalidación de memoria",
    "desc": "La memoria ausente hace que el modelo diga que no sabe; la memoria caducada produce errores dichos con seguridad. Marcar en lugar de borrar deja juzgar a la siguiente persona.",
    "note": "En código, un cambio en el archivo vinculado es la señal de caducidad más precisa — al coincidir por ruta, apenas deja falsos positivos.",
    "notePending": "Algunas tarjetas se marcaron porque cambiaron sus archivos vinculados. Compáralas con el código actual y confírmalas o retíralas."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "clean": "Rien de signalé",
      "pending": "À vérifier"
    },
    "check": {
      "needsCheck": "Marquées obsolètes",
      "review": "En attente de décision",
      "cards": "Cartes stockées"
    },
    "heading": "Invalidation de mémoire",
    "desc": "Une mémoire absente fait dire au modèle qu’il ne sait pas ; une mémoire périmée produit des erreurs affirmées avec assurance. Marquer plutôt que supprimer laisse juger la personne suivante.",
    "note": "Dans le code, une modification du fichier lié est le signal d’obsolescence le plus précis — la correspondance de chemin ne laisse presque aucun faux positif.",
    "notePending": "Certaines cartes ont été signalées parce que leurs fichiers liés ont changé. Comparez-les au code actuel puis confirmez-les ou retirez-les."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "clean": "Nichts markiert",
      "pending": "Prüfung nötig"
    },
    "check": {
      "needsCheck": "Als veraltet markiert",
      "review": "Wartet auf Beurteilung",
      "cards": "Gespeicherte Karten"
    },
    "heading": "Gedächtnis-Invalidierung",
    "desc": "Fehlendes Gedächtnis lässt ein Modell „weiß ich nicht“ sagen; veraltetes Gedächtnis erzeugt selbstsichere Falschaussagen. Markieren statt löschen lässt den Nächsten urteilen.",
    "note": "Im Code ist eine Änderung der verknüpften Datei das genaueste Veraltungssignal — durch Pfadabgleich gibt es praktisch keine Fehlalarme.",
    "notePending": "Einige Karten wurden markiert, weil sich ihre verknüpften Dateien geändert haben. Gleichen Sie sie mit dem aktuellen Code ab und bestätigen oder verwerfen Sie sie."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "clean": "कुछ चिह्नित नहीं",
      "pending": "जाँच चाहिए"
    },
    "check": {
      "needsCheck": "पुराना चिह्नित",
      "review": "निर्णय प्रतीक्षित",
      "cards": "संग्रहित कार्ड"
    },
    "heading": "स्मृति अमान्यकरण",
    "desc": "गुम स्मृति से मॉडल कहता है कि पता नहीं; बासी स्मृति आत्मविश्वास से भरी ग़लती पैदा करती है। मिटाने के बजाय चिह्नित करना अगले मनुष्य को निर्णय का मौका देता है।",
    "note": "कोड में, जुड़ी फ़ाइल का बदलना बासीपन का सबसे सटीक संकेत है — यह पथ मिलाता है, इसलिए झूठे संकेत लगभग नहीं आते।",
    "notePending": "कुछ कार्ड इसलिए चिह्नित हैं कि उनकी जुड़ी फ़ाइलें बदल गईं। मौजूदा कोड से मिलाइए और या तो पुष्टि कीजिए या सेवानिवृत्त कीजिए।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "clean": "Tidak ada tanda",
      "pending": "Perlu diperiksa"
    },
    "check": {
      "needsCheck": "Ditandai usang",
      "review": "Menunggu penilaian",
      "cards": "Kartu tersimpan"
    },
    "heading": "Invalidasi memori",
    "desc": "Memori yang hilang membuat model berkata tidak tahu; memori usang menghasilkan kesalahan yang diucapkan dengan yakin. Menandai alih-alih menghapus membiarkan orang berikutnya menilai.",
    "note": "Dalam kode, perubahan pada berkas tertaut adalah sinyal keusangan paling akurat — karena mencocokkan jalur, nyaris tanpa positif palsu.",
    "notePending": "Beberapa kartu ditandai karena berkas tertautnya berubah. Bandingkan dengan kode saat ini lalu konfirmasi atau pensiunkan."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "clean": "Nulla segnalato",
      "pending": "Da verificare"
    },
    "check": {
      "needsCheck": "Segnate come obsolete",
      "review": "In attesa di giudizio",
      "cards": "Schede memorizzate"
    },
    "heading": "Invalidazione della memoria",
    "desc": "Una memoria assente fa dire al modello che non sa; una memoria scaduta produce errori detti con sicurezza. Marcare invece di cancellare lascia giudicare alla prossima persona.",
    "note": "Nel codice, una modifica al file collegato è il segnale di obsolescenza più preciso — combaciando sul percorso, non lascia quasi falsi positivi.",
    "notePending": "Alcune schede sono state segnalate perché i file collegati sono cambiati. Confrontale con il codice attuale e confermale o ritirale."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "clean": "Nada sinalizado",
      "pending": "Precisa verificação"
    },
    "check": {
      "needsCheck": "Marcadas como obsoletas",
      "review": "Aguardando julgamento",
      "cards": "Cartões armazenados"
    },
    "heading": "Invalidação de memória",
    "desc": "Memória ausente faz o modelo dizer que não sabe; memória vencida produz erros ditos com convicção. Marcar em vez de apagar deixa a próxima pessoa julgar.",
    "note": "Em código, uma alteração no arquivo vinculado é o sinal de obsolescência mais preciso — por casar caminhos, quase não deixa falsos positivos.",
    "notePending": "Alguns cartões foram marcados porque os arquivos vinculados mudaram. Compare-os com o código atual e confirme ou aposente cada um."
  }
} as const;
