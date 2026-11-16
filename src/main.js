import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

import { createHeroScene } from "./hero/three-scene.js";
import { initInboxDemo } from "./ui/inbox-demo.js";
import { MODEL_INFO, classifyText } from "./lib/ai.js";

/* ------------------------------------------------------------------ */
/*  Header and mobile navigation                                      */
/* ------------------------------------------------------------------ */

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const siteNav = document.getElementById("site-nav");
const navLabel = navToggle?.querySelector(".nav-toggle-label");
const desktopNav = window.matchMedia("(min-width: 901px)");

function setNav(open) {
  if (!navToggle || !siteNav) return;
  siteNav.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
  if (navLabel) navLabel.textContent = open ? "Close" : "Menu";
}

navToggle?.addEventListener("click", () => {
  setNav(navToggle.getAttribute("aria-expanded") !== "true");
});

siteNav?.addEventListener("click", (event) => {
  if (event.target.closest("a")) setNav(false);
});

document.addEventListener("click", (event) => {
  if (!siteNav?.classList.contains("is-open")) return;
  if (!header?.contains(event.target)) setNav(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setNav(false);
});

desktopNav.addEventListener("change", (event) => {
  if (event.matches) setNav(false);
});

let lastScrollY = window.scrollY;
function onScroll() {
  const y = window.scrollY;
  header?.classList.toggle("is-scrolled", y > 8);
  lastScrollY = y;
}

onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

/* ------------------------------------------------------------------ */
/*  Three.js hero scene                                               */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById("hero-canvas");
const fallback = document.querySelector("[data-scene-fallback]");
const pauseButton = document.querySelector("[data-scene-pause]");
const sceneStatus = document.querySelector(".scene-status span:last-child");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let heroScene = null;
let scenePaused = false;

function showFallback() {
  if (fallback) fallback.hidden = false;
  if (canvas) canvas.style.display = "none";
  if (pauseButton) pauseButton.hidden = true;
  if (sceneStatus) sceneStatus.textContent = "Sorting table · still";
}

if (canvas) {
  try {
    heroScene = createHeroScene(canvas, { onUnavailable: showFallback });
  } catch {
    showFallback();
  }
}

pauseButton?.addEventListener("click", () => {
  if (!heroScene) return;
  scenePaused = !scenePaused;
  heroScene.setPaused(scenePaused);
  pauseButton.setAttribute("aria-pressed", String(scenePaused));
  pauseButton.textContent = scenePaused ? "Play scene" : "Pause scene";
  if (sceneStatus) {
    sceneStatus.textContent = scenePaused ? "Sorting table · paused" : "Sorting table · live";
  }
});

if (reduceMotion.matches) {
  if (pauseButton) pauseButton.hidden = true;
  if (sceneStatus) sceneStatus.textContent = "Sorting table · still";
}

reduceMotion.addEventListener("change", (event) => {
  if (event.matches) {
    if (pauseButton) pauseButton.hidden = true;
    if (sceneStatus) sceneStatus.textContent = "Sorting table · still";
  } else if (pauseButton && fallback?.hidden) {
    pauseButton.hidden = false;
    if (sceneStatus) sceneStatus.textContent = "Sorting table · live";
  }
});

window.addEventListener("pagehide", () => {
  heroScene?.destroy();
});

/* ------------------------------------------------------------------ */
/*  Pipeline tabs                                                     */
/* ------------------------------------------------------------------ */

const stageTabs = Array.from(document.querySelectorAll("[data-stage]"));
const stagePanels = Array.from(document.querySelectorAll("[data-panel]"));

function activateStage(index, { focus = false } = {}) {
  stageTabs.forEach((tab, tabIndex) => {
    const active = tabIndex === index;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
    if (active && tab.parentElement && tab.parentElement.scrollWidth > tab.parentElement.clientWidth) {
      tab.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: reduceMotion.matches ? "auto" : "smooth"
      });
    }
  });

  stagePanels.forEach((panel, panelIndex) => {
    const active = panelIndex === index;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
}

stageTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateStage(index));
  tab.addEventListener("keydown", (event) => {
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % stageTabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + stageTabs.length) % stageTabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = stageTabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    activateStage(next, { focus: true });
  });
});

/* ------------------------------------------------------------------ */
/*  Model card and classifier playground                              */
/* ------------------------------------------------------------------ */

const CLASS_LABELS = {
  important: "Important",
  academic: "Academic",
  internship: "Internship",
  personal: "Personal",
  spam: "Spam"
};

function initModelCard() {
  const metrics = MODEL_INFO.metrics;
  const accuracy = document.querySelector("[data-model-accuracy]");
  const macroF1 = document.querySelector("[data-model-f1]");
  const samples = document.querySelector("[data-model-samples]");
  const vocab = document.querySelector("[data-model-vocab]");

  if (accuracy) accuracy.textContent = `${Math.round(metrics.accuracy * 100)}%`;
  if (macroF1) macroF1.textContent = `${Math.round(metrics.macroF1 * 100)}%`;
  if (samples) samples.textContent = String(MODEL_INFO.samples);
  if (vocab) vocab.textContent = String(MODEL_INFO.vocabSize);

  const classList = document.querySelector("[data-model-classes]");
  if (classList) {
    classList.replaceChildren(
      ...Object.entries(metrics.perClass).map(([id, values]) => {
        const row = document.createElement("div");
        row.className = "model-class";

        const label = document.createElement("span");
        label.className = "model-class-label";
        label.textContent = CLASS_LABELS[id] || id;

        const track = document.createElement("span");
        track.className = "model-class-track";
        const fill = document.createElement("span");
        fill.className = `model-class-fill cat-bg-${id}`;
        fill.style.width = `${Math.max(2, Math.round(values.f1 * 100))}%`;
        track.append(fill);

        const value = document.createElement("span");
        value.className = "model-class-value";
        value.textContent = `${Math.round(values.f1 * 100)}% F1`;

        row.append(label, track, value);
        return row;
      })
    );
  }

  const input = document.querySelector("[data-model-input]");
  const run = document.querySelector("[data-model-run]");
  const bars = document.querySelector("[data-model-playground-bars]");
  const resultLabel = document.querySelector("[data-model-playground-result]");

  function renderPrediction() {
    if (!input || !bars) return;
    const result = classifyText(input.value);
    const top = result.labels[0];

    if (resultLabel) {
      resultLabel.textContent = top
        ? `Predicted: ${top.label} · ${Math.round(top.probability * 100)}% confidence`
        : "Predicted: no known terms";
    }

    bars.replaceChildren(
      ...result.labels.map((item, index) => {
        const row = document.createElement("div");
        row.className = "model-bar";
        row.classList.toggle("is-winner", index === 0);

        const label = document.createElement("span");
        label.className = "model-bar-label";
        label.textContent = item.label;

        const track = document.createElement("span");
        track.className = "model-bar-track";
        const fill = document.createElement("span");
        fill.className = `model-bar-fill cat-bg-${item.id}`;
        fill.style.width = `${Math.max(2, Math.round(item.probability * 100))}%`;
        track.append(fill);

        const value = document.createElement("span");
        value.className = "model-bar-value";
        value.textContent = `${Math.round(item.probability * 100)}%`;

        row.append(label, track, value);
        return row;
      })
    );
  }

  run?.addEventListener("click", renderPrediction);
  input?.addEventListener("input", renderPrediction);
  renderPrediction();
}

initModelCard();

/* ------------------------------------------------------------------ */
/*  Inbox demo                                                        */
/* ------------------------------------------------------------------ */

initInboxDemo(document.querySelector("[data-demo]"));
