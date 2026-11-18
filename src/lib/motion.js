/* ------------------------------------------------------------------ */
/*  Motion layer                                                      */
/*                                                                    */
/*  Shared, dependency-free helpers for the page-level motion system: */
/*  scroll progress, scroll reveals, pointer spotlights and small      */
/*  value/entrance replays. Every helper no-ops when the visitor asks  */
/*  for reduced motion, and CSS states are only enabled after the      */
/*  observers are wired, so a failure can never hide content.          */
/* ------------------------------------------------------------------ */

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion() {
  return window.matchMedia(REDUCE_QUERY).matches;
}

let started = false;

export function initMotion() {
  if (started) return;
  started = true;

  const root = document.documentElement;
  const media = window.matchMedia(REDUCE_QUERY);

  if (media.matches) {
    root.classList.add("motion-reduced");
    return;
  }

  initScrollProgress();
  initReveals();
  initSpotlights();

  // Enabled only after the observers above are attached. If any of this
  // script fails, the page keeps its fully-visible static styles.
  root.classList.add("has-motion");

  media.addEventListener("change", (event) => {
    root.classList.toggle("has-motion", !event.matches);
    root.classList.toggle("motion-reduced", event.matches);
    if (event.matches) {
      document.querySelectorAll("[data-reveal], [data-reveal-stagger]").forEach((node) => {
        node.classList.add("is-revealed");
      });
    }
  });
}

/* ---------- scroll progress ---------- */

function initScrollProgress() {
  const bar = document.querySelector("[data-scroll-progress]");
  if (!bar) return;

  let queued = false;

  const update = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
  };

  const request = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request, { passive: true });
  update();
}

/* ---------- scroll reveals ---------- */

function initReveals() {
  const targets = Array.from(document.querySelectorAll("[data-reveal], [data-reveal-stagger]"));
  if (!targets.length) return;

  targets.forEach((node) => {
    if (!node.hasAttribute("data-reveal-stagger")) return;
    Array.from(node.children).forEach((child, index) => {
      child.style.setProperty("--reveal-i", String(Math.min(index, 8)));
    });
  });

  if (!("IntersectionObserver" in window)) {
    targets.forEach((node) => node.classList.add("is-revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -6% 0px" }
  );

  targets.forEach((node) => {
    const rect = node.getBoundingClientRect();
    // Anything already on screen reveals immediately, without a flash.
    if (rect.top < window.innerHeight * 0.94 && rect.bottom > 0) {
      node.classList.add("is-revealed");
    }
    observer.observe(node);
  });
}

/* ---------- pointer spotlight ---------- */

function initSpotlights() {
  const spots = Array.from(document.querySelectorAll("[data-spotlight]"));
  if (!spots.length) return;

  spots.forEach((node) => {
    let queued = false;
    let last = null;

    node.addEventListener(
      "pointermove",
      (event) => {
        last = event;
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          if (!last) return;
          const rect = node.getBoundingClientRect();
          node.style.setProperty("--spot-x", `${Math.round(last.clientX - rect.left)}px`);
          node.style.setProperty("--spot-y", `${Math.round(last.clientY - rect.top)}px`);
        });
      },
      { passive: true }
    );

    node.addEventListener("pointerleave", () => {
      last = null;
      node.style.removeProperty("--spot-x");
      node.style.removeProperty("--spot-y");
    });
  });
}

/* ---------- per-render helpers ---------- */

/** Replay a one-shot CSS animation class on a node. */
export function replayAnimation(node, className = "is-swapping") {
  if (!node || prefersReducedMotion()) return;
  node.classList.remove(className);
  // Force a style flush so the animation restarts on the same element.
  void node.offsetWidth;
  node.classList.add(className);
}

/** Short, GPU-friendly pulse when a metric changes. */
export function pulseValue(node) {
  if (!node || prefersReducedMotion() || typeof node.animate !== "function") return;
  node.animate(
    [
      { transform: "translateY(3px)", opacity: 0.4 },
      { transform: "translateY(0)", opacity: 1 }
    ],
    { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  );
}
