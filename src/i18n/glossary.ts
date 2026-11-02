// Glossary terms in both languages. See docs/DESIGN.md §5.1.

import { getLang } from '.';

export interface Term {
  et: string;
  en: string;
  explain: { et: string; en: string };
}

export const GLOSSARY = {
  bias: {
    et: 'eelpingekaader',
    en: 'bias frame',
    explain: {
      et: 'Nullise säriajaga kaader. Näitab, mis väärtuse kaamera annab ka siis, kui valgust pole üldse.',
      en: 'A frame with zero exposure. It shows the value the camera gives even when there is no light at all.',
    },
  },
  dark: {
    et: 'pimekaader',
    en: 'dark frame',
    explain: {
      et: 'Suletud katikuga tehtud kaader. Näitab, kui palju signaali tekib sensoris soojuse tõttu.',
      en: 'A frame taken with the shutter closed. It shows how much signal the sensor makes from heat.',
    },
  },
  flat: {
    et: 'tasaväljakaader',
    en: 'flat frame',
    explain: {
      et: 'Ühtlaselt valgustatud taeva või ekraani kaader. Näitab, kui tundlik on iga piksel ja kus on tolm või vinjeteerimine.',
      en: 'A frame of an evenly lit sky or screen. It shows how sensitive each pixel is, and where dust or vignetting is.',
    },
  },
  light: {
    et: 'objektikaader',
    en: 'light frame',
    explain: {
      et: 'Taevaobjekti kaader – see, mida tegelikult pildistada taheti.',
      en: 'A frame of the sky object – what was actually meant to be photographed.',
    },
  },
  master: {
    et: 'koondkaader',
    en: 'master frame',
    explain: {
      et: 'Mitmest samaliigilisest kaadrist kokku arvutatud kaader, milles on vähem müra.',
      en: 'A frame computed from several frames of the same kind, with less noise.',
    },
  },
  overscan: {
    et: 'ülelugemisala',
    en: 'overscan',
    explain: {
      et: 'Pildi servas olevad veerud, mis ei saa valgust. Need näitavad eelpinge taset.',
      en: 'Columns at the edge of the image that get no light. They show the bias level.',
    },
  },
  adu: {
    et: 'ADU',
    en: 'ADU',
    explain: {
      et: 'Analoog-digitaalmuunduri ühik: arv, mille kaamera iga piksli kohta salvestab.',
      en: 'Analogue-to-digital unit: the number the camera stores for each pixel.',
    },
  },
} satisfies Record<string, Term>;

export type TermId = keyof typeof GLOSSARY;

export function term(id: TermId): string {
  return GLOSSARY[id][getLang()];
}

export function explain(id: TermId): string {
  return GLOSSARY[id].explain[getLang()];
}
