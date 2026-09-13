/**
 * query-rewriting — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.queryRewriting` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Raw history and reusable knowledge are not the same shape, so what was observed has to be reshaped on the way in. Here that reshaping happens during analysis — repeated runs are folded into one identity and given a name.",
    "heading": "Query Rewriting",
    "level": {
      "none": "Nothing spotted",
      "empty": "Spotted, nothing written",
      "effective": "Spotted and written"
    },
    "check": {
      "searches": "Runs spotted",
      "hits": "Written down"
    },
    "note": "Spotting runs but never writing one down usually means the work is not actually repeating the same way twice."
  },
  "ko": {
    "desc": "날것의 이력과 다시 쓸 수 있는 지식은 모양이 다르므로, 본 것을 들어오는 길에 다시 빚어야 합니다. 여기서는 그 일이 분석 중에 일어납니다 — 되풀이된 일들이 하나로 접히고 이름을 얻습니다.",
    "heading": "질의 재작성",
    "level": {
      "none": "잡힌 것 없음",
      "empty": "잡혔지만 안 적힘",
      "effective": "잡혀서 적힘"
    },
    "check": {
      "searches": "잡은 일",
      "hits": "적힌 절차"
    },
    "note": "일은 잡히는데 적히는 절차가 없다면 대개 같은 모양으로 두 번 되풀이되지 않는다는 뜻입니다."
  },
  "ja": {
    "level": {
      "none": "検索なし",
      "empty": "検索が空振り",
      "effective": "検索が当たった"
    },
    "heading": "クエリ書き換え",
    "check": {
      "searches": "検索回数",
      "hits": "見つかったカード"
    },
    "desc": "人が使う言葉と保存された知識の言い回しはうまく噛み合わないので、問いを整える必要があります。ここではエージェント自身が検索語を作るため、書き換えはエージェント側で起きます。",
    "note": "検索が空振りを続けるなら、大抵は保存された言い回しと尋ねる言い回しがそもそも重なっていないということです。"
  },
  "zh-CN": {
    "level": {
      "none": "无检索",
      "empty": "检索无命中",
      "effective": "检索有命中"
    },
    "heading": "查询改写",
    "check": {
      "searches": "检索次数",
      "hits": "找到的卡片"
    },
    "desc": "人使用的措辞与知识库中存储的措辞很少一致，所以查询需要重塑。这里由智能体自己写检索词，因此改写发生在它那一侧。",
    "note": "检索持续空手而归，通常意味着存储时的措辞与提问时的措辞根本没有交集。"
  },
  "es": {
    "level": {
      "none": "Sin búsquedas",
      "empty": "Búsquedas sin resultados",
      "effective": "Las búsquedas encontraron"
    },
    "heading": "Reescritura de consultas",
    "check": {
      "searches": "Búsquedas",
      "hits": "Tarjetas encontradas"
    },
    "desc": "Las palabras de una persona y las guardadas en el conocimiento rara vez coinciden, así que la consulta hay que remodelarla. Aquí el agente escribe sus propios términos, de modo que la reescritura ocurre de su lado.",
    "note": "Búsquedas que vuelven vacías una y otra vez suelen significar que la redacción guardada y la preguntada nunca se solapan."
  },
  "es-419": {
    "level": {
      "none": "Sin búsquedas",
      "empty": "Búsquedas sin resultados",
      "effective": "Las búsquedas encontraron"
    },
    "heading": "Reescritura de consultas",
    "check": {
      "searches": "Búsquedas",
      "hits": "Tarjetas encontradas"
    },
    "desc": "Las palabras de una persona y las guardadas en el conocimiento rara vez coinciden, así que la consulta hay que remodelarla. Aquí el agente escribe sus propios términos, de modo que la reescritura ocurre de su lado.",
    "note": "Búsquedas que vuelven vacías una y otra vez suelen significar que la redacción guardada y la preguntada nunca se solapan."
  },
  "fr": {
    "level": {
      "none": "Aucune recherche",
      "empty": "Recherches sans résultat",
      "effective": "Recherches fructueuses"
    },
    "heading": "Réécriture de requêtes",
    "check": {
      "searches": "Recherches",
      "hits": "Cartes trouvées"
    },
    "desc": "Les mots d’une personne et ceux stockés dans le savoir coïncident rarement : la requête doit être remodelée. Ici l’agent écrit lui-même ses termes de recherche, la réécriture se fait donc de son côté.",
    "note": "Des recherches qui reviennent toujours vides signifient d’ordinaire que la formulation stockée et la formulation posée ne se recoupent jamais."
  },
  "de": {
    "level": {
      "none": "Keine Suchen",
      "empty": "Suchen ohne Treffer",
      "effective": "Suchen fanden Treffer"
    },
    "heading": "Anfrage-Umschreibung",
    "check": {
      "searches": "Suchen",
      "hits": "Gefundene Karten"
    },
    "desc": "Die Worte eines Menschen und die im Wissen gespeicherten Worte decken sich selten, die Anfrage muss also umgeformt werden. Hier schreibt der Agent seine eigenen Suchbegriffe, das Umschreiben passiert also auf seiner Seite.",
    "note": "Suchen, die immer leer zurückkommen, bedeuten meist, dass gespeicherte und gefragte Formulierung sich nie überschneiden."
  },
  "hi": {
    "level": {
      "none": "कोई खोज नहीं",
      "empty": "खोज में कुछ नहीं",
      "effective": "खोज में मिला"
    },
    "heading": "क्वेरी पुनर्लेखन",
    "check": {
      "searches": "खोजें",
      "hits": "मिले कार्ड"
    },
    "desc": "किसी के शब्द और ज्ञान में सहेजे शब्द शायद ही मेल खाते हैं, इसलिए कुंजी को दोबारा गढ़ना पड़ता है। यहाँ एजेंट अपने खोज-शब्द ख़ुद लिखता है, इसलिए पुनर्लेखन उसी की ओर होता है।",
    "note": "जो खोज बार-बार ख़ाली लौटे, उसका आम मतलब है कि सहेजे और पूछे गए शब्द कभी आपस में मिले ही नहीं।"
  },
  "id": {
    "level": {
      "none": "Tanpa pencarian",
      "empty": "Pencarian nihil",
      "effective": "Pencarian menemukan"
    },
    "heading": "Penulisan ulang kueri",
    "check": {
      "searches": "Pencarian",
      "hits": "Kartu ditemukan"
    },
    "desc": "Kata-kata seseorang dan kata-kata yang tersimpan dalam pengetahuan jarang cocok, jadi kuerinya harus dibentuk ulang. Di sini agen menulis sendiri istilah pencariannya, sehingga penulisan ulang terjadi di sisinya.",
    "note": "Pencarian yang terus kembali kosong biasanya berarti susunan kata yang tersimpan dan yang ditanyakan tak pernah beririsan."
  },
  "it": {
    "level": {
      "none": "Nessuna ricerca",
      "empty": "Ricerche senza esito",
      "effective": "Ricerche con esito"
    },
    "heading": "Riscrittura delle query",
    "check": {
      "searches": "Ricerche",
      "hits": "Schede trovate"
    },
    "desc": "Le parole di una persona e quelle conservate nella conoscenza combaciano di rado, quindi l’interrogazione va rimodellata. Qui l’agente scrive da sé i termini di ricerca, perciò la riscrittura avviene dalla sua parte.",
    "note": "Ricerche che tornano vuote di continuo di solito significano che la formulazione salvata e quella chiesta non si sovrappongono mai."
  },
  "pt-BR": {
    "level": {
      "none": "Sem buscas",
      "empty": "Buscas sem resultado",
      "effective": "Buscas encontraram"
    },
    "heading": "Reescrita de consultas",
    "check": {
      "searches": "Buscas",
      "hits": "Cartões encontrados"
    },
    "desc": "As palavras de uma pessoa e as guardadas no conhecimento raramente coincidem, então a consulta precisa ser remodelada. Aqui o agente escreve os próprios termos, então a reescrita acontece do lado dele.",
    "note": "Buscas que voltam vazias repetidamente costumam significar que a redação guardada e a perguntada nunca se sobrepõem."
  }
} as const;
