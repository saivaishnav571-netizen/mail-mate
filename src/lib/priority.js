/**
 * Independent priority engine.
 *
 * Priority is deliberately not a copy of the category. It combines deadline
 * proximity, urgency language, explicit actions, sender importance, thread
 * state and unread state, then exposes every factor that moved the score.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const IMPORTANT_SENDERS = /manager|board|finance|legal|payroll|hr|people ops|facilities|it service|security|recruit|talent|university|professor|supervisor|bank/i;
const PERSONAL_SENDERS = /mum|dad|friend|family|sister|brother|housemate/i;
const EXPLICIT_URGENCY = /\b(urgent|urgently|asap|immediately|action required|final notice|last chance)\b/i;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deadlinePoints(email, reference) {
  if (!email.deadline?.date) return { points: 0, urgency: 0, detail: null };

  const delta = email.deadline.date.getTime() - reference.getTime();
  if (delta < 0) return { points: 30, urgency: 100, detail: "Deadline has passed" };
  if (delta <= DAY_MS) return { points: 28, urgency: 88, detail: "Due within 24 hours" };
  if (delta <= 2 * DAY_MS) return { points: 22, urgency: 72, detail: "Due within 48 hours" };
  if (delta <= 7 * DAY_MS) return { points: 14, urgency: 46, detail: "Due this week" };
  if (delta <= 30 * DAY_MS) return { points: 7, urgency: 24, detail: "Due this month" };
  return { points: 3, urgency: 12, detail: "Due later" };
}

function senderPoints(email) {
  const name = `${email.from?.name || ""} ${email.from?.email || ""}`;
  if (IMPORTANT_SENDERS.test(name)) return { points: 8, detail: "Work or institutional sender" };
  if (PERSONAL_SENDERS.test(name)) return { points: 2, detail: "Personal sender" };
  return { points: 0, detail: "Unknown sender importance" };
}

export function scorePriority(email, sentiment = {}, context = {}) {
  const reference = context.reference || new Date();
  const category = email.analysis?.category || email.category || "important";
  const factors = [];

  if (category === "spam") {
    return {
      score: 4,
      band: "Low",
      bandClass: "filtered",
      urgency: 0,
      filtered: true,
      factors: [{ label: "Spam filter", points: -18, detail: "Kept out of the reply queue" }],
      nextAction: "No action. Leave it filtered."
    };
  }

  let score = 0;

  const deadline = deadlinePoints(email, reference);
  if (deadline.detail) {
    score += deadline.points;
    factors.push({ label: "Deadline", points: deadline.points, detail: deadline.detail });
  }

  const urgency = Number(sentiment.urgency) || 0;
  const urgencyPoints = Math.round((urgency / 100) * 20);
  if (urgencyPoints) {
    score += urgencyPoints;
    factors.push({ label: "Urgency", points: urgencyPoints, detail: `Tone score ${urgency}/100` });
  }

  const actions = email.analysis?.actions?.length || email.actions?.length || 0;
  const actionPoints = Math.min(3, actions) * 5;
  if (actionPoints) {
    score += actionPoints;
    factors.push({ label: "Actions", points: actionPoints, detail: `${actions} next action${actions === 1 ? "" : "s"}` });
  }

  const sender = senderPoints(email);
  if (sender.points) {
    score += sender.points;
    factors.push({ label: "Sender", points: sender.points, detail: sender.detail });
  }

  if (EXPLICIT_URGENCY.test(email.body || "")) {
    score += 6;
    factors.push({ label: "Language", points: 6, detail: "Explicit urgency cue in the message" });
  }

  if (!email.read) {
    score += 4;
    factors.push({ label: "Unread", points: 4, detail: "Not opened yet" });
  }

  if (email.followUp?.awaiting) {
    score += 6;
    factors.push({ label: "Thread", points: 6, detail: "The conversation is waiting on you" });
  }

  if (email.attachments?.length) {
    score += 3;
    factors.push({ label: "Attachment", points: 3, detail: `${email.attachments.length} attachment${email.attachments.length === 1 ? "" : "s"} to review` });
  }

  if (email.replied) {
    score -= 20;
    factors.push({ label: "Replied", points: -20, detail: "Already handled" });
  }

  score = clamp(Math.round(score), 0, 100);

  const urgencyScore = clamp(
    Math.round(0.55 * urgency + 0.45 * deadline.urgency + (EXPLICIT_URGENCY.test(email.body || "") ? 12 : 0)),
    0,
    100
  );

  const band = score >= 65 ? "High" : score >= 35 ? "Medium" : "Low";
  const nextAction =
    email.analysis?.actions?.[0] ||
    (email.deadline?.label ? `Reply before ${email.deadline.label}` : "Read and decide whether to reply.");

  factors.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return {
    score,
    band,
    bandClass: band.toLowerCase(),
    urgency: urgencyScore,
    filtered: false,
    factors: factors.slice(0, 5),
    nextAction
  };
}

export { DAY_MS, HOUR_MS };
