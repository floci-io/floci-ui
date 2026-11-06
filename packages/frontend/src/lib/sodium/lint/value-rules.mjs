export const LINT_IGNORES = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**', '**/out/**', '**/components/ui/**'];

/** A raw color value: #hex (not an entity, a URL fragment or part of a word; `_#fff` in a bracket value counts), or a color function. */
export const RAW = /(?<![A-Za-z0-9&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/;

/** CSS color keywords, which count as raw colors where a color goes. */
export const NAMED = new Set(['white', 'black', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey', 'silver', 'navy', 'teal', 'aqua',
  'cyan', 'magenta', 'fuchsia', 'lime', 'maroon', 'olive', 'brown', 'gold', 'indigo', 'violet', 'coral', 'salmon', 'tomato', 'crimson', 'beige', 'ivory',
  'khaki', 'lavender', 'turquoise', 'tan', 'whitesmoke', 'gainsboro', 'lightgray', 'lightgrey', 'darkgray', 'darkgrey', 'dimgray', 'slategray']);

/**
 * Whether the arbitrary value `inside` the brackets of `base` is a hand-picked number. Transition lists, keywords,
 * proportions (a lone %, vh or vw, fr tracks) and values that read var(--) or --spacing() are fine.
 */
export function handPickedValue(base, inside) {
  // A grid track list in fr (grid-cols-[1fr_auto], grid-cols-[auto_1fr]) is a proportion, not a size, and so is
  // an fr track that may shrink past its content (minmax(0,1fr)): its zero is no hand-picked number.
  const tracks = inside.replace(/minmax\(0,/g, 'minmax(').replace(/(?<![A-Za-z0-9.])\d+(?:\.\d+)?fr(?![a-z0-9])/g, '');
  if (/^transition-\[/.test(base) || !/\d/.test(tracks)) return false;
  if (/^-?\d+(?:\.\d+)?(?:%|d?vh|svh|lvh|d?vw|svw|lvw)$/.test(inside)) return false;
  return !/var\(--|--spacing\(/.test(inside);
}
