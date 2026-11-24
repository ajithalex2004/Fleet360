# Fleet360 website — experience blueprint

Theme: **Editorial · Paper & Ember** (Calibri / Carlito, warm paper `#fbfaf7`, ink `#121212`,
ember accent `#c2410c`). One page tells one story; every section answers the question the
previous one raised.

## 1. Narrative spine

| # | Section | Visitor question it answers | Emotional beat | Exit to next |
|---|---|---|---|---|
| 0 | **Hero — "The Living Network"** | What is this, and is it for me? | Awe → recognition ("that's my operation") | "Where does all of this live?" |
| — | Module ticker | How broad is it? | Scale | Scroll cue |
| 01 | **Platform** — 10 operating domains + event chain | Does it cover my whole operation? | Relief: one system, not ten | "Who runs it all?" |
| 02 | **AI agents** — roster + decision loop | Who does the work? | Leverage | "Show me." |
| 03 | **Live product stage** — drayage console | Is it real software? | Proof | "Does it fit my region?" |
| 04 | **UAE / GCC** | Does it understand my authorities and cities? | Belonging | "Can I trust the AI?" |
| 05 | **Governed AI** | Will it act without me? | Safety | "What do I get?" |
| 06 | **Outcomes** — counted numbers | What's the payoff? | Desire | "What's the catch?" |
| 07 | **FAQ** — objections | Cost, rollout, data, integrations | Confidence | "Next step?" |
| 08 | **Closing CTA + footer** | How do I start? | Commitment | Operations review |

## 2. Conversion system

- **Primary goal:** *Book an operations review* (`/operations-review`). It appears in the hero,
  the sticky header (after the hero scrolls away), mid-page after the proof stage, the closing
  section, and a mobile bottom bar.
- **Secondary goal:** *Explore the platform* (in-page tour, anchor links — never a protected
  app route, which would bounce an anonymous visitor to login).
- **Utility:** *Sign in* for existing customers, always top-right.
- Every CTA carries `data-analytics-cta`; every section `data-analytics-section`, feeding
  `homepage_section_view` / `homepage_cta_click` so drop-off per section is measurable.

## 3. Page structure and hierarchy

```
<main>
  header (sticky, condenses on scroll, progress hairline, chapter label)
  section#top        hero            h1
  ticker                             (decorative, aria-label summary)
  section#platform   § 01            h2 → h3 × 10
  section#agents     § 02            h2 → roster table
  section#drayage    § 03            h2 → tabbed console
  section#region     § 04            h2 → h3 × 3
  section#governed   § 05            h2 → h3 × 3
  section#outcomes   § 06            h2 → counted stats
  section#faq        § 07            h2 → <details> × 6
  section#start      closing CTA     h2
  footer
  mobile CTA bar (≤ 900px, after hero)
```

Grid: 1240px container, 40px gutters (22px mobile). Section rhythm 104px (72px mobile).
Every section opens with the same `§ NN — Name` label + h2, so the eye learns the pattern once.

## 4. Hero art direction — "The Living Network"

**Concept.** The visitor's fleet, seen from above, alive. A tilted 3D map plane of the
UAE corridor (Abu Dhabi → Jebel Ali → Dubai → Sharjah) floats beside the headline. Routes
draw themselves, vehicles travel along them, a road closure flashes, and an AI agent card
pops up with the decision it just made. In three seconds it says: *everything you run,
moving, and something intelligent is watching it.*

- **Composition.** 12-col grid: headline 6 cols left; stage 6 cols right, bleeding past the
  container edge. Diagonal reading line: kicker → h1 → lede → CTA → (eye jumps) → map → agent card.
- **Typography.** h1 Calibri Bold, `clamp(52px, 6.6vw, 96px)`, −0.02em, ember italic on
  *thinking*. Words rise in sequence (60ms stagger). Labels 12px caps, 0.14em tracking.
- **3D / depth.** Pure CSS 3D: `perspective: 1400px`, plane at `rotateX(52deg) rotateZ(-14deg)`.
  Upright HTML cards float above it (KPIs + agent decision), giving three depth layers:
  paper grid → routes → floating UI. No WebGL: zero extra JS weight, crisp at any DPI.
- **Lighting and texture.** A warm radial "sun" gradient falls on the plane's far edge, a soft
  contact shadow sits under it, and the grid fades out with a mask, like ink on paper.
- **Imagery.** Vector only: coastline, roads, city pins, vehicles as ember/ink dots.
  No stock photography, so nothing generic.
- **Entrance (≈1.4s total).** Kicker fade → h1 words rise → lede → CTAs → plane eases in from
  flatter angle → routes draw (stroke-dashoffset) → vehicles start → first agent card at 1.6s.
- **Interaction.** Pointer parallax tilts the plane ±4° (rAF-throttled, desktop only). The agent
  card cycles through real event types every 4.5s; hovering pauses it.
- **Scroll.** As the hero leaves, the plane flattens and drifts up (CSS scroll-driven
  animation where supported; static elsewhere).
- **Accessibility.** The stage is `aria-hidden` decoration with a text summary; the cycling card
  is not a live region, so it doesn't interrupt screen readers. `prefers-reduced-motion` freezes
  everything on a composed final frame.
- **CTA.** Solid ink pill "Book an operations review →" + ghost "Take the tour" (scrolls to § 01).

## 5. Motion system

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.2,.7,.2,1)` | entrances, reveals |
| `--dur-1` | 200ms | hovers, buttons |
| `--dur-2` | 600ms | section reveals |
| `--dur-3` | 1200ms | hero choreography |

Rules: animate only `transform` and `opacity`; reveal once (no re-trigger on scroll-up);
stagger ≤ 80ms; nothing loops in the viewport except the hero network and the ticker; all
motion respects `prefers-reduced-motion`.

## 6. Scrolling behaviour

- Native scroll (no scroll-jacking); `scroll-behavior: smooth` for anchors; `scroll-margin-top`
  so headings clear the sticky header.
- Section content reveals at 15% visibility (IntersectionObserver). Content is visible by
  default and only hidden once JS has booted, so no-JS and crawlers see everything.
- Header: transparent at top → condensed paper bar with blur, 2px ember progress hairline and
  the current chapter (`§ 03 Live product`) after the hero.
- Outcome numbers count up once when visible.
