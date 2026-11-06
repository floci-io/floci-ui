import {createPlugin} from './core.mjs';

// Sodium's lint rules, as an ESLint plugin. The shared rules live in core.mjs, which the design.how registry build
// copies here; this file says what they call things in Sodium and adds the rules only Sodium has: zero radius, no
// yellow as text or a mark on a light ground, mono capitals only through the label roles, one primary per group of
// actions, no shadows, mono through its roles and no grid behind the page. Each rule's docs link points at the Sodium
// rule it enforces.

const SITE = 'https://design.how/systems/sodium';
const FOUNDATIONS = ['anti-slop', 'color', 'typography', 'space', 'radius', 'borders-and-lines', 'elevation', 'motion', 'iconography'];
const COMPONENTS = ['button', 'button-group', 'copy-button', 'field', 'input', 'textarea', 'select', 'combobox', 'checkbox', 'radio-group', 'switch', 'slider', 'segmented-control',
  'tag', 'status-strip', 'avatar', 'kbd', 'item', 'data-list', 'status', 'meter', 'progress', 'alert', 'toast', 'empty-state', 'skeleton',
  'dialog', 'sheet', 'popover', 'tooltip', 'dropdown-menu', 'command', 'tabs', 'numbered-tabs', 'breadcrumb', 'pagination', 'collapsible', 'frame',
  'table', 'filter-bar', 'code-block', 'code-window', 'json-view', 'log-viewer',
  'chart', 'stem-chart', 'swimlanes', 'bar-blocks',
  'tool-call-row', 'tool-call', 'activity', 'prompt-input', 'message', 'response'];

/** Button's primary family: the yellow slab and the destructive. A group leads with one of them, so each counts as its primary. */
const PRIMARY = new Set(['primary', 'destructive']);
/** Containers that hold one group of actions. Two primaries anywhere inside one is two. */
const GROUP = /(?:Card|Footer|Actions|Toolbar|ButtonGroup|Dialog|AlertDialog|Sheet|Popover|Panel|Frame)$/;
/** The structure recipes that make a plain element one region, and so one group. */
const GROUP_CLASS = new Set(['frame', 'panel', 'panel-head']);
/** Tracking a role sets on prose and headlines, which is not spread letters. */
const TRACKING = new Set(['display', 'title', 'heading', 'body', 'normal']);
/** The roots that paint text or a mark: on a light ground, solid yellow there is 1.4:1. */
const MARK_ROOTS = /^(?:text|fill|stroke|decoration|caret|outline|border(?:-[xytblrse])?|ring|divide|accent|placeholder)$/;
/** A page root: where a texture would sit behind every word. */
const PAGE_ROOT = new Set(['body', 'main', 'html']);
const PAGE_SIZE = new Set(['min-h-dvh', 'min-h-screen', 'h-dvh', 'h-screen', 'min-h-svh', 'h-svh']);

const plugin = createPlugin({
  name: 'sodium',
  title: 'Sodium',
  site: SITE,
  pages: {sodium: '', ...Object.fromEntries(FOUNDATIONS.map(slug => [slug, `/foundations/${slug}`])), ...Object.fromEntries(COMPONENTS.map(slug => [slug, `/components/${slug}`]))},
  docs: {
    'unknown-class': 'sodium-tokens-only', 'no-raw-color': 'sodium-tokens-only', 'no-arbitrary-value': 'space-grid', 'no-inline-style': 'sodium-tokens-only',
    'no-dynamic-class': 'sodium-tokens-only', 'no-dark-variant': 'color-roles-only', 'no-caps': 'typography-caps-through-roles', 'no-transition-all': 'motion-name-properties',
    'no-outline-none': 'sodium-focus-ring', 'no-gradient': 'anti-slop-no-decoration', 'no-native-control': 'sodium-components-first', 'field-label': 'sodium-components-first',
    'no-restyle': 'sodium-components-first', 'one-primary': 'sodium-one-primary', 'no-emoji-or-em-dash': 'anti-slop-no-emoji',
    'dialog-controlled': 'anti-slop-dialog-controlled', 'no-side-rail': 'anti-slop-no-side-rail', 'skeleton-still': 'motion-loops',
    'no-scroll-reveal': 'anti-slop-no-scroll-reveal', 'no-second-icon-set': 'iconography-one-source',
  },
  roles: {text: ['text-1', 'text-2', 'text-3', 'accent-text'], bg: ['page', 'panel', 'well', 'selected'], line: ['line', 'line-faint', 'line-control'], other: ['text-1', 'page', 'line']},
  examples: {text: 'text-text-1', muted: 'text-text-2', surface: 'bg-panel', tint: 'bg-fail-tint', selected: 'selected'},
  tracking: [...TRACKING],
  hints: {
    font: 'a type-* role such as type-heading or type-label; Sodium sets every word at 400',
    textSize: 'a type-* role such as type-body, type-body-sm, type-label or type-caption',
    caps: 'capitals come only with type-label, type-label-sm, type-label-lg or type-micro',
    white: 'text on solid ink is text-text-inverse',
    focusRing: 'Sodium\'s 2px :focus-visible ring',
    duration: 'duration-(--dur-state)',
    gradient: {description: 'No gradients: Sodium is flat fills and 1px rules.', use: 'a flat role such as bg-panel or bg-well'},
  },
  natives: ui => ({button: `Button from '${ui}/button'`, textarea: `Textarea from '${ui}/textarea'`, select: `Select from '${ui}/select'`,
    dialog: `Dialog or Sheet from '${ui}/'`, checkbox: `Checkbox from '${ui}/checkbox'`, radio: `RadioGroup from '${ui}/radio-group'`,
    range: `Slider from '${ui}/slider'`, file: `Attachment from '${ui}/attachment'`, input: `Input from '${ui}/input' inside a Field`}),
  restyle: {
    sized: ['Skeleton', 'ScrollArea'],
    controls: ['Button', 'CopyButton', 'Input', 'Textarea', 'SelectTrigger', 'ComboboxInput', 'Tag', 'Avatar', 'Switch', 'Checkbox',
      'RadioGroupItem', 'SegmentedControl', 'SegmentedControlItem', 'Slider', 'TabsList', 'TabsTrigger', 'Progress', 'Meter', 'Kbd'],
  },
  overlays: ['Dialog', 'Sheet', 'AlertDialog'],

  rules: kit => {
    const {meta, classRule, elementTokens, elementName, attribute, stringOf, hasSpread, ownImports} = kit;
    const jsx = node => node?.type === 'JSXElement' || node?.type === 'JSXFragment';

    return {
      // Replaces the shared one-primary: in Sodium the rule is per group of actions, and the yellow slab and the
      // destructive are one family, so either counts as the group's primary.
      'one-primary': {
        meta: meta('At most one primary Button (the yellow slab or the destructive) in a frame, panel, footer, dialog or any group of actions; every other action beside it is variant="secondary" or "ghost".', 'sodium-one-primary'),
        create(context) {
          let imports;
          const counts = new Map();
          const message = 'A second primary Button in this group; the yellow slab marks the one thing to act on, so a frame, footer, dialog or row of actions leads with one primary or destructive, and this one is variant="secondary".';
          /** The JSX parent the Button renders into, and which branch of a condition it sits in, so exclusive branches never count together. */
          const parentOf = element => {
            const path = [];
            let child = element;
            for (let p = element.parent; p; child = p, p = p.parent) {
              if (jsx(p)) return {parent: p, branch: path.join('|')};
              if (p.type === 'ConditionalExpression') { if (child === p.test) return undefined; path.push(`${p.range[0]}${child === p.consequent ? 'c' : 'a'}`); continue; }
              if (['JSXExpressionContainer', 'LogicalExpression', 'ParenthesizedExpression'].includes(p.type)) continue;
              return undefined;
            }
            return undefined;
          };
          /** The nearest container that holds one group of actions. */
          const groupOf = element => {
            for (let p = element.parent; p; p = p.parent) {
              if (p.type !== 'JSXElement') continue;
              const opening = p.openingElement;
              const name = elementName(opening);
              if (name && GROUP.test(imports.get(name)?.imported ?? name)) return p;
              if (elementTokens(context.sourceCode, opening).some(({c}) => !c.variants.length && GROUP_CLASS.has(c.base))) return p;
            }
            return undefined;
          };
          const count = key => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n; };
          return {
            JSXOpeningElement(node) {
              imports ??= ownImports(context);
              if (imports.get(elementName(node))?.imported !== 'Button') return;
              const variant = attribute(node, 'variant');
              if (variant ? !PRIMARY.has(stringOf(variant)) : hasSpread(node)) return;
              const element = node.parent;
              const at = parentOf(element);
              const group = groupOf(element);
              const siblings = at ? count(`p${at.parent.range[0]}:${at.branch}`) : 0;
              const inGroup = group ? count(`g${group.range[0]}:${at?.branch ?? ''}`) : 0;
              if (siblings > 1 || inGroup > 1) context.report({node, message});
            },
          };
        },
      },

      // Replaces the shared no-caps: Sodium speaks in mono capitals, but only through the label roles, which carry the
      // case and the tracking together. Capitals or tracking written by hand anywhere else still fail.
      'no-caps': classRule(meta('Set capitals and letter spacing only through the label roles: type-label, type-label-sm, type-label-lg or type-micro.', 'typography-caps-through-roles'), c => {
        const tracked = /^-?tracking$/.test(c.root ?? '') && !TRACKING.has(c.value) && !/^\(?--/.test(c.value ?? '') && !c.base.startsWith('-');
        if (c.base !== 'uppercase' && !tracked && !/^\[(?:text-transform:uppercase|letter-spacing:)/.test(c.base)) return undefined;
        return `"${c.utility}" sets capitals or tracking by hand; use type-label (13px mono capitals at +0.05em), type-label-sm, type-label-lg or type-micro, which carry both, and keep prose and headlines in sentence case.`;
      }),

      'no-radius': classRule(meta('Zero radius everywhere: no rounded-* class.', 'radius-zero'), c => {
        const root = c.root ?? '';
        if (!/^rounded(?:-[a-z]{1,2})?$/.test(root) && !/^rounded(?:-|$)/.test(c.base)) return undefined;
        if (['none', '0'].includes(c.value ?? '') || /\bnone$/.test(c.base)) return undefined;
        return `"${c.utility}" rounds a corner, and every corner in Sodium is square; every stock corner draws 0 here, so drop the class.`;
      }),

      // Solid yellow (the accent-fill role) is 1.4:1 on a light ground, so as text, an icon, a lone line or a ring it
      // vanishes. Yellow-family text is text-accent-text, which is dark gold in light and yellow in dark.
      'no-yellow-on-light': classRule(meta('Never set text, an icon or a lone line in solid yellow: yellow-family text is text-accent-text, and a yellow fill sits under ink.', 'color-yellow-rules'), c => {
        if (c.value !== 'accent-fill' || !MARK_ROOTS.test(c.root ?? '')) return undefined;
        return `"${c.utility}" paints text or a line in solid yellow, 1.4:1 on a light ground; use text-accent-text (dark gold in light, yellow in dark) for a word, and keep bg-accent-fill for a slab under ink or a chart series.`;
      }),

      'no-shadow': classRule(meta('No shadows: an overlay is the panel with a rule edge.', 'elevation-no-shadows'), c => {
        const root = c.root ?? '';
        const named = /^(?:shadow|inset-shadow|drop-shadow|text-shadow)$/.test(root) && !['none', 'transparent', 'current', 'inherit'].includes(c.value ?? '') && !c.modifier;
        const bare = ['shadow', 'drop-shadow', 'inset-shadow'].includes(c.base);
        const raw = /^\[(?:box-shadow|text-shadow|filter:drop-shadow)/.test(c.base);
        if (!named && !bare && !raw) return undefined;
        return `"${c.utility}" casts a shadow, and Sodium has none: every shadow class draws nothing here. Give an overlay the overlay recipe (the panel and a 1px rule edge) and a region a frame.`;
      }),

      'mono-roles': classRule(meta('Set mono through its roles: a type-label role for interface words, type-code or type-code-sm for code and values, mono inside a sentence of sans.', 'typography-mono-roles'), c => {
        if (c.base !== 'font-mono') return undefined;
        return `"${c.utility}" sets Commit Mono with no role: interface words take type-label (mono capitals), code and values type-code or type-code-sm, and mono inside a sentence of sans takes mono, at 0.85 of the text around it.`;
      }),

      // No cell grid (docs/sodium/DECISIONS.md). A texture on a page root sits behind every word, so the dots recipe goes on a large
      // empty gutter only.
      'no-page-grid': {
        meta: meta('No grid or dot texture behind the page: dots only on a large empty gutter, and structure is rules between content.', 'borders-and-lines-no-page-grid'),
        create(context) {
          return {
            JSXOpeningElement(node) {
              const all = elementTokens(context.sourceCode, node).filter(({c}) => !c.variants.length);
              const texture = all.find(({c}) => c.base === 'dots');
              if (!texture) return;
              const name = elementName(node) ?? '';
              const root = PAGE_ROOT.has(name) || all.some(({c}) => PAGE_SIZE.has(c.base) || c.base === 'sodium');
              const holds = node.parent?.children?.some(child => child.type === 'JSXText' ? child.value.trim() : child.type === 'JSXElement' || child.type === 'JSXExpressionContainer');
              if (!root && !holds) return;
              context.report({loc: texture.loc, message: `"dots" ${root ? 'on a page root draws a grid behind every word' : 'behind content draws a grid under the words'}; Sodium has no cell grid. Divide content with rules (rule-row, rule-col, frame) and keep dots for an empty gutter with nothing in it.`});
            },
          };
        },
      },
    };
  },
});

// Two primaries side by side is never right in Sodium, so it fails the lint rather than warning.
plugin.configs.app.rules['sodium/one-primary'] = 'error';

export default plugin;
