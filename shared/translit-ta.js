// English spelling -> Tamil script, by sound. The last resort in Tamil mode
// for names that no list knows (students, parents, staff): "Farhan Menon" ->
// "ஃபர்ஹான் மேனன்". Codes with digits (BSACIST-118, TN22AB4521), e-mail
// addresses and links are left alone.

const INDEPENDENT = { a: 'அ', aa: 'ஆ', i: 'இ', ee: 'ஈ', ii: 'ஈ', u: 'உ', oo: 'ஊ', uu: 'ஊ', e: 'எ', o: 'ஒ', ai: 'ஐ', au: 'ஔ', ay: 'எ', ea: 'ஈ', ou: 'ஔ' };
const SIGN = { a: '', aa: 'ா', i: 'ி', ee: 'ீ', ii: 'ீ', u: 'ு', oo: 'ூ', uu: 'ூ', e: 'ெ', o: 'ோ', ai: 'ை', au: 'ௌ', ay: 'ே', ea: 'ீ', ou: 'ௌ' };
const VOWELS = ['aa', 'ee', 'ii', 'oo', 'uu', 'ai', 'au', 'ay', 'ea', 'ou', 'a', 'i', 'u', 'e', 'o'];
// Longest first, so "th" wins over "t".
const CONSONANTS = [
  ['ksh', 'க்ஷ'], ['sh', 'ஷ'], ['zh', 'ழ'], ['th', 'த'], ['dh', 'த'], ['ch', 'ச'], ['ph', 'ஃப'], ['bh', 'ப'], ['gh', 'க'], ['kh', 'க'],
  ['ng', 'ங'], ['nj', 'ஞ'], ['ny', 'ஞ'],
  ['k', 'க'], ['c', 'க'], ['q', 'க'], ['g', 'க'], ['j', 'ஜ'], ['t', 'ட'], ['d', 'ட'], ['n', 'ன'], ['p', 'ப'], ['b', 'ப'], ['f', 'ஃப'],
  ['m', 'ம'], ['y', 'ய'], ['r', 'ர'], ['l', 'ல'], ['v', 'வ'], ['w', 'வ'], ['s', 'ச'], ['z', 'ஸ'], ['h', 'ஹ'], ['x', 'க்ஸ'],
];
const VIRAMA = '்';
const LETTER = { A: 'ஏ', B: 'பி', C: 'சி', D: 'டி', E: 'இ', F: 'எஃப்', G: 'ஜி', H: 'எச்', I: 'ஐ', J: 'ஜே', K: 'கே', L: 'எல்', M: 'எம்', N: 'என்', O: 'ஓ', P: 'பி', Q: 'கியூ', R: 'ஆர்', S: 'எஸ்', T: 'டி', U: 'யூ', V: 'வி', W: 'டபிள்யூ', X: 'எக்ஸ்', Y: 'ஒய்', Z: 'இசட்' };
const KEEP = new Set(['BSACIST']);
// Titles before a name.
const TITLE = { mr: 'திரு.', mrs: 'திருமதி', ms: 'செல்வி', miss: 'செல்வி', dr: 'டாக்டர்', prof: 'பேராசிரியர்' };

/** One word by sound. */
export function translitWord(word) {
  if (!/^[A-Za-z'’]+$/.test(word)) return word;
  if (KEEP.has(word)) return word;
  // Short all-capitals words are initials or abbreviations: say each letter (GPS -> ஜி.பி.எஸ்.).
  if (word.length <= 5 && word === word.toUpperCase() && word.length > 1) return `${[...word].map((ch) => LETTER[ch] ?? ch).join('.')}.`;
  if (word.length === 1) return `${LETTER[word.toUpperCase()] ?? word}.`;
  const w = word.toLowerCase().replace(/['’]/g, '');
  let out = '';
  let i = 0;
  let prevConsonant = false;
  // 'n' at the start of a word, or before a vowel at the start of a syllable, is the dental ந.
  while (i < w.length) {
    const vowel = VOWELS.find((v) => w.startsWith(v, i));
    if (vowel) {
      if (prevConsonant) {
        // A word-final short 'a' is said long in names (Fathima, Krishna).
        const sign = vowel === 'a' && i + 1 === w.length ? 'ா' : SIGN[vowel];
        out += sign;
      } else {
        out += INDEPENDENT[vowel];
      }
      prevConsonant = false;
      i += vowel.length;
      continue;
    }
    const pair = CONSONANTS.find(([en]) => w.startsWith(en, i));
    if (!pair) { i += 1; continue; }
    let ta = pair[1];
    if (pair[0] === 'n' && (i === 0 || !prevConsonant && /[aeiou]/.test(w[i + 1] ?? '') && i === 0)) ta = 'ந';
    if (pair[0] === 'n' && /[td]/.test(w[i + 1] ?? '') && !/^(th|dh)/.test(w.slice(i + 1))) ta = 'ண';
    if (pair[0] === 'n' && /^(th|dh)/.test(w.slice(i + 1))) ta = 'ந';
    if (prevConsonant) out += VIRAMA;
    out += ta;
    prevConsonant = true;
    i += pair[0].length;
  }
  if (prevConsonant) out += VIRAMA;
  return out;
}

/** Every English word in a line, by sound; numbers, codes, e-mails and links stay. */
export function translitLine(line) {
  return String(line).replace(/[A-Za-z][A-Za-z0-9'’@._/:-]*/g, (tok) => {
    if (/[0-9@/:]/.test(tok) || /[-_.][A-Za-z0-9]/.test(tok.replace(/\.$/, '')) && !/^([A-Z]\.)+$/.test(tok)) return tok;
    if (/^([A-Z]\.)+$/.test(tok)) return [...tok.replace(/\./g, '')].map((ch) => `${LETTER[ch] ?? ch}.`).join('');
    const clean = tok.replace(/\.$/, '');
    if (TITLE[clean.toLowerCase()] && /^[A-Z]/.test(clean)) return TITLE[clean.toLowerCase()];
    return translitWord(clean) + (tok.endsWith('.') ? '.' : '');
  });
}

/** True when a line still has English letters a Tamil reader would see. */
export const hasLatin = (line) => /[A-Za-z]{2,}/.test(String(line).replace(/BSACIST(-\w+)?|[\w.+-]+@[\w.-]+|https?:\/\/\S+|\b[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}\b/g, ''));

/** A name, not a sentence: every English word starts with a capital (Farhan Menon, Mr. Raj, Demo Parent). */
export const isNameLike = (line) => {
  const words = String(line).split(/\s+/).map((t) => t.replace(/^[("'‘“]+|[)"'’”.,:;]+$/g, '')).filter((t) => /^[A-Za-z][A-Za-z'’.]*$/.test(t));
  return words.length > 0 && words.length <= 5 && words.every((w) => /^[A-Z]/.test(w));
};
