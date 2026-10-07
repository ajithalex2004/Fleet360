/**
 * Shared look of the selected option in tab bars, segmented toggles and
 * filter pills: a solid accent with white text, so the active option is
 * obvious in both the light and the dark theme. Inactive options keep a
 * neutral look.
 *
 * Use it in the active branch of the className, e.g.
 *   className={`px-3 py-1.5 rounded-lg ${tab === t ? ACTIVE_TOGGLE : 'text-[var(--text-muted)]'}`}
 * Use ACTIVE_TOGGLE_BORDERED when the element also has a `border` class.
 *
 * Before, several of these used a neutral surface (bg-[var(--bg-surface-hover)])
 * for the active option, which on the light theme is near-white on white.
 */
export const ACTIVE_TOGGLE = 'bg-blue-600 text-white shadow-sm';
export const ACTIVE_TOGGLE_BORDERED = 'bg-blue-600 text-white shadow-sm border border-blue-600';

/**
 * "Back to …" navigation buttons (Back to Tenants, Back to Platform, the
 * header's ← FLEET360 / Home): a dark gradient with white text, so the way
 * back is easy to spot in both themes. Add layout classes (margins etc.)
 * next to it; colours, border, padding and font size come from here.
 */
export const BACK_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-slate-700 to-slate-900 text-white border border-slate-800 shadow-sm hover:from-slate-600 hover:to-slate-800 px-3 py-1.5 text-xs font-medium transition-all';

/** BACK_BUTTON at full button size, for use next to large primary buttons. */
export const BACK_BUTTON_LG =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 text-white border border-slate-800 shadow-sm hover:from-slate-600 hover:to-slate-800 px-6 py-2.5 text-sm font-medium transition-all';
