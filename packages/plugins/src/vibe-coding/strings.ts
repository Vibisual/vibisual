/**
 * vibe-coding — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.vibeCoding` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Its defining trait is accepting output without reading every line. It has not disappeared — its range narrowed to prototypes, exploration and throwaway tools.",
    "heading": "Vibe Coding",
    "level": {
      "vibe": "Little supervision",
      "mixed": "Some supervision",
      "supervised": "Supervised"
    },
    "check": {
      "supervision": "Supervision signals",
      "reviews": "Reviews",
      "rules": "Rule characters"
    },
    "note": "The judgement is simply how long this code has to live — a day means vibe, three years means specification."
  },
  "ko": {
    "desc": "정의적 특징은 모든 줄을 읽지 않고 받아들이는 것입니다. 사라진 게 아니라 적용 범위가 프로토타입·탐색·일회성 도구로 좁혀졌습니다.",
    "heading": "바이브 코딩",
    "level": {
      "vibe": "감독 거의 없음",
      "mixed": "일부 감독",
      "supervised": "감독됨"
    },
    "check": {
      "supervision": "감독 신호",
      "reviews": "검수",
      "rules": "규칙 글자 수"
    },
    "note": "판단 기준은 하나입니다 — 이 코드가 얼마나 오래 살아야 하는가. 하루면 바이브, 3년이면 명세."
  },
  "ja": {
    "check": {
      "reviews": "検収",
      "rules": "ルール文字数",
      "supervision": "監督の要素"
    },
    "heading": "バイブコーディング",
    "level": {
      "vibe": "監督がほぼない",
      "mixed": "監督が一部あり",
      "supervised": "監督あり"
    },
    "desc": "定義的な特徴は、すべての行を読まずに受け入れることです。消えたわけではなく、適用範囲がプロトタイプ・探索・使い捨ての道具に狭まりました。",
    "note": "判断基準は一つです — このコードがどれだけ長く生きる必要があるか。一日ならバイブ、三年なら仕様。"
  },
  "zh-CN": {
    "check": {
      "reviews": "检查",
      "rules": "规则字数",
      "supervision": "监督信号"
    },
    "heading": "氛围式编码",
    "level": {
      "vibe": "几乎无监督",
      "mixed": "有一定监督",
      "supervised": "有监督"
    },
    "desc": "它的定义性特征是不逐行阅读就接受输出。它并没有消失 — 适用范围收窄到了原型、探索和一次性工具。",
    "note": "判断标准只有一个 — 这段代码要活多久。一天就用氛围式，三年就写规格。"
  },
  "es": {
    "check": {
      "reviews": "Revisiones",
      "rules": "Caracteres de reglas",
      "supervision": "Señales de supervisión"
    },
    "heading": "Vibe coding",
    "level": {
      "vibe": "Poca supervisión",
      "mixed": "Algo de supervisión",
      "supervised": "Supervisado"
    },
    "desc": "Su rasgo definitorio es aceptar la salida sin leer cada línea. No ha desaparecido — su alcance se estrechó a prototipos, exploración y herramientas de usar y tirar.",
    "note": "El criterio es simplemente cuánto tiene que vivir este código — un día es vibe, tres años es especificación."
  },
  "es-419": {
    "check": {
      "reviews": "Revisiones",
      "rules": "Caracteres de reglas",
      "supervision": "Señales de supervisión"
    },
    "heading": "Vibe coding",
    "level": {
      "vibe": "Poca supervisión",
      "mixed": "Algo de supervisión",
      "supervised": "Supervisado"
    },
    "desc": "Su rasgo definitorio es aceptar la salida sin leer cada línea. No ha desaparecido — su alcance se estrechó a prototipos, exploración y herramientas de usar y tirar.",
    "note": "El criterio es simplemente cuánto tiene que vivir este código — un día es vibe, tres años es especificación."
  },
  "fr": {
    "check": {
      "reviews": "Revues",
      "rules": "Caractères de règles",
      "supervision": "Signaux de supervision"
    },
    "heading": "Vibe coding",
    "level": {
      "vibe": "Peu de supervision",
      "mixed": "Un peu de supervision",
      "supervised": "Supervisé"
    },
    "desc": "Son trait distinctif est d’accepter la sortie sans lire chaque ligne. Il n’a pas disparu — son domaine s’est rétréci aux prototypes, à l’exploration et aux outils jetables.",
    "note": "Le critère est simplement la durée de vie exigée de ce code — un jour, c’est du vibe ; trois ans, c’est une spécification."
  },
  "de": {
    "check": {
      "reviews": "Prüfungen",
      "rules": "Regelzeichen",
      "supervision": "Aufsichtssignale"
    },
    "heading": "Vibe Coding",
    "level": {
      "vibe": "Kaum Aufsicht",
      "mixed": "Etwas Aufsicht",
      "supervised": "Beaufsichtigt"
    },
    "desc": "Sein bestimmendes Merkmal ist, Ausgaben anzunehmen, ohne jede Zeile zu lesen. Es ist nicht verschwunden — sein Bereich verengte sich auf Prototypen, Erkundung und Wegwerfwerkzeuge.",
    "note": "Der Maßstab ist schlicht, wie lange dieser Code leben muss — ein Tag heißt Vibe, drei Jahre heißen Spezifikation."
  },
  "hi": {
    "check": {
      "reviews": "समीक्षाएँ",
      "rules": "नियम अक्षर",
      "supervision": "पर्यवेक्षण संकेत"
    },
    "heading": "वाइब कोडिंग",
    "level": {
      "vibe": "बहुत कम पर्यवेक्षण",
      "mixed": "कुछ पर्यवेक्षण",
      "supervised": "पर्यवेक्षित"
    },
    "desc": "इसकी पहचान है हर पंक्ति पढ़े बिना आउटपुट स्वीकार कर लेना। यह ख़त्म नहीं हो रहा — इसका दायरा सिमटकर प्रोटोटाइप, खोजबीन और एक-बार के औज़ारों तक आ रहा है।",
    "note": "पैमाना सीधा है: यह कोड कितने समय जीना चाहिए — एक दिन यानी vibe, तीन साल यानी विनिर्देश।"
  },
  "id": {
    "check": {
      "reviews": "Tinjauan",
      "rules": "Karakter aturan",
      "supervision": "Sinyal pengawasan"
    },
    "heading": "Vibe coding",
    "level": {
      "vibe": "Sedikit pengawasan",
      "mixed": "Ada sedikit pengawasan",
      "supervised": "Diawasi"
    },
    "desc": "Ciri khasnya adalah menerima keluaran tanpa membaca tiap baris. Ia tidak hilang — jangkauannya menyempit ke purwarupa, penjelajahan, dan alat sekali pakai.",
    "note": "Ukurannya sederhana: berapa lama kode ini harus hidup — sehari berarti vibe, tiga tahun berarti spesifikasi."
  },
  "it": {
    "check": {
      "reviews": "Revisioni",
      "rules": "Caratteri regole",
      "supervision": "Segnali di supervisione"
    },
    "heading": "Vibe coding",
    "level": {
      "vibe": "Poca supervisione",
      "mixed": "Un po’ di supervisione",
      "supervised": "Supervisionato"
    },
    "desc": "Il suo tratto distintivo è accettare l’output senza leggere ogni riga. Non è sparito — il suo raggio si è ristretto a prototipi, esplorazione e strumenti usa e getta.",
    "note": "Il criterio è semplicemente quanto a lungo debba vivere questo codice — un giorno è vibe, tre anni è specifica."
  },
  "pt-BR": {
    "check": {
      "reviews": "Revisões",
      "rules": "Caracteres das regras",
      "supervision": "Sinais de supervisão"
    },
    "heading": "Vibe coding",
    "level": {
      "vibe": "Pouca supervisão",
      "mixed": "Alguma supervisão",
      "supervised": "Supervisionado"
    },
    "desc": "Seu traço definidor é aceitar a saída sem ler cada linha. Não desapareceu — seu alcance estreitou para protótipos, exploração e ferramentas descartáveis.",
    "note": "O critério é simplesmente quanto tempo este código precisa viver — um dia é vibe, três anos é especificação."
  }
} as const;
