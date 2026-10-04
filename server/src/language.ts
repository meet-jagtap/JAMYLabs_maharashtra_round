export type SupportedLanguage = 'en' | 'hi' | 'mr' | 'gu';

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi',
  gu: 'Gujarati',
};

const GUJARATI_REGEX = /[\u0A80-\u0AFF]/;
const DEVANAGARI_REGEX = /[\u0900-\u097F]/;
const MARATHI_EXCLUSIVE_CHAR = /\u0933/; // 'ळ' character exclusive to Marathi in modern Indian languages

const MARATHI_WORDS = new Set([
  'आहे', 'आहेत', 'नाही', 'आणि', 'पण', 'करा', 'करावे', 'होते', 'झाले', 'झाला',
  'कसा', 'काय', 'आपण', 'मला', 'तुला', 'त्यांना', 'आम्ही', 'तुम्ही', 'पूर्ण',
  'करूया', 'पाहिजे', 'करावा', 'करावी', 'येथे', 'कुठे', 'केले', 'केली', 'झाली',
  'करतो', 'करते', 'होती', 'होता', 'फार', 'छान', 'करायचे', 'करायचा', 'करायची',
  'माझे', 'माझा', 'माझी', 'मित्रांनो', 'सर्व', 'यांचे', 'त्यांचे', 'नक्की'
]);

const HINDI_WORDS = new Set([
  'है', 'हैं', 'नहीं', 'और', 'का', 'के', 'की', 'को', 'में', 'पर', 'से', 'यह',
  'वह', 'हम', 'आप', 'कर', 'करना', 'रहा', 'रही', 'रहे', 'था', 'थी', 'थे',
  'होगा', 'होगी', 'होंगे', 'चाहिए', 'सकते', 'सकता', 'सकती', 'मुझे', 'तुम्हें',
  'उन्हें', 'इसे', 'उसे', 'कि', 'तो', 'भी', 'किया', 'गया', 'गई', 'गए', 'बहुत',
  'अच्छा', 'करेंगे', 'होने', 'वाले', 'होता', 'होती', 'होते', 'हुए', 'हुआ'
]);

/**
 * Lightweight, zero-latency language detector for English, Hindi, Marathi, and Gujarati.
 * Detects based on Unicode script ranges and distinctive stop-words.
 */
export function detectLanguage(text: string, reportedCode?: string): SupportedLanguage {
  const clean = text.trim();
  if (!clean) return 'en';

  // If Gemini reported a recognized language code, normalize and check consistency
  if (reportedCode) {
    const norm = reportedCode.toLowerCase().slice(0, 2);
    if (norm === 'gu' && GUJARATI_REGEX.test(clean)) return 'gu';
    if (norm === 'mr' && DEVANAGARI_REGEX.test(clean)) return 'mr';
    if (norm === 'hi' && DEVANAGARI_REGEX.test(clean)) return 'hi';
    if (norm === 'en' && !DEVANAGARI_REGEX.test(clean) && !GUJARATI_REGEX.test(clean)) return 'en';
  }

  // 1. Gujarati: unique Unicode block \u0A80-\u0AFF
  if (GUJARATI_REGEX.test(clean)) {
    return 'gu';
  }

  // 2. Devanagari: used by Hindi & Marathi
  if (DEVANAGARI_REGEX.test(clean)) {
    // Check Marathi-exclusive letter 'ळ'
    if (MARATHI_EXCLUSIVE_CHAR.test(clean)) {
      return 'mr';
    }

    // Tokenize into words
    const words = clean.split(/[\s,।॥!?:;."'`()]+/).filter(Boolean);
    let marathiScore = 0;
    let hindiScore = 0;

    for (const w of words) {
      if (MARATHI_WORDS.has(w)) marathiScore += 2;
      if (HINDI_WORDS.has(w)) hindiScore += 2;

      // Suffix heuristics
      if (w.endsWith('या') || w.endsWith('चे') || w.endsWith('ला') || w.endsWith('ून')) marathiScore += 1;
      if (w.endsWith('ने') || w.endsWith('ना') || w.endsWith('ता') || w.endsWith('ते')) hindiScore += 1;
    }

    if (marathiScore > hindiScore) return 'mr';
    if (hindiScore > marathiScore) return 'hi';

    // If still tied, fallback to Hindi
    return 'hi';
  }

  // 3. Default: English / Latin
  return 'en';
}

export function getLanguageName(code?: string): string {
  if (!code) return 'English';
  return LANGUAGE_NAMES[code as SupportedLanguage] ?? code.toUpperCase();
}
