/*
 * CollageFX — small, dependency-free (beyond GSAP) helpers for the
 * "tactile collage" animation suite: scatter-in, humanized typewriter,
 * and a paper tear/uncrumple reveal.
 *
 * Scoped under window.CollageFX. Every function is idempotent-safe to
 * call repeatedly (each call builds + returns a fresh GSAP timeline you
 * can .kill() yourself for cleanup).
 *
 * Usage (see Portfolio.dc.html for a real integration):
 *   CollageFX.scatterIn(containerEl, '.coll-scatter', { distance: 500 });
 *   CollageFX.humanizedTypewriter(el, { text: 'Hello there' });
 *   CollageFX.tearReveal(el, { duration: 0.9 });
 */
(function () {
  function ready() { return !!window.gsap; }

  function registerPlugins() {
    if (!window.gsap) return;
    if (window.TextPlugin) gsap.registerPlugin(window.TextPlugin);
    if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  }

  // ── 1. Collage "scatter-in" ──────────────────────────────────────
  // Assets fly in from random off-screen coordinates into their real,
  // already-laid-out position. Ends with a tiny stop-motion "settle"
  // wobble so it reads as physical, not digitally smooth.
  function scatterIn(container, selector, opts) {
    opts = opts || {};
    if (!ready()) return null;
    const scope = container || document;
    const els = scope.querySelectorAll(selector);
    if (!els.length) return null;

    const stagger = opts.stagger ?? 0.16;
    const rotateJitter = opts.rotateRange ?? 15;
    // stop-motion feel: a handful of discrete, un-eased jumps (~6fps)
    // along a jittery path, instead of one continuous smooth tween
    const steps = opts.steps ?? 5;
    // px/sec travel rate — held constant per element, so a piece that
    // has to travel further (e.g. from the far corner of the screen)
    // simply takes proportionally longer, rather than arriving at the
    // same time as a piece that started right next to its resting spot
    const speed = opts.speed ?? 2600;
    const minStepDuration = opts.stepDuration ?? 0.3;

    // scattered origins pulled from all around the viewport (corners +
    // edge midpoints, just off-screen) so pieces fly in from genuinely
    // different parts of the screen instead of radiating a fixed
    // distance from their own resting spot
    const W = window.innerWidth, H = window.innerHeight;
    const originPool = [
      { x: -0.18 * W, y: -0.2 * H }, { x: 1.18 * W, y: -0.2 * H },
      { x: -0.18 * W, y: 1.2 * H }, { x: 1.18 * W, y: 1.2 * H },
      { x: 0.5 * W, y: -0.28 * H }, { x: 0.5 * W, y: 1.28 * H },
      { x: -0.26 * W, y: 0.5 * H }, { x: 1.26 * W, y: 0.5 * H },
    ];
    const shuffled = originPool.slice().sort(() => Math.random() - 0.5);

    const tl = gsap.timeline();
    els.forEach((el, i) => {
      // read whatever rotation is already baked into the element's
      // inline transform so we land exactly where the layout expects
      const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || '');
      const finalRotation = m ? parseFloat(m[1]) : 0;
      const rect = el.getBoundingClientRect();
      const restX = rect.left + rect.width / 2, restY = rect.top + rect.height / 2;
      el.style.transform = (el.style.transform || '').replace(/rotate\([^)]+\)/, '').trim();
      el.style.willChange = 'transform, opacity';

      const origin = shuffled[i % shuffled.length];
      const jitterX = (Math.random() - 0.5) * 0.08 * W;
      const jitterY = (Math.random() - 0.5) * 0.08 * H;
      const fromX = origin.x + jitterX - restX;
      const fromY = origin.y + jitterY - restY;
      const distance = Math.hypot(fromX, fromY);
      const fromRot = finalRotation + (Math.random() > 0.5 ? 1 : -1) * (rotateJitter + Math.random() * rotateJitter);

      gsap.set(el, { x: fromX, y: fromY, rotation: fromRot, opacity: 0 });

      // same px/sec rate for every piece — only the travel time changes
      const stepDuration = Math.max(minStepDuration, distance / speed / steps);

      const at = i * stagger;
      // build a jagged path from the off-screen origin to the final
      // resting spot: each frame SNAPS into place and holds (no
      // interpolation within a step) so motion reads as discrete
      // stop-motion frames rather than a smooth glide
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const settle = t * t; // biases later steps closer to home
        const wobble = (1 - t) * (Math.random() * 2 - 1);
        tl.set(el, {
          x: fromX * (1 - settle) + distance * 0.06 * wobble,
          y: fromY * (1 - settle) + distance * 0.06 * wobble,
          rotation: finalRotation + (fromRot - finalRotation) * (1 - settle) + wobble * rotateJitter * 0.4,
          opacity: s === 1 ? 1 : undefined,
        }, at + (s - 1) * stepDuration);
      }
      // snap exactly to rest, then a couple of coarse settle jitters
      tl.set(el, { x: 0, y: 0, rotation: finalRotation }, at + steps * stepDuration);
      tl.to(el, {
        rotation: finalRotation + gsap.utils.random(-0.8, 0.8),
        duration: 0.07,
        repeat: 3,
        yoyo: true,
        ease: 'none',
        onComplete: () => { el.style.willChange = 'auto'; gsap.set(el, { rotation: finalRotation }); },
      }, at + steps * stepDuration);
    });
    return tl;
  }

  // ── 2. Humanized typewriter ──────────────────────────────────────
  // Per-character reveal with randomized timing (not a flat rate) and
  // a longer pause after punctuation, plus a blinking cursor. Uses
  // GSAP's TextPlugin-style incremental text assignment under the hood.
  function humanizedTypewriter(el, opts) {
    opts = opts || {};
    if (!ready() || !el) return null;
    const text = opts.text != null ? opts.text : el.textContent;
    const baseSpeed = opts.speed ?? 0.042;   // seconds/char baseline
    const variance = opts.variance ?? 0.03;   // +/- jitter per char
    const punctuationPause = opts.punctuationPause ?? 0.16;

    el.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'coll-cursor';
    cursor.textContent = '|';
    cursor.style.marginLeft = '2px';
    cursor.style.display = 'inline-block';
    cursor.style.animation = 'collCursorBlink 0.9s step-end infinite';

    const tl = gsap.timeline();
    for (let i = 1; i <= text.length; i++) {
      const ch = text[i - 1];
      const extra = /[,.;:!?]/.test(ch) ? punctuationPause : 0;
      const dur = Math.max(0.012, baseSpeed + (Math.random() * 2 - 1) * variance) + extra;
      tl.to({}, {
        duration: dur,
        onComplete: () => {
          el.textContent = text.slice(0, i);
          el.appendChild(cursor);
        },
      });
    }
    if (opts.removeCursorOnEnd) {
      tl.call(() => cursor.remove());
    }
    return tl;
  }

  // ── 3. Paper tear / uncrumple reveal ─────────────────────────────
  // Splits the element's edge into a jagged "torn paper" clip-path,
  // jitters it briefly (simulated physical tension), then settles
  // into a clean rectangle.
  function tearReveal(el, opts) {
    opts = opts || {};
    if (!ready() || !el) return null;
    const duration = opts.duration ?? 0.9;
    const jitterSteps = opts.jitterSteps ?? 6;

    const torn = 'polygon(0 0,52% 4%,54% 0,100% 0,100% 46%,96% 50%,100% 54%,100% 100%,48% 96%,46% 100%,0 100%,0 54%,4% 50%,0 46%)';
    const whole = 'polygon(0 0,52% 0,54% 0,100% 0,100% 46%,100% 50%,100% 54%,100% 100%,48% 100%,46% 100%,0 100%,0 54%,4% 50%,0 46%)';

    el.style.willChange = 'clip-path, transform';
    gsap.set(el, { clipPath: torn, opacity: 0 });

    const tl = gsap.timeline();
    tl.to(el, { opacity: 1, duration: 0.12, ease: 'none' });
    for (let i = 0; i < jitterSteps; i++) {
      tl.to(el, {
        x: gsap.utils.random(-3, 3),
        y: gsap.utils.random(-2, 2),
        duration: duration / jitterSteps,
        ease: 'none',
      });
    }
    tl.to(el, {
      clipPath: whole, x: 0, y: 0,
      duration: 0.35, ease: 'power2.out',
      onComplete: () => { el.style.willChange = 'auto'; },
    }, '<');
    return tl;
  }

  registerPlugins();
  window.CollageFX = { scatterIn, humanizedTypewriter, tearReveal, registerPlugins };
})();
