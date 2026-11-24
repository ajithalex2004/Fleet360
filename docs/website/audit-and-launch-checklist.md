# Fleet360 website — audit and launch checklist

Scope: public homepage (`/`), sign-in and password pages (`/login`, `/forgot-password`,
`/reset-password`), crawler and share metadata. Audited on the development server at
1440×900 and 375×812 in Chromium, plus a production build.

Legend: ✅ verified · ⚠️ works, improvement recommended · ❌ issue found and fixed in this
change · ⏳ not verifiable here; must be checked before launch.

## 1. Audit

### Visual quality
- ✅ One system across homepage and auth pages: Calibri/Carlito, Paper & Ember palette,
  hairline rules, pill buttons, `§ NN` section labels.
- ✅ Hero has three depth layers (paper grid → live routes → floating UI) and no stock imagery.
- ⚠️ The drayage "live product" stage is denser and more technical than the rest of the
  page. Consider a calmer 2-tab version once real customer feedback is in.

### Storytelling
- ✅ Narrative runs: promise → breadth → who does the work → proof → regional fit → trust →
  payoff → objections → ask (see `experience-blueprint.md`).
- ✅ New FAQ section handles the six usual buying objections before the final CTA.
- ⏳ **FAQ answers are draft copy.** Confirm the hosting/data-residency, Arabic, pricing and
  rollout statements with the business before launch.
- ⏳ Outcome numbers show "(illustrative)" until `FLEET360_PUBLIC_*` env values are set.
  Publish real, defensible numbers or keep the label.

### Navigation and conversion paths
- ❌→✅ Header links pointed at `/logistics/drayage`, `/agents` and `/ai-platform`. Those are
  protected app routes, so anonymous visitors were bounced to the login page. They are now
  in-page anchors.
- ❌→✅ The drayage stage linked prospects into the protected console in 6 places, and its tab
  badges exposed internal route paths. The stage now offers prospects the review and labels
  the console link "Customers: sign in".
- ✅ The primary CTA (*Book an operations review*) is reachable from the hero, the condensed
  header, the drayage stage, the closing section, the mobile menu and the mobile bottom bar.
  Every CTA is tagged with `data-analytics-cta`.
- ✅ The sticky header shows the current chapter and a scroll-progress hairline.

### Animation and scrolling
- ✅ Animations change only `transform` and `opacity`. Elements reveal once, staggered by 70ms or less.
- ✅ Native scrolling (no scroll-jacking), smooth anchor scrolling, and `scroll-margin-top`
  so headings clear the sticky header.
- ✅ Content is visible without JS. Reveal only hides elements below the fold after hydration.
- ✅ `prefers-reduced-motion` handling:
  - stops the hero vehicles and shows a composed static frame;
  - disables the reveals, count-up, card cycling and parallax.
- ⏳ Reduced-motion mode was reviewed in code but not emulated in a browser. Check it
  with the OS setting on.
- ⚠️ The scroll-driven hero exit (`animation-timeline`) runs in Chromium only. Safari and
  Firefox show a static hero, which is the intended fallback.

### Responsiveness
- ✅ At 375px there is no horizontal overflow. The hero map is cropped to fit, one KPI chip is
  hidden, the menu animates, and a bottom CTA bar appears after the hero and hides at the
  closing CTA.
- ⏳ Not yet checked at 768px (tablet), 1024px, or above 1920px.

### Accessibility
- ✅ One `h1` and ordered `h2`s. Landmarks: `header`, `main`, `footer` and labelled `nav`s.
  There is a skip link. No images are missing `alt`.
- ✅ The hero stage is `role="img"` with a text summary. The cycling agent card is not a live
  region, so it doesn't interrupt screen readers.
- ✅ Visible focus rings on links, buttons and FAQ summaries. FAQ items use native `<details>`.
- ✅ The ember accent `#c2410c` meets WCAG AA (≈5:1) on paper for text.
- ⚠️ The hero pauses card cycling on hover, but keyboard users have no pause control.
  Add a pause button, or stop cycling after one full loop.
- ⏳ Run axe or Lighthouse accessibility, and a real screen-reader pass (NVDA and VoiceOver).

### SEO
- ✅ Unique title and description, canonical, Open Graph and Twitter `summary_large_image`.
- ✅ Generated 1200×630 share image at `/opengraph-image`.
- ✅ `robots.txt` lets crawlers into the marketing pages and `/_next/` assets and keeps them
  out of the app and APIs. `sitemap.xml` lists `/` and `/operations-review`.
- ✅ JSON-LD for `Organization`, `SoftwareApplication` and `FAQPage`, with `<` escaped.
- ⏳ `NEXT_PUBLIC_APP_URL` must be the production origin, or the canonical, sitemap and OG
  URLs will point at localhost.
- ⚠️ `/operations-review` still uses the older page styling and default metadata.

### Loading speed
- ✅ No new dependencies: no WebGL, animation library or images in the hero.
- ✅ The hero is roughly 10 KB of inline SVG. Animations run on the compositor. The font is
  self-hosted Carlito (`display: swap`) and Calibri is used where it is installed.
- ✅ The homepage makes no API calls other than first-party analytics beacons.
- ⏳ Run Lighthouse or WebPageTest on the deployed production URL. Targets: LCP < 2.5s,
  CLS < 0.1, INP < 200ms on mid-range mobile over 4G.

### Browser compatibility
- ✅ Chromium verified.
- ⏳ Safari (iOS and macOS) and Firefox not tested here. Things to check:
  - SVG `animateMotion` (widely supported);
  - CSS 3D `preserve-3d` (supported);
  - `backdrop-filter` (Safari needs the `-webkit-` prefix; the fallback is solid paper);
  - `mask-image` (Safari needs `-webkit-mask-image`; without it the plane edge is just hard).

### Security basics
- ✅ The existing headers stay in place: HSTS, CSP, XFO, nosniff, Referrer-Policy and
  Permissions-Policy.
- ✅ The three new public routes are static and data-free. They are declared in the
  public-route inventory test, and that test passes.
- ✅ JSON-LD is built from constants, not user input, and is escaped.
- ⚠️ The CSP allows `'unsafe-inline'` and `'unsafe-eval'` site-wide (this predates the
  change). Moving to nonces would harden the whole app; plan it separately.

## 2. Launch checklist

**Mobile fallbacks**
- [ ] On a real iPhone and Android, check:
  - [ ] the hero map crop;
  - [ ] the bottom CTA bar clears the home indicator (consider `env(safe-area-inset-bottom)`);
  - [ ] the menu closes on tap.
- [ ] Turn on reduced motion in the OS settings and confirm the hero shows the static frame.

**CTAs and conversion**
- [ ] Submit `/operations-review` end to end and confirm the request reaches the
      operations inbox.
- [ ] Confirm every CTA fires `homepage_cta_click` in the deployment logs.

**Content and assets**
- [ ] The business has approved the FAQ answers and every outcome claim.
- [ ] Either set `FLEET360_PUBLIC_*` snapshot values or keep the "illustrative" labels.
- [ ] Favicon and app icons render. The share card looks right in LinkedIn and WhatsApp.

**Performance**
- [ ] Lighthouse mobile performance ≥ 90 on the production URL.
- [ ] Carlito woff2 is served from `/_next/static`, with no layout shift as the font swaps.

**Accessibility**
- [ ] axe reports no serious or critical issues.
- [ ] A keyboard-only pass works: skip link, nav, FAQ, CTAs.
- [ ] NVDA or VoiceOver reads the hero summary.

**Cross-browser**
- [ ] Latest Chrome, Edge, Safari (macOS and iOS), Firefox and Samsung Internet.

**SEO metadata**
- [ ] `NEXT_PUBLIC_APP_URL` is the production origin.
- [ ] Submit the sitemap in Google Search Console and Bing Webmaster Tools.
- [ ] Validate the structured data with the Rich Results Test.

**Analytics**
- [ ] `/api/public/analytics` events show up in logs or the dashboard.
- [ ] Build a funnel: view → section depth → CTA click → review submitted.

**Error handling**
- [ ] With the API down, the homepage still renders (it has no data dependencies).
- [ ] The login page shows the network error message when the network fails.
- [ ] The 404 page is branded.

**Deployment**
- [ ] `npm run build` passes locally (CI can't run; see project notes).
- [ ] Deploy to staging first and smoke-test `/`, `/login`, `/robots.txt`, `/sitemap.xml`
      and `/opengraph-image`.
- [ ] Promote to production, then purge the CDN cache for `/`.
