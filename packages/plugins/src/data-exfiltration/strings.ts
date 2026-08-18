/**
 * data-exfiltration — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.dataExfiltration` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Looks for commands that send data outward. It does not inspect content — the point is whether an outbound path was actually used, because anything that left cannot be recalled.",
    "heading": "Data Exfiltration",
    "level": {
      "noCommands": "Nothing run yet",
      "none": "No outbound use",
      "used": "Outbound paths used"
    },
    "check": {
      "commands": "Commands run",
      "egress": "Outbound",
      "last": "Most recent"
    },
    "kind": {
      "push": "git push",
      "upload": "upload with body",
      "webhook": "webhook",
      "copy": "remote copy",
      "secretsRead": "secret file read"
    },
    "note": "What counts as “sending outward” is broad now — commits, pushes, API calls, image URL requests and webhooks all qualify.",
    "noteUsed": "Once content is out, deleting it later does not remove it from caches and indexes. Check what these commands carried."
  },
  "ko": {
    "desc": "데이터를 바깥으로 보내는 명령을 찾습니다. 내용은 검사하지 않습니다 — 요점은 나가는 통로가 실제로 쓰였는가이며, 나간 것은 되부를 수 없기 때문입니다.",
    "heading": "데이터 유출",
    "level": {
      "noCommands": "아직 실행 없음",
      "none": "외부 전송 없음",
      "used": "외부 통로 사용됨"
    },
    "check": {
      "commands": "실행한 명령",
      "egress": "외부 전송",
      "last": "가장 최근"
    },
    "kind": {
      "push": "git push",
      "upload": "본문 실은 업로드",
      "webhook": "웹훅",
      "copy": "원격 복사",
      "secretsRead": "비밀 파일 읽기"
    },
    "note": "\"외부에 보낸다\"의 범위가 넓어졌습니다 — 커밋·푸시·API 호출·이미지 URL 요청·웹훅이 전부 해당합니다.",
    "noteUsed": "한 번 나간 내용은 나중에 지워도 캐시와 색인에 남습니다. 이 명령들이 무엇을 실어 보냈는지 확인하십시오."
  },
  "ja": {
    "level": {
      "noCommands": "まだ実行なし",
      "none": "外部送信なし",
      "used": "外部送信が使われた"
    },
    "check": {
      "commands": "実行コマンド数",
      "last": "最新",
      "egress": "外部送信"
    },
    "heading": "データ持ち出し",
    "kind": {
      "push": "git push",
      "upload": "本文付きアップロード",
      "webhook": "ウェブフック",
      "copy": "リモートへコピー",
      "secretsRead": "秘密ファイルの読み取り"
    },
    "desc": "データを外へ送るコマンドを探します。中身は検査しません — 要点は外へ出る通路が実際に使われたかであり、出たものは呼び戻せないからです。",
    "note": "「外へ送る」の範囲は広がりました — コミット・プッシュ・API 呼び出し・画像 URL の要求・ウェブフックがすべて該当します。",
    "noteUsed": "一度出た内容は後から消してもキャッシュや索引に残ります。これらのコマンドが何を運んだのかを確認してください。"
  },
  "zh-CN": {
    "level": {
      "noCommands": "尚未执行",
      "none": "未对外发送",
      "used": "已使用外发路径"
    },
    "check": {
      "commands": "已执行命令",
      "last": "最近一次",
      "egress": "对外发送"
    },
    "heading": "数据外泄",
    "kind": {
      "push": "git push",
      "upload": "带正文的上传",
      "webhook": "Webhook",
      "copy": "远程复制",
      "secretsRead": "读取了机密文件"
    },
    "desc": "寻找把数据往外发送的命令。它不检查内容 — 要点在于对外通路是否真的被用过，因为一旦出去就再也收不回来。",
    "note": "「往外发送」的范围已经变宽 — 提交、推送、API 调用、图片 URL 请求和 webhook 全都算。",
    "noteUsed": "内容一旦出去，事后删除也无法从缓存和索引中清除。请确认这些命令带走了什么。"
  },
  "es": {
    "level": {
      "noCommands": "Nada ejecutado aún",
      "none": "Sin salidas usadas",
      "used": "Vías de salida usadas"
    },
    "check": {
      "commands": "Comandos ejecutados",
      "last": "Más reciente",
      "egress": "Salidas"
    },
    "heading": "Filtración de datos",
    "kind": {
      "push": "git push",
      "upload": "subida con cuerpo",
      "webhook": "webhook",
      "copy": "copia remota",
      "secretsRead": "lectura de archivo secreto"
    },
    "desc": "Busca comandos que envíen datos hacia fuera. No inspecciona el contenido — lo que importa es si se usó realmente una vía de salida, porque lo que salió no se puede recuperar.",
    "note": "Lo que cuenta como «enviar hacia fuera» es hoy amplio — commits, pushes, llamadas a API, peticiones de URL de imagen y webhooks entran todos.",
    "noteUsed": "Una vez fuera, borrarlo después no lo quita de cachés e índices. Comprueba qué se llevaron estos comandos."
  },
  "es-419": {
    "level": {
      "noCommands": "Nada ejecutado aún",
      "none": "Sin salidas usadas",
      "used": "Vías de salida usadas"
    },
    "check": {
      "commands": "Comandos ejecutados",
      "last": "Más reciente",
      "egress": "Salidas"
    },
    "heading": "Filtración de datos",
    "kind": {
      "push": "git push",
      "upload": "subida con cuerpo",
      "webhook": "webhook",
      "copy": "copia remota",
      "secretsRead": "lectura de archivo secreto"
    },
    "desc": "Busca comandos que envíen datos hacia fuera. No inspecciona el contenido — lo que importa es si se usó realmente una vía de salida, porque lo que salió no se puede recuperar.",
    "note": "Lo que cuenta como «enviar hacia fuera» es hoy amplio — commits, pushes, llamadas a API, peticiones de URL de imagen y webhooks entran todos.",
    "noteUsed": "Una vez fuera, borrarlo después no lo quita de cachés e índices. Comprueba qué se llevaron estos comandos."
  },
  "fr": {
    "level": {
      "noCommands": "Rien d’exécuté",
      "none": "Aucune sortie utilisée",
      "used": "Voies de sortie utilisées"
    },
    "check": {
      "commands": "Commandes exécutées",
      "last": "Le plus récent",
      "egress": "Sortant"
    },
    "heading": "Exfiltration de données",
    "kind": {
      "push": "git push",
      "upload": "envoi avec corps",
      "webhook": "webhook",
      "copy": "copie distante",
      "secretsRead": "lecture de fichier secret"
    },
    "desc": "Recherche les commandes qui envoient des données vers l’extérieur. Elle n’inspecte pas le contenu — l’enjeu est de savoir si une voie de sortie a réellement servi, car ce qui est parti ne se rappelle pas.",
    "note": "Ce qui compte comme « envoyer dehors » est désormais large — commits, pushes, appels d’API, requêtes d’URL d’image et webhooks en font tous partie.",
    "noteUsed": "Une fois un contenu sorti, le supprimer plus tard ne l’ôte pas des caches et des index. Vérifiez ce que ces commandes ont emporté."
  },
  "de": {
    "level": {
      "noCommands": "Noch nichts ausgeführt",
      "none": "Kein Ausgang genutzt",
      "used": "Ausgangswege genutzt"
    },
    "check": {
      "commands": "Ausgeführte Befehle",
      "last": "Zuletzt",
      "egress": "Ausgehend"
    },
    "heading": "Datenabfluss",
    "kind": {
      "push": "git push",
      "upload": "Upload mit Inhalt",
      "webhook": "Webhook",
      "copy": "Fernkopie",
      "secretsRead": "Geheimdatei gelesen"
    },
    "desc": "Sucht nach Befehlen, die Daten nach außen senden. Sie prüft keine Inhalte — es geht darum, ob ein Ausgangsweg tatsächlich genutzt wurde, denn was hinaus ist, lässt sich nicht zurückholen.",
    "note": "Was als „nach außen senden“ zählt, ist heute weit gefasst — Commits, Pushes, API-Aufrufe, Bild-URL-Anfragen und Webhooks gehören alle dazu.",
    "noteUsed": "Ist ein Inhalt einmal draußen, entfernt späteres Löschen ihn nicht aus Caches und Indizes. Prüfen Sie, was diese Befehle mitgenommen haben."
  },
  "hi": {
    "level": {
      "noCommands": "अभी कुछ नहीं चला",
      "none": "बाहर भेजना नहीं",
      "used": "बाहर जाने के पथ प्रयुक्त"
    },
    "check": {
      "commands": "चले कमांड",
      "last": "सबसे हाल का",
      "egress": "बाहर जाना"
    },
    "heading": "डेटा बहिर्गमन",
    "kind": {
      "push": "git push",
      "upload": "बॉडी सहित अपलोड",
      "webhook": "वेबहुक",
      "copy": "रिमोट कॉपी",
      "secretsRead": "गुप्त फ़ाइल पढ़ी"
    },
    "desc": "बाहर डेटा भेजने वाले आदेश खोजता है। यह सामग्री नहीं देखता — मायने यह रखता है कि बाहर जाने का रास्ता सचमुच इस्तेमाल हुआ या नहीं, क्योंकि जो निकल गया वह वापस नहीं खींचा जा सकता।",
    "note": "«बाहर भेजना» अब चौड़ा हो चुका है — commit, push, API कॉल, चित्र-URL अनुरोध और webhook सब इसमें आते हैं।",
    "noteUsed": "सामग्री एक बार निकल जाए तो बाद में मिटाने से वह cache और सूचकांक से नहीं जाती। देखिए कि ये आदेश क्या साथ ले गए।"
  },
  "id": {
    "level": {
      "noCommands": "Belum ada yang dijalankan",
      "none": "Tanpa pengiriman keluar",
      "used": "Jalur keluar terpakai"
    },
    "check": {
      "commands": "Perintah dijalankan",
      "last": "Terbaru",
      "egress": "Keluar"
    },
    "heading": "Eksfiltrasi data",
    "kind": {
      "push": "git push",
      "upload": "unggah dengan isi",
      "webhook": "webhook",
      "copy": "salin jarak jauh",
      "secretsRead": "berkas rahasia dibaca"
    },
    "desc": "Mencari perintah yang mengirim data ke luar. Ia tidak memeriksa isinya — yang penting adalah apakah jalur keluar benar-benar dipakai, sebab yang sudah keluar tak bisa ditarik kembali.",
    "note": "Apa yang terhitung sebagai «mengirim ke luar» kini luas — commit, push, panggilan API, permintaan URL gambar, dan webhook semuanya termasuk.",
    "noteUsed": "Begitu isinya keluar, menghapusnya kemudian tidak menghilangkannya dari cache dan indeks. Periksa apa yang dibawa perintah-perintah ini."
  },
  "it": {
    "level": {
      "noCommands": "Nulla eseguito",
      "none": "Nessuna uscita usata",
      "used": "Vie d’uscita usate"
    },
    "check": {
      "commands": "Comandi eseguiti",
      "last": "Più recente",
      "egress": "In uscita"
    },
    "heading": "Esfiltrazione di dati",
    "kind": {
      "push": "git push",
      "upload": "upload con corpo",
      "webhook": "webhook",
      "copy": "copia remota",
      "secretsRead": "lettura di file segreto"
    },
    "desc": "Cerca comandi che mandano dati fuori. Non ispeziona il contenuto — ciò che conta è se una via d’uscita è stata davvero usata, perché ciò che è uscito non si richiama indietro.",
    "note": "Ciò che conta come «mandare fuori» oggi è ampio — commit, push, chiamate API, richieste di URL di immagini e webhook rientrano tutti.",
    "noteUsed": "Una volta uscito, cancellarlo dopo non lo toglie da cache e indici. Verifica che cosa hanno portato via questi comandi."
  },
  "pt-BR": {
    "level": {
      "noCommands": "Nada executado ainda",
      "none": "Sem envios externos",
      "used": "Vias de saída usadas"
    },
    "check": {
      "commands": "Comandos executados",
      "last": "Mais recente",
      "egress": "Saída"
    },
    "heading": "Exfiltração de dados",
    "kind": {
      "push": "git push",
      "upload": "envio com corpo",
      "webhook": "webhook",
      "copy": "cópia remota",
      "secretsRead": "leitura de arquivo secreto"
    },
    "desc": "Procura comandos que mandam dados para fora. Não inspeciona o conteúdo — o que importa é se um caminho de saída foi de fato usado, porque o que saiu não se chama de volta.",
    "note": "O que conta como «mandar para fora» hoje é amplo — commits, pushes, chamadas de API, requisições de URL de imagem e webhooks entram todos.",
    "noteUsed": "Uma vez fora, apagar depois não remove de caches e índices. Confira o que esses comandos levaram."
  }
} as const;
