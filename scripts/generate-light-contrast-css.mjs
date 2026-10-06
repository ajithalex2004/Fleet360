#!/usr/bin/env node
/**
 * Generates src/app/light-contrast.css: light-theme readability for screens
 * styled for the dark theme. Run after editing the table below:
 *
 *   node scripts/generate-light-contrast-css.mjs
 *
 * Three rules per hue, light theme only (html.light); the dark theme is untouched:
 *
 * 1. Tinted chips and buttons. An element (button, link, tab, span badge,
 *    label) pairing a translucent background of a hue (`bg-amber-500/15`)
 *    with a pale text shade of the same hue (`text-amber-300`) gets a solid
 *    dark background of that hue and white text.
 *
 * 2. Pale text elsewhere. `text-<hue>-200…500` on its own is darkened to a
 *    readable shade, except on genuinely dark backgrounds (solid 500-950
 *    fills, gradients, black overlays), where it keeps its original colour:
 *    those backgrounds set --lc-* back to the original values.
 *
 * 3. Mid-tone solid fills with white text. `bg-<hue>-300/400/500` together
 *    with `text-white` (e.g. `bg-cyan-500 text-white`, 2.4:1) gets the dark
 *    shade of the hue instead.
 *
 * Neutral hues (slate, gray, …) skip the 500 shade in rules 2 and 3: their
 * 500 is already readable on white and with white text.
 *
 * Class matching: text shades and solid fills must be whole classes (`~=`),
 * so `hover:text-amber-300` or `dark:bg-cyan-500` alone do not trigger it;
 * background tints must start a class (`^=` / ` bg-…`), so `hover:bg-…/20`
 * does not either.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// hue: Tailwind palette originals for 200/300/400/500, then the light-theme
// text shade, the dark fill (chips, solid buttons) and its hover.
const HUES = {
  slate:   { neutral: true, pale: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b'], text: '#334155', chip: '#334155', hover: '#1e293b' },
  gray:    { neutral: true, pale: ['#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280'], text: '#374151', chip: '#374151', hover: '#1f2937' },
  zinc:    { neutral: true, pale: ['#e4e4e7', '#d4d4d8', '#a1a1aa', '#71717a'], text: '#3f3f46', chip: '#3f3f46', hover: '#27272a' },
  neutral: { neutral: true, pale: ['#e5e5e5', '#d4d4d4', '#a3a3a3', '#737373'], text: '#404040', chip: '#404040', hover: '#262626' },
  stone:   { neutral: true, pale: ['#e7e5e4', '#d6d3d1', '#a8a29e', '#78716c'], text: '#44403c', chip: '#44403c', hover: '#292524' },
  red:     { pale: ['#fecaca', '#fca5a5', '#f87171', '#ef4444'], text: '#b91c1c', chip: '#b91c1c', hover: '#991b1b' },
  orange:  { pale: ['#fed7aa', '#fdba74', '#fb923c', '#f97316'], text: '#9a3412', chip: '#c2410c', hover: '#9a3412' },
  amber:   { pale: ['#fde68a', '#fcd34d', '#fbbf24', '#f59e0b'], text: '#92400e', chip: '#b45309', hover: '#92400e' },
  yellow:  { pale: ['#fef08a', '#fde047', '#facc15', '#eab308'], text: '#854d0e', chip: '#a16207', hover: '#854d0e' },
  lime:    { pale: ['#d9f99d', '#bef264', '#a3e635', '#84cc16'], text: '#3f6212', chip: '#4d7c0f', hover: '#3f6212' },
  green:   { pale: ['#bbf7d0', '#86efac', '#4ade80', '#22c55e'], text: '#15803d', chip: '#15803d', hover: '#166534' },
  emerald: { pale: ['#a7f3d0', '#6ee7b7', '#34d399', '#10b981'], text: '#047857', chip: '#047857', hover: '#065f46' },
  teal:    { pale: ['#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6'], text: '#0f766e', chip: '#0f766e', hover: '#115e59' },
  cyan:    { pale: ['#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4'], text: '#0e7490', chip: '#0e7490', hover: '#155e75' },
  sky:     { pale: ['#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9'], text: '#0369a1', chip: '#0369a1', hover: '#075985' },
  blue:    { pale: ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6'], text: '#1d4ed8', chip: '#1d4ed8', hover: '#1e40af' },
  indigo:  { pale: ['#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1'], text: '#4338ca', chip: '#4338ca', hover: '#3730a3' },
  violet:  { pale: ['#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6'], text: '#6d28d9', chip: '#5b21b6', hover: '#4c1d95' },
  purple:  { pale: ['#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7'], text: '#7e22ce', chip: '#6b21a8', hover: '#581c87' },
  fuchsia: { pale: ['#f5d0fe', '#f0abfc', '#e879f9', '#d946ef'], text: '#a21caf', chip: '#86198f', hover: '#701a75' },
  pink:    { pale: ['#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899'], text: '#be185d', chip: '#9d174d', hover: '#831843' },
  rose:    { pale: ['#fecdd3', '#fda4af', '#fb7185', '#f43f5e'], text: '#be123c', chip: '#9f1239', hover: '#881337' },
};
const PALE_SHADES = [200, 300, 400, 500];
const TINT_SHADES = [400, 500, 600, 700, 800, 900, 950];
const CHIP_ELEMENTS = 'button, a, span, label, [role="button"], [role="tab"]';
const INTERACTIVE = 'button, a, [role="button"], [role="tab"]';

const hues = Object.keys(HUES);
const paleShades = (h) => (HUES[h].neutral ? PALE_SHADES.filter((s) => s !== 500) : PALE_SHADES);
const solidShades = (h) => (HUES[h].neutral ? [300, 400] : [300, 400, 500]);
const v = (hue, shade) => `--lc-${hue}-${shade}`;
const startsClass = (prefix) => `[class^="${prefix}"], [class*=" ${prefix}"]`;
const cls = (name) => `[class~="${name}"]`;

// Dark backgrounds where pale text is intended: solid fills, gradients, overlays.
const darkBackgrounds = [
  ...hues.flatMap((h) => [500, 600, 700, 800, 900, 950].map((s) => cls(`bg-${h}-${s}`))),
  startsClass('bg-gradient-'), startsClass('bg-black'), cls('bg-black'),
].join(',\n  ');

let css = `/* GENERATED by scripts/generate-light-contrast-css.mjs — do not edit by hand.
 *
 * Light theme only: pale, dark-theme colours made readable. See the
 * generator for the rules. Unlayered, so it wins over Tailwind utilities
 * (including hover:*) without !important.
 */

/* Genuinely dark backgrounds keep the original text colours. */
html.light :is(
  ${darkBackgrounds}
) {
${hues.flatMap((h) => paleShades(h).map((s) => `  ${v(h, s)}: ${HUES[h].pale[PALE_SHADES.indexOf(s)]};`)).join('\n')}
}
`;

for (const h of hues) {
  const { text, chip, hover } = HUES[h];
  css += `\n/* ${h} */\n`;

  // Rule 2: pale text.
  css += paleShades(h).map((s) => `html.light ${cls(`text-${h}-${s}`)} { color: var(${v(h, s)}, ${text}); }`).join('\n') + '\n';

  // Rule 3: mid-tone solid fill with white text.
  const solid = `html.light ${cls('text-white')}:is(${solidShades(h).map((s) => cls(`bg-${h}-${s}`)).join(', ')})`;
  css += `${solid} {\n  background-color: ${chip};\n  border-color: ${chip};\n}\n`;
  css += `${solid}:is(${INTERACTIVE}):hover:not(:disabled) {\n  background-color: ${hover};\n  border-color: ${hover};\n}\n`;

  // Rule 1: tinted chip / button (declared last: it wins over rule 2's text colour).
  const tint = TINT_SHADES.map((s) => startsClass(`bg-${h}-${s}/`)).join(', ');
  const chipText = [100, ...paleShades(h)].map((s) => cls(`text-${h}-${s}`)).join(', ');
  const chipSel = `html.light :is(${CHIP_ELEMENTS}):is(${tint}):is(${chipText})`;
  css += `${chipSel} {\n  background-color: ${chip};\n  border-color: ${chip};\n  color: #ffffff;\n}\n`;
  css += `${chipSel}:is(${INTERACTIVE}):hover:not(:disabled) {\n  background-color: ${hover};\n  border-color: ${hover};\n}\n`;
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'light-contrast.css');
writeFileSync(out, css);
console.log(`wrote ${path.relative(process.cwd(), out)} (${css.length} bytes, ${hues.length} hues)`);
