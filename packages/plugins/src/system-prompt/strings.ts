/**
 * system-prompt — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.systemPrompt` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows the size of the always-on instruction layer. A system prompt has to sit at the right altitude — too specific and it is brittle, too abstract and it is ignored.",
    "heading": "System Prompt",
    "level": {
      "none": "No custom rules",
      "sized": "Reasonably sized",
      "long": "Long"
    },
    "check": {
      "rules": "Rule characters",
      "rulesTokens": "Rule tokens",
      "base": "Base prompt",
      "skills": "Skills"
    },
    "note": "Background work such as summarising or classifying rarely needs a general-purpose prompt — a short dedicated one with no tools is usually the right answer.",
    "noteLong": "These rules ride along on every single turn. Long rules cost tokens continuously and get diluted first when the session grows."
  },
  "ko": {
    "desc": "상시로 얹히는 지시층의 크기를 보여줍니다. 시스템 프롬프트는 올바른 고도에 써야 합니다 — 너무 구체적이면 취약해지고, 너무 추상적이면 지켜지지 않습니다.",
    "heading": "시스템 프롬프트",
    "level": {
      "none": "커스텀 규칙 없음",
      "sized": "적당한 크기",
      "long": "김"
    },
    "check": {
      "rules": "규칙 글자 수",
      "rulesTokens": "규칙 토큰",
      "base": "기본 프롬프트",
      "skills": "스킬 수"
    },
    "note": "요약·분류 같은 배경 작업에는 범용 프롬프트가 대개 낭비입니다 — 짧은 전용 프롬프트에 도구 없음이 정답인 경우가 많습니다.",
    "noteLong": "이 규칙은 매 턴 함께 실립니다. 길수록 토큰을 계속 쓰고, 세션이 길어지면 가장 먼저 희석됩니다."
  },
  "ja": {
    "level": {
      "long": "長い",
      "none": "独自ルールなし",
      "sized": "ほどよい長さ"
    },
    "check": {
      "rules": "ルール文字数",
      "skills": "スキル",
      "rulesTokens": "ルールのトークン",
      "base": "基本プロンプト"
    },
    "heading": "システムプロンプト",
    "desc": "常時載る指示層の大きさを示します。システムプロンプトは「正しい高度」で書く必要があります — 具体的すぎれば脆く、抽象的すぎれば守られません。",
    "note": "要約や分類のような裏方処理に汎用プロンプトは大抵むだです — 短い専用プロンプトにツールなしが正解であることが多いです。",
    "noteLong": "このルールは毎ターン一緒に載ります。長いほどトークンを使い続け、セッションが伸びると最初に薄まります。"
  },
  "zh-CN": {
    "level": {
      "long": "较长",
      "none": "无自定义规则",
      "sized": "长度适中"
    },
    "check": {
      "rules": "规则字数",
      "skills": "技能",
      "rulesTokens": "规则令牌",
      "base": "基础提示词"
    },
    "heading": "系统提示词",
    "desc": "显示常驻指令层的大小。系统提示词要写在「合适的高度」 — 太具体就脆弱，太抽象就没人遵守。",
    "note": "摘要、分类这类后台处理通常并不需要通用提示词 — 一段简短的专用提示词加上不给工具，往往才是正解。",
    "noteLong": "这些规则每一轮都会一起载入。越长就持续消耗令牌，而且会话变长时最先被稀释。"
  },
  "es": {
    "level": {
      "long": "Largo",
      "none": "Sin reglas propias",
      "sized": "Tamaño razonable"
    },
    "check": {
      "rules": "Caracteres de reglas",
      "skills": "Habilidades",
      "rulesTokens": "Tokens de reglas",
      "base": "Prompt base"
    },
    "heading": "Prompt del sistema",
    "desc": "Muestra el tamaño de la capa de instrucciones siempre activa. Un prompt de sistema debe estar a la altura correcta — demasiado concreto se vuelve frágil, demasiado abstracto se ignora.",
    "note": "El trabajo de fondo, como resumir o clasificar, rara vez necesita un prompt de propósito general — uno corto y dedicado, sin herramientas, suele ser la respuesta.",
    "noteLong": "Estas reglas viajan en cada turno. Si son largas, cuestan tokens de forma continua y se diluyen las primeras cuando la sesión crece."
  },
  "es-419": {
    "level": {
      "long": "Largo",
      "none": "Sin reglas propias",
      "sized": "Tamaño razonable"
    },
    "check": {
      "rules": "Caracteres de reglas",
      "skills": "Habilidades",
      "rulesTokens": "Tokens de reglas",
      "base": "Prompt base"
    },
    "heading": "Prompt del sistema",
    "desc": "Muestra el tamaño de la capa de instrucciones siempre activa. Un prompt de sistema debe estar a la altura correcta — demasiado concreto se vuelve frágil, demasiado abstracto se ignora.",
    "note": "El trabajo de fondo, como resumir o clasificar, rara vez necesita un prompt de propósito general — uno corto y dedicado, sin herramientas, suele ser la respuesta.",
    "noteLong": "Estas reglas viajan en cada turno. Si son largas, cuestan tokens de forma continua y se diluyen las primeras cuando la sesión crece."
  },
  "fr": {
    "level": {
      "long": "Long",
      "none": "Aucune règle propre",
      "sized": "Taille raisonnable"
    },
    "check": {
      "rules": "Caractères de règles",
      "skills": "Compétences",
      "rulesTokens": "Jetons de règles",
      "base": "Prompt de base"
    },
    "heading": "Prompt système",
    "desc": "Montre la taille de la couche d’instructions toujours active. Un prompt système doit être à la bonne altitude — trop précis il devient fragile, trop abstrait il est ignoré.",
    "note": "Le travail de fond comme résumer ou classer a rarement besoin d’un prompt généraliste — un prompt court et dédié, sans outils, est souvent la bonne réponse.",
    "noteLong": "Ces règles voyagent à chaque tour. Longues, elles coûtent des jetons en continu et se diluent en premier quand la session s’allonge."
  },
  "de": {
    "level": {
      "long": "Lang",
      "none": "Keine eigenen Regeln",
      "sized": "Angemessene Größe"
    },
    "check": {
      "rules": "Regelzeichen",
      "skills": "Skills",
      "rulesTokens": "Regel-Tokens",
      "base": "Basis-Prompt"
    },
    "heading": "System-Prompt",
    "desc": "Zeigt die Größe der dauerhaft mitlaufenden Anweisungsschicht. Ein System-Prompt muss auf der richtigen Flughöhe stehen — zu konkret ist brüchig, zu abstrakt wird ignoriert.",
    "note": "Hintergrundarbeit wie Zusammenfassen oder Klassifizieren braucht selten einen Allzweck-Prompt — ein kurzer, dedizierter ohne Werkzeuge ist meist die richtige Antwort.",
    "noteLong": "Diese Regeln fahren in jedem einzelnen Zug mit. Lange Regeln kosten fortlaufend Tokens und verwässern als Erstes, wenn die Sitzung wächst."
  },
  "hi": {
    "level": {
      "long": "लंबा",
      "none": "कोई कस्टम नियम नहीं",
      "sized": "उचित आकार"
    },
    "check": {
      "rules": "नियम अक्षर",
      "skills": "स्किल",
      "rulesTokens": "नियम टोकन",
      "base": "आधार प्रॉम्प्ट"
    },
    "heading": "सिस्टम प्रॉम्प्ट",
    "desc": "हमेशा जलती रहने वाली निर्देश-परत का आकार दिखाता है। सिस्टम प्रॉम्प्ट को सही ऊँचाई पर होना चाहिए — बहुत विशिष्ट हो तो भंगुर, बहुत अमूर्त हो तो अनदेखा।",
    "note": "सारांश या वर्गीकरण जैसे पीछे के काम को शायद ही कभी सर्व-उपयोगी प्रॉम्प्ट चाहिए — छोटा, विशेष, बिना टूल वाला प्रॉम्प्ट ही उत्तर होता है।",
    "noteLong": "ये नियम हर बारी में साथ जाते हैं। लंबे हों तो लगातार टोकन खाते हैं और सत्र खिंचने पर सबसे पहले पतले पड़ते हैं।"
  },
  "id": {
    "level": {
      "long": "Panjang",
      "none": "Tanpa aturan khusus",
      "sized": "Ukuran wajar"
    },
    "check": {
      "rules": "Karakter aturan",
      "skills": "Skill",
      "rulesTokens": "Token aturan",
      "base": "Prompt dasar"
    },
    "heading": "Prompt sistem",
    "desc": "Menunjukkan besarnya lapisan instruksi yang selalu menyala. Prompt sistem harus berada di ketinggian yang tepat — terlalu spesifik jadi rapuh, terlalu abstrak jadi diabaikan.",
    "note": "Pekerjaan latar seperti meringkas atau mengklasifikasi jarang butuh prompt serbaguna — yang pendek dan khusus, tanpa alat, biasanya jawabannya.",
    "noteLong": "Aturan ini ikut di setiap giliran. Kalau panjang, ia memakan token terus-menerus dan paling awal mengencer saat sesi memanjang."
  },
  "it": {
    "level": {
      "long": "Lungo",
      "none": "Nessuna regola propria",
      "sized": "Dimensione ragionevole"
    },
    "check": {
      "rules": "Caratteri regole",
      "skills": "Competenze",
      "rulesTokens": "Token delle regole",
      "base": "Prompt di base"
    },
    "heading": "Prompt di sistema",
    "desc": "Mostra la dimensione del livello di istruzioni sempre attivo. Un prompt di sistema va scritto alla quota giusta — troppo specifico è fragile, troppo astratto viene ignorato.",
    "note": "Il lavoro di fondo come riassumere o classificare raramente ha bisogno di un prompt generalista — uno breve e dedicato, senza strumenti, di solito è la risposta giusta.",
    "noteLong": "Queste regole viaggiano a ogni singolo turno. Se sono lunghe costano token di continuo e si diluiscono per prime quando la sessione cresce."
  },
  "pt-BR": {
    "level": {
      "long": "Longo",
      "none": "Sem regras próprias",
      "sized": "Tamanho razoável"
    },
    "check": {
      "rules": "Caracteres das regras",
      "skills": "Habilidades",
      "rulesTokens": "Tokens das regras",
      "base": "Prompt base"
    },
    "heading": "Prompt do sistema",
    "desc": "Mostra o tamanho da camada de instruções sempre ativa. Um prompt de sistema precisa estar na altura certa — específico demais fica frágil, abstrato demais é ignorado.",
    "note": "Trabalho de fundo como resumir ou classificar raramente precisa de um prompt genérico — um curto e dedicado, sem ferramentas, costuma ser a resposta.",
    "noteLong": "Estas regras viajam em cada turno. Longas, custam tokens continuamente e se diluem primeiro quando a sessão cresce."
  }
} as const;
