/**
 * TF-IDF + multinomial logistic regression, trained in the browser.
 *
 * The implementation is deliberately small and deterministic: full-batch
 * gradient descent, a fixed sample order, and a fixed number of epochs. That
 * keeps the reported cross-validation numbers reproducible on every load.
 */

import { CATEGORIES, CATEGORY_BY_ID } from "./triage.js";
import { TRAINING_SAMPLES } from "./ai-training.js";
import { tokenize } from "./text.js";

const CATEGORY_IDS = CATEGORIES.map((category) => category.id);
const DEFAULTS = {
  epochs: 420,
  learningRate: 0.55,
  l2: 0.0015
};

function buildDocumentFrequency(documents) {
  const documentFrequency = new Map();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  return documentFrequency;
}

function buildIdf(documents) {
  const documentFrequency = buildDocumentFrequency(documents);
  const total = documents.length || 1;
  const idf = new Map();
  for (const [token, frequency] of documentFrequency) {
    idf.set(token, Math.log((1 + total) / (1 + frequency)) + 1);
  }
  return { idf, documentFrequency };
}

function vectorize(tokens, idf, vocabulary) {
  const counts = new Map();
  for (const token of tokens) {
    if (vocabulary && !vocabulary.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const vector = new Map();
  let norm = 0;
  for (const [token, count] of counts) {
    const value = (1 + Math.log(count)) * (idf.get(token) || 1);
    vector.set(token, value);
    norm += value * value;
  }

  norm = Math.sqrt(norm) || 1;
  for (const [token, value] of vector) vector.set(token, value / norm);
  return vector;
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

function argmax(values) {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) best = index;
  }
  return best;
}

export function trainLogisticRegression(samples, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const docs = samples.map((sample) => tokenize(sample.text));
  const { idf } = buildIdf(docs);
  const vocabulary = new Set(idf.keys());
  const terms = [...vocabulary];
  const termIndex = new Map(terms.map((term, index) => [term, index]));
  const vectors = docs.map((tokens) => vectorize(tokens, idf, vocabulary));

  const classIndex = new Map(CATEGORY_IDS.map((id, index) => [id, index]));
  const weights = CATEGORY_IDS.map(() => new Float64Array(terms.length));
  const biases = new Float64Array(CATEGORY_IDS.length);
  const classCounts = new Float64Array(CATEGORY_IDS.length);

  for (const sample of samples) {
    const index = classIndex.get(sample.category);
    if (index !== undefined) classCounts[index] += 1;
  }
  for (let index = 0; index < biases.length; index += 1) {
    biases[index] = Math.log((classCounts[index] + 1) / (samples.length + CATEGORY_IDS.length));
  }

  const featureRows = vectors.map((vector) => {
    const row = [];
    for (const [term, value] of vector) {
      const index = termIndex.get(term);
      if (index !== undefined) row.push([index, value]);
    }
    return row;
  });

  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    const weightGradients = CATEGORY_IDS.map(() => new Float64Array(terms.length));
    const biasGradients = new Float64Array(CATEGORY_IDS.length);

    for (let row = 0; row < samples.length; row += 1) {
      const target = classIndex.get(samples[row].category);
      if (target === undefined) continue;

      const logits = new Float64Array(CATEGORY_IDS.length);
      for (let classId = 0; classId < CATEGORY_IDS.length; classId += 1) {
        let score = biases[classId];
        const classWeights = weights[classId];
        for (const [feature, value] of featureRows[row]) score += classWeights[feature] * value;
        logits[classId] = score;
      }

      const probabilities = softmax(logits);
      for (let classId = 0; classId < CATEGORY_IDS.length; classId += 1) {
        const error = probabilities[classId] - (classId === target ? 1 : 0);
        biasGradients[classId] += error;
        const gradient = weightGradients[classId];
        for (const [feature, value] of featureRows[row]) gradient[feature] += error * value;
      }
    }

    const scale = 1 / (samples.length || 1);
    for (let classId = 0; classId < CATEGORY_IDS.length; classId += 1) {
      biases[classId] -= config.learningRate * biasGradients[classId] * scale;
      const classWeights = weights[classId];
      const gradient = weightGradients[classId];
      for (let feature = 0; feature < classWeights.length; feature += 1) {
        classWeights[feature] -=
          config.learningRate * (gradient[feature] * scale + config.l2 * classWeights[feature]);
      }
    }
  }

  function predict(text) {
    const tokens = tokenize(text);
    const vector = vectorize(tokens, idf, vocabulary);
    const logits = CATEGORY_IDS.map((_, classId) => {
      let score = biases[classId];
      for (const [term, value] of vector) {
        const feature = termIndex.get(term);
        if (feature !== undefined) score += weights[classId][feature] * value;
      }
      return score;
    });

    const probabilities = softmax(logits);
    const ranked = CATEGORY_IDS.map((id, index) => ({
      id,
      label: CATEGORY_BY_ID[id].label,
      probability: probabilities[index]
    })).sort((a, b) => b.probability - a.probability);

    const predictedIndex = argmax(probabilities);
    const predicted = CATEGORY_IDS[predictedIndex];
    const contributions = [];
    for (const [term, value] of vector) {
      const feature = termIndex.get(term);
      if (feature === undefined) continue;
      contributions.push({
        term,
        weight: weights[predictedIndex][feature] * value
      });
    }
    contributions.sort((a, b) => b.weight - a.weight);

    return {
      predicted,
      predictedLabel: CATEGORY_BY_ID[predicted].label,
      probabilities: Object.fromEntries(CATEGORY_IDS.map((id, index) => [id, probabilities[index]])),
      ranked,
      alternatives: ranked.slice(1, 3),
      topTerms: contributions
        .filter((item) => item.weight > 0)
        .slice(0, 6)
        .map((item) => ({ term: item.term, weight: Number(item.weight.toFixed(3)) })),
      // Sparse or unfamiliar text is inherently harder to classify.
      // Do not let class priors create an unjustifiably confident prediction.
      confidence: Math.min(
        ranked[0].probability,
        vector.size <= 2 ? 0.5 : vector.size <= 5 ? 0.65 : 1
      ),
      knownTokens: vector.size,
      source: "ml"
    };
  }

  return {
    predict,
    vocabulary,
    vocabSize: vocabulary.size,
    idf,
    terms,
    weights,
    biases,
    samples: samples.length,
    config
  };
}

export function metricsFromPredictions(predictions) {
  const perClass = {};

  for (const label of CATEGORY_IDS) {
    const truePositive = predictions.filter((item) => item.expected === label && item.predicted === label).length;
    const falsePositive = predictions.filter((item) => item.expected !== label && item.predicted === label).length;
    const falseNegative = predictions.filter((item) => item.expected === label && item.predicted !== label).length;
    const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
    const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[label] = {
      precision,
      recall,
      f1,
      support: truePositive + falseNegative
    };
  }

  const correct = predictions.filter((item) => item.expected === item.predicted).length;
  const macroF1 = CATEGORY_IDS.reduce((total, label) => total + perClass[label].f1, 0) / CATEGORY_IDS.length;

  return {
    accuracy: predictions.length ? correct / predictions.length : 0,
    macroF1,
    perClass,
    total: predictions.length
  };
}

export function crossValidate(samples, folds = 5) {
  const predictions = [];

  for (let fold = 0; fold < folds; fold += 1) {
    const training = samples.filter((_, index) => index % folds !== fold);
    const testing = samples.filter((_, index) => index % folds === fold);
    if (!training.length || !testing.length) continue;
    const model = trainLogisticRegression(training);
    for (const sample of testing) {
      predictions.push({
        expected: sample.category,
        predicted: model.predict(sample.text).predicted
      });
    }
  }

  return metricsFromPredictions(predictions);
}

export const ML_MODEL = trainLogisticRegression(TRAINING_SAMPLES);
export const ML_METRICS = crossValidate(TRAINING_SAMPLES);
export const ML_MODEL_INFO = {
  name: "TF-IDF + Logistic Regression",
  samples: TRAINING_SAMPLES.length,
  vocabSize: ML_MODEL.vocabSize,
  classes: CATEGORY_IDS.length,
  metrics: ML_METRICS,
  epochs: ML_MODEL.config.epochs
};
