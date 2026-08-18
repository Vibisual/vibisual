/**
 * model-routing — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.modelRouting` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Puts the current model next to the size of the work so promotion or demotion is a visible decision. It never switches models for you — that stays your call.",
    "heading": "Model Routing",
    "level": {
      "fit": "Fits the work",
      "upgrade": "Consider promoting",
      "downgrade": "Consider demoting"
    },
    "check": {
      "model": "Model",
      "effort": "Effort",
      "turns": "Turns so far"
    },
    "advice": {
      "fit": "Model and workload look matched. Cascades pay off when the cheap model handles the easy majority.",
      "upgrade": "This has become a long task on a small model. Promoting it usually costs less than repeated retries.",
      "downgrade": "A short task on the largest model. A cheaper model would likely finish this identically."
    }
  },
  "ko": {
    "desc": "지금 모델을 작업 크기와 나란히 놓아 승급·강등을 눈으로 판단하게 합니다. 모델을 대신 바꾸지 않습니다 — 그건 사용자 결정입니다.",
    "heading": "모델 라우팅",
    "level": {
      "fit": "작업에 맞음",
      "upgrade": "승급 검토",
      "downgrade": "강등 검토"
    },
    "check": {
      "model": "모델",
      "effort": "사고 깊이",
      "turns": "지금까지 턴"
    },
    "advice": {
      "fit": "모델과 작업 크기가 맞아 보입니다. 계단식은 쉬운 다수를 싼 모델이 처리할 때 이득이 납니다.",
      "upgrade": "작은 모델에서 작업이 길어졌습니다. 승급이 재시도를 반복하는 것보다 대개 쌉니다.",
      "downgrade": "가장 큰 모델로 짧은 작업을 했습니다. 더 싼 모델도 같은 결과를 냈을 가능성이 높습니다."
    }
  },
  "ja": {
    "check": {
      "model": "モデル",
      "effort": "思考の深さ",
      "turns": "これまでのターン"
    },
    "heading": "モデルルーティング",
    "level": {
      "fit": "作業に合う",
      "upgrade": "昇格を検討",
      "downgrade": "降格を検討"
    },
    "desc": "現在のモデルを作業の大きさと並べて、昇格・降格を目で判断できるようにします。モデルを勝手に切り替えることはありません — それは利用者の判断です。",
    "advice": {
      "fit": "モデルと作業量が釣り合って見えます。階段式は、易しい大多数を安いモデルが処理するときに得になります。",
      "upgrade": "小さいモデルで作業が長引いています。昇格させる方が、再試行を繰り返すより安く済むのが普通です。",
      "downgrade": "最も大きいモデルで短い作業をしています。より安いモデルでも同じ結果になった可能性が高いです。"
    }
  },
  "zh-CN": {
    "check": {
      "model": "模型",
      "effort": "思考强度",
      "turns": "目前轮次"
    },
    "heading": "模型路由",
    "level": {
      "fit": "与任务匹配",
      "upgrade": "建议升级",
      "downgrade": "建议降级"
    },
    "desc": "把当前模型与任务规模并排放，让升级或降级成为可见的判断。它不会替你切换模型 — 那是你的决定。",
    "advice": {
      "fit": "模型与工作量看起来匹配。阶梯式的收益来自让廉价模型处理容易的大多数。",
      "upgrade": "小模型上的任务已经拉长。升级通常比反复重试更省。",
      "downgrade": "用最大的模型做了很短的任务。更便宜的模型多半也能得到相同结果。"
    }
  },
  "es": {
    "check": {
      "model": "Modelo",
      "effort": "Esfuerzo",
      "turns": "Turnos hasta ahora"
    },
    "heading": "Enrutado de modelos",
    "level": {
      "fit": "Encaja con la tarea",
      "upgrade": "Considerar subir",
      "downgrade": "Considerar bajar"
    },
    "desc": "Pone el modelo actual junto al tamaño del trabajo para que subir o bajar de nivel sea una decisión visible. Nunca cambia el modelo por ti — eso sigue siendo tu decisión.",
    "advice": {
      "fit": "Modelo y carga de trabajo parecen acordes. Las cascadas rinden cuando el modelo barato resuelve la mayoría fácil.",
      "upgrade": "Esto se ha vuelto una tarea larga sobre un modelo pequeño. Promoverlo suele costar menos que repetir intentos.",
      "downgrade": "Una tarea corta sobre el modelo más grande. Un modelo más barato probablemente habría dado el mismo resultado."
    }
  },
  "es-419": {
    "check": {
      "model": "Modelo",
      "effort": "Esfuerzo",
      "turns": "Turnos hasta ahora"
    },
    "heading": "Enrutado de modelos",
    "level": {
      "fit": "Encaja con la tarea",
      "upgrade": "Considerar subir",
      "downgrade": "Considerar bajar"
    },
    "desc": "Pone el modelo actual junto al tamaño del trabajo para que subir o bajar de nivel sea una decisión visible. Nunca cambia el modelo por ti — eso sigue siendo tu decisión.",
    "advice": {
      "fit": "Modelo y carga de trabajo parecen acordes. Las cascadas rinden cuando el modelo barato resuelve la mayoría fácil.",
      "upgrade": "Esto se ha vuelto una tarea larga sobre un modelo pequeño. Promoverlo suele costar menos que repetir intentos.",
      "downgrade": "Una tarea corta sobre el modelo más grande. Un modelo más barato probablemente habría dado el mismo resultado."
    }
  },
  "fr": {
    "check": {
      "model": "Modèle",
      "effort": "Effort",
      "turns": "Tours jusqu’ici"
    },
    "heading": "Routage de modèles",
    "level": {
      "fit": "Adapté au travail",
      "upgrade": "Envisager de promouvoir",
      "downgrade": "Envisager de rétrograder"
    },
    "desc": "Place le modèle actuel à côté de l’ampleur du travail pour faire de la promotion ou de la rétrogradation une décision visible. Il ne change jamais de modèle à votre place — cela reste votre choix.",
    "advice": {
      "fit": "Le modèle et la charge semblent accordés. Les cascades paient lorsque le modèle bon marché traite la majorité facile.",
      "upgrade": "C’est devenu une tâche longue sur un petit modèle. Promouvoir coûte généralement moins que multiplier les reprises.",
      "downgrade": "Une tâche courte sur le plus gros modèle. Un modèle moins cher aurait très probablement abouti au même résultat."
    }
  },
  "de": {
    "check": {
      "model": "Modell",
      "effort": "Denkaufwand",
      "turns": "Züge bisher"
    },
    "heading": "Modell-Routing",
    "level": {
      "fit": "Passt zur Aufgabe",
      "upgrade": "Höherstufung erwägen",
      "downgrade": "Herabstufung erwägen"
    },
    "desc": "Stellt das aktuelle Modell neben den Umfang der Arbeit, damit Höher- oder Herabstufung eine sichtbare Entscheidung wird. Es wechselt nie selbst das Modell — das bleibt Ihre Entscheidung.",
    "advice": {
      "fit": "Modell und Arbeitslast wirken passend. Kaskaden zahlen sich aus, wenn das günstige Modell die einfache Mehrheit erledigt.",
      "upgrade": "Auf einem kleinen Modell ist daraus eine lange Aufgabe geworden. Höherstufen kostet meist weniger als wiederholte Versuche.",
      "downgrade": "Eine kurze Aufgabe auf dem größten Modell. Ein günstigeres Modell hätte das sehr wahrscheinlich genauso erledigt."
    }
  },
  "hi": {
    "check": {
      "model": "मॉडल",
      "effort": "प्रयास",
      "turns": "अब तक टर्न"
    },
    "heading": "मॉडल रूटिंग",
    "level": {
      "fit": "कार्य से मेल",
      "upgrade": "बढ़ाने पर विचार",
      "downgrade": "घटाने पर विचार"
    },
    "desc": "मौजूदा मॉडल को काम के आकार के बग़ल में रखता है ताकि ऊपर या नीचे जाना एक दिखने वाला निर्णय बने। यह आपके लिए मॉडल कभी नहीं बदलता — वह निर्णय आपका ही रहता है।",
    "advice": {
      "fit": "मॉडल और भार आपस में मेल खाते दिखते हैं। कैस्केड तब फ़ायदा देता है जब आसान बहुमत सस्ता मॉडल सँभाल ले।",
      "upgrade": "यह छोटे मॉडल पर लंबा काम बन चुका है। ऊपर जाना आम तौर पर बार-बार कोशिश करने से सस्ता पड़ता है।",
      "downgrade": "सबसे बड़े मॉडल पर छोटा काम। सस्ता मॉडल भी बहुत संभवतः यही नतीजा देगा।"
    }
  },
  "id": {
    "check": {
      "model": "Model",
      "effort": "Upaya",
      "turns": "Giliran sejauh ini"
    },
    "heading": "Perutean model",
    "level": {
      "fit": "Cocok dengan tugas",
      "upgrade": "Pertimbangkan naikkan",
      "downgrade": "Pertimbangkan turunkan"
    },
    "desc": "Menaruh model saat ini di sebelah besarnya pekerjaan agar menaikkan atau menurunkan kelas menjadi keputusan yang terlihat. Ia tidak pernah mengganti model untuk Anda — itu tetap keputusan Anda.",
    "advice": {
      "fit": "Model dan beban tampak sepadan. Kaskade menguntungkan ketika model murah menangani mayoritas yang mudah.",
      "upgrade": "Ini sudah menjadi tugas panjang di atas model kecil. Menaikkan kelas biasanya lebih murah daripada mengulang percobaan.",
      "downgrade": "Tugas pendek di model terbesar. Model yang lebih murah kemungkinan besar memberi hasil yang sama."
    }
  },
  "it": {
    "check": {
      "model": "Modello",
      "effort": "Sforzo",
      "turns": "Turni finora"
    },
    "heading": "Instradamento modelli",
    "level": {
      "fit": "Adatto al lavoro",
      "upgrade": "Valuta l’upgrade",
      "downgrade": "Valuta il downgrade"
    },
    "desc": "Mette il modello attuale accanto alla dimensione del lavoro, così promuovere o retrocedere diventa una decisione visibile. Non cambia mai il modello al posto tuo — quella resta una tua scelta.",
    "advice": {
      "fit": "Modello e carico sembrano in linea. Le cascate rendono quando il modello economico gestisce la maggioranza facile.",
      "upgrade": "È diventata un’attività lunga su un modello piccolo. Promuovere di solito costa meno che ripetere i tentativi.",
      "downgrade": "Un’attività breve sul modello più grande. Un modello più economico avrebbe probabilmente dato lo stesso risultato."
    }
  },
  "pt-BR": {
    "check": {
      "model": "Modelo",
      "effort": "Esforço",
      "turns": "Turnos até agora"
    },
    "heading": "Roteamento de modelos",
    "level": {
      "fit": "Adequado ao trabalho",
      "upgrade": "Considerar promover",
      "downgrade": "Considerar rebaixar"
    },
    "desc": "Coloca o modelo atual ao lado do tamanho do trabalho para que promover ou rebaixar seja uma decisão visível. Ele nunca troca o modelo por você — isso continua sendo sua escolha.",
    "advice": {
      "fit": "Modelo e carga parecem combinar. Cascatas compensam quando o modelo barato resolve a maioria fácil.",
      "upgrade": "Isso virou uma tarefa longa em um modelo pequeno. Promover costuma custar menos do que repetir tentativas.",
      "downgrade": "Uma tarefa curta no maior modelo. Um modelo mais barato provavelmente teria chegado ao mesmo resultado."
    }
  }
} as const;
