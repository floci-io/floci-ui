import {readFileSync} from 'node:fs';
import {handPickedValue, NAMED, RAW} from './value-rules.mjs';

// The lint every design system ships, as an ESLint plugin. Plain ESM, no build step. Each rule flags one thing a
// system's rules forbid and says what to use instead; its docs link points at the system rule it enforces.
//
// This file is the shared part. A system's lint/plugin.mjs calls createPlugin(config) with its name, its site, the
// words its messages use (color roles, the focus ring, its components) and any rules only it has. The registry build
// copies this file into each system's lint folder as lint/core.mjs, so the installed lint needs nothing from
// design.how.
//
// Classes are read where Tailwind reads them: className (and any *ClassName prop) and the arguments of cn, clsx,
// cva and the like. classes.json, written by the build beside this file, lists every utility the system's theme
// defines and the stock Tailwind vocabulary it leaves out, so nothing here loads Tailwind. value-rules.mjs, also
// written by the build, holds what a raw color and a hand-picked value are, shared with the registry's value check.

const set = list => new Set(list);
const isNumber = value => /^\d+(?:\.\d+)?$/.test(value);
const onScale = value => Number.isInteger(Number(value) * 4);

/** Splits at `sep` outside brackets and parentheses. */
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

// ---- reading classes out of the source -------------------------------------------------------------------------

const CLASS_FNS = new Set(['cn', 'clsx', 'cx', 'classnames', 'classNames', 'twMerge', 'twJoin', 'cva', 'tv']);
const isClassAttr = name => name === 'className' || name === 'class' || /ClassName$/.test(name);
const isClassCall = node => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && CLASS_FNS.has(node.callee.name);
const attrName = attr => attr.type === 'JSXAttribute' ? (attr.name.type === 'JSXNamespacedName' ? `${attr.name.namespace.name}:${attr.name.name.name}` : attr.name.name) : undefined;

/** The static string pieces of a class expression, as {node, text, offset}. A class-function call is read by its own visitor unless `intoCalls`. */
function pieces(node, out = [], intoCalls = false) {
  if (!node) return out;
  switch (node.type) {
    case 'Literal': if (typeof node.value === 'string') out.push({node, text: node.value, offset: 1}); break;
    case 'TemplateLiteral': for (const q of node.quasis) out.push({node: q, text: q.value.cooked ?? q.value.raw, offset: 1}); break;
    case 'JSXExpressionContainer': pieces(node.expression, out, intoCalls); break;
    case 'ConditionalExpression': pieces(node.consequent, out, intoCalls); pieces(node.alternate, out, intoCalls); break;
    case 'LogicalExpression': pieces(node.left, out, intoCalls); pieces(node.right, out, intoCalls); break;
    case 'BinaryExpression': if (node.operator === '+') { pieces(node.left, out, intoCalls); pieces(node.right, out, intoCalls); } break;
    case 'ArrayExpression': for (const el of node.elements) pieces(el, out, intoCalls); break;
    case 'ObjectExpression':
      for (const p of node.properties) {
        if (p.type !== 'Property') continue;
        if (p.key.type === 'Literal') pieces(p.key, out, intoCalls);
        pieces(p.value, out, intoCalls);
      }
      break;
    case 'TSAsExpression': case 'TSSatisfiesExpression': case 'TSNonNullExpression': case 'ParenthesizedExpression': pieces(node.expression, out, intoCalls); break;
    case 'CallExpression': if (intoCalls && isClassCall(node)) for (const arg of node.arguments) pieces(arg, out, intoCalls); break;
    default: break;
  }
  return out;
}

/** Each class token in a piece, with its location. */
function* tokens(sourceCode, piece) {
  for (const m of piece.text.matchAll(/\S+/g)) {
    const start = piece.node.range[0] + piece.offset + m.index;
    yield {token: m[0], loc: {start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(start + m[0].length)}};
  }
}

const elementName = opening => opening.name.type === 'JSXIdentifier' ? opening.name.name : undefined;
const attribute = (opening, name) => opening.attributes.find(a => attrName(a) === name);
const hasSpread = opening => opening.attributes.some(a => a.type === 'JSXSpreadAttribute');
const stringOf = attr => {
  const v = attr?.value;
  if (v?.type === 'Literal') return typeof v.value === 'string' ? v.value : undefined;
  if (v?.type === 'JSXExpressionContainer' && v.expression.type === 'Literal' && typeof v.expression.value === 'string') return v.expression.value;
  if (v?.type === 'JSXExpressionContainer' && v.expression.type === 'TemplateLiteral' && !v.expression.expressions.length) return v.expression.quasis[0].value.cooked;
  return undefined;
};

/** The object literal a style attribute holds, through `as` casts, or undefined. */
function styleObject(attr) {
  let expr = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : undefined;
  while (expr && /^TS(?:As|Satisfies|NonNull)Expression$/.test(expr.type)) expr = expr.expression;
  return expr?.type === 'ObjectExpression' ? expr : undefined;
}

/** The properties of an inline style object literal, as {key, value (static string or number), node}. */
function styleProps(attr) {
  const expr = styleObject(attr);
  if (expr?.type !== 'ObjectExpression') return [];
  return expr.properties.filter(p => p.type === 'Property').map(p => {
    const key = p.key.type === 'Identifier' ? p.key.name : typeof p.key.value === 'string' ? p.key.value : undefined;
    const v = p.value;
    const value = v.type === 'Literal' ? v.value : v.type === 'TemplateLiteral' && !v.expressions.length ? v.quasis[0].value.cooked : undefined;
    return {key, value, node: p};
  });
}

/** A rule over inline style objects: `check(key, value)` returns a message or nothing. */
function styleRule(check) {
  return context => ({
    JSXAttribute(node) {
      if (attrName(node) !== 'style') return;
      for (const {key, value, node: prop} of styleProps(node)) {
        if (key === undefined || value === undefined || value === null) continue;
        const message = check(key, String(value));
        if (message) context.report({node: prop, message});
      }
    },
  });
}

/** Runs several rule bodies as one: each returns a visitor map. */
function merge(...visitors) {
  const out = {};
  for (const v of visitors) for (const [key, fn] of Object.entries(v)) {
    const prev = out[key];
    out[key] = prev ? node => { prev(node); fn(node); } : fn;
  }
  return out;
}

const COLOR_PROPS = /^(?:color|background|backgroundColor|border\w*Color|borderColor|border|outline|outlineColor|fill|stroke|stopColor|floodColor|caretColor|accentColor|textDecorationColor|boxShadow|textShadow)$/;
const COLOR_ATTRS = new Set(['fill', 'stroke', 'color', 'stopColor', 'floodColor', 'lightingColor']);
const ICON_PACKAGES = /^(?:lucide-react|lucide|react-icons|@heroicons\/[\w-]+|@radix-ui\/react-icons|@tabler\/icons(?:-react)?|@phosphor-icons\/[\w-]+|phosphor-react|@fortawesome\/[\w-]+|@mui\/icons-material|react-feather|feather-icons|@carbon\/icons-react|@carbon\/icons|iconoir-react|@iconify\/[\w-]+|@iconify-icon\/[\w-]+|@remixicon\/[\w-]+|remixicon|react-bootstrap-icons|@ant-design\/icons|ionicons|@primer\/octicons-react|@hugeicons\/[\w-]+|@untitled-ui\/icons-react|@expo\/vector-icons|@mdi\/[\w-]+|@icon-park\/[\w-]+|@geist-ui\/icons|@spectrum-icons\/[\w-]+)(?:\/|$)/;

/** Rules every system's source may break: they guard app code only, since the system's own source builds the controls. */
const APP_ONLY = ['no-raw-color', 'no-outline-none', 'no-arbitrary-value', 'no-inline-style', 'no-dynamic-class', 'no-native-control', 'field-label', 'no-restyle', 'one-primary', 'no-second-icon-set'];
const WARN = ['one-primary', 'no-emoji-or-em-dash'];

/**
 * The plugin for one design system. `config` (see Lime's and Quartz's lint/plugin.mjs):
 *   name, title          the system's id (lime) and display name (Lime)
 *   site, pages          the system's docs URL, and the page under it for each rule-id prefix ({color: '/foundations/color'})
 *   docs                 the system rule each shared rule enforces, by rule name
 *   roles                color role names for text, bg and line, best first, used in suggestions
 *   examples             class names messages show: text, muted, surface, tint, selected
 *   tracking             tracking-* values that are not spread letters
 *   hints                wording only this system has: caps, white, focusRing, duration, gradient, font, textSize
 *   natives              for each native control (button, input, checkbox ...), what to use instead
 *   field, restyle, primary, overlays, skeleton, iconFile
 *   rules                kit => {id: rule}, the system's own rules, built from the helpers in kit
 *   appOnly, warn        more rule ids to turn off in the system's own source, or to report as warnings
 */
export function createPlugin(config) {
  const {name, title} = config;
  const vocab = JSON.parse(readFileSync(new URL('./classes.json', import.meta.url), 'utf8'));
  const hints = config.hints ?? {};
  const ex = config.examples;

  const docsFor = id => {
    const prefix = Object.keys(config.pages).find(p => id.startsWith(`${p}-`));
    return `${config.site}${prefix === undefined ? '' : config.pages[prefix]}`;
  };
  const meta = (description, rule, type = 'problem') => ({type, docs: {description, url: docsFor(rule), rule, [`${name}Rule`]: rule}, schema: []});

  // ---- the vocabulary -------------------------------------------------------------------------------------------

  const own = {static: set(vocab.static), colors: set(vocab.colors), colorRoots: set(vocab.colorRoots), numeric: set(vocab.numeric), fraction: set(vocab.fraction),
    values: Object.fromEntries(Object.entries(vocab.values).map(([k, v]) => [k, set(v)])), variants: vocab.variants};
  const stock = {static: set(vocab.tailwind.static), colors: set(vocab.tailwind.colors), numeric: set(vocab.tailwind.numeric),
    values: Object.fromEntries(Object.entries(vocab.tailwind.values).map(([k, v]) => [k, set(v)])), variants: vocab.tailwind.variants};
  // Class names Tailwind treats as markers rather than utilities.
  for (const marker of ['group', 'peer', 'dark', 'not-prose']) own.static.add(marker);
  const ROOTS = [...new Set([...Object.keys(own.values), ...own.colorRoots, ...own.numeric, ...own.fraction, ...Object.keys(stock.values), ...stock.numeric])]
    .sort((a, b) => b.length - a.length);

  /**
   * One class token, taken apart: variants (hover, sm, data-[open], [&>svg]), the utility without its important
   * mark, the base without its modifier (/50, /6), the root it is a value of (p, bg, rounded-t, -mt) and the value.
   */
  function parse(token) {
    const parts = splitTop(token, ':');
    let utility = parts.pop();
    utility = utility.replace(/^!/, '').replace(/!$/, '');
    const slash = splitTop(utility, '/');
    const base = slash.length > 1 ? slash.slice(0, -1).join('/') : utility;
    const modifier = slash.length > 1 ? slash.at(-1) : undefined;
    const arbitrary = /[[(]/.test(base);
    const root = arbitrary ? base.match(/^(-?[a-z][\w-]*?)-[[(]/)?.[1] : ROOTS.find(r => base === r || base.startsWith(`${r}-`));
    const value = root === undefined ? undefined : base === root ? '' : base.slice(root.length + 1);
    return {token, variants: parts, utility, base, modifier, root, value, arbitrary};
  }

  /** Whether the system's theme has this utility: true, false, or undefined when it is not a Tailwind-shaped class at all. */
  function owns(c) {
    if (own.static.has(c.base) || own.static.has(c.utility)) return true;
    if (c.root === undefined) return undefined;
    if (own.values[c.root]?.has(c.value)) return true;
    if (own.colorRoots.has(c.root) && own.colors.has(c.value)) return true;
    if (own.numeric.has(c.root) && isNumber(c.value) && onScale(c.value)) return true;
    if (own.fraction.has(c.root) && isNumber(c.value) && c.modifier && isNumber(c.modifier)) return true;
    return false;
  }

  /** Whether a class the system lacks still reads as Tailwind: a stock class, a color utility, or a number off the scale. */
  function looksTailwind(c) {
    if (stock.static.has(c.base)) return true;
    if (c.root === undefined) return false;
    if (stock.values[c.root]?.has(c.value)) return true;
    if (own.colorRoots.has(c.root) && /^[a-z][a-z0-9-]*$/.test(c.value)) return true;
    if (isNumber(c.value) && (own.numeric.has(c.root) || stock.numeric.has(c.root))) return true;
    return false;
  }

  /** A stock variant the system's theme does not define, such as 2xl: or max-2xl:. */
  function unknownVariant(variant) {
    if (variant in own.variants) return false;
    if (variant in stock.variants && !stock.variants[variant].length) return true;
    for (let i = 1; i < variant.length; i++) {
      const at = variant[0] === '@' && i === 1;
      if (variant[i] !== '-' && !at) continue;
      const vname = at ? '@' : variant.slice(0, i);
      const value = at ? variant.slice(1) : variant.slice(i + 1);
      if (stock.variants[vname]?.includes(value) && !own.variants[vname]?.includes(value)) return true;
    }
    return false;
  }

  const BREAKPOINTS = Object.keys(own.variants).filter(v => ['sm', 'md', 'lg', 'xl', '2xl'].includes(v));
  const WORDY = new Set(['', 'inherit', 'initial', 'none', 'current', 'transparent']);
  const TEXT_SIZE = /^(?:xs|sm|base|lg|\d?xl)$/;

  /** Color roles that fit a root, as class names: text gets the text roles, bg the surfaces, borders the lines. */
  function roles(root) {
    const r = root.replace(/^-/, '');
    const names = r === 'text' || r === 'fill' || r === 'stroke' || r === 'decoration' || r === 'caret' || r === 'placeholder' ? config.roles.text
      : r === 'bg' || r === 'from' || r === 'via' || r === 'to' ? config.roles.bg
      : /^(?:border|divide|ring|outline|inset-ring)/.test(r) ? config.roles.line : config.roles.other;
    return names.filter(n => own.colors.has(n)).map(n => `${r}-${n}`).join(', ');
  }

  /** What the system has in place of a class it lacks, for a message. */
  function suggest(c) {
    const root = c.root.replace(/^-/, '');
    const stockNamed = stock.values[c.root]?.has(c.value);
    if (own.colorRoots.has(c.root) && !stockNamed && !(root === 'text' && TEXT_SIZE.test(c.value ?? ''))) return `a color role such as ${roles(c.root)}`;
    if (root === 'font') return hints.font;
    if (root === 'text') return hints.textSize ?? `a size from ${['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'].filter(v => own.values.text?.has(v)).map(v => `text-${v}`).join(', ')}`;
    const named = [...(own.values[c.root] ?? [])].filter(v => !WORDY.has(v) && !/^\[|\d%$/.test(v));
    if (own.numeric.has(c.root)) return `the 4px scale (${root}-1 is 4px, ${root}-4 is 16px)${named.length && /^(?:max-|min-)?[wh]$|^size$/.test(root) ? ` or a size such as ${root}-${named.includes('md') ? 'md' : named[0]}` : ''}`;
    if (named.length) return named.slice(0, 8).map(v => `${root}-${v}`).join(', ');
    return undefined;
  }

  // ---- what each rule claims --------------------------------------------------------------------------------------

  const arbitraryValue = c => c.base.match(/\[(.*)\]/)?.[1];

  /** A raw color in a class: a palette color (text-white, bg-gray-500) or a color value inside brackets. */
  function rawColor(c) {
    if (c.root && own.colorRoots.has(c.root) && stock.colors.has(c.value)) return c.value;
    const inside = arbitraryValue(c);
    if (inside === undefined) return undefined;
    const hit = inside.match(RAW);
    if (hit) return hit[0].replace(/\($/, '()');
    if (c.root && own.colorRoots.has(c.root) && NAMED.has(inside.toLowerCase())) return inside;
    return undefined;
  }
  const GRADIENT_ROOTS = new Set(['bg-linear', '-bg-linear', 'bg-radial', 'bg-conic', '-bg-conic', 'from', 'via', 'to']);
  // A mask fades an edge where content scrolls on; it paints nothing, so a gradient inside one is not decoration.
  const gradient = c => GRADIENT_ROOTS.has(c.root) || /^-?bg-gradient-/.test(c.base) || (!/^\[(?:-webkit-)?mask/.test(c.base) && /gradient\(/.test(arbitraryValue(c) ?? ''));
  const tracking = config.tracking ?? ['tight', 'normal'];
  const caps = c => c.base === 'uppercase' || (/^-?tracking$/.test(c.root ?? '') && !tracking.includes(c.value) && !/^\(?--/.test(c.value ?? '') && !c.base.startsWith('-'))
    || /^\[(?:text-transform:uppercase|letter-spacing:)/.test(c.base);
  const transitionAll = c => c.base === 'transition-all' || c.base === 'transition-[all]';
  /** A looping animation the system does not have: its spinner is its one loop. */
  const decorativeLoop = c => /^animate-(?:pulse|ping|bounce|shimmer)$/.test(c.base);
  /** A one-side border two or more px wide: with a color, it is a side rail. */
  const sideWidth = c => /^border-[lrse]-(?:[2-9]|\d{2,}|\[[^\]]*\d)/.test(c.base);
  const outlineNone = c => ['outline-none', 'outline-hidden', 'outline-0'].includes(c.base);

  /** The arbitrary value a hand-picked number makes. */
  function handPicked(c) {
    const inside = arbitraryValue(c);
    return inside !== undefined && handPickedValue(c.base, inside);
  }

  /**
   * A rule over every class token in the file. `check(c)` gets a parsed token and returns a message or nothing.
   * Tokens are read once per string, from className attributes and from class-function calls.
   */
  function classRule(ruleMeta, check) {
    return {
      meta: ruleMeta,
      create(context) {
        const sourceCode = context.sourceCode;
        const visit = piece => {
          for (const {token, loc} of tokens(sourceCode, piece)) {
            const message = check(parse(token));
            if (message) context.report({loc, message});
          }
        };
        return {
          JSXAttribute(node) { if (isClassAttr(attrName(node))) for (const piece of pieces(node.value)) visit(piece); },
          CallExpression(node) { if (isClassCall(node)) for (const arg of node.arguments) for (const piece of pieces(arg)) visit(piece); },
        };
      },
    };
  }

  /** The class tokens on one JSX opening element, through cn() and conditionals, with their locations and the piece each came from. */
  function elementTokens(sourceCode, opening) {
    const out = [];
    for (const attr of opening.attributes) {
      if (!isClassAttr(attrName(attr))) continue;
      for (const piece of pieces(attr.value, [], true)) for (const t of tokens(sourceCode, piece)) out.push({...t, c: parse(t.token), piece});
    }
    return out;
  }

  // ---- imports ----------------------------------------------------------------------------------------------------

  /** The system's components, wherever the project's alias puts them: .../lime/ui/button, .../lime/ai/message. */
  const componentPath = new RegExp(`(?:^|/)${name}/(?:ui|ai)/[\\w.-]+$`);
  const isOwnComponent = source => componentPath.test(source) || /^\.\.?\/(?:\.\.\/)*(?:ui|ai)\/[\w.-]+$/.test(source);

  /** The local names a file imports from the system's components, as local name to {imported, source}. */
  function ownImports(context) {
    const names = new Map();
    for (const node of context.sourceCode.ast.body) {
      if (node.type !== 'ImportDeclaration' || !isOwnComponent(node.source.value)) continue;
      for (const s of node.specifiers) if (s.type === 'ImportSpecifier') names.set(s.local.name, {imported: s.imported.name ?? s.imported.value, source: node.source.value});
    }
    return names;
  }

  const iconFile = `@/components/${name}/icon`;
  const ui = `@/components/${name}/ui`;
  const field = config.field ?? {};
  const restyle = config.restyle ?? {};
  const primary = config.primary ?? {};

  // ---- the rules --------------------------------------------------------------------------------------------------

  const rules = {
    'unknown-class': classRule(meta(`Use only classes ${title}'s theme defines.`, config.docs['unknown-class']), c => {
      for (const variant of c.variants) {
        if (variant === 'dark' || !unknownVariant(variant)) continue;
        const bp = BREAKPOINTS.length && /\d?xl$|^(?:max|min)-/.test(variant) ? `; ${title}'s breakpoints are ${BREAKPOINTS.join(', ')}` : '';
        return `"${variant}:" is not a variant in ${title}'s theme${bp}.`;
      }
      if (c.arbitrary || rawColor(c) || gradient(c) || caps(c) || decorativeLoop(c) || c.base.startsWith('[')) return undefined;
      const has = owns(c);
      if (has !== false || !looksTailwind(c)) return undefined;
      const hint = suggest(c);
      return `"${c.utility}" is not in ${title}'s theme${hint ? `; use ${hint}` : `; use a class from the Tokens list in the ${title} skill`}.`;
    }),

    'no-raw-color': {
      meta: meta(`Use a ${title} color role, never a raw or palette color.`, config.docs['no-raw-color']),
      create(context) {
        const classes = classRule({}, c => {
          const color = rawColor(c);
          if (!color) return undefined;
          const root = c.root ?? 'text';
          const white = /^white/.test(color) && root === 'text' && hints.white ? `; ${hints.white}` : '';
          return `Raw color ${color} in "${c.utility}"; use a color role such as ${roles(root)}${white}.`;
        }).create(context);
        const styles = styleRule((key, value) => {
          const hit = value.match(RAW)?.[0] ?? (COLOR_PROPS.test(key) && value.toLowerCase().split(/[\s,]+/).find(word => NAMED.has(word)));
          return hit ? `Raw color ${hit.replace(/\($/, '()')} in style.${key}; use a color role class such as ${ex.text} or ${ex.surface}.` : undefined;
        })(context);
        const attrs = {
          JSXAttribute(node) {
            const attr = attrName(node);
            if (!attr || isClassAttr(attr) || attr === 'style') return;
            const value = stringOf(node)?.trim();
            if (!value) return;
            if (new RegExp(`^(?:${RAW.source})`).test(value) || (COLOR_ATTRS.has(attr) && NAMED.has(value.toLowerCase()))) {
              context.report({node, message: `Raw color ${value} in ${attr}; use currentColor and a color role class such as ${ex.muted}.`});
            }
          },
        };
        return merge(classes, styles, attrs);
      },
    },

    'no-arbitrary-value': classRule(meta('Use a token or a scale step, not an arbitrary value.', config.docs['no-arbitrary-value']), c => {
      if (!handPicked(c) || rawColor(c) || gradient(c) || caps(c)) return undefined;
      const hint = c.root ? suggest(c) : undefined;
      return `Arbitrary value "${c.utility}"; use ${hint ?? 'a scale step or a token'}, or var(--token) inside the brackets.`;
    }),

    'no-inline-style': {
      meta: meta(`Style with ${title}'s classes, not inline styles.`, config.docs['no-inline-style']),
      create(context) {
        return {
          JSXAttribute(node) {
            if (attrName(node) !== 'style') return;
            const expr = styleObject(node);
            if (!expr) return;
            // Setting a custom property for a class to read, as in style={{'--pct': '40%'}} with w-(--pct), is the way in.
            const plain = expr.properties.filter(p => p.type === 'Property' && !(p.key.type === 'Literal' && String(p.key.value).startsWith('--')));
            if (!plain.length) return;
            context.report({node, message: `Inline style; use ${title}'s classes. For a value known only at runtime, set a custom property (style={{'--pct': value}}) and read it in a class (w-(--pct)).`});
          },
        };
      },
    },

    'no-dynamic-class': {
      meta: meta('Write each class whole, so Tailwind can find it.', config.docs['no-dynamic-class']),
      create(context) {
        // Whether every string an expression can give is whole classes at that edge: `text-sm${on ? ' text-fg' : ''}` is.
        const joins = (expr, edge) => {
          if (expr.type === 'Literal') return typeof expr.value === 'string' && edge.test(expr.value);
          if (expr.type === 'TemplateLiteral') return edge.test(expr.quasis.map(q => q.value.cooked).join(''));
          if (expr.type === 'ConditionalExpression') return joins(expr.consequent, edge) && joins(expr.alternate, edge);
          if (expr.type === 'LogicalExpression') return joins(expr.right, edge);
          return false;
        };
        const check = node => {
          if (!node) return;
          if (node.type === 'TemplateLiteral') {
            node.expressions.forEach((expr, i) => {
              const before = node.quasis[i].value.cooked ?? '';
              const after = node.quasis[i + 1].value.cooked ?? '';
              if ((/\S$/.test(before) && !joins(expr, /^(?:\s|$)/)) || (/^\S/.test(after) && !joins(expr, /(?:\s|^)$/))) context.report({node: expr, message: `A class built from a value, as in \`bg-\${tone}\`, is never generated; map each value to a whole class (const tones = {ok: '${ex.tint}'}) and pass it through cn().`});
            });
            return;
          }
          if (node.type === 'BinaryExpression' && node.operator === '+') {
            context.report({node, message: `Classes joined with +; pass each whole class to cn() instead, as in cn('px-2', active && '${ex.selected}').`});
            return;
          }
          if (node.type === 'ConditionalExpression') { check(node.consequent); check(node.alternate); }
          if (node.type === 'LogicalExpression') check(node.right);
          if (node.type === 'ArrayExpression') node.elements.forEach(check);
        };
        return {
          JSXAttribute(node) {
            if (!isClassAttr(attrName(node)) || node.value?.type !== 'JSXExpressionContainer') return;
            check(node.value.expression);
          },
          CallExpression(node) { if (isClassCall(node) && node.callee.name !== 'cva' && node.callee.name !== 'tv') node.arguments.forEach(check); },
        };
      },
    },

    'no-dark-variant': classRule(meta(`${title} flips its tokens for dark; never write dark:.`, config.docs['no-dark-variant']), c =>
      c.variants.includes('dark') ? `"${c.token}" uses dark:; ${title}'s color roles change in the dark theme on their own, so use the role alone.` : undefined),

    'no-caps': {
      meta: meta('Keep sentence case; no capitals or letter spacing.', config.docs['no-caps']),
      create(context) {
        return merge(
          classRule({}, c => caps(c) ? `"${c.utility}" sets capitals or spreads letters; keep sentence case${c.base === 'uppercase' || !hints.caps ? '' : `, ${hints.caps}`}.` : undefined).create(context),
          styleRule((key, value) => {
            if (key === 'textTransform' && value === 'uppercase') return 'textTransform: uppercase; keep sentence case.';
            if (key === 'letterSpacing' && !/^(?:-|0(?:\D|$)|normal)/.test(value.trim())) return `letterSpacing: ${value}; ${title} never tracks letters out.`;
            return undefined;
          })(context),
        );
      },
    },

    'no-transition-all': {
      meta: meta('Name the properties a transition moves.', config.docs['no-transition-all']),
      create(context) {
        return merge(
          classRule({}, c => transitionAll(c) ? `"${c.utility}" animates every property; use transition-colors, transition-opacity or transition-transform with ${hints.duration}.` : undefined).create(context),
          styleRule((key, value) => ((key === 'transition' && /^\s*all\b/.test(value)) || (key === 'transitionProperty' && value.trim() === 'all'))
            ? `${key}: ${value}; name the properties, such as color, background-color and opacity.` : undefined)(context),
        );
      },
    },

    'no-outline-none': {
      meta: meta('Keep the focus ring.', config.docs['no-outline-none']),
      create(context) {
        return merge(
          classRule({}, c => outlineNone(c) ? `"${c.token}" removes the focus ring; ${hints.focusRing} is already on every element, so leave the outline alone.` : undefined).create(context),
          styleRule((key, value) => ((key === 'outline' || key === 'outlineStyle' || key === 'outlineWidth') && /^(?:none|0(?:px)?)$/.test(value.trim()))
            ? `${key}: ${value} removes the focus ring; leave the outline alone.` : undefined)(context),
        );
      },
    },

    'no-gradient': {
      meta: meta(hints.gradient.description, config.docs['no-gradient']),
      create(context) {
        return merge(
          classRule({}, c => gradient(c) ? `"${c.utility}" draws a gradient; use ${hints.gradient.use}.` : undefined).create(context),
          // A mask paints nothing, as in the class form above: style={{maskImage: 'linear-gradient(...)'}} fades an edge.
          styleRule((key, value) => /gradient\(/.test(value) && !/^(?:-?webkit-?)?mask/i.test(key) ? `style.${key} draws a gradient; use a flat role such as ${ex.surface}.` : undefined)(context),
        );
      },
    },

    'no-native-control': {
      meta: meta(`Use ${title}'s components for controls.`, config.docs['no-native-control']),
      create(context) {
        const use = config.natives(ui);
        return {
          JSXOpeningElement(node) {
            const el = elementName(node);
            if (!['button', 'input', 'textarea', 'select', 'dialog'].includes(el)) return;
            const type = el === 'input' ? stringOf(attribute(node, 'type')) : undefined;
            if (type === 'hidden') return;
            context.report({node, message: `Native <${el}${type ? ` type="${type}"` : ''}>; use ${use[type] ?? use[el]}, which brings the focus ring, states and touch size.`});
          },
        };
      },
    },

    'field-label': {
      meta: meta(`Every input sits in a ${field.component ?? 'Field'} with a label.`, config.docs['field-label']),
      create(context) {
        let imports;
        const CONTROLS = new Set(field.controls ?? ['Input', 'Textarea', 'Select', 'Combobox']);
        const PARTS = new Set(field.labelledByPart ?? ['Select', 'Combobox']);
        const FIELD = field.component ?? 'Field';
        let bound;
        // A label outside a Field names its control through htmlFor and the control's id.
        const labelFor = id => {
          if (!bound) {
            bound = new Set();
            const stack = [context.sourceCode.ast];
            while (stack.length) {
              const n = stack.pop();
              if (n?.type === 'JSXAttribute' && attrName(n) === 'htmlFor' && stringOf(n)) bound.add(stringOf(n));
              for (const [key, value] of Object.entries(n ?? {})) {
                if (key === 'parent' || key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') continue;
                if (Array.isArray(value)) stack.push(...value.filter(v => v && typeof v.type === 'string')); else if (value && typeof value.type === 'string') stack.push(value);
              }
            }
          }
          return id !== undefined && bound.has(id);
        };
        const labelled = opening => ['aria-label', 'aria-labelledby'].some(n => attribute(opening, n)) || labelFor(stringOf(attribute(opening, 'id')));
        const isField = element => element.type === 'JSXElement' && imports.get(elementName(element.openingElement))?.imported === FIELD;
        // Select and Combobox take their name on a part: aria-label on SelectTrigger or ComboboxInput counts.
        const labelledInside = node => {
          const stack = [...(node.children ?? [])];
          while (stack.length) {
            const n = stack.pop();
            if (!n || typeof n !== 'object') continue;
            if (n.type === 'JSXElement' && labelled(n.openingElement)) return true;
            for (const [key, value] of Object.entries(n)) {
              if (key === 'parent' || key === 'loc' || key === 'range') continue;
              if (Array.isArray(value)) stack.push(...value); else if (value && typeof value === 'object' && value.type) stack.push(value);
            }
          }
          return false;
        };
        return {
          JSXElement(node) {
            imports ??= ownImports(context);
            const opening = node.openingElement;
            const info = imports.get(elementName(opening));
            if (!info || !CONTROLS.has(info.imported) || labelled(opening) || hasSpread(opening)) return;
            for (let p = node.parent; p; p = p.parent) if (isField(p)) return;
            if (PARTS.has(info.imported) && labelledInside(node)) return;
            context.report({node: opening, message: `<${elementName(opening)}> has no label; wrap it in <${FIELD}> with a <${field.label ?? 'FieldLabel'}> above it, or give it aria-label when the words around it already name it.`});
          },
        };
      },
    },

    'no-restyle': {
      meta: meta(`Place ${title}'s components; do not restyle them.`, config.docs['no-restyle']),
      create(context) {
        let imports;
        // Components whose size is set by the caller, such as a Skeleton shaped to the content it stands in for.
        const SIZED = new Set(restyle.sized ?? []);
        // Controls have a fixed look: their height, padding, type and edge come from size and variant props. Every other
        // component (Card, TableCell, Empty ...) takes padding and type from the caller, but never a fill, radius or shadow.
        const CONTROLS = new Set(restyle.controls ?? []);
        const SURFACE = new Set(['glow', 'fill', 'radius', 'shadow']);
        const PADDING = /^-?(?:p|px|py|ps|pe|pt|pr|pb|pl|pbs|pbe)$/;
        const TEXT_SIZES = own.values.text ?? new Set();
        const restyles = c => {
          const r = c.root;
          if (/^glow/.test(c.base)) return 'glow';
          if (/^type-/.test(c.base) && own.static.has(c.base)) return 'text';
          if (r === undefined) return undefined;
          if (r === 'bg') return 'fill';
          if (r === 'h' || r === 'min-h' || r === 'max-h' || r === 'size') return 'height';
          if (/^rounded/.test(r)) return 'radius';
          if (PADDING.test(r)) return 'padding';
          // An inset hairline shadow draws a line, not a lift.
          if (r === 'shadow') return /^\[inset[_\s]/.test(c.value ?? '') ? 'border' : 'shadow';
          if (/^border/.test(r) && c.value !== undefined && (own.colors.has(c.value) || c.value === '' || isNumber(c.value))) return 'border';
          if (r === 'text' && (own.colors.has(c.value) || /^(?:xs|sm|base|lg|\d?xl)$/.test(c.value) || (TEXT_SIZES.has(c.value) && /xl|xs|sm|lg|base/.test(c.value)))) return 'text';
          if (r === 'font' && ['normal', 'medium', 'semibold', 'bold', 'light'].includes(c.value)) return 'weight';
          return undefined;
        };
        return {
          JSXOpeningElement(node) {
            imports ??= ownImports(context);
            const info = imports.get(elementName(node));
            if (!info || SIZED.has(info.imported)) return;
            const control = CONTROLS.has(info.imported);
            for (const {c, loc} of elementTokens(context.sourceCode, node)) {
              const what = restyles(c);
              if (what && (control || SURFACE.has(what))) context.report({loc, message: `"${c.utility}" restyles the ${what} of <${elementName(node)}>; use its variant and size props, and keep className for placement such as w-full, flex-1, self-start or mt-4.`});
            }
          },
        };
      },
    },

    'one-primary': {
      meta: meta(primary.description ?? 'One primary action per view.', config.docs['one-primary'], 'suggestion'),
      create(context) {
        let imports;
        const groups = new Map();
        const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
        const variantName = primary.variant ?? 'primary';
        // Props that turn a Button into a toggle, which defaults to another variant, and the group whose buttons are one action (a split button).
        const toggles = primary.toggles ?? [];
        const GROUP = primary.group;
        const counted = new Set();
        // Buttons in different branches of a condition are different views; only those on the same path are counted together.
        const branchKey = node => {
          const path = [];
          let child = node;
          for (let p = node.parent; p; child = p, p = p.parent) {
            if (FN.has(p.type)) return {fn: p, key: path.join('|')};
            if (p.type === 'ConditionalExpression' && child !== p.test) path.push(`${p.range[0]}${child === p.consequent ? 'c' : 'a'}`);
            else if (p.type === 'LogicalExpression' && child === p.right) path.push(`${p.range[0]}r`);
            else if (p.type === 'IfStatement' && child !== p.test) path.push(`${p.range[0]}${child === p.consequent ? 'c' : 'a'}`);
            else if (p.type === 'SwitchCase') path.push(`${p.range[0]}s`);
          }
          return {fn: null, key: path.join('|')};
        };
        return {
          JSXOpeningElement(node) {
            imports ??= ownImports(context);
            if (imports.get(elementName(node))?.imported !== 'Button') return;
            const variant = attribute(node, 'variant');
            if (variant && stringOf(variant) !== variantName) return;
            if (hasSpread(node) && !variant) return;
            if (!variant && toggles.some(prop => attribute(node, prop))) return;
            const group = GROUP && node.parent.parent?.type === 'JSXElement' && imports.get(elementName(node.parent.parent.openingElement))?.imported === GROUP ? node.parent.parent : undefined;
            if (group) { if (counted.has(group)) return; counted.add(group); }
            const {fn, key} = branchKey(node);
            const id = `${fn?.range[0] ?? 'top'}:${key}`;
            if (!groups.has(id)) groups.set(id, []);
            groups.get(id).push(node);
          },
          'Program:exit'() {
            for (const nodes of groups.values()) for (const node of nodes.slice(1)) context.report({node, message: primary.message});
          },
        };
      },
    },

    'no-emoji-or-em-dash': {
      meta: meta('Write words: no emoji, no em dash.', config.docs['no-emoji-or-em-dash'], 'suggestion'),
      create(context) {
        const EMOJI = /(?![©®™‼⁉])\p{Extended_Pictographic}/u;
        const check = (node, text) => {
          if (typeof text !== 'string') return;
          if (EMOJI.test(text)) context.report({node, message: `Emoji in UI copy; use words, and an Icon from '${iconFile}' where a glyph helps.`});
          if (text.includes('—')) context.report({node, message: 'Em dash in UI copy; end the sentence or use a comma.'});
        };
        const inJsx = node => node.parent?.type === 'JSXExpressionContainer' || node.parent?.type === 'JSXAttribute';
        return {
          JSXText(node) { check(node, node.value); },
          Literal(node) { if (inJsx(node) && !(node.parent.type === 'JSXAttribute' && isClassAttr(attrName(node.parent)))) check(node, node.value); },
          TemplateLiteral(node) { if (node.parent?.type === 'JSXExpressionContainer') for (const q of node.quasis) check(q, q.value.cooked); },
        };
      },
    },

    'dialog-controlled': {
      meta: meta('Keep a Dialog, Sheet or AlertDialog mounted and open it with open.', config.docs['dialog-controlled']),
      create(context) {
        let imports;
        const OVERLAYS = new Set(config.overlays ?? ['Dialog', 'Sheet', 'AlertDialog']);
        const overlay = node => {
          while (node?.type === 'ParenthesizedExpression') node = node.expression;
          if (node?.type !== 'JSXElement') return undefined;
          const el = elementName(node.openingElement);
          return OVERLAYS.has(imports.get(el)?.imported ?? el) ? el : undefined;
        };
        const report = (node, el) => context.report({node, message: `<${el}> mounts only while open, so it cannot animate out or return focus; keep it mounted and pass open and onOpenChange.`});
        return {
          LogicalExpression(node) {
            imports ??= ownImports(context);
            const el = node.operator === '&&' && overlay(node.right);
            if (el) report(node, el);
          },
          ConditionalExpression(node) {
            imports ??= ownImports(context);
            const empty = n => n.type === 'Literal' && n.value === null || n.type === 'Identifier' && n.name === 'undefined';
            const el = (empty(node.alternate) && overlay(node.consequent)) || (empty(node.consequent) && overlay(node.alternate));
            if (el) report(node, el);
          },
        };
      },
    },

    'no-side-rail': {
      meta: meta('No colored bar on one edge.', config.docs['no-side-rail']),
      create(context) {
        return {
          JSXOpeningElement(node) {
            const all = elementTokens(context.sourceCode, node);
            const colored = all.some(({c}) => /^border(?:-[lrsexy])?$/.test(c.root ?? '') && (own.colors.has(c.value) || stock.colors.has(c.value) || rawColor(c)));
            if (!colored) return;
            for (const {c, loc} of all) if (sideWidth(c)) context.report({loc, message: `"${c.utility}" with a border color draws a bar on one edge; mark a chosen row with ${ex.selected}, and keep borders 1px all round.`});
          },
        };
      },
    },

    'skeleton-still': {
      meta: meta(`No pulse, shimmer or bounce; the spinner is ${title}'s one loop.`, config.docs['skeleton-still']),
      create(context) {
        let imports;
        const SKELETON = config.skeleton ?? 'Skeleton';
        return merge(
          classRule({}, c => decorativeLoop(c) ? `"${c.utility}" loops for decoration; a ${SKELETON} stays still, and the spinner is ${title}'s one looping motion.` : undefined).create(context),
          {
            JSXOpeningElement(node) {
              imports ??= ownImports(context);
              if (imports.get(elementName(node))?.imported !== SKELETON) return;
              for (const {c, loc} of elementTokens(context.sourceCode, node)) {
                if (/^animate-/.test(c.base) && !decorativeLoop(c)) context.report({loc, message: `"${c.utility}" animates a ${SKELETON}; it stays still until the content lands.`});
              }
            },
          },
        );
      },
    },

    'no-scroll-reveal': {
      meta: meta('Content is there when it scrolls in; no reveal on scroll.', config.docs['no-scroll-reveal']),
      create(context) {
        return {
          JSXAttribute(node) {
            if (attrName(node) === 'whileInView') context.report({node, message: 'whileInView fades or slides content in as it scrolls into view; render it in place, and keep motion for answers to what the person did.'});
          },
        };
      },
    },

    'no-second-icon-set': {
      meta: meta(`One icon set, through ${title}'s icon file.`, config.docs['no-second-icon-set']),
      create(context) {
        const check = (node, source) => {
          if (typeof source !== 'string' || /^[.~#]|^@\//.test(source)) return;
          if (ICON_PACKAGES.test(source) || /^(?:@[\w-]+\/)?[\w-]*-icons?(?:-react)?(?:\/|$)/.test(source)) {
            context.report({node, message: `Icons from ${source}; import Icon and the glyph from '${iconFile}', and add a missing glyph to that file.`});
          }
        };
        return {
          ImportDeclaration(node) { check(node.source, node.source.value); },
          ImportExpression(node) { if (node.source.type === 'Literal') check(node.source, node.source.value); },
        };
      },
    },
  };

  // The system's own rules, built on the same reading of classes, imports and elements.
  const kit = {
    name, title, own, stock, meta, parse, classRule, styleRule, merge, pieces, tokens, elementTokens, elementName, attribute, attrName, hasSpread, stringOf,
    isClassAttr, ownImports, rawColor, gradient, isNumber, ui, iconFile,
  };
  Object.assign(rules, config.rules?.(kit) ?? {});

  const ids = Object.keys(rules);
  const warn = new Set([...WARN, ...(config.warn ?? [])]);
  const appOnly = new Set([...APP_ONLY, ...(config.appOnly ?? [])]);

  /**
   * Run alone (npx eslint -c <system>.eslint.config.mjs), ESLint knows only this system's rules, so an eslint-disable
   * comment for another plugin's rule would report that rule as missing. This processor drops those reports and nothing else.
   */
  const standalone = {
    meta: {name: `${name}/standalone`},
    supportsAutofix: true,
    preprocess: text => [text],
    postprocess: messages => messages.flat().filter(m => !(m.ruleId && !m.ruleId.startsWith(`${name}/`) && /^Definition for rule '.+' was not found/.test(m.message))),
  };

  return {
    meta: {name, version: '1.0.0'},
    processors: {standalone},
    rules,
    configs: {
      app: {rules: Object.fromEntries(ids.map(id => [`${name}/${id}`, warn.has(id) ? 'warn' : 'error']))},
      source: {rules: Object.fromEntries(ids.filter(id => appOnly.has(id)).map(id => [`${name}/${id}`, 'off']))},
    },
  };
}
