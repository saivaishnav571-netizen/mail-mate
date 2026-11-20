# External labeled evaluation

MailMate's AI Intelligence Center can evaluate the active backend model on a CSV of labeled emails.

## CSV format

Required columns: `category` and `text`.

Optional columns: `subject` and `id`.

Allowed category values: `important`, `academic`, `internship`, `personal`, `spam`.

See [labeled-evaluation-template.csv](./labeled-evaluation-template.csv) for a starter template. The five sample rows are only a format demonstration; they are not a meaningful accuracy benchmark.

## Recommended evaluation set

- Use real examples that were not included in model training or feedback.
- Prefer at least 50 labeled emails per category (more is better).
- Keep labels consistent; write down the labeling rules for ambiguous emails.
- Include different senders, formats, short/long messages, forwarded messages, and category-overlap cases.
- Remove or redact names, phone numbers, account numbers, addresses, secrets, and sensitive message content before upload.
- Avoid duplicates and near-duplicates between the training set and evaluation set.

## What is reported

- Accuracy, macro precision, macro recall, macro F1, and per-category support.
- Confusion matrix.
- Confidence coverage: proportion at or above the selected threshold.
- Accuracy on confident predictions (selective accuracy).
- Multiclass Brier score and expected calibration error (ECE).
- Review queue includes low-confidence predictions and misclassified examples; a sample may have both flags.

## Privacy and model safety

The uploaded text is sent to the configured backend for inference/evaluation. The evaluation endpoint does not persist uploaded sample text, train from it, or activate/change the model. Results are returned to the browser. Use a redacted dataset and a backend you trust. The confidence score is a review signal and may not be calibrated; it is not a guarantee of correctness.
