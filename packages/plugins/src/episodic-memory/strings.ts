/**
 * episodic-memory — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.episodicMemory` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "The raw experience is first-class evidence. Keep only summaries and there is no way left to verify them or undo their errors.",
    "heading": "Episodic Memory",
    "level": {
      "empty": "Nothing recorded",
      "partial": "Turns only",
      "kept": "Sessions kept"
    },
    "check": {
      "sessions": "Session logs",
      "turns": "Recorded turns"
    },
    "note": "Extracted knowledge should carry its source session and timestamp so it can be walked back to the original."
  },
  "ko": {
    "desc": "원 경험이 1급 증거입니다. 요약본만 남기면 \"정말 그랬나\"를 검증할 근거가 사라지고, 요약의 오류를 되돌릴 방법도 없어집니다.",
    "heading": "일화 기억",
    "level": {
      "empty": "기록 없음",
      "partial": "턴만 있음",
      "kept": "세션 보존됨"
    },
    "check": {
      "sessions": "세션 로그",
      "turns": "기록된 턴"
    },
    "note": "추출된 지식에는 출처 세션과 시각을 붙여 원본으로 되돌아갈 수 있게 하는 것이 표준입니다."
  },
  "ja": {
    "level": {
      "empty": "記録なし",
      "partial": "ターンのみ",
      "kept": "セッションを保持"
    },
    "check": {
      "turns": "記録されたターン",
      "sessions": "セッションログ"
    },
    "heading": "エピソード記憶",
    "desc": "生の経験が一級の証拠です。要約だけ残すと「本当にそうだったか」を検証する根拠が消え、要約の誤りを戻す方法もなくなります。",
    "note": "抽出した知識には出所セッションと時刻を付け、原本へ戻れるようにするのが標準です。"
  },
  "zh-CN": {
    "level": {
      "empty": "无记录",
      "partial": "仅有轮次",
      "kept": "会话已保留"
    },
    "check": {
      "turns": "已记录轮次",
      "sessions": "会话日志"
    },
    "heading": "情景记忆",
    "desc": "原始经历是一级证据。只留摘要的话，就没有依据去验证「当时真的是这样吗」，也无法回退摘要中的错误。",
    "note": "抽取出的知识应带上来源会话与时间，以便能回到原文，这是标准做法。"
  },
  "es": {
    "level": {
      "empty": "Nada registrado",
      "partial": "Solo turnos",
      "kept": "Sesiones conservadas"
    },
    "check": {
      "turns": "Turnos registrados",
      "sessions": "Registros de sesión"
    },
    "heading": "Memoria episódica",
    "desc": "La experiencia en bruto es prueba de primer orden. Si solo quedan resúmenes, no queda forma de verificarlos ni de deshacer sus errores.",
    "note": "El conocimiento extraído debería llevar su sesión de origen y su marca de tiempo, para poder volver al original."
  },
  "es-419": {
    "level": {
      "empty": "Nada registrado",
      "partial": "Solo turnos",
      "kept": "Sesiones conservadas"
    },
    "check": {
      "turns": "Turnos registrados",
      "sessions": "Registros de sesión"
    },
    "heading": "Memoria episódica",
    "desc": "La experiencia en bruto es prueba de primer orden. Si solo quedan resúmenes, no queda forma de verificarlos ni de deshacer sus errores.",
    "note": "El conocimiento extraído debería llevar su sesión de origen y su marca de tiempo, para poder volver al original."
  },
  "fr": {
    "level": {
      "empty": "Rien d’enregistré",
      "partial": "Tours seulement",
      "kept": "Sessions conservées"
    },
    "check": {
      "turns": "Tours enregistrés",
      "sessions": "Journaux de session"
    },
    "heading": "Mémoire épisodique",
    "desc": "L’expérience brute est une preuve de premier ordre. Ne garder que des résumés, c’est perdre toute base pour les vérifier ou annuler leurs erreurs.",
    "note": "Le savoir extrait devrait porter sa session source et son horodatage, afin de pouvoir remonter à l’original."
  },
  "de": {
    "level": {
      "empty": "Nichts erfasst",
      "partial": "Nur Züge",
      "kept": "Sitzungen erhalten"
    },
    "check": {
      "turns": "Erfasste Züge",
      "sessions": "Sitzungsprotokolle"
    },
    "heading": "Episodisches Gedächtnis",
    "desc": "Die rohe Erfahrung ist ein erstklassiger Beleg. Bleiben nur Zusammenfassungen, gibt es keine Grundlage mehr, sie zu prüfen oder ihre Fehler zurückzunehmen.",
    "note": "Extrahiertes Wissen sollte Quellsitzung und Zeitstempel tragen, damit man zum Original zurückgehen kann."
  },
  "hi": {
    "level": {
      "empty": "कुछ दर्ज नहीं",
      "partial": "केवल टर्न",
      "kept": "सत्र सुरक्षित"
    },
    "check": {
      "turns": "दर्ज टर्न",
      "sessions": "सत्र लॉग"
    },
    "heading": "प्रासंगिक स्मृति",
    "desc": "कच्चा अनुभव प्रथम श्रेणी का प्रमाण है। यदि केवल सारांश बचे, तो न उसे जाँचने का आधार बचता है, न ग़लती पलटने का।",
    "note": "निकाले गए ज्ञान के साथ उसका स्रोत सत्र और समय चलना चाहिए, ताकि मूल तक वापस पहुँचा जा सके।"
  },
  "id": {
    "level": {
      "empty": "Tidak ada catatan",
      "partial": "Hanya giliran",
      "kept": "Sesi tersimpan"
    },
    "check": {
      "turns": "Giliran tercatat",
      "sessions": "Log sesi"
    },
    "heading": "Memori episodik",
    "desc": "Pengalaman mentah adalah bukti kelas satu. Kalau hanya ringkasan yang tersisa, tak ada lagi dasar untuk memverifikasinya maupun membatalkan kesalahannya.",
    "note": "Pengetahuan yang diekstraksi sebaiknya membawa sesi asal dan waktunya, agar bisa ditelusuri kembali ke aslinya."
  },
  "it": {
    "level": {
      "empty": "Nulla registrato",
      "partial": "Solo turni",
      "kept": "Sessioni conservate"
    },
    "check": {
      "turns": "Turni registrati",
      "sessions": "Log di sessione"
    },
    "heading": "Memoria episodica",
    "desc": "L’esperienza grezza è una prova di prim’ordine. Se restano solo i riassunti, non c’è più base per verificarli né per annullarne gli errori.",
    "note": "La conoscenza estratta dovrebbe portare la sessione di origine e l’orario, così da poter tornare all’originale."
  },
  "pt-BR": {
    "level": {
      "empty": "Nada registrado",
      "partial": "Apenas turnos",
      "kept": "Sessões mantidas"
    },
    "check": {
      "turns": "Turnos registrados",
      "sessions": "Logs de sessão"
    },
    "heading": "Memória episódica",
    "desc": "A experiência bruta é prova de primeira ordem. Ficando só com resumos, não sobra base para verificá-los nem para desfazer seus erros.",
    "note": "O conhecimento extraído deveria carregar sua sessão de origem e o horário, para permitir voltar ao original."
  }
} as const;
