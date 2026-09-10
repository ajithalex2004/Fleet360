/**
 * Bilingual English / Arabic Fuzzy Name Normalizer
 * -------------------------------------------------
 * Specialised for UAE fleet operations, drivers, suppliers, and government cards.
 * Resolves spelling variations, transliterations, and script mismatches across
 * English (Latin) and Arabic (Perso-Arabic) text.
 */

export interface BilingualComparisonResult {
  match: boolean;
  similarity: number;
  method: 'EXACT' | 'TRANSLITERATION' | 'TOKEN_SORT' | 'FUZZY_LEVENSHTEIN' | 'NONE';
  normalizedName1: string;
  normalizedName2: string;
}

/**
 * Checks if a string contains Arabic Unicode characters.
 */
export function isArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Normalizes Arabic script:
 * - Strips tashkeel / harakat (fatha, damma, kasra, sukun, shadda, tanween)
 * - Removes tatweel / kashida (ـ)
 * - Unifies Alef variations (أ, إ, آ, ٱ -> ا)
 * - Unifies Taa Marbouta (ة -> ه)
 * - Unifies Alif Maqsura (ى -> ي)
 * - Trims whitespace and collapses multiple spaces
 */
export function normalizeArabicText(text: string): string {
  if (!text) return '';

  return text
    // Remove diacritics / tashkeel
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Remove tatweel / kashida
    .replace(/\u0640/g, '')
    // Unify Alef variations
    .replace(/[أإآٱ]/g, 'ا')
    // Unify Taa Marbouta to Haa
    .replace(/ة/g, 'ه')
    // Unify Alif Maqsura to Yaa
    .replace(/ى/g, 'ي')
    // Remove punctuation
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normalizes English / Latin text:
 * - Lowercases and trims
 * - Removes common corporate suffixes (LLC, PJSC, CO, EST, LTD, CORP)
 * - Normalizes "Al-" and "El-" prefixes (e.g. Al-Futtaim -> al futtaim)
 * - Collapses repeated vowels/letters (e.g. mohammed -> mohamed)
 */
export function normalizeEnglishText(text: string): string {
  if (!text) return '';

  let clean = text
    .toLowerCase()
    .replace(/['"’`]/g, '')
    .replace(/\b(l\.?l\.?c\.?|p\.?j\.?s\.?c\.?|corp\.?|co\.?|ltd\.?|est\.?|establishment|company|trading|group)\b/gi, '')
    .replace(/[-_]/g, ' ')
    .replace(/[.,/#!$%^&*;:{}=`~()?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize Al/El prefixes
  clean = clean.replace(/\b(al|el)\s+/g, 'al ');

  return clean;
}

// UAE Common Cross-Script Translation & Transliteration Dictionary
const ARABIC_TO_ENGLISH_MAP: Record<string, string> = {
  // Emirates
  'دبي': 'dubai',
  'ابوظبي': 'abu dhabi',
  'الشارقه': 'sharjah',
  'الشارقة': 'sharjah',
  'عجمان': 'ajman',
  'ام القيوين': 'umm al quwain',
  'راس الخيمه': 'ras al khaimah',
  'راس الخيمة': 'ras al khaimah',
  'الفجيره': 'fujairah',
  'الفجيرة': 'fujairah',
  'العين': 'al ain',

  // Common Given Names
  'محمد': 'mohammed',
  'احمد': 'ahmed',
  'علي': 'ali',
  'عبدالله': 'abdullah',
  'عبد الله': 'abdullah',
  'عبدالرحمن': 'abdulrahman',
  'عبد الرحمن': 'abdulrahman',
  'راشد': 'rashid',
  'سعيد': 'saeed',
  'خالد': 'khalid',
  'عمر': 'omar',
  'عثمان': 'othman',
  'يوسف': 'yousef',
  'طارق': 'tariq',
  'حسن': 'hassan',
  'حسين': 'hussein',
  'سالم': 'salem',
  'منصور': 'mansoor',
  'سلطان': 'sultan',
  'حمد': 'hamad',
  'ابراهيم': 'ibrahim',
  'زايد': 'zayed',

  // Common Commercial Entities & Surnames
  'الفطيم': 'al futtaim',
  'النابوده': 'al naboodah',
  'النابودة': 'al naboodah',
  'الغرير': 'al ghurair',
  'الرستماني': 'al rostamani',
  'الحبتور': 'al habtoor',
  'مواصلات الامارات': 'emirates transport',
  'مواصلات': 'transport',
  'نقليات': 'transport',
  'تاكسي': 'taxi',
  'باصات': 'buses',
  'سيارات': 'motors',
  'المتحدة': 'united',
  'العربيه': 'arab',
  'العربية': 'arab',
};

// Common English Transliteration Aliases -> Canonical Form
const ENGLISH_NAME_ALIASES: Record<string, string> = {
  'mohamed': 'mohammed',
  'muhammad': 'mohammed',
  'mohd': 'mohammed',
  'muhamad': 'mohammed',
  'ahmad': 'ahmed',
  'abdulla': 'abdullah',
  'abdulah': 'abdullah',
  'rasheed': 'rashid',
  'said': 'saeed',
  'khaled': 'khalid',
  'usman': 'othman',
  'osman': 'othman',
  'youssef': 'yousef',
  'joseph': 'yousef',
  'tareq': 'tariq',
  'hasan': 'hassan',
  'hussain': 'hussein',
  'mansour': 'mansoor',
  'alfuttaim': 'al futtaim',
  'al-futtaim': 'al futtaim',
  'alnaboodah': 'al naboodah',
  'al-naboodah': 'al naboodah',
  'alrostamani': 'al rostamani',
};

/**
 * Transliterates known Arabic words/names to English equivalents.
 */
export function transliterateArabicToEnglish(arabicText: string): string {
  const normalized = normalizeArabicText(arabicText);

  // Direct phrase match
  if (ARABIC_TO_ENGLISH_MAP[normalized]) {
    return ARABIC_TO_ENGLISH_MAP[normalized];
  }

  // Word by word mapping
  const words = normalized.split(/\s+/);
  const mappedWords = words.map((w) => ARABIC_TO_ENGLISH_MAP[w] || w);
  return mappedWords.join(' ');
}

/**
 * Canonicalizes an English name using alias mappings.
 */
export function canonicalizeEnglishName(englishText: string): string {
  const norm = normalizeEnglishText(englishText);
  const words = norm.split(/\s+/);
  const mapped = words.map((w) => ENGLISH_NAME_ALIASES[w] || w);
  return mapped.join(' ');
}

/**
 * Calculates Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculates normalized similarity ratio (0.0 to 1.0) based on Levenshtein distance.
 */
export function calculateStringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return Math.round((1 - dist / maxLen) * 100) / 100;
}

/**
 * Token sort similarity: sorts words alphabetically then compares,
 * preventing word-order differences (e.g. "Rashid Ahmed" vs "Ahmed Rashid").
 */
export function calculateTokenSortSimilarity(a: string, b: string): number {
  const sortedA = a.split(/\s+/).filter(Boolean).sort().join(' ');
  const sortedB = b.split(/\s+/).filter(Boolean).sort().join(' ');
  return calculateStringSimilarity(sortedA, sortedB);
}

/**
 * Master Bilingual Comparison Function
 * -------------------------------------
 * Compares two names/entities across Arabic and English script.
 * Returns match boolean (threshold >= 0.80), similarity score, and matching method.
 */
export function compareBilingualNames(
  name1: string,
  name2: string,
  threshold: number = 0.80
): BilingualComparisonResult {
  if (!name1 || !name2) {
    return {
      match: false,
      similarity: 0,
      method: 'NONE',
      normalizedName1: '',
      normalizedName2: '',
    };
  }

  // 1. Check if either name is in Arabic and transliterate
  let norm1 = name1;
  let norm2 = name2;

  if (isArabic(name1)) {
    norm1 = transliterateArabicToEnglish(name1);
  }
  if (isArabic(name2)) {
    norm2 = transliterateArabicToEnglish(name2);
  }

  // Canonicalize English representations
  norm1 = canonicalizeEnglishName(norm1);
  norm2 = canonicalizeEnglishName(norm2);

  // 2. Exact match check
  if (norm1 === norm2) {
    return {
      match: true,
      similarity: 1.0,
      method: 'EXACT',
      normalizedName1: norm1,
      normalizedName2: norm2,
    };
  }

  // 3. Token Sort Match
  const tokenSortSim = calculateTokenSortSimilarity(norm1, norm2);
  if (tokenSortSim >= threshold) {
    return {
      match: true,
      similarity: tokenSortSim,
      method: 'TOKEN_SORT',
      normalizedName1: norm1,
      normalizedName2: norm2,
    };
  }

  // 4. Fuzzy Levenshtein Match
  const levSim = calculateStringSimilarity(norm1, norm2);
  if (levSim >= threshold) {
    return {
      match: true,
      similarity: levSim,
      method: 'FUZZY_LEVENSHTEIN',
      normalizedName1: norm1,
      normalizedName2: norm2,
    };
  }

  const bestSim = Math.max(tokenSortSim, levSim);
  return {
    match: bestSim >= threshold,
    similarity: bestSim,
    method: bestSim >= threshold ? 'FUZZY_LEVENSHTEIN' : 'NONE',
    normalizedName1: norm1,
    normalizedName2: norm2,
  };
}
