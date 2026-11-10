// The password rule, the same on the server, the website and the phone app.
export const PASSWORD_MIN = 10;
export const PASSWORD_HINT = 'At least 10 characters, with letters and a number or symbol';

const COMMON = new Set(['password', 'passwordpassword', 'qwertyuiop', 'qwertyuiopas', 'iloveyou', 'welcome', 'admin', 'administrator', 'crescent', 'crescenttransit', 'student', 'letmein', 'abcdefghij']);

/** What is wrong with a new password, or null when it is fine. */
export function passwordProblem(password, { username = '', email = '' } = {}) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (!/\p{L}/u.test(value) || !/[^\p{L}]/u.test(value)) return 'Password needs letters and a number or symbol';
  const lower = value.toLowerCase();
  if (COMMON.has(lower.replace(/[^a-z]+$/, '').replace(/^[^a-z]+/, ''))) return 'That password is too easy to guess';
  if (/^(.)\1+$/.test(value) || /^(0123456789|1234567890|9876543210)/.test(value)) return 'That password is too easy to guess';
  const names = [String(username).toLowerCase(), String(email).toLowerCase().split('@')[0]].filter((n) => n.length >= 4);
  if (names.some((n) => lower.includes(n))) return 'Password must not contain your username';
  return null;
}
