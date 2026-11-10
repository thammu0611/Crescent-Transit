/**
 * Which navigation links fit in the bar. Labels change width with the language
 * and the role changes how many there are, so this works from measured widths
 * rather than screen sizes: all links at full spacing, then all links closer
 * together, then as many as fit beside a "More" menu. The current page always
 * stays in the bar.
 */
export function fitNav({ wide, tight, more, room, gap = 2, active = 0 }) {
  const total = (widths) => widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  const all = wide.map((_, i) => i);
  if (total(wide) <= room) return { compact: false, shown: all };
  if (total(tight) <= room) return { compact: true, shown: all };
  const first = Math.max(0, Math.min(active, tight.length - 1));
  const shown = [first];
  let used = tight[first] + gap + more;
  for (let i = 0; i < tight.length; i += 1) {
    if (i === first) continue;
    if (used + gap + tight[i] > room) break;
    shown.push(i);
    used += gap + tight[i];
  }
  return { compact: true, shown: shown.sort((a, b) => a - b) };
}
