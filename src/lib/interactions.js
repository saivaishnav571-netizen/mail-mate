/* ------------------------------------------------------------------ */
/*  Interaction layer                                                 */
/*                                                                    */
/*  A live "just sorted" feed, the triage ticker, count-ups, a scene  */
/*  tilt, the quick-jump palette, the section rail, the before/after  */
/*  comparison and the optional pipeline walkthrough. Everything is   */
/*  progressive: without JS the page keeps its static content, and    */
/*  every moving part stops for prefers-reduced-motion.               */
/* ------------------------------------------------------------------ */

import { triageEmail } from "./triage.js";
import { prefersReducedMotion } from "./motion.js";
import { MODEL_INFO } from "./ai.js";

const DEMO_NOW = new Date("2026-11-15T09:00:00Z");
const CATEGORY_COLORS = {
  important: "#b8401a",
  academic: "#226a62",
  internship: "#9b6a12",
  personal: "#536d3f",
  spam: "#767168"
};

export function initInteractions() {
  const messages = readDemoMessages();

  if (messages.length) {
    initHeroFeed(messages);
    initTicker(messages);
  }

  initCountUps();
  initSceneTilt();
  initPalette();
  initSearchShortcut();
  initSectionRail();
  initCompare();
  initPipelinePlay();
}

/* ---------- demo data ---------- */

function readDemoMessages() {
  const node = document.getElementById("embedded-test-inbox");
  if (!node) return [];

  try {
    const rows = JSON.parse(node.textContent);
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        const triaged = triageEmail(row, DEMO_NOW);
        return {
          subject: triaged.subject,
          category: triaged.analysis.category,
          label: triaged.analysis.categoryLabel,
          confidence: triaged.analysis.confidence
        };
      })
      .filter((item) => item.subject && item.category);
  } catch {
    return [];
  }
}

/* ---------- hero: just-sorted feed ---------- */

function initHeroFeed(messages) {
  const feed = document.querySelector("[data-scene-feed]");
  if (!feed) return;

  const line = feed.querySelector(".scene-feed-line");
  const subject = feed.querySelector("[data-feed-subject]");
  const bucket = feed.querySelector("[data-feed-bucket]");
  const confidence = feed.querySelector("[data-feed-confidence]");
  const dot = feed.querySelector("[data-feed-cat]");
  if (!line || !subject || !bucket || !confidence || !dot) return;

  // One message per bucket first, so the feed never shows the same label twice.
  const seen = new Set();
  const rotation = [];
  for (const item of messages) {
    if (seen.has(item.category)) continue;
    seen.add(item.category);
    rotation.push(item);
  }
  for (const item of messages) {
    if (rotation.length >= 8) break;
    if (!rotation.includes(item)) rotation.push(item);
  }

  const paint = (item) => {
    subject.textContent = item.subject;
    bucket.textContent = item.label;
    confidence.textContent = `${item.confidence}%`;
    dot.style.backgroundColor = CATEGORY_COLORS[item.category] || "var(--accent)";
  };

  let index = 0;
  paint(rotation[0]);

  if (prefersReducedMotion() || rotation.length < 2) return;

  let swapTimer = null;
  const timer = window.setInterval(() => {
    if (document.hidden) return;
    index = (index + 1) % rotation.length;

    feed.classList.add("is-swapping");
    window.clearTimeout(swapTimer);
    swapTimer = window.setTimeout(() => {
      paint(rotation[index]);
      feed.classList.remove("is-swapping");
    }, 190);
  }, 4200);

  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
}

/* ---------- live triage ticker ---------- */

function initTicker(messages) {
  const track = document.querySelector("[data-ticker-track]");
  const band = document.querySelector(".ticker-band");
  if (!track || !band) return;

  const makeCopy = (hidden) => {
    const copy = document.createElement("div");
    copy.className = "ticker-copy";
    if (hidden) copy.setAttribute("aria-hidden", "true");

    for (const item of messages) {
      const chip = document.createElement("span");
      chip.className = "ticker-item";

      const dot = document.createElement("i");
      dot.style.backgroundColor = CATEGORY_COLORS[item.category] || "var(--accent)";

      const label = document.createElement("b");
      label.textContent = item.label;

      const subject = document.createElement("span");
      subject.textContent = item.subject;

      const confidence = document.createElement("em");
      confidence.textContent = `${item.confidence}%`;

      chip.append(dot, label, subject, confidence);
      copy.append(chip);
    }

    return copy;
  };

  track.replaceChildren(makeCopy(false), makeCopy(true));
  band.classList.add("is-ready");

  // A short inbox makes a stop-start loop; hold the first copy still instead.
  if (messages.length < 8) track.style.animation = "none";
}

/* ---------- count-ups ---------- */

function initCountUps() {
  const nodes = Array.from(document.querySelectorAll("[data-count]"));
  if (!nodes.length) return;

  // The honest-numbers band always reports the model that actually shipped,
  // even if the bundled training set changes.
  const live = {
    accuracy: Math.round(MODEL_INFO.metrics.accuracy * 100),
    samples: MODEL_INFO.samples,
    vocab: MODEL_INFO.vocabSize
  };

  nodes.forEach((node) => {
    const value = live[node.dataset.metric];
    if (value !== undefined) node.dataset.count = String(value);
  });

  const targets = nodes.map((node) => ({
    node,
    value: Number(node.dataset.count) || 0,
    done: false
  }));

  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    targets.forEach(({ node, value }) => {
      node.textContent = String(value);
    });
    return;
  }

  const run = ({ node, value }) => {
    const duration = 900;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = String(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(step);
    };

    node.textContent = "0";
    requestAnimationFrame(step);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = targets.find((item) => item.node === entry.target);
        if (!target || target.done) return;
        target.done = true;
        if (target.value > 0) run(target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.4 }
  );

  targets.forEach((target) => observer.observe(target.node));
}

/* ---------- scene tilt ---------- */

function initSceneTilt() {
  const visual = document.querySelector(".hero-visual");
  const frame = document.querySelector(".scene-frame");
  if (!visual || !frame) return;
  if (prefersReducedMotion()) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  let queued = false;
  let point = null;

  const apply = () => {
    queued = false;
    if (!point) return;
    const rect = visual.getBoundingClientRect();
    const x = (point.clientX - rect.left) / rect.width - 0.5;
    const y = (point.clientY - rect.top) / rect.height - 0.5;

    frame.style.transition = "none";
    frame.style.transform = `perspective(1400px) rotateX(${(-y * 1.5).toFixed(2)}deg) rotateY(${(x * 2).toFixed(2)}deg) translateY(${(-y * 3).toFixed(2)}px)`;
  };

  visual.addEventListener(
    "pointermove",
    (event) => {
      point = event;
      if (queued) return;
      queued = true;
      requestAnimationFrame(apply);
    },
    { passive: true }
  );

  visual.addEventListener("pointerleave", () => {
    point = null;
    frame.style.transition = "transform 480ms var(--ease)";
    frame.style.transform = "";
  });
}

/* ---------- quick-jump palette ---------- */

function initPalette() {
  const dialog = document.getElementById("palette-dialog");
  const input = document.querySelector("[data-palette-input]");
  const list = document.querySelector("[data-palette-list]");
  const empty = document.querySelector("[data-palette-empty]");
  if (!dialog || !input || !list) return;

  const go = (hash) => {
    const target = document.querySelector(hash);
    if (!target) return;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  const click = (selector) => {
    const node = document.querySelector(selector);
    if (node instanceof HTMLElement) node.click();
  };

  const downloadTestInbox = () => {
    const link = document.querySelector('a[href="test-inbox.json"][download]');
    if (link instanceof HTMLElement) link.click();
  };

  const commands = [
    { group: "Jump to", label: "Live inbox demo", meta: "26 messages · on-device", icon: "↓", key: "#demo", run: () => go("#demo") },
    { group: "Jump to", label: "The difference", meta: "Before / after comparison", icon: "⇄", key: "#difference", run: () => go("#difference") },
    { group: "Jump to", label: "How it works", meta: "Five pipeline stages", icon: "≡", key: "#how", run: () => go("#how") },
    { group: "Jump to", label: "AI model", meta: "Classifier, metrics, playground", icon: "✦", key: "#ai", run: () => go("#ai") },
    { group: "Jump to", label: "Approval gate", meta: "Nothing sends by itself", icon: "✓", key: "#approval", run: () => go("#approval") },
    { group: "Jump to", label: "Your data", meta: "JSON / CSV import", icon: "↥", key: "#data", run: () => go("#data") },
    { group: "Jump to", label: "FAQ", meta: "Fair questions", icon: "?", key: "#faq", run: () => go("#faq") },
    { group: "Actions", label: "Open the AI brief", meta: "Ranked focus list for today", icon: "✦", key: "B", run: () => click("[data-brief-toggle]") },
    { group: "Actions", label: "Open the Intelligence Center", meta: "Held-out model metrics", icon: "◈", key: "I", run: () => click("[data-intelligence-toggle]") },
    { group: "Actions", label: "Feedback analytics", meta: "Human review signal", icon: "◎", key: "F", run: () => click("[data-feedback-toggle]") },
    { group: "Actions", label: "Upload a JSON or CSV file", meta: "Parsed locally, stays on device", icon: "↥", key: "U", run: () => click("[data-open-upload]") },
    { group: "Actions", label: "Download the test inbox", meta: "26-message JSON sample", icon: "↓", key: "D", run: downloadTestInbox }
  ];

  let filtered = commands.slice();
  let active = 0;
  let lastFocus = null;

  const render = () => {
    list.replaceChildren();
    if (!filtered.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    filtered.forEach((command, index) => {
      const item = document.createElement("li");
      item.className = "palette-item";
      item.id = `palette-item-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === active));
      item.classList.toggle("is-active", index === active);

      const icon = document.createElement("span");
      icon.className = "palette-item-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = command.icon;

      const body = document.createElement("span");
      body.className = "palette-item-body";
      const label = document.createElement("span");
      label.className = "palette-item-label";
      label.textContent = command.label;
      const meta = document.createElement("span");
      meta.className = "palette-item-meta";
      meta.textContent = `${command.group} · ${command.meta}`;
      body.append(label, meta);

      const key = document.createElement("span");
      key.className = "palette-item-key";
      key.setAttribute("aria-hidden", "true");
      key.textContent = command.key;

      item.append(icon, body, key);
      item.addEventListener("pointermove", () => setActive(index, false));
      item.addEventListener("click", () => run(index));
      list.append(item);
    });

    input.setAttribute("aria-activedescendant", `palette-item-${active}`);
  };

  const setActive = (index, scroll = true) => {
    active = Math.max(0, Math.min(filtered.length - 1, index));
    Array.from(list.children).forEach((child, childIndex) => {
      const on = childIndex === active;
      child.classList.toggle("is-active", on);
      child.setAttribute("aria-selected", String(on));
    });
    input.setAttribute("aria-activedescendant", `palette-item-${active}`);
    if (scroll) list.children[active]?.scrollIntoView({ block: "nearest" });
  };

  const filter = () => {
    const query = input.value.trim().toLowerCase();
    filtered = !query
      ? commands.slice()
      : commands.filter((command) =>
          `${command.label} ${command.meta} ${command.group}`.toLowerCase().includes(query)
        );
    active = 0;
    render();
  };

  const run = (index) => {
    const command = filtered[index];
    if (!command) return;
    dialog.close();
    // Let the dialog leave first, then act, so scrolling is not interrupted.
    window.setTimeout(() => command.run(), 30);
  };

  const open = () => {
    if (dialog.open) return;
    lastFocus = document.activeElement;
    input.value = "";
    filtered = commands.slice();
    active = 0;
    render();
    dialog.showModal();
    input.focus();
  };

  document.querySelectorAll("[data-palette-open]").forEach((button) => {
    button.addEventListener("click", open);
  });

  input.addEventListener("input", filter);

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(active - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(filtered.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(active);
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", () => {
    if (lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      dialog.open ? dialog.close() : open();
    }
  });
}

/* ---------- inbox search shortcut ---------- */

function initSearchShortcut() {
  const search = document.querySelector("[data-search]");
  const demo = document.getElementById("demo");
  if (!search || !demo) return;

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^(input|textarea|select)$/i.test(event.target?.tagName || "")) return;
    if (event.target?.isContentEditable) return;

    const rect = demo.getBoundingClientRect();
    const inView = rect.top < window.innerHeight * 0.72 && rect.bottom > 80;
    if (!inView) return;

    event.preventDefault();
    search.focus({ preventScroll: false });
    search.select?.();
  });
}

/* ---------- section rail ---------- */

function initSectionRail() {
  const rail = document.querySelector("[data-section-rail]");
  if (!rail) return;

  const links = Array.from(rail.querySelectorAll("a[data-rail]"));
  const sections = links
    .map((link) => document.getElementById(link.dataset.rail))
    .filter(Boolean);
  if (!sections.length) return;

  const setActive = (id) => {
    links.forEach((link) => {
      const on = link.dataset.rail === id;
      link.classList.toggle("is-active", on);
      if (on) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  if (!("IntersectionObserver" in window)) {
    setActive("top");
    return;
  }

  const visible = new Map();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0));
      let best = null;
      let bestRatio = -1;
      visible.forEach((ratio, id) => {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = id;
        }
      });
      if (best) setActive(best);
    },
    { rootMargin: "-38% 0px -52% 0px", threshold: [0, 0.1, 0.4, 0.8] }
  );

  sections.forEach((section) => observer.observe(section));
  setActive("top");
}

/* ---------- before / after comparison ---------- */

function initCompare() {
  const frame = document.querySelector("[data-compare-frame]");
  const handle = document.querySelector("[data-compare-handle]");
  const reset = document.querySelector("[data-compare-reset]");
  if (!frame || !handle) return;

  const viewButtons = Array.from(document.querySelectorAll("[data-compare-view]"));

  const setView = (view) => {
    frame.dataset.view = view === "before" ? "before" : "after";
    viewButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.compareView === frame.dataset.view));
    });
  };

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.compareView));
  });

  let value = 50;
  let dragging = false;

  const describe = (percent) => {
    if (percent < 38) return "Mostly triaged";
    if (percent > 62) return "Mostly untouched";
    return "Half before, half after";
  };

  const apply = (percent, announce = true) => {
    value = Math.max(18, Math.min(82, percent));
    frame.style.setProperty("--split", `${value.toFixed(1)}%`);
    if (announce) {
      handle.setAttribute("aria-valuenow", String(Math.round(value)));
      handle.setAttribute("aria-valuetext", describe(value));
    }
  };

  const fromEvent = (event) => {
    const rect = frame.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * 100;
  };

  const start = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    frame.classList.add("is-dragging");
    frame.setPointerCapture?.(event.pointerId);
    apply(fromEvent(event));
  };

  frame.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".compare-handle")) {
      dragging = true;
      frame.classList.add("is-dragging");
      frame.setPointerCapture?.(event.pointerId);
      return;
    }
    start(event);
  });

  frame.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    apply(fromEvent(event));
  });

  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    frame.classList.remove("is-dragging");
    frame.releasePointerCapture?.(event.pointerId);
  };

  frame.addEventListener("pointerup", end);
  frame.addEventListener("pointercancel", end);
  frame.addEventListener("lostpointercapture", () => {
    dragging = false;
    frame.classList.remove("is-dragging");
  });

  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 8 : 3;
    let next = null;
    if (event.key === "ArrowLeft") next = value + step;
    if (event.key === "ArrowRight") next = value - step;
    if (event.key === "Home") next = 82;
    if (event.key === "End") next = 18;
    if (next === null) return;
    event.preventDefault();
    apply(next);
  });

  handle.addEventListener("dblclick", () => apply(50));
  reset?.addEventListener("click", () => {
    apply(50);
    handle.focus({ preventScroll: true });
  });

  apply(50, false);
  handle.setAttribute("aria-valuenow", "50");
  handle.setAttribute("aria-valuetext", "Half before, half after");
}

/* ---------- pipeline walkthrough ---------- */

function initPipelinePlay() {
  const button = document.querySelector("[data-pipeline-play]");
  const label = document.querySelector("[data-pipeline-play-label]");
  const tabs = Array.from(document.querySelectorAll("[data-stage]"));
  if (!button || !tabs.length || prefersReducedMotion()) {
    if (button) button.hidden = true;
    return;
  }

  let timer = null;
  let autoClick = false;

  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
    button.setAttribute("aria-pressed", "false");
    if (label) label.textContent = "Play the pipeline";
    const glyph = button.querySelector(".play-glyph");
    if (glyph) glyph.textContent = "▶";
  };

  const step = () => {
    const current = tabs.findIndex((tab) => tab.classList.contains("is-active"));
    const next = (current + 1) % tabs.length;
    autoClick = true;
    tabs[next].click();
    autoClick = false;

    if (next === tabs.length - 1) {
      window.clearInterval(timer);
      timer = null;
      window.setTimeout(stop, 2300);
    }
  };

  button.addEventListener("click", () => {
    if (timer) {
      stop();
      return;
    }
    button.setAttribute("aria-pressed", "true");
    if (label) label.textContent = "Pause the walkthrough";
    const glyph = button.querySelector(".play-glyph");
    if (glyph) glyph.textContent = "❚❚";
    step();
    timer = window.setInterval(step, 2300);
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!autoClick && timer) stop();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && timer) stop();
  });
}
