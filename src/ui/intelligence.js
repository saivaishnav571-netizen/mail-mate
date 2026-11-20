/**
 * AI Intelligence Center.
 *
 * Every number on this dashboard comes from the FastAPI service: scikit-learn
 * metrics on a fixed labelled holdout, aggregate inbox metadata recorded by
 * this page, feedback totals, and real service inference counters. Nothing is
 * estimated locally, and opening the dashboard never retrains a model.
 */

import { CATEGORY_BY_ID } from "../lib/triage.js";
import {
  FeedbackApiError,
  fetchIntelligence,
  evaluateLabeledDataset,
  isBackendConfigured,
  reportEmailAnalytics
} from "../lib/feedback.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const DATE_ONLY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

function formatDate(value, formatter = DATE_TIME) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatter.format(date);
}

function percent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${(number * 100).toFixed(digits)}%`;
}

function number(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function categoryLabel(id) {
  return CATEGORY_BY_ID[id]?.label || id;
}

function categoryColor(id) {
  return CATEGORY_BY_ID[id]?.color || "#767168";
}

function categoryDot(id) {
  const dot = element("i", "intel-dot");
  dot.style.background = categoryColor(id);
  return dot;
}

function kpi(label, value, note, tone = "") {
  const card = element("div", `intel-kpi${tone ? ` ${tone}` : ""}`);
  card.append(
    element("span", "intel-kpi-label", label),
    element("strong", "intel-kpi-value", value),
    element("span", "intel-kpi-note", note)
  );
  return card;
}

function metricCell(label, value) {
  const cell = element("div", "intel-compare-metric");
  cell.append(
    element("span", "intel-compare-metric-label", label),
    element("strong", "intel-compare-metric-value", percent(value))
  );
  return cell;
}

export function initIntelligenceCenter({ getAnalyticsSnapshot } = {}) {
  const dialog = document.getElementById("intelligence-dialog");
  if (!dialog) return;

  const els = {
    close: dialog.querySelector("[data-intelligence-close]"),
    statusWrap: dialog.querySelector(".intel-status"),
    status: dialog.querySelector("[data-intel-status]"),
    refresh: dialog.querySelector("[data-intel-refresh]"),
    warning: dialog.querySelector("[data-intel-warning]"),
    loading: dialog.querySelector("[data-intel-loading]"),
    offline: dialog.querySelector("[data-intel-offline]"),
    error: dialog.querySelector("[data-intel-error]"),
    errorMessage: dialog.querySelector("[data-intel-error-message]"),
    retry: dialog.querySelector("[data-intel-retry]"),
    content: dialog.querySelector("[data-intel-content]"),
    kpis: dialog.querySelector("[data-intel-kpis]"),
    categories: dialog.querySelector("[data-intel-categories]"),
    matrix: dialog.querySelector("[data-intel-matrix]"),
    metricsNote: dialog.querySelector("[data-intel-metrics-note]"),
    comparison: dialog.querySelector("[data-intel-comparison]"),
    comparisonNote: dialog.querySelector("[data-intel-comparison-note]"),
    model: dialog.querySelector("[data-intel-model]"),
    emailKpis: dialog.querySelector("[data-intel-email-kpis]"),
    emailEmpty: dialog.querySelector("[data-intel-email-empty]"),
    emailCharts: dialog.querySelector("[data-intel-email-charts]"),
    emailCategories: dialog.querySelector("[data-intel-email-categories]"),
    priority: dialog.querySelector("[data-intel-priority]"),
    confidence: dialog.querySelector("[data-intel-confidence]"),
    timeline: dialog.querySelector("[data-intel-timeline]"),
    feedbackKpis: dialog.querySelector("[data-intel-feedback-kpis]"),
    feedbackCategories: dialog.querySelector("[data-intel-feedback-categories]"),
    feedbackNote: dialog.querySelector("[data-intel-feedback-note]"),
    inference: dialog.querySelector("[data-intel-inference]"),
    disclosures: dialog.querySelector("[data-intel-disclosures]"),
    evalFile: dialog.querySelector("[data-intel-eval-file]"),
    evalThreshold: dialog.querySelector("[data-intel-eval-threshold]"),
    evalRun: dialog.querySelector("[data-intel-eval-run]"),
    evalStatus: dialog.querySelector("[data-intel-eval-status]"),
    evalResults: dialog.querySelector("[data-intel-eval-results]"),
    evalKpis: dialog.querySelector("[data-intel-eval-kpis]"),
    evalCategories: dialog.querySelector("[data-intel-eval-categories]"),
    evalMatrix: dialog.querySelector("[data-intel-eval-matrix]"),
    evalReviewNote: dialog.querySelector("[data-intel-eval-review-note]"),
    evalReview: dialog.querySelector("[data-intel-eval-review]")
  };

  const toggles = Array.from(document.querySelectorAll("[data-intelligence-toggle]"));
  let loading = false;
  let ingestedSignature = null;
  const backendAvailable = () => isBackendConfigured();

  toggles.forEach((toggle) => toggle.addEventListener("click", openCenter));
  els.close?.addEventListener("click", () => dialog.close());
  els.refresh?.addEventListener("click", () => loadCenter());
  els.retry?.addEventListener("click", () => loadCenter());
  els.evalFile?.addEventListener("change", () => {
    els.evalRun.disabled = !els.evalFile.files?.length;
    els.evalStatus.textContent = els.evalFile.files?.length
      ? "CSV selected. It will be evaluated by the active model only; no training or storage."
      : "";
    els.evalResults.hidden = true;
  });
  els.evalRun?.addEventListener("click", runExternalEvaluation);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });


  async function runExternalEvaluation() {
    const file = els.evalFile?.files?.[0];
    if (!file) return;
    els.evalRun.disabled = true;
    els.evalStatus.textContent = "Reading and evaluating labeled rows…";
    els.evalResults.hidden = true;
    try {
      if (file.size > 2_000_000) throw new Error("CSV must be 2 MB or smaller.");
      const rows = parseLabeledCsv(await file.text());
      if (rows.length < 5) throw new Error("Please include at least 5 labeled emails.");
      if (rows.length > 2000) throw new Error("Maximum supported dataset size is 2,000 rows.");
      const result = await evaluateLabeledDataset({
        dataset: file.name,
        confidence_threshold: Number(els.evalThreshold?.value || 0.65),
        samples: rows
      });
      renderExternalEvaluation(result);
      els.evalResults.hidden = false;
      els.evalStatus.textContent = "Evaluation complete · " + result.test_size + " labeled rows · not stored or used for training.";
    } catch (error) {
      els.evalStatus.textContent = error?.message || "Could not evaluate the uploaded CSV.";
    } finally {
      els.evalRun.disabled = !els.evalFile.files?.length;
    }
  }

  function renderExternalEvaluation(result) {
    els.evalKpis.replaceChildren(
      kpi("Accuracy", percent(result.accuracy), result.correct + "/" + result.test_size + " correct"),
      kpi("Macro precision", percent(result.precision_macro), "across categories"),
      kpi("Macro recall", percent(result.recall_macro), "across categories"),
      kpi("Macro F1", percent(result.macro_f1), "balanced headline score", "is-accent"),
      kpi("Coverage", percent(result.coverage), result.accepted_count + " accepted · " + result.review_count + " review"),
      kpi("Accepted accuracy", result.accepted_accuracy === null ? "—" : percent(result.accepted_accuracy), "threshold " + percent(result.confidence_threshold))
    );

    const table = element("table", "intel-table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Category", "Precision", "Recall", "F1", "Support"].forEach((label) => headRow.append(element("th", "", label)));
    head.append(headRow);
    const body = document.createElement("tbody");
    result.per_category.forEach((row) => {
      const tr = document.createElement("tr");
      const category = element("th", "intel-table-category");
      category.scope = "row";
      category.append(categoryDot(row.category), document.createTextNode(categoryLabel(row.category)));
      tr.append(category, element("td", "", percent(row.precision)), element("td", "", percent(row.recall)), element("td", "intel-f1", percent(row.f1)), element("td", "intel-support", number(row.support)));
      body.append(tr);
    });
    table.append(head, body);
    els.evalCategories.replaceChildren(table);
    renderExternalConfusionMatrix(els.evalMatrix, result.confusion_matrix);

    els.evalReviewNote.textContent = result.review_count + " of " + result.test_size + " examples fell below " + percent(result.confidence_threshold) + " confidence and should be reviewed. " + result.confidence_note;
    if (!result.review_items.length) {
      els.evalReview.replaceChildren(element("p", "intel-empty", "No rows fell below the selected confidence threshold."));
      return;
    }
    const reviewTable = element("table", "intel-table");
    const reviewHead = document.createElement("thead");
    const reviewHeadRow = document.createElement("tr");
    ["ID / subject", "Actual", "Predicted", "Confidence", "Result"].forEach((label) => reviewHeadRow.append(element("th", "", label)));
    reviewHead.append(reviewHeadRow);
    const reviewBody = document.createElement("tbody");
    result.review_items.forEach((row) => {
      const tr = document.createElement("tr");
      tr.append(
        element("td", "", row.subject || row.sample_id || "Unidentified sample"),
        element("td", "", categoryLabel(row.actual_category)),
        element("td", "", categoryLabel(row.predicted_category)),
        element("td", "", percent(row.confidence)),
        element("td", row.correct ? "intel-review-correct" : "intel-review-error", row.correct ? "Correct" : "Incorrect")
      );
      reviewBody.append(tr);
    });
    reviewTable.append(reviewHead, reviewBody);
    els.evalReview.replaceChildren(reviewTable);
  }

  function renderExternalConfusionMatrix(container, confusion) {
    const labels = confusion.labels;
    const matrix = confusion.matrix;
    const table = element("table", "intel-table intel-matrix");
    const head = document.createElement("thead");
    const row = document.createElement("tr");
    row.append(element("th", "intel-matrix-corner", "Actual ↓"));
    labels.forEach((label) => row.append(element("th", "", categoryLabel(label))));
    head.append(row);
    const body = document.createElement("tbody");
    labels.forEach((actual, index) => {
      const tr = document.createElement("tr");
      const th = element("th", "intel-matrix-row");
      th.scope = "row";
      th.append(categoryDot(actual), document.createTextNode(categoryLabel(actual)));
      tr.append(th);
      const actualRow = matrix[index] || [];
      const total = actualRow.reduce((sum, value) => sum + Number(value || 0), 0);
      labels.forEach((label, column) => {
        const value = Number(actualRow[column] || 0);
        const cell = element("td", "intel-matrix-cell", number(value));
        cell.style.setProperty("--cell-strength", total ? (value / total).toFixed(3) : "0");
        if (index === column) cell.classList.add("is-diagonal");
        tr.append(cell);
      });
      body.append(tr);
    });
    table.append(head, body);
    container.replaceChildren(table);
  }

  function parseLabeledCsv(source) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const text = String(source || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(field); field = "";
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
    if (quoted) throw new Error("CSV contains an unclosed quoted field.");
    if (rows.length < 2) throw new Error("CSV needs a header row and labeled examples.");
    const headers = rows.shift().map((header) => header.trim().toLowerCase());
    const categoryIndex = headers.indexOf("category");
    const textIndex = headers.indexOf("text");
    const subjectIndex = headers.indexOf("subject");
    const idIndex = headers.indexOf("id");
    if (categoryIndex < 0 || textIndex < 0) throw new Error("CSV must include category and text columns.");
    const allowed = new Set(["important", "academic", "internship", "personal", "spam"]);
    return rows.map((values, index) => {
      const category = String(values[categoryIndex] || "").trim().toLowerCase();
      const text = String(values[textIndex] || "").trim();
      if (!allowed.has(category)) throw new Error("Row " + (index + 2) + ": invalid category " + category + ".");
      if (!text) throw new Error("Row " + (index + 2) + ": text is empty.");
      return {
        sample_id: idIndex >= 0 ? String(values[idIndex] || "").trim() || null : null,
        subject: subjectIndex >= 0 ? String(values[subjectIndex] || "").trim() || null : null,
        text,
        category
      };
    });
  }

  async function openCenter() {
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!backendAvailable()) {
      showOffline();
      return;
    }
    await loadCenter();
  }

  async function loadCenter() {
    // Static hosting has no API. Show the notice without firing requests that
    // could only fail, and never render placeholder metrics.
    if (!backendAvailable()) {
      showOffline();
      return;
    }
    if (loading) return;
    loading = true;
    dialog.setAttribute("aria-busy", "true");
    if (els.refresh) els.refresh.disabled = true;
    hideWarning();
    showLoading();
    setStatus("Connecting…", "waiting");

    try {
      await ingestInbox();
      const data = await fetchIntelligence();
      render(data);
      setStatus(`Backend connected · ${formatDate(data.generated_at)}`, "connected");
    } catch (error) {
      showError(error);
      setStatus("Backend unavailable", "down");
    } finally {
      loading = false;
      dialog.removeAttribute("aria-busy");
      if (els.refresh) els.refresh.disabled = false;
    }
  }

  async function ingestInbox() {
    if (typeof getAnalyticsSnapshot !== "function") return;
    const snapshot = getAnalyticsSnapshot();
    if (!snapshot?.messages?.length) return;

    const signature = JSON.stringify([snapshot.dataset, snapshot.messages]);
    if (signature === ingestedSignature) return;

    try {
      await reportEmailAnalytics(snapshot);
      ingestedSignature = signature;
    } catch (error) {
      if (!(error instanceof FeedbackApiError)) throw error;
      // A dead service also blocks the metrics request; surface it there.
      if (error.status === 0) throw error;
      showWarning(`Inbox metadata was not stored: ${error.message}`);
    }
  }

  function setStatus(text, state = "") {
    if (els.status) els.status.textContent = text;
    if (els.statusWrap) {
      els.statusWrap.classList.toggle("is-connected", state === "connected");
      els.statusWrap.classList.toggle("is-down", state === "down");
      els.statusWrap.classList.toggle("is-preview", state === "preview");
    }
  }

  function showWarning(text) {
    if (!els.warning) return;
    els.warning.textContent = text;
    els.warning.hidden = false;
  }

  function hideWarning() {
    if (!els.warning) return;
    els.warning.hidden = true;
    els.warning.textContent = "";
  }

  function showLoading() {
    if (els.loading) els.loading.hidden = false;
    if (els.offline) els.offline.hidden = true;
    if (els.error) els.error.hidden = true;
    if (els.content) els.content.hidden = true;
    if (els.refresh) els.refresh.hidden = false;
  }

  function showContent() {
    if (els.loading) els.loading.hidden = true;
    if (els.offline) els.offline.hidden = true;
    if (els.error) els.error.hidden = true;
    if (els.content) els.content.hidden = false;
    if (els.refresh) els.refresh.hidden = false;
  }

  function showError(error) {
    if (els.loading) els.loading.hidden = true;
    if (els.offline) els.offline.hidden = true;
    if (els.content) els.content.hidden = true;
    if (els.error) els.error.hidden = false;
    if (els.errorMessage) {
      let message =
        error instanceof FeedbackApiError
          ? error.message
          : error?.message || "The intelligence service did not return a usable response.";
      if (error instanceof FeedbackApiError && (error.status === 0 || error.status === 502)) {
        message =
          "The intelligence service is offline. Start the FastAPI backend with `npm run api`, then press Try again.";
      } else if (error instanceof FeedbackApiError && error.status === 404) {
        message =
          "The backend responded with HTTP 404, so its API may be out of date. Restart it with `npm run api` and try again.";
      }
      els.errorMessage.textContent = message;
    }
  }

  /**
   * Static hosting (the Vercel preview) has no backend. Show an honest notice
   * instead of a network error, and leave every metric area empty.
   */
  function showOffline() {
    if (els.loading) els.loading.hidden = true;
    if (els.error) els.error.hidden = true;
    if (els.content) els.content.hidden = true;
    if (els.warning) els.warning.hidden = true;
    if (els.offline) els.offline.hidden = false;
    if (els.refresh) {
      els.refresh.disabled = true;
      els.refresh.hidden = true;
    }
    setStatus("Frontend-only preview", "preview");
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                         */
  /* ------------------------------------------------------------------ */

  function render(data) {
    renderKpis(data);
    renderPerformance(data);
    renderComparison(data);
    renderModelInfo(data);
    renderEmailAnalytics(data);
    renderFeedback(data);
    renderInference(data);
    renderDisclosures(data);
    showContent();
  }

  function renderKpis(data) {
    const metrics = data.metrics;
    els.kpis.replaceChildren(
      kpi("Accuracy", percent(metrics.accuracy), `${metrics.correct} of ${metrics.test_size} held-out`),
      kpi("Precision", percent(metrics.precision_macro), "macro average"),
      kpi("Recall", percent(metrics.recall_macro), "macro average"),
      kpi("Macro F1", percent(metrics.macro_f1), "headline score", "is-accent")
    );
    els.metricsNote.textContent =
      `Test set: ${metrics.test_size} labelled examples · ${metrics.dataset} · ` +
      `evaluated ${formatDate(metrics.evaluated_at)}`;
  }

  function renderPerformance(data) {
    const table = element("table", "intel-table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Category", "Precision", "Recall", "F1", "Support"].forEach((label) => {
      headRow.append(element("th", "", label));
    });
    head.append(headRow);

    const body = document.createElement("tbody");
    data.metrics.per_category.forEach((row) => {
      const tr = document.createElement("tr");
      const category = element("th", "intel-table-category");
      category.scope = "row";
      category.append(categoryDot(row.category), document.createTextNode(categoryLabel(row.category)));

      tr.append(
        category,
        element("td", "", percent(row.precision)),
        element("td", "", percent(row.recall)),
        element("td", "intel-f1", percent(row.f1)),
        element("td", "intel-support", number(row.support))
      );
      body.append(tr);
    });

    table.append(head, body);
    els.categories.replaceChildren(table);

    renderConfusionMatrix(data);
  }

  function renderConfusionMatrix(data) {
    const { labels, matrix } = data.metrics.confusion_matrix;
    const table = element("table", "intel-table intel-matrix");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.append(element("th", "intel-matrix-corner", "Actual ↓"));
    labels.forEach((label) => {
      const th = element("th", "", categoryLabel(label));
      th.scope = "col";
      headRow.append(th);
    });
    head.append(headRow);

    const body = document.createElement("tbody");
    labels.forEach((actual, rowIndex) => {
      const tr = document.createElement("tr");
      const rowLabel = element("th", "intel-matrix-row");
      rowLabel.scope = "row";
      rowLabel.append(categoryDot(actual), document.createTextNode(categoryLabel(actual)));

      const row = matrix[rowIndex] || [];
      const rowTotal = row.reduce((sum, value) => sum + Number(value || 0), 0);

      tr.append(rowLabel);
      labels.forEach((predicted, columnIndex) => {
        const value = Number(row[columnIndex] || 0);
        const share = rowTotal ? value / rowTotal : 0;
        const cell = element("td", "intel-matrix-cell", number(value));
        cell.style.setProperty("--cell-strength", share.toFixed(3));
        if (rowIndex === columnIndex) cell.classList.add("is-diagonal");
        cell.title = `Actual ${categoryLabel(actual)} · predicted ${categoryLabel(predicted)}: ${value}`;
        tr.append(cell);
      });
      body.append(tr);
    });

    table.append(head, body);
    els.matrix.replaceChildren(table);
  }

  function renderComparison(data) {
    const models = data.comparison.models || [];
    if (!models.length) {
      els.comparison.replaceChildren(element("p", "intel-empty", "No comparison results available."));
      els.comparisonNote.textContent = "";
      return;
    }

    const best = Math.max(...models.map((model) => Number(model.macro_f1) || 0));
    const leaders = models.filter((model) => Math.abs((Number(model.macro_f1) || 0) - best) < 1e-9);
    const leaderIds = new Set(leaders.map((model) => model.id));

    els.comparison.replaceChildren(
      ...models.map((model) => {
        const row = element("div", `intel-compare-row${leaderIds.has(model.id) ? " is-best" : ""}`);

        const name = element("div", "intel-compare-name");
        name.append(element("strong", "", model.name), element("span", "", model.detail));
        if (leaderIds.has(model.id)) name.append(element("span", "intel-best", "Best macro F1"));

        const metrics = element("div", "intel-compare-metrics");
        metrics.append(
          metricCell("Accuracy", model.accuracy),
          metricCell("Precision", model.precision_macro),
          metricCell("Recall", model.recall_macro),
          metricCell("Macro F1", model.macro_f1)
        );

        const track = element("div", "intel-compare-track");
        const fill = element("span", `intel-compare-fill${leaderIds.has(model.id) ? " is-best" : ""}`);
        fill.style.width = `${Math.max(1, (Number(model.macro_f1) || 0) * 100)}%`;
        track.append(fill);

        row.append(name, metrics, track);
        return row;
      })
    );

    const leaderNames = leaders.map((model) => model.name).join(", ");
    const lead =
      leaders.length > 1
        ? `Tied on macro F1 at ${percent(best)}: ${leaderNames}.`
        : `Best macro F1: ${leaderNames} at ${percent(best)}.`;
    els.comparisonNote.textContent = `${lead} ${data.comparison.note}`;
  }

  function renderModelInfo(data) {
    const tfidf = data.model.tfidf || {};
    const ngrams = Array.isArray(tfidf.ngram_range) ? tfidf.ngram_range.join("–") : "1–2";
    const tfidfSummary = [
      `${ngrams} word n-grams`,
      tfidf.sublinear_tf ? "sublinear tf" : null,
      tfidf.min_df ? `min_df ${tfidf.min_df}` : null,
      tfidf.max_features ? `max ${tfidf.max_features} features` : "no feature cap",
      tfidf.strip_accents ? `strip accents (${tfidf.strip_accents})` : null
    ]
      .filter(Boolean)
      .join(" · ");

    const rows = [
      ["Model", data.model.name],
      ["Version", `${data.model.version}${data.model.is_active ? " · active" : ""}`],
      ["Algorithm", data.model.algorithm],
      ["TF-IDF", tfidfSummary],
      ["Trained", formatDate(data.model.created_at)],
      ["Training samples", number(data.model.training_samples)],
      ["Test samples", number(data.model.test_samples)],
      ["Feedback samples", number(data.model.feedback_samples)],
      ["Evaluation set", data.metrics.dataset],
      ["Evaluated", formatDate(data.metrics.evaluated_at)]
    ];
    if (data.model.reconstructed) {
      rows.push(["Report", "Reconstructed from the stored artifact"]);
    }

    els.model.replaceChildren(
      ...rows.map(([label, value]) => {
        const row = document.createElement("div");
        row.append(element("dt", "", label), element("dd", "", value));
        return row;
      })
    );
  }

  function renderEmailAnalytics(data) {
    const email = data.email_analytics;
    const hasData = Number(email.total_analyzed) > 0;

    els.emailKpis.replaceChildren(
      kpi("Emails analyzed", number(email.total_analyzed), "aggregate events"),
      kpi("Unique messages", number(email.unique_messages), "de-duplicated"),
      kpi("Datasets", number(email.datasets.length), email.datasets.join(", ") || "none yet"),
      kpi(
        "Last analyzed",
        email.last_analyzed_at ? formatDate(email.last_analyzed_at, DATE_ONLY) : "—",
        email.last_analyzed_at ? formatDate(email.last_analyzed_at) : "no data"
      )
    );

    if (els.emailEmpty) els.emailEmpty.hidden = hasData;
    if (els.emailCharts) els.emailCharts.hidden = !hasData;
    if (!hasData) {
      [els.emailCategories, els.priority, els.confidence, els.timeline].forEach((node) =>
        node?.replaceChildren()
      );
      return;
    }

    renderBars(
      els.emailCategories,
      email.category_distribution,
      {
        label: (row) => categoryLabel(row.category),
        color: (row) => categoryColor(row.category)
      }
    );
    renderBars(els.priority, email.priority_distribution);
    renderBars(els.confidence, email.confidence_distribution);
    renderTimeline(els.timeline, email.timeline);
  }

  function renderBars(container, rows, { label = (row) => row.label, color = null } = {}) {
    if (!container) return;
    const items = (rows || []).filter((row) => Number(row.count) >= 0);
    const total = items.reduce((sum, row) => sum + Number(row.count || 0), 0);

    if (!items.length || total <= 0) {
      container.replaceChildren(element("p", "intel-empty", "No data recorded yet."));
      return;
    }

    container.replaceChildren(
      ...items.map((row) => {
        const count = Number(row.count) || 0;
        const share = count / total;
        const wrap = element("div", "intel-bar-row");
        wrap.tabIndex = 0;
        wrap.setAttribute("role", "img");
        wrap.setAttribute("aria-label", `${label(row)}: ${count} (${percent(share)})`);

        const head = element("div", "intel-bar-head");
        head.append(
          element("span", "intel-bar-label", label(row)),
          element("span", "intel-bar-value", `${number(count)} · ${percent(share)}`)
        );

        const track = element("div", "intel-bar-track");
        const fill = element("span", "intel-bar-fill");
        fill.style.width = `${Math.max(2, share * 100)}%`;
        if (color) fill.style.background = color(row);
        track.append(fill);

        wrap.append(head, track);
        return wrap;
      })
    );
  }

  function renderTimeline(container, points) {
    if (!container) return;
    if (!points?.length) {
      container.replaceChildren(element("p", "intel-empty", "No processed emails recorded yet."));
      return;
    }

    const width = 680;
    const height = 190;
    const padX = 34;
    const padTop = 20;
    const padBottom = 40;
    const max = Math.max(...points.map((point) => Number(point.count) || 0), 1);
    const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
    const xAt = (index) => padX + stepX * index;
    const yAt = (count) => height - padBottom - (count / max) * (height - padTop - padBottom);

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "intel-timeline-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `Emails processed across ${points.length} day${points.length === 1 ? "" : "s"}. Peak ${max}.`
    );

    for (let grid = 0; grid <= 2; grid += 1) {
      const y = padTop + ((height - padTop - padBottom) / 2) * grid;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(padX));
      line.setAttribute("x2", String(width - padX));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("class", "intel-timeline-grid");
      svg.append(line);
    }

    const linePoints = points.map((point, index) => `${xAt(index)},${yAt(Number(point.count) || 0)}`);
    const area = document.createElementNS(SVG_NS, "path");
    area.setAttribute(
      "d",
      `M ${padX} ${height - padBottom} L ${linePoints.join(" L ")} L ${
        width - padX
      } ${height - padBottom} Z`
    );
    area.setAttribute("class", "intel-timeline-area");
    svg.append(area);

    const path = document.createElementNS(SVG_NS, "polyline");
    path.setAttribute("points", linePoints.join(" "));
    path.setAttribute("class", "intel-timeline-line");
    svg.append(path);

    points.forEach((point, index) => {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(xAt(index)));
      circle.setAttribute("cy", String(yAt(Number(point.count) || 0)));
      circle.setAttribute("r", "3.4");
      circle.setAttribute("class", "intel-timeline-point");
      circle.setAttribute("tabindex", "0");
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${point.date}: ${point.count} email${Number(point.count) === 1 ? "" : "s"}`;
      circle.append(title);
      svg.append(circle);

      if (points.length <= 8) {
        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(xAt(index)));
        label.setAttribute("y", String(height - 16));
        label.setAttribute("class", "intel-timeline-label");
        label.setAttribute("text-anchor", "middle");
        label.textContent = formatDate(point.date, DATE_ONLY);
        svg.append(label);
      }
    });

    if (points.length > 8) {
      const first = document.createElementNS(SVG_NS, "text");
      first.setAttribute("x", String(padX));
      first.setAttribute("y", String(height - 16));
      first.setAttribute("class", "intel-timeline-label");
      first.setAttribute("text-anchor", "start");
      first.textContent = formatDate(points[0].date, DATE_ONLY);
      svg.append(first);

      const last = document.createElementNS(SVG_NS, "text");
      last.setAttribute("x", String(width - padX));
      last.setAttribute("y", String(height - 16));
      last.setAttribute("class", "intel-timeline-label");
      last.setAttribute("text-anchor", "end");
      last.textContent = formatDate(points[points.length - 1].date, DATE_ONLY);
      svg.append(last);
    }

    container.replaceChildren(svg);
  }

  function renderFeedback(data) {
    const feedback = data.feedback;
    const hasFeedback = Number(feedback.total_feedback) > 0;
    els.feedbackKpis.replaceChildren(
      kpi("Total feedback", number(feedback.total_feedback), "human submissions"),
      kpi("Corrected", number(feedback.corrected_predictions), "user disagreed"),
      kpi(
        "User agreement",
        hasFeedback ? percent(feedback.user_agreement_rate) : "—",
        hasFeedback ? "not model accuracy" : "no feedback yet"
      ),
      kpi("Approved for training", number(feedback.approved_for_training), "manual review")
    );

    renderBars(
      els.feedbackCategories,
      (feedback.most_frequently_corrected_categories || []).map((row) => ({
        category: row.category,
        count: row.count,
        label: categoryLabel(row.category)
      })),
      {
        label: (row) => row.label || categoryLabel(row.category),
        color: (row) => categoryColor(row.category)
      }
    );

    const accuracy =
      feedback.model_accuracy === null || feedback.model_accuracy === undefined
        ? "unavailable"
        : percent(feedback.model_accuracy);
    els.feedbackNote.textContent =
      `${feedback.agreement_definition} Current model accuracy is ${accuracy} on the held-out test set.`;
  }

  function renderInference(data) {
    const inference = data.inference;
    const status =
      {
        loaded: "Loaded",
        artifact_missing: "Artifact missing",
        load_failed: "Load failed"
      }[inference.status] || inference.status;
    const hasPredictions = Number(inference.total_predictions) > 0;

    els.inference.replaceChildren(
      kpi(
        "Average latency",
        hasPredictions ? `${number(inference.average_latency_ms, 3)} ms` : "—",
        hasPredictions ? "service-side prediction" : "no predictions yet"
      ),
      kpi("Total predictions", number(inference.total_predictions), "evaluations + API calls"),
      kpi("Model status", status, inference.model_loaded ? "ready for inference" : "unavailable"),
      kpi(
        "Load time",
        inference.model_load_ms === null || inference.model_load_ms === undefined
          ? "—"
          : `${number(inference.model_load_ms, 2)} ms`,
        inference.artifact_exists ? "first artifact load" : "artifact missing"
      )
    );
  }

  function renderDisclosures(data) {
    els.disclosures.replaceChildren(
      ...(data.disclosures || []).map((text) => element("li", "", text))
    );
  }
}
