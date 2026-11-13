import { useEffect, useRef } from 'react';
import { dictionary, translatePageText } from '../../../shared/i18n.js';
import { useSession } from '../lib/session.jsx';

const LANG_KEY = 'ubts.lang';
const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'svg', 'NOSCRIPT']);

const storedLanguage = () => {
  try { return localStorage.getItem(LANG_KEY) || 'en'; } catch { return 'en'; }
};

/**
 * Puts the whole page in the reader's language. Screens translate their own
 * text with t(); this covers everything else - labels, placeholders, empty
 * states, help text - by swapping any text that has a translation, as React
 * renders it. The signed-in user's language wins; the sign-in and landing
 * pages use the language last chosen on this browser.
 */
export default function PageTranslator() {
  const { user } = useSession();
  const language = user?.language ?? storedLanguage();
  const previous = useRef(language);

  // Remember the choice for the pages before sign-in.
  useEffect(() => {
    if (!user?.language) return;
    try { localStorage.setItem(LANG_KEY, user.language); } catch { /* per-tab only */ }
  }, [user?.language]);

  useEffect(() => {
    // Back to English: the swapped text belongs to the page, so start it afresh.
    if (previous.current !== 'en' && language === 'en') { window.location.reload(); return undefined; }
    previous.current = language;
    document.documentElement.lang = language === 'ta' ? 'ta' : 'en';
    const words = language === 'en' ? null : dictionary(language);
    if (!words) return undefined;

    const lookup = (raw) => {
      if (!raw) return null;
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text || !/[A-Za-z]/.test(text)) return null;
      const hit = translatePageText(language, text);
      if (hit) return raw.replace(raw.trim(), hit);
      // "Label:" and "Label ›" keep their punctuation.
      const m = text.match(/^(.*?)([:›·]?)$/);
      if (m && m[2] && words[m[1].trim()]) return raw.replace(raw.trim(), `${words[m[1].trim()]}${m[2]}`);
      return null;
    };
    const skip = (el) => {
      for (let n = el; n; n = n.parentElement) {
        if (SKIP.has(n.nodeName) || n.isContentEditable || n.dataset?.noTranslate !== undefined) return true;
      }
      return false;
    };
    const doText = (node) => {
      if (!node.parentElement || skip(node.parentElement)) return;
      const next = lookup(node.nodeValue);
      if (next && next !== node.nodeValue) node.nodeValue = next;
    };
    const doElement = (el) => {
      if (skip(el)) return;
      for (const a of ATTRS) {
        const v = el.getAttribute?.(a);
        const next = v && lookup(v);
        if (next && next !== v) el.setAttribute(a, next);
      }
    };
    const walk = (root) => {
      if (root.nodeType === Node.TEXT_NODE) { doText(root); return; }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      doElement(root);
      const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = it.nextNode(); n; n = it.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) doText(n); else doElement(n);
      }
    };

    walk(document.body);
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doElement(r.target);
        else r.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    return () => observer.disconnect();
  }, [language]);

  return null;
}
