'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import s from './Editorial.module.css';

const NAV = [
  { href: '#platform', label: 'Platform' },
  { href: '#agents', label: 'AI agents' },
  { href: '#drayage', label: 'Live product' },
  { href: '#governed', label: 'Governed AI' },
  { href: '#faq', label: 'FAQ' },
];

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M14 7l5 5-5 5" /></svg>
);

/**
 * Sticky header (condenses after the hero, shows scroll progress and the
 * current chapter), plus the mobile bottom CTA bar. Chapters come from
 * `[data-chapter]` elements on the page.
 */
export function SiteHeader() {
  const progressRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [condensed, setCondensed] = useState(false);
  const [chapter, setChapter] = useState('');
  const [showBar, setShowBar] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) root.style.scrollBehavior = 'smooth';

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = root.scrollHeight - window.innerHeight;
        const p = max > 0 ? window.scrollY / max : 0;
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
        setCondensed(window.scrollY > 24);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const hero = document.getElementById('top');
    const closing = document.getElementById('start');
    const visible = new Map<Element, boolean>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => visible.set(e.target, e.isIntersecting));
      setShowBar(!visible.get(hero!) && !visible.get(closing!));
    }, { threshold: 0.05 });
    if (hero) io.observe(hero);
    if (closing) io.observe(closing);

    const chapters = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
    const chapterIo = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setChapter((e.target as HTMLElement).dataset.chapter ?? ''); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    chapters.forEach((c) => chapterIo.observe(c));

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      io.disconnect();
      chapterIo.disconnect();
      root.style.scrollBehavior = '';
    };
  }, []);

  const closeMenu = () => menuRef.current?.removeAttribute('open');

  return (
    <>
      <header className={`${s.siteHeader} ${condensed ? s.condensed : ''}`}>
        <div className={`${s.wrap} ${s.nav}`}>
          <Link className={s.brand} href="/" aria-label="Fleet360 home">Fleet<b>360</b></Link>
          <span className={`${s.chapter} ${s.label}`} aria-hidden="true">{condensed ? chapter : ''}</span>
          <nav className={s.navLinks} aria-label="Primary navigation">
            {NAV.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
          </nav>
          <div className={s.navActions}>
            <Link className={`${s.btn} ${s.btnGhost} ${s.navSignIn}`} href="/login" data-analytics-cta="hero_signin">Sign in</Link>
            <Link className={`${s.btn} ${s.btnSolid} ${s.navCta}`} href="/operations-review" data-analytics-cta="header_operations_review">
              Book a review <Arrow />
            </Link>
          </div>
          <details className={s.mobileNav} ref={menuRef}>
            <summary aria-label="Open navigation"><span /><span /><span /></summary>
            <nav aria-label="Mobile navigation">
              {NAV.map((item) => <a key={item.href} href={item.href} onClick={closeMenu}>{item.label}</a>)}
              <Link href="/login" onClick={closeMenu}>Sign in</Link>
              <Link href="/operations-review" className={s.mobileNavCta} data-analytics-cta="menu_operations_review">Book an operations review →</Link>
            </nav>
          </details>
        </div>
        <span ref={progressRef} className={s.progress} aria-hidden="true" />
      </header>

      <div className={`${s.mobileBar} ${showBar ? s.mobileBarOn : ''}`} aria-hidden={!showBar}>
        <Link className={`${s.btn} ${s.btnSolid}`} href="/operations-review" tabIndex={showBar ? 0 : -1} data-analytics-cta="mobile_bar_operations_review">
          Book an operations review <Arrow />
        </Link>
      </div>
    </>
  );
}

/**
 * Reveals `[data-reveal]` elements once as they scroll in. Content is visible
 * by default; it is only hidden after this runs, so no-JS visitors and
 * crawlers always see everything.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const vh = window.innerHeight;
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
      .filter((el) => el.getBoundingClientRect().top > vh * 0.92); // leave above-the-fold content alone
    items.forEach((el) => el.setAttribute('data-reveal', 'pending'));
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { (e.target as HTMLElement).setAttribute('data-reveal', 'shown'); io.unobserve(e.target); }
    }), { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}

/** Counts up to `value` the first time it scrolls into view. */
export function CountUp({ value, prefix = '', decimals = 0 }: { value: number; prefix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    const fmt = (n: number) => `${prefix}${n.toFixed(decimals)}`;
    el.textContent = fmt(0);
    let frame = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 1200);
        el.textContent = fmt(value * (1 - Math.pow(1 - t, 3)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(frame); el.textContent = fmt(value); };
  }, [value, prefix, decimals]);
  return <span ref={ref}>{`${prefix}${value.toFixed(decimals)}`}</span>;
}
