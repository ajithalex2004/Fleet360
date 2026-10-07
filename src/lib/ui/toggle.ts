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
