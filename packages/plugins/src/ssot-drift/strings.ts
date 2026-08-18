/**
 * ssot-drift — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.ssotDrift` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 *
 * v4.65 — 카드가 집행 실측을 그리게 되면서 행 구성이 바뀌었다(`doc`·`sources`·`rivals`·`changeLog`).
 * 옛 행(`rules`·`memory`)은 클라가 아는 것을 세던 자리라 제거했다 — 남겨 두면 화면에 안 나오는 문자열이
 * 12로케일로 남아 다음 사람이 쓰이는 줄 알고 유지한다(`deadStrings` 검사가 잡는 부류).
 *
 * v4.67 — 행 둘(`docState`·`drift`)과 등급 셋(`thin`·`configMissing`·`stale`)이 늘었다. "문서가 있다"에
 * 빈 파일이 섞여 있었고, 이름이 Drift 인데 어긋남을 재는 자리가 없었기 때문이다. `note` 에는 **이미 떠
 * 있는 터미널 세션에는 소급되지 않는다**를 적었다 — 그것을 안 적었더니 "켰는데 왜 이 터미널은 그대로냐"가
 * 반복해서 나왔다.
 */
export const strings = {
  "en": {
    "desc": "Turns this project's SSOT discipline on. While enabled, every agent turn is told to read the spec document first, not to redesign without approval, and to update the doc before the code. The project can name its own spec file in .vibisual/ssot.json.",
    "heading": "SSOT Drift",
    "level": {
      "single": "Single source",
      "two": "Two sources",
      "many": "Several sources",
      "noDoc": "No spec doc",
      "thin": "Spec doc is empty",
      "configMissing": "Named doc is missing",
      "stale": "Doc lags the code",
      "unmeasured": "Not measured yet"
    },
    "check": {
      "doc": "SSOT document",
      "docState": "Document contents",
      "sources": "Instruction sources",
      "rivals": "Rival instruction docs",
      "changeLog": "Change Log section",
      "drift": "Doc vs. code"
    },
    "state": {
      "ok": "has content ({{chars}} chars)",
      "thin": "nearly empty ({{chars}} chars)",
      "configMissing": "named path has no file",
      "none": "no document"
    },
    "drift": {
      "fresh": "{{days}} d behind (within limit)",
      "behind": "{{days}} d behind the repo",
      "unknown": "cannot measure"
    },
    "aligned": "{{count}} aligned",
    "configuredMissing": "{{path}} (named, but absent)",
    "yes": "yes",
    "no": "none",
    "noneFound": "none found",
    "notMeasured": "not measured yet",
    "note": "Here it does not stop at a readout — while enabled, agents in this project receive the SSOT rules on every turn, and the rows above are what the enforcement actually measured in your files. Rules reach sessions that start from now on; a terminal session that is already open keeps its old context until you restart it.",
    "settings": {
      "title": "Spec document for this project",
      "desc": "Name the file that is the source of truth here. The choice is saved in .vibisual/ssot.json inside the project, so it travels with the repository.",
      "docLabel": "Document path (relative to the project root)",
      "placeholder": "docs/SSOT.md",
      "save": "Save",
      "create": "Create the document",
      "clear": "Clear",
      "current": "Currently used: {{doc}}",
      "noProject": "Open a project first — the choice is stored in that project.",
      "saved": "Saved. The next agent turn uses it.",
      "failed": "Could not save. Check that the path is inside the project."
    }
  },
  "ko": {
    "desc": "이 프로젝트의 SSOT 규율을 켭니다. 켜져 있는 동안 에이전트는 매 턴 기획 문서를 먼저 읽고, 승인 없이 재설계하지 않으며, 코드보다 문서를 먼저 고치라는 지시를 받습니다. 정본 문서 경로는 프로젝트가 .vibisual/ssot.json 에서 직접 지정할 수 있습니다.",
    "heading": "SSOT 어긋남",
    "level": {
      "single": "한 곳",
      "two": "두 곳",
      "many": "여러 곳",
      "noDoc": "기획 문서 없음",
      "thin": "문서가 비어 있음",
      "configMissing": "지정한 문서가 없음",
      "stale": "문서가 코드보다 뒤처짐",
      "unmeasured": "아직 측정 전"
    },
    "check": {
      "doc": "SSOT 문서",
      "docState": "문서 내용",
      "sources": "지시 공급원",
      "rivals": "경쟁 지시 문서",
      "changeLog": "Change Log 절",
      "drift": "문서 대 코드"
    },
    "state": {
      "ok": "내용 있음 ({{chars}}자)",
      "thin": "거의 비어 있음 ({{chars}}자)",
      "configMissing": "지정한 경로에 파일 없음",
      "none": "문서 없음"
    },
    "drift": {
      "fresh": "{{days}}일 차 (문턱 안)",
      "behind": "저장소보다 {{days}}일 뒤처짐",
      "unknown": "잴 수 없음"
    },
    "aligned": "정렬됨 {{count}}개",
    "configuredMissing": "{{path}} (지정했으나 없음)",
    "yes": "있음",
    "no": "없음",
    "noneFound": "못 찾음",
    "notMeasured": "아직 측정 전",
    "note": "여기서는 표시로 끝나지 않습니다 — 켜 두면 이 프로젝트의 에이전트가 매 턴 SSOT 규율을 받고, 위 행은 집행이 실제로 파일에서 확인한 값입니다. 규율은 지금부터 시작하는 세션에 실립니다. 이미 열려 있는 터미널 세션은 다시 시작해야 적용됩니다.",
    "settings": {
      "title": "이 프로젝트의 기획 문서",
      "desc": "정본으로 삼을 파일을 여기서 지정합니다. 선택은 프로젝트 안 .vibisual/ssot.json 에 저장되므로 저장소와 함께 따라갑니다.",
      "docLabel": "문서 경로 (프로젝트 루트 기준)",
      "placeholder": "docs/SSOT.md",
      "save": "저장",
      "create": "문서 만들기",
      "clear": "지정 해제",
      "current": "지금 쓰는 문서: {{doc}}",
      "noProject": "프로젝트를 먼저 열어 주세요 — 지정은 그 프로젝트 안에 저장됩니다.",
      "saved": "저장했습니다. 다음 턴부터 이 문서를 씁니다.",
      "failed": "저장하지 못했습니다. 경로가 프로젝트 안인지 확인해 주세요."
    }
  },
  "ja": {
    "check": {
      "doc": "SSOT 文書",
      "docState": "文書の中身",
      "sources": "指示の出所",
      "rivals": "競合する指示文書",
      "changeLog": "Change Log 節",
      "drift": "文書とコード"
    },
    "state": {
      "ok": "中身あり（{{chars}}文字）",
      "thin": "ほぼ空（{{chars}}文字）",
      "configMissing": "指定したパスにファイルなし",
      "none": "文書なし"
    },
    "drift": {
      "fresh": "{{days}}日差（しきい値内）",
      "behind": "リポジトリより {{days}}日遅れ",
      "unknown": "計測できません"
    },
    "aligned": "整合 {{count}}件",
    "configuredMissing": "{{path}}（指定済みだが存在しない）",
    "yes": "あり",
    "no": "なし",
    "noneFound": "見つかりません",
    "notMeasured": "未計測",
    "heading": "SSOT のずれ",
    "level": {
      "single": "出所は一つ",
      "two": "出所が二つ",
      "many": "出所が複数",
      "noDoc": "仕様文書なし",
      "thin": "仕様文書が空",
      "configMissing": "指定した文書がない",
      "stale": "文書がコードより遅れ",
      "unmeasured": "未計測"
    },
    "desc": "このプロジェクトの SSOT 規律を有効にします。有効な間、エージェントは毎ターン、まず仕様文書を読み、承認なしに再設計せず、コードより先に文書を更新するよう指示されます。正本の文書パスは .vibisual/ssot.json でプロジェクト側が指定できます。",
    "note": "ここでは表示だけで終わりません — 有効にすると、このプロジェクトのエージェントは毎ターン SSOT 規律を受け取ります。上の行は、実際にファイルを調べて得た値です。規律はこれから始まるセッションに載ります。すでに開いているターミナルは開き直すまで反映されません。",
    "settings": {
      "title": "このプロジェクトの仕様文書",
      "desc": "正本とするファイルをここで指定します。選択はプロジェクト内の .vibisual/ssot.json に保存され、リポジトリと一緒に移動します。",
      "docLabel": "文書のパス（プロジェクト直下から）",
      "placeholder": "docs/SSOT.md",
      "save": "保存",
      "create": "文書を作成",
      "clear": "指定を解除",
      "current": "現在使用中: {{doc}}",
      "noProject": "まずプロジェクトを開いてください — 指定はそのプロジェクト内に保存されます。",
      "saved": "保存しました。次のターンから使われます。",
      "failed": "保存できませんでした。パスがプロジェクト内か確認してください。"
    }
  },
  "zh-CN": {
    "check": {
      "doc": "SSOT 文档",
      "docState": "文档内容",
      "sources": "指令来源",
      "rivals": "竞争的指令文档",
      "changeLog": "Change Log 小节",
      "drift": "文档与代码"
    },
    "state": {
      "ok": "有内容（{{chars}} 字）",
      "thin": "几乎为空（{{chars}} 字）",
      "configMissing": "指定路径下没有文件",
      "none": "没有文档"
    },
    "drift": {
      "fresh": "相差 {{days}} 天（在阈值内）",
      "behind": "比仓库落后 {{days}} 天",
      "unknown": "无法测量"
    },
    "aligned": "已对齐 {{count}} 个",
    "configuredMissing": "{{path}}（已指定，但不存在）",
    "yes": "有",
    "no": "无",
    "noneFound": "未找到",
    "notMeasured": "尚未测量",
    "heading": "SSOT 偏移",
    "level": {
      "single": "单一来源",
      "two": "两个来源",
      "many": "多个来源",
      "noDoc": "没有规格文档",
      "thin": "规格文档为空",
      "configMissing": "指定的文档不存在",
      "stale": "文档落后于代码",
      "unmeasured": "尚未测量"
    },
    "desc": "为该项目启用 SSOT 规范。启用期间，智能体每一轮都会被要求先阅读规格文档、未经批准不得重新设计、并在改代码之前先更新文档。正式文档的路径可由项目在 .vibisual/ssot.json 中指定。",
    "note": "这里不只是显示——启用后，该项目的智能体每一轮都会收到 SSOT 规范，上面几行是执行时在你的文件中实际测得的值。规范会加载到此后新开的会话；已经打开的终端会话需重启后才生效。",
    "settings": {
      "title": "本项目的规格文档",
      "desc": "在此指定作为正本的文件。该选择保存在项目内的 .vibisual/ssot.json，因此会随仓库一起迁移。",
      "docLabel": "文档路径（相对项目根目录）",
      "placeholder": "docs/SSOT.md",
      "save": "保存",
      "create": "创建文档",
      "clear": "清除指定",
      "current": "当前使用：{{doc}}",
      "noProject": "请先打开一个项目——该指定保存在那个项目里。",
      "saved": "已保存。下一轮起生效。",
      "failed": "保存失败。请确认路径位于项目内。"
    }
  },
  "es": {
    "check": {
      "doc": "Documento SSOT",
      "docState": "Contenido del documento",
      "sources": "Fuentes de instrucciones",
      "rivals": "Documentos de instrucciones rivales",
      "changeLog": "Sección Change Log",
      "drift": "Documento frente al código"
    },
    "state": {
      "ok": "tiene contenido ({{chars}} caracteres)",
      "thin": "casi vacío ({{chars}} caracteres)",
      "configMissing": "no hay archivo en la ruta indicada",
      "none": "sin documento"
    },
    "drift": {
      "fresh": "{{days}} d de diferencia (dentro del límite)",
      "behind": "{{days}} d por detrás del repositorio",
      "unknown": "no se puede medir"
    },
    "aligned": "{{count}} alineados",
    "configuredMissing": "{{path}} (indicado, pero no existe)",
    "yes": "sí",
    "no": "ninguno",
    "noneFound": "no se encontró",
    "notMeasured": "aún sin medir",
    "heading": "Deriva del SSOT",
    "level": {
      "single": "Fuente única",
      "two": "Dos fuentes",
      "many": "Varias fuentes",
      "noDoc": "Sin documento de especificación",
      "thin": "Documento vacío",
      "configMissing": "Falta el documento indicado",
      "stale": "El documento va detrás del código",
      "unmeasured": "Aún sin medir"
    },
    "desc": "Activa la disciplina SSOT de este proyecto. Mientras esté activa, en cada turno se le indica al agente que lea primero el documento de especificación, que no rediseñe sin aprobación y que actualice el documento antes que el código. El proyecto puede indicar su propio documento en .vibisual/ssot.json.",
    "note": "Aquí no se queda en un indicador: mientras esté activo, los agentes de este proyecto reciben las reglas SSOT en cada turno, y las filas anteriores son lo que la aplicación midió realmente en tus archivos. Las reglas llegan a las sesiones que empiecen a partir de ahora; una terminal ya abierta necesita reiniciarse.",
    "settings": {
      "title": "Documento de especificación de este proyecto",
      "desc": "Indica aquí el archivo que sirve de fuente de verdad. La elección se guarda en .vibisual/ssot.json dentro del proyecto, así que viaja con el repositorio.",
      "docLabel": "Ruta del documento (desde la raíz del proyecto)",
      "placeholder": "docs/SSOT.md",
      "save": "Guardar",
      "create": "Crear el documento",
      "clear": "Quitar",
      "current": "En uso ahora: {{doc}}",
      "noProject": "Abre primero un proyecto: la elección se guarda dentro de ese proyecto.",
      "saved": "Guardado. Se usará en el próximo turno.",
      "failed": "No se pudo guardar. Comprueba que la ruta esté dentro del proyecto."
    }
  },
  "es-419": {
    "check": {
      "doc": "Documento SSOT",
      "docState": "Contenido del documento",
      "sources": "Fuentes de instrucciones",
      "rivals": "Documentos de instrucciones rivales",
      "changeLog": "Sección Change Log",
      "drift": "Documento frente al código"
    },
    "state": {
      "ok": "tiene contenido ({{chars}} caracteres)",
      "thin": "casi vacío ({{chars}} caracteres)",
      "configMissing": "no hay archivo en la ruta indicada",
      "none": "sin documento"
    },
    "drift": {
      "fresh": "{{days}} d de diferencia (dentro del límite)",
      "behind": "{{days}} d por detrás del repositorio",
      "unknown": "no se puede medir"
    },
    "aligned": "{{count}} alineados",
    "configuredMissing": "{{path}} (indicado, pero no existe)",
    "yes": "sí",
    "no": "ninguno",
    "noneFound": "no se encontró",
    "notMeasured": "aún sin medir",
    "heading": "Deriva del SSOT",
    "level": {
      "single": "Fuente única",
      "two": "Dos fuentes",
      "many": "Varias fuentes",
      "noDoc": "Sin documento de especificación",
      "thin": "Documento vacío",
      "configMissing": "Falta el documento indicado",
      "stale": "El documento va detrás del código",
      "unmeasured": "Aún sin medir"
    },
    "desc": "Activa la disciplina SSOT de este proyecto. Mientras esté activa, en cada turno se le indica al agente que lea primero el documento de especificación, que no rediseñe sin aprobación y que actualice el documento antes que el código. El proyecto puede indicar su propio documento en .vibisual/ssot.json.",
    "note": "Aquí no se queda en un indicador: mientras esté activo, los agentes de este proyecto reciben las reglas SSOT en cada turno, y las filas anteriores son lo que la aplicación midió realmente en tus archivos. Las reglas llegan a las sesiones que empiecen a partir de ahora; una terminal ya abierta necesita reiniciarse.",
    "settings": {
      "title": "Documento de especificación de este proyecto",
      "desc": "Indica aquí el archivo que sirve de fuente de verdad. La elección se guarda en .vibisual/ssot.json dentro del proyecto, así que viaja con el repositorio.",
      "docLabel": "Ruta del documento (desde la raíz del proyecto)",
      "placeholder": "docs/SSOT.md",
      "save": "Guardar",
      "create": "Crear el documento",
      "clear": "Quitar",
      "current": "En uso ahora: {{doc}}",
      "noProject": "Abre primero un proyecto: la elección se guarda dentro de ese proyecto.",
      "saved": "Guardado. Se usará en el próximo turno.",
      "failed": "No se pudo guardar. Comprueba que la ruta esté dentro del proyecto."
    }
  },
  "fr": {
    "check": {
      "doc": "Document SSOT",
      "docState": "Contenu du document",
      "sources": "Sources d’instructions",
      "rivals": "Documents d’instructions concurrents",
      "changeLog": "Section Change Log",
      "drift": "Document vs. code"
    },
    "state": {
      "ok": "contenu présent ({{chars}} caractères)",
      "thin": "quasi vide ({{chars}} caractères)",
      "configMissing": "aucun fichier au chemin indiqué",
      "none": "aucun document"
    },
    "drift": {
      "fresh": "{{days}} j d’écart (dans la limite)",
      "behind": "{{days}} j de retard sur le dépôt",
      "unknown": "mesure impossible"
    },
    "aligned": "{{count}} aligné(s)",
    "configuredMissing": "{{path}} (indiqué, mais absent)",
    "yes": "oui",
    "no": "aucun",
    "noneFound": "introuvable",
    "notMeasured": "pas encore mesuré",
    "heading": "Dérive du SSOT",
    "level": {
      "single": "Source unique",
      "two": "Deux sources",
      "many": "Plusieurs sources",
      "noDoc": "Aucun document de spécification",
      "thin": "Document vide",
      "configMissing": "Document indiqué introuvable",
      "stale": "Le document est en retard sur le code",
      "unmeasured": "Pas encore mesuré"
    },
    "desc": "Active la discipline SSOT de ce projet. Tant qu’elle est active, chaque tour d’agent reçoit la consigne de lire d’abord le document de spécification, de ne pas reconcevoir sans validation et de mettre à jour le document avant le code. Le projet peut désigner son propre document dans .vibisual/ssot.json.",
    "note": "Ici, cela ne se limite pas à un affichage : tant que c’est activé, les agents de ce projet reçoivent les règles SSOT à chaque tour, et les lignes ci-dessus sont ce que l’application a réellement mesuré dans vos fichiers. Les règles s’appliquent aux sessions démarrées à partir de maintenant ; un terminal déjà ouvert doit être relancé.",
    "settings": {
      "title": "Document de spécification de ce projet",
      "desc": "Indiquez ici le fichier qui fait référence. Le choix est enregistré dans .vibisual/ssot.json au sein du projet : il suit donc le dépôt.",
      "docLabel": "Chemin du document (depuis la racine du projet)",
      "placeholder": "docs/SSOT.md",
      "save": "Enregistrer",
      "create": "Créer le document",
      "clear": "Effacer",
      "current": "Utilisé actuellement : {{doc}}",
      "noProject": "Ouvrez d’abord un projet — le choix est stocké dans ce projet.",
      "saved": "Enregistré. Pris en compte au prochain tour.",
      "failed": "Échec de l’enregistrement. Vérifiez que le chemin est dans le projet."
    }
  },
  "de": {
    "check": {
      "doc": "SSOT-Dokument",
      "docState": "Inhalt des Dokuments",
      "sources": "Anweisungsquellen",
      "rivals": "Konkurrierende Anweisungsdokumente",
      "changeLog": "Change-Log-Abschnitt",
      "drift": "Dokument vs. Code"
    },
    "state": {
      "ok": "hat Inhalt ({{chars}} Zeichen)",
      "thin": "fast leer ({{chars}} Zeichen)",
      "configMissing": "keine Datei am angegebenen Pfad",
      "none": "kein Dokument"
    },
    "drift": {
      "fresh": "{{days}} T Abstand (im Rahmen)",
      "behind": "{{days}} T hinter dem Repository",
      "unknown": "nicht messbar"
    },
    "aligned": "{{count}} abgestimmt",
    "configuredMissing": "{{path}} (angegeben, aber nicht vorhanden)",
    "yes": "ja",
    "no": "keine",
    "noneFound": "nicht gefunden",
    "notMeasured": "noch nicht gemessen",
    "heading": "SSOT-Drift",
    "level": {
      "single": "Einzige Quelle",
      "two": "Zwei Quellen",
      "many": "Mehrere Quellen",
      "noDoc": "Kein Spezifikationsdokument",
      "thin": "Dokument ist leer",
      "configMissing": "Angegebenes Dokument fehlt",
      "stale": "Dokument hinkt dem Code hinterher",
      "unmeasured": "Noch nicht gemessen"
    },
    "desc": "Aktiviert die SSOT-Disziplin dieses Projekts. Solange sie aktiv ist, wird dem Agenten in jedem Zug gesagt: zuerst das Spezifikationsdokument lesen, nicht ohne Freigabe umgestalten und das Dokument vor dem Code aktualisieren. Das Projekt kann sein eigenes Dokument in .vibisual/ssot.json angeben.",
    "note": "Hier bleibt es nicht bei der Anzeige – solange aktiv, erhalten die Agenten dieses Projekts die SSOT-Regeln in jedem Zug, und die Zeilen oben sind das, was die Durchsetzung tatsächlich in deinen Dateien gemessen hat. Die Regeln greifen für Sitzungen, die ab jetzt starten; ein bereits offenes Terminal muss neu gestartet werden.",
    "settings": {
      "title": "Spezifikationsdokument dieses Projekts",
      "desc": "Gib hier die Datei an, die als Quelle der Wahrheit gilt. Die Auswahl liegt in .vibisual/ssot.json im Projekt und wandert damit mit dem Repository.",
      "docLabel": "Dokumentpfad (ab Projektwurzel)",
      "placeholder": "docs/SSOT.md",
      "save": "Speichern",
      "create": "Dokument anlegen",
      "clear": "Zurücksetzen",
      "current": "Aktuell genutzt: {{doc}}",
      "noProject": "Öffne zuerst ein Projekt – die Auswahl wird in diesem Projekt gespeichert.",
      "saved": "Gespeichert. Ab dem nächsten Zug aktiv.",
      "failed": "Speichern fehlgeschlagen. Prüfe, ob der Pfad im Projekt liegt."
    }
  },
  "hi": {
    "check": {
      "doc": "SSOT दस्तावेज़",
      "docState": "दस्तावेज़ की सामग्री",
      "sources": "निर्देश स्रोत",
      "rivals": "प्रतिस्पर्धी निर्देश दस्तावेज़",
      "changeLog": "Change Log अनुभाग",
      "drift": "दस्तावेज़ बनाम कोड"
    },
    "state": {
      "ok": "सामग्री है ({{chars}} अक्षर)",
      "thin": "लगभग खाली ({{chars}} अक्षर)",
      "configMissing": "बताए गए पथ पर फ़ाइल नहीं",
      "none": "कोई दस्तावेज़ नहीं"
    },
    "drift": {
      "fresh": "{{days}} दिन का अंतर (सीमा के भीतर)",
      "behind": "रिपॉज़िटरी से {{days}} दिन पीछे",
      "unknown": "माप नहीं सकते"
    },
    "aligned": "{{count}} संरेखित",
    "configuredMissing": "{{path}} (बताया गया, पर मौजूद नहीं)",
    "yes": "हाँ",
    "no": "कोई नहीं",
    "noneFound": "नहीं मिला",
    "notMeasured": "अभी मापा नहीं",
    "heading": "SSOT बहाव",
    "level": {
      "single": "एकल स्रोत",
      "two": "दो स्रोत",
      "many": "कई स्रोत",
      "noDoc": "कोई स्पेसिफिकेशन दस्तावेज़ नहीं",
      "thin": "दस्तावेज़ खाली है",
      "configMissing": "बताया गया दस्तावेज़ नहीं मिला",
      "stale": "दस्तावेज़ कोड से पीछे है",
      "unmeasured": "अभी मापा नहीं"
    },
    "desc": "इस प्रोजेक्ट का SSOT अनुशासन चालू करता है। चालू रहने पर हर एजेंट टर्न को कहा जाता है कि पहले स्पेसिफिकेशन दस्तावेज़ पढ़ें, बिना अनुमति के नया डिज़ाइन न करें, और कोड से पहले दस्तावेज़ अपडेट करें। प्रोजेक्ट अपना दस्तावेज़ .vibisual/ssot.json में बता सकता है।",
    "note": "यहाँ बात सिर्फ़ दिखाने तक नहीं रुकती — चालू रहने पर इस प्रोजेक्ट के एजेंट हर टर्न में SSOT नियम पाते हैं, और ऊपर की पंक्तियाँ वही हैं जो प्रवर्तन ने आपकी फ़ाइलों में वास्तव में मापा। नियम अब से शुरू होने वाले सत्रों पर लगते हैं; पहले से खुला टर्मिनल दोबारा शुरू करना होगा।",
    "settings": {
      "title": "इस प्रोजेक्ट का स्पेसिफिकेशन दस्तावेज़",
      "desc": "यहाँ वह फ़ाइल बताएँ जो सत्य का स्रोत है। यह चुनाव प्रोजेक्ट के अंदर .vibisual/ssot.json में सहेजा जाता है, इसलिए रिपॉज़िटरी के साथ चलता है।",
      "docLabel": "दस्तावेज़ पथ (प्रोजेक्ट रूट से)",
      "placeholder": "docs/SSOT.md",
      "save": "सहेजें",
      "create": "दस्तावेज़ बनाएँ",
      "clear": "हटाएँ",
      "current": "अभी उपयोग में: {{doc}}",
      "noProject": "पहले कोई प्रोजेक्ट खोलें — चुनाव उसी प्रोजेक्ट में सहेजा जाता है।",
      "saved": "सहेजा गया। अगले टर्न से लागू।",
      "failed": "सहेजा नहीं जा सका। जाँचें कि पथ प्रोजेक्ट के अंदर है।"
    }
  },
  "id": {
    "check": {
      "doc": "Dokumen SSOT",
      "docState": "Isi dokumen",
      "sources": "Sumber instruksi",
      "rivals": "Dokumen instruksi pesaing",
      "changeLog": "Bagian Change Log",
      "drift": "Dokumen vs. kode"
    },
    "state": {
      "ok": "ada isinya ({{chars}} karakter)",
      "thin": "nyaris kosong ({{chars}} karakter)",
      "configMissing": "tidak ada berkas di jalur yang ditunjuk",
      "none": "tidak ada dokumen"
    },
    "drift": {
      "fresh": "selisih {{days}} hari (masih dalam batas)",
      "behind": "{{days}} hari tertinggal dari repositori",
      "unknown": "tidak bisa diukur"
    },
    "aligned": "{{count}} selaras",
    "configuredMissing": "{{path}} (ditunjuk, tetapi tidak ada)",
    "yes": "ya",
    "no": "tidak ada",
    "noneFound": "tidak ditemukan",
    "notMeasured": "belum diukur",
    "heading": "Pergeseran SSOT",
    "level": {
      "single": "Sumber tunggal",
      "two": "Dua sumber",
      "many": "Beberapa sumber",
      "noDoc": "Tanpa dokumen spesifikasi",
      "thin": "Dokumen kosong",
      "configMissing": "Dokumen yang ditunjuk tidak ada",
      "stale": "Dokumen tertinggal dari kode",
      "unmeasured": "Belum diukur"
    },
    "desc": "Mengaktifkan disiplin SSOT proyek ini. Selama aktif, setiap giliran agen diminta membaca dokumen spesifikasi lebih dulu, tidak merancang ulang tanpa persetujuan, dan memperbarui dokumen sebelum kode. Proyek dapat menunjuk dokumennya sendiri di .vibisual/ssot.json.",
    "note": "Di sini bukan sekadar tampilan — selama aktif, agen di proyek ini menerima aturan SSOT pada setiap giliran, dan baris di atas adalah hasil pengukuran nyata pada berkas Anda. Aturan berlaku untuk sesi yang dimulai mulai sekarang; terminal yang sudah terbuka perlu dijalankan ulang.",
    "settings": {
      "title": "Dokumen spesifikasi proyek ini",
      "desc": "Tentukan berkas yang menjadi sumber kebenaran di sini. Pilihan disimpan di .vibisual/ssot.json dalam proyek, jadi ikut berpindah bersama repositori.",
      "docLabel": "Jalur dokumen (dari akar proyek)",
      "placeholder": "docs/SSOT.md",
      "save": "Simpan",
      "create": "Buat dokumen",
      "clear": "Hapus",
      "current": "Sedang dipakai: {{doc}}",
      "noProject": "Buka proyek terlebih dahulu — pilihan disimpan di dalam proyek itu.",
      "saved": "Tersimpan. Berlaku pada giliran berikutnya.",
      "failed": "Gagal menyimpan. Pastikan jalurnya berada di dalam proyek."
    }
  },
  "it": {
    "check": {
      "doc": "Documento SSOT",
      "docState": "Contenuto del documento",
      "sources": "Fonti di istruzioni",
      "rivals": "Documenti di istruzioni concorrenti",
      "changeLog": "Sezione Change Log",
      "drift": "Documento vs. codice"
    },
    "state": {
      "ok": "ha contenuto ({{chars}} caratteri)",
      "thin": "quasi vuoto ({{chars}} caratteri)",
      "configMissing": "nessun file nel percorso indicato",
      "none": "nessun documento"
    },
    "drift": {
      "fresh": "{{days}} g di scarto (entro il limite)",
      "behind": "{{days}} g indietro rispetto al repository",
      "unknown": "non misurabile"
    },
    "aligned": "{{count}} allineati",
    "configuredMissing": "{{path}} (indicato, ma assente)",
    "yes": "sì",
    "no": "nessuno",
    "noneFound": "non trovato",
    "notMeasured": "non ancora misurato",
    "heading": "Deriva dell’SSOT",
    "level": {
      "single": "Fonte unica",
      "two": "Due fonti",
      "many": "Diverse fonti",
      "noDoc": "Nessun documento di specifica",
      "thin": "Documento vuoto",
      "configMissing": "Documento indicato assente",
      "stale": "Il documento è indietro rispetto al codice",
      "unmeasured": "Non ancora misurato"
    },
    "desc": "Attiva la disciplina SSOT di questo progetto. Finché è attiva, a ogni turno l’agente riceve l’istruzione di leggere prima il documento di specifica, di non riprogettare senza approvazione e di aggiornare il documento prima del codice. Il progetto può indicare il proprio documento in .vibisual/ssot.json.",
    "note": "Qui non ci si ferma alla visualizzazione: finché è attivo, gli agenti di questo progetto ricevono le regole SSOT a ogni turno e le righe sopra sono ciò che l’applicazione ha misurato davvero nei tuoi file. Le regole valgono per le sessioni avviate da ora in poi; un terminale già aperto va riavviato.",
    "settings": {
      "title": "Documento di specifica di questo progetto",
      "desc": "Indica qui il file che fa da fonte di verità. La scelta viene salvata in .vibisual/ssot.json dentro il progetto, quindi viaggia con il repository.",
      "docLabel": "Percorso del documento (dalla radice del progetto)",
      "placeholder": "docs/SSOT.md",
      "save": "Salva",
      "create": "Crea il documento",
      "clear": "Rimuovi",
      "current": "In uso ora: {{doc}}",
      "noProject": "Apri prima un progetto: la scelta viene salvata in quel progetto.",
      "saved": "Salvato. Vale dal turno successivo.",
      "failed": "Salvataggio non riuscito. Controlla che il percorso sia nel progetto."
    }
  },
  "pt-BR": {
    "check": {
      "doc": "Documento SSOT",
      "docState": "Conteúdo do documento",
      "sources": "Fontes de instruções",
      "rivals": "Documentos de instruções rivais",
      "changeLog": "Seção Change Log",
      "drift": "Documento vs. código"
    },
    "state": {
      "ok": "tem conteúdo ({{chars}} caracteres)",
      "thin": "quase vazio ({{chars}} caracteres)",
      "configMissing": "não há arquivo no caminho indicado",
      "none": "sem documento"
    },
    "drift": {
      "fresh": "{{days}} d de diferença (dentro do limite)",
      "behind": "{{days}} d atrás do repositório",
      "unknown": "não dá para medir"
    },
    "aligned": "{{count}} alinhados",
    "configuredMissing": "{{path}} (indicado, mas ausente)",
    "yes": "sim",
    "no": "nenhum",
    "noneFound": "não encontrado",
    "notMeasured": "ainda não medido",
    "heading": "Deriva do SSOT",
    "level": {
      "single": "Fonte única",
      "two": "Duas fontes",
      "many": "Várias fontes",
      "noDoc": "Sem documento de especificação",
      "thin": "Documento vazio",
      "configMissing": "Documento indicado ausente",
      "stale": "O documento está atrás do código",
      "unmeasured": "Ainda não medido"
    },
    "desc": "Ativa a disciplina de SSOT deste projeto. Enquanto estiver ativa, cada turno do agente recebe a instrução de ler primeiro o documento de especificação, não redesenhar sem aprovação e atualizar o documento antes do código. O projeto pode indicar seu próprio documento em .vibisual/ssot.json.",
    "note": "Aqui não para na exibição: enquanto estiver ativo, os agentes deste projeto recebem as regras de SSOT a cada turno, e as linhas acima são o que a aplicação realmente mediu nos seus arquivos. As regras valem para sessões iniciadas de agora em diante; um terminal já aberto precisa ser reiniciado.",
    "settings": {
      "title": "Documento de especificação deste projeto",
      "desc": "Indique aqui o arquivo que serve de fonte da verdade. A escolha fica em .vibisual/ssot.json dentro do projeto, então acompanha o repositório.",
      "docLabel": "Caminho do documento (a partir da raiz do projeto)",
      "placeholder": "docs/SSOT.md",
      "save": "Salvar",
      "create": "Criar o documento",
      "clear": "Limpar",
      "current": "Em uso agora: {{doc}}",
      "noProject": "Abra um projeto primeiro — a escolha é gravada dentro dele.",
      "saved": "Salvo. Vale a partir do próximo turno.",
      "failed": "Não foi possível salvar. Verifique se o caminho está dentro do projeto."
    }
  }
} as const;
