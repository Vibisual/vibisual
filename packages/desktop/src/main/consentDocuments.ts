import { createHash } from 'node:crypto';
import eula from '../../../../EULA.md?raw';
import privacy from '../../../../PRIVACY.md?raw';
import en from '../../build/license/license_en_US.txt?raw';
import ko from '../../build/license/license_ko_KR.txt?raw';
import ja from '../../build/license/license_ja_JP.txt?raw';
import zh from '../../build/license/license_zh_CN.txt?raw';
import de from '../../build/license/license_de_DE.txt?raw';
import fr from '../../build/license/license_fr_FR.txt?raw';
import es from '../../build/license/license_es_ES.txt?raw';
import pt from '../../build/license/license_pt_BR.txt?raw';
import it from '../../build/license/license_it_IT.txt?raw';
import id from '../../build/license/license_id_ID.txt?raw';
import hi from '../../build/license/license_hi_IN.txt?raw';

export interface ConsentDocuments {
  version: string;
  digest: string;
  eula: string;
  privacy: string;
  summaries: Record<string, string>;
}

/** The exact documents shipped with this build, without network or a mutable main-branch URL. */
export function consentDocuments(): ConsentDocuments {
  const normalize = (text: string): string => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const fullTerms = normalize(eula);
  const version = /\*\*Version (\d+\.\d+) — effective (\d{4}-\d{2}-\d{2})\*\*/.exec(fullTerms)?.[1];
  if (!version) throw new Error('The bundled EULA has no version');
  const summaries = Object.fromEntries(Object.entries({ en, ko, ja, 'zh-CN': zh, de, fr, es, 'pt-BR': pt, it, id, hi })
    .map(([locale, text]) => [locale, normalize(text)]));
  const privacyText = normalize(privacy);
  if (!privacyText.trim() || Object.values(summaries).some((text) => !text.trim())) {
    throw new Error('A bundled consent document is empty');
  }
  // Include translations as well: a changed notice requires a new explicit decision.
  const digest = createHash('sha256').update(JSON.stringify([fullTerms, privacyText, summaries])).digest('hex');
  return { version, digest, eula: fullTerms, privacy: privacyText, summaries: { ...summaries, 'es-419': summaries.es } };
}
