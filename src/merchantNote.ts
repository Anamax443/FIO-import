/**
 * Odhad kategorie a poznámky podle názvu obchodníka.
 *
 * Revolut u transakcí nemá kategorii ani poznámku. Dřív se do zprávy psalo
 * napevno „nákup" — u čerpačky i parkoviště stejně, což je zavádějící.
 * Tahle tabulka pokryje typické obchodníky bez volání AI; co nepozná,
 * popíše pravdivě jako „platba kartou" / „výběr" a případně doplní AI vrstva.
 */

import { asciiFold } from './util.js';

export interface MerchantGuess {
  kategorie?: string;
  poznamka: string;
}

interface Rule {
  patterns: string[];
  kategorie?: string;
  poznamka: string;
}

/** Pořadí rozhoduje — první shoda vyhrává. */
const RULES: Rule[] = [
  { patterns: ['orlen', 'benzina', 'mol ', 'shell', 'omv', 'eurooil', 'circle k', 'globus cerpac', 'prim ', 'tank'], kategorie: 'PHM', poznamka: 'PHM' },
  { patterns: ['parking', 'parkov', 'parkomat', 'zps ', 'garaz'], kategorie: 'parkování', poznamka: 'parkování' },
  { patterns: ['lidl', 'kaufland', 'albert', 'billa', 'tesco', 'penny', 'globus', 'zabka', 'norma', 'coop', 'makro', 'rohlik', 'kosik'], kategorie: 'nákup', poznamka: 'nákup' },
  { patterns: ['dr.max', 'dr max', 'benu', 'lekarna', 'pilulka'], kategorie: 'léky', poznamka: 'léky' },
  { patterns: ['dm ', 'dm-', 'rossmann', 'teta'], kategorie: 'drogerie', poznamka: 'drogerie' },
  { patterns: ['restaur', 'pizz', 'kfc', 'mcdonald', 'burger', 'kavarna', 'cafe', 'bistro', 'hospoda', 'pivnice', 'bageter'], kategorie: 'jídlo', poznamka: 'jídlo' },
  { patterns: ['booking', 'hotel', 'penzion', 'airbnb', 'kemp', 'camping'], kategorie: 'ubytování', poznamka: 'ubytování' },
  { patterns: ['dalnicn', 'znamka', 'vignette', 'mytne', 'e-shop dalnic'], kategorie: 'doprava', poznamka: 'dálniční známka' },
  { patterns: ['cd ', 'ceske drahy', 'regiojet', 'flixbus', 'dpmb', 'dpp ', 'jizdne'], kategorie: 'doprava', poznamka: 'jízdné' },
  { patterns: ['alza', 'datart', 'mall', 'czc', 'ikea', 'obi', 'hornbach', 'bauhaus'], kategorie: 'nákup', poznamka: 'nákup' },
];

const ATM = ['atm', 'bankomat', 'withdrawal', 'vyber'];

export function guessNote(merchant: string | undefined, type = ''): MerchantGuess {
  const hay = asciiFold(`${merchant ?? ''} ${type}`).toLowerCase();

  if (ATM.some((a) => hay.includes(a))) return { poznamka: 'výběr' };

  for (const rule of RULES) {
    if (rule.patterns.some((p) => hay.includes(p))) {
      return { kategorie: rule.kategorie, poznamka: rule.poznamka };
    }
  }

  // Nic nevymýšlet — popsat, co to doopravdy je.
  return { poznamka: 'platba kartou' };
}
