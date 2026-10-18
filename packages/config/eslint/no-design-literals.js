// @ts-check
/**
 * agentor/no-design-literals
 *
 * All visual values come from tokens (designspecifikation §2, build brief §4). In class names
 * and style objects this rule forbids:
 *   - Tailwind arbitrary values, e.g. "w-[13px]", "bg-[#fff]" (arbitrary *variants* such as
 *     "data-[state=open]:" and CSS-variable shorthands such as "w-(--x)" stay allowed);
 *   - hex colours and rgb()/hsl() colours;
 *   - raw px lengths in style objects.
 * Add a token in packages/ui/src/styles/theme.css instead.
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab)\(/;
const PX = /\b\d+(?:\.\d+)?px\b/;

/** A class token whose final segment (after the last variant colon) contains [...]. */
function hasArbitraryValue(text) {
  return text.split(/\s+/).some((cls) => {
    if (!cls.includes('[')) return false;
    // Strip variants: everything up to the last ':' that is outside brackets.
    let depth = 0;
    let lastColon = -1;
    for (let i = 0; i < cls.length; i++) {
      const c = cls[i];
      if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === ':' && depth === 0) lastColon = i;
    }
    return cls.slice(lastColon + 1).includes('[');
  });
}

const CLASS_CALLEES = new Set(['cn', 'cva', 'clsx', 'twMerge', 'buttonVariants']);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow design values that bypass the token system' },
    schema: [],
    messages: {
      arbitrary: 'Arbitrary Tailwind value "{{text}}": use a token from theme.css.',
      color: 'Raw colour "{{text}}": use a colour token.',
      px: 'Raw px length "{{text}}" in a style object: use a token.',
    },
  },
  create(context) {
    /** @param {import('estree').Node} node */
    function contextOf(node) {
      /** @type {any} */
      let p = node;
      for (let depth = 0; p && depth < 8; depth++, p = p.parent) {
        if (p.type === 'JSXAttribute') {
          const name = p.name && p.name.name;
          if (name === 'className') return 'class';
          if (name === 'style') return 'style';
          return null;
        }
        if (p.type === 'CallExpression') {
          const callee = p.callee;
          const name = callee.type === 'Identifier' ? callee.name : null;
          if (name && CLASS_CALLEES.has(name)) return 'class';
        }
        if (
          p.type === 'VariableDeclarator' &&
          p.id.type === 'Identifier' &&
          /^[A-Z_]+$/.test(p.id.name)
        ) {
          // Constant lookup tables of class names, e.g. const SIZE = { 24: 'size-6 …' }.
          return 'class';
        }
      }
      return null;
    }

    /** @param {any} node @param {string} text */
    function check(node, text) {
      const where = contextOf(node);
      if (!where) return;
      if (where === 'class' && hasArbitraryValue(text)) {
        context.report({ node, messageId: 'arbitrary', data: { text: text.trim().slice(0, 60) } });
      }
      const color = text.match(HEX) ?? text.match(COLOR_FN);
      if (color) context.report({ node, messageId: 'color', data: { text: color[0] } });
      if (where === 'style') {
        const px = text.match(PX);
        if (px) context.report({ node, messageId: 'px', data: { text: px[0] } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

export default rule;
