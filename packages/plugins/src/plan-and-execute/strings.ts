/**
 * plan-and-execute — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.planAndExecute` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows whether a plan exists and how far it has progressed. Writing the plan to a file means it survives compaction, which is the main reason to keep one.",
    "heading": "Plan and Execute",
    "level": {
      "noPlan": "No plan recorded",
      "running": "In progress",
      "done": "Plan completed"
    },
    "check": {
      "steps": "Steps",
      "progress": "Progress",
      "turns": "Turns"
    },
    "note": "A plan the user can approve and edit is worth more than a faster start.",
    "noteNoPlan": "No plan recorded yet. For work with many ordered steps, a written plan is what keeps the thread from losing its way."
  },
  "ko": {
    "desc": "계획이 있는지, 어디까지 갔는지 보여줍니다. 계획을 파일로 써 두면 컨텍스트가 압축돼도 남는다는 점이 계획을 두는 가장 큰 이유입니다.",
    "heading": "계획 후 실행",
    "level": {
      "noPlan": "기록된 계획 없음",
      "running": "진행 중",
      "done": "계획 완료"
    },
    "check": {
      "steps": "단계 수",
      "progress": "진행",
      "turns": "턴 수"
    },
    "note": "사용자가 승인하고 고칠 수 있는 계획이, 빨리 시작하는 것보다 값집니다.",
    "noteNoPlan": "아직 기록된 계획이 없습니다. 단계가 많고 순서가 중요한 작업이면, 적어 둔 계획이 길을 잃지 않게 합니다."
  },
  "ja": {
    "check": {
      "turns": "ターン数",
      "steps": "ステップ数",
      "progress": "進捗"
    },
    "heading": "計画してから実行",
    "level": {
      "noPlan": "計画の記録なし",
      "running": "進行中",
      "done": "計画は完了"
    },
    "desc": "計画があるか、どこまで進んだかを示します。計画をファイルに書いておけばコンテキストが圧縮されても残る、というのが計画を持つ最大の理由です。",
    "note": "利用者が承認して直せる計画は、早く着手することより価値があります。",
    "noteNoPlan": "まだ記録された計画がありません。手順が多く順序が重要な作業では、書き出した計画が道に迷わせない支えになります。"
  },
  "zh-CN": {
    "check": {
      "turns": "轮次",
      "steps": "步骤数",
      "progress": "进度"
    },
    "heading": "先计划后执行",
    "level": {
      "noPlan": "未记录计划",
      "running": "进行中",
      "done": "计划已完成"
    },
    "desc": "显示是否存在计划以及推进到哪一步。把计划写进文件意味着它能在上下文压缩后存活，这正是保留计划的主要理由。",
    "note": "一份用户能审批和修改的计划，比更快开工更有价值。",
    "noteNoPlan": "尚未记录计划。对步骤多且顺序重要的工作来说，写下的计划才是不迷路的依靠。"
  },
  "es": {
    "check": {
      "turns": "Turnos",
      "steps": "Pasos",
      "progress": "Progreso"
    },
    "heading": "Planificar y ejecutar",
    "level": {
      "noPlan": "Sin plan registrado",
      "running": "En curso",
      "done": "Plan completado"
    },
    "desc": "Muestra si existe un plan y hasta dónde ha avanzado. Escrito en un archivo, el plan sobrevive a la compactación, que es la razón principal para mantener uno.",
    "note": "Un plan que el usuario puede aprobar y editar vale más que empezar antes.",
    "noteNoPlan": "Aún no hay plan registrado. En trabajos con muchos pasos ordenados, un plan escrito es lo que evita que el hilo se pierda."
  },
  "es-419": {
    "check": {
      "turns": "Turnos",
      "steps": "Pasos",
      "progress": "Progreso"
    },
    "heading": "Planificar y ejecutar",
    "level": {
      "noPlan": "Sin plan registrado",
      "running": "En curso",
      "done": "Plan completado"
    },
    "desc": "Muestra si existe un plan y hasta dónde ha avanzado. Escrito en un archivo, el plan sobrevive a la compactación, que es la razón principal para mantener uno.",
    "note": "Un plan que el usuario puede aprobar y editar vale más que empezar antes.",
    "noteNoPlan": "Aún no hay plan registrado. En trabajos con muchos pasos ordenados, un plan escrito es lo que evita que el hilo se pierda."
  },
  "fr": {
    "check": {
      "turns": "Tours",
      "steps": "Étapes",
      "progress": "Progression"
    },
    "heading": "Planifier puis exécuter",
    "level": {
      "noPlan": "Aucun plan enregistré",
      "running": "En cours",
      "done": "Plan terminé"
    },
    "desc": "Indique s’il existe un plan et jusqu’où il a avancé. Écrit dans un fichier, le plan survit à la compaction — c’est la principale raison d’en tenir un.",
    "note": "Un plan que l’utilisateur peut approuver et modifier vaut mieux qu’un démarrage plus rapide.",
    "noteNoPlan": "Aucun plan enregistré pour l’instant. Pour un travail à nombreuses étapes ordonnées, un plan écrit est ce qui empêche le fil de se perdre."
  },
  "de": {
    "check": {
      "turns": "Züge",
      "steps": "Schritte",
      "progress": "Fortschritt"
    },
    "heading": "Planen und ausführen",
    "level": {
      "noPlan": "Kein Plan erfasst",
      "running": "Läuft",
      "done": "Plan abgeschlossen"
    },
    "desc": "Zeigt, ob ein Plan existiert und wie weit er gediehen ist. In eine Datei geschrieben überlebt der Plan die Kompaktierung — das ist der Hauptgrund, einen zu führen.",
    "note": "Ein Plan, den man freigeben und ändern kann, ist mehr wert als ein schnellerer Start.",
    "noteNoPlan": "Noch kein Plan erfasst. Bei Arbeit mit vielen geordneten Schritten hält ein aufgeschriebener Plan den Faden davon ab, sich zu verlieren."
  },
  "hi": {
    "check": {
      "turns": "टर्न",
      "steps": "चरण",
      "progress": "प्रगति"
    },
    "heading": "योजना फिर निष्पादन",
    "level": {
      "noPlan": "कोई योजना दर्ज नहीं",
      "running": "चल रहा",
      "done": "योजना पूर्ण"
    },
    "desc": "दिखाता है कि योजना है या नहीं और कितनी दूर पहुँची। फ़ाइल में लिखी योजना संपीड़न के पार भी बची रहती है — उसे रखने की मुख्य वजह यही है।",
    "note": "जिस योजना को उपयोगकर्ता मंज़ूर और संपादित कर सके, वह जल्दी शुरू कर देने से ज़्यादा मूल्यवान है।",
    "noteNoPlan": "अभी कोई योजना दर्ज नहीं है। कई क्रमिक चरणों वाले काम में लिखी हुई योजना ही धारे को भटकने से बचाती है।"
  },
  "id": {
    "check": {
      "turns": "Giliran",
      "steps": "Langkah",
      "progress": "Progres"
    },
    "heading": "Rencanakan lalu jalankan",
    "level": {
      "noPlan": "Tanpa rencana tercatat",
      "running": "Berjalan",
      "done": "Rencana selesai"
    },
    "desc": "Menunjukkan apakah ada rencana dan sejauh mana ia berjalan. Ditulis ke berkas, rencana bertahan melewati pemadatan — itulah alasan utama memilikinya.",
    "note": "Rencana yang bisa disetujui dan disunting pengguna lebih berharga daripada mulai lebih cepat.",
    "noteNoPlan": "Belum ada rencana yang tercatat. Untuk pekerjaan dengan banyak langkah berurutan, rencana tertulislah yang menjaga utas tidak tersesat."
  },
  "it": {
    "check": {
      "turns": "Turni",
      "steps": "Passi",
      "progress": "Avanzamento"
    },
    "heading": "Pianifica ed esegui",
    "level": {
      "noPlan": "Nessun piano registrato",
      "running": "In corso",
      "done": "Piano completato"
    },
    "desc": "Mostra se esiste un piano e fin dove è arrivato. Scritto su file, il piano sopravvive alla compattazione — è la ragione principale per tenerne uno.",
    "note": "Un piano che l’utente può approvare e modificare vale più di una partenza più rapida.",
    "noteNoPlan": "Nessun piano ancora registrato. In lavori con molti passi ordinati, un piano scritto è ciò che impedisce al filo di perdersi."
  },
  "pt-BR": {
    "check": {
      "turns": "Turnos",
      "steps": "Etapas",
      "progress": "Progresso"
    },
    "heading": "Planejar e executar",
    "level": {
      "noPlan": "Sem plano registrado",
      "running": "Em andamento",
      "done": "Plano concluído"
    },
    "desc": "Mostra se existe um plano e até onde ele avançou. Escrito num arquivo, o plano sobrevive à compactação — essa é a razão principal de manter um.",
    "note": "Um plano que o usuário pode aprovar e editar vale mais do que começar antes.",
    "noteNoPlan": "Ainda não há plano registrado. Em trabalhos com muitos passos ordenados, um plano escrito é o que impede a linha de se perder."
  }
} as const;
