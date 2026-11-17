/**
 * Thread intelligence.
 *
 * Groups messages by an explicit thread_id when the dataset provides one,
 * otherwise by normalised subject plus a shared participant. The summary is
 * assembled from the actual messages; it is never a hard-coded paragraph.
 */

import { CATEGORY_BY_ID, extractActions, extractDeadline, formatDeadline } from "./triage.js";
import { extractEntities } from "./text.js";

const PREFIX = /^\s*(?:(?:re|fwd|fw|aw|sv)\s*:\s*)+/i;

export function normalizeSubject(subject) {
  return String(subject || "")
    .replace(PREFIX, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function participantsOf(email) {
  const list = [];
  if (email.from?.email) list.push({ name: email.from.name, email: email.from.email });
  for (const recipient of email.to || []) {
    if (recipient?.email) list.push({ name: recipient.name || recipient.email, email: recipient.email });
  }
  return list;
}

function participantKey(email) {
  return new Set(participantsOf(email).map((person) => person.email.toLowerCase()));
}

function intersects(a, b) {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function clusterBySubject(emails) {
  const bySubject = new Map();
  for (const email of emails) {
    const key = normalizeSubject(email.subject);
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(email);
  }

  const clusters = [];
  for (const group of bySubject.values()) {
    const pending = [...group];
    while (pending.length) {
      const cluster = [pending.shift()];
      let changed = true;
      while (changed) {
        changed = false;
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const candidate = pending[index];
          const candidateParticipants = participantKey(candidate);
          if (cluster.some((member) => intersects(participantKey(member), candidateParticipants))) {
            cluster.push(candidate);
            pending.splice(index, 1);
            changed = true;
          }
        }
      }
      clusters.push(cluster);
    }
  }
  return clusters;
}

function directionOf(email) {
  return email.direction === "outgoing" ? "outgoing" : "incoming";
}

function gist(email) {
  const body = String(email.body || "").replace(/\s+/g, " ").trim();
  const sentence = body.match(/^[^.!?]+[.!?]?/)?.[0] || body;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
}

/**
 * Pull the explicit "please prepare: …" list out of the latest message that
 * asks for it. This stays grounded in the message text; nothing is invented.
 */
function extractPreparation(emails) {
  const items = [];
  const seen = new Set();

  for (const email of emails) {
    const body = String(email.body || "").replace(/\s+/g, " ");
    const match = body.match(/\b(?:please\s+)?prepare\s*:?\s+([^.!?]+)/i);
    if (!match) continue;

    const list = match[1]
      .replace(/\s+and\s+/gi, ", ")
      .split(/\s*[,;]\s*/)
      .map((item) => item.replace(/^(?:a|an|the)\s+/i, "").trim())
      .filter((item) => item.length > 2 && item.length < 160);

    for (const item of list) {
      const key = item.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
      }
    }
  }

  return items.slice(0, 6);
}

function formatThreadDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function summarizeThread(thread) {
  const category = CATEGORY_BY_ID[thread.category]?.label || "Mail";
  const participantNames = thread.participants.map((person) => person.name).filter(Boolean);
  const first = thread.messages[0];
  const last = thread.messages[thread.messages.length - 1];
  const parts = [];

  parts.push(
    `${category} conversation with ${participantNames.join(" and ")} — ${thread.count} message${thread.count === 1 ? "" : "s"} from ${formatThreadDate(first.receivedAt)} to ${formatThreadDate(last.receivedAt)}.`
  );

  if (thread.status === "Awaiting you") {
    parts.push("The latest message is from them, so the conversation is waiting on your reply.");
  } else if (thread.status === "Waiting on them") {
    parts.push("Your reply is the latest message, so the next move is theirs.");
  }

  if (thread.interview?.date) {
    parts.push(`Interview confirmed for ${formatThreadDate(thread.interview.date)}.`);
  } else if (thread.deadline?.date) {
    parts.push(`The next date is ${formatDeadline(thread.deadline.date, thread.reference)}.`);
  }

  const preparation = thread.prep?.length ? thread.prep : thread.actions.slice(0, 3);
  if (preparation.length) {
    parts.push(`Prepare: ${preparation.join("; ")}.`);
  }

  parts.push(`Latest: ${gist(last)}`);
  return parts.join(" ");
}

function buildThread(messages, reference, options = {}) {
  const ordered = [...messages].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const participants = [];
  const seen = new Set();
  for (const email of ordered) {
    for (const person of participantsOf(email)) {
      const key = person.email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        participants.push(person);
      }
    }
  }

  const last = ordered[ordered.length - 1];
  const lastDirection = directionOf(last);
  let status = "Active";
  if (lastDirection === "outgoing") status = "Waiting on them";
  else if (!last.replied) status = "Awaiting you";

  const categoryCounts = {};
  for (const email of ordered) {
    const category = email.analysis?.category || "important";
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  const category = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "important";

  const actions = [];
  const actionSeen = new Set();
  for (const email of ordered) {
    for (const action of extractActions(email.body)) {
      const key = action.toLowerCase();
      if (!actionSeen.has(key)) {
        actionSeen.add(key);
        actions.push(action);
      }
    }
  }

  const deadlines = ordered
    .map((email) => extractDeadline(`${email.subject}. ${email.body}`, reference))
    .filter(Boolean);
  const deadline = deadlines[deadlines.length - 1] || null;

  const interviewMessage = [...ordered]
    .reverse()
    .find((email) => /\binterview\b/i.test(`${email.subject} ${email.body}`) && extractDeadline(email.body, reference));
  const interviewDeadline = interviewMessage ? extractDeadline(interviewMessage.body, reference) : null;

  const entities = ordered.reduce(
    (merged, email) => {
      const found = extractEntities(`${email.subject}\n${email.body}`);
      merged.emails.push(...found.emails);
      merged.urls.push(...found.urls);
      merged.money.push(...found.money);
      merged.dates.push(...found.dates);
      merged.organizations.push(...found.organizations);
      return merged;
    },
    { emails: [], urls: [], money: [], dates: [], organizations: [] }
  );
  for (const key of Object.keys(entities)) entities[key] = [...new Set(entities[key])];

  const thread = {
    id: ordered[0].threadId || `thread-${normalizeSubject(ordered[0].subject)}`,
    subject: ordered[0].subject,
    normalizedSubject: normalizeSubject(ordered[0].subject),
    messages: ordered,
    count: ordered.length,
    participants,
    category,
    status,
    actions: actions.slice(0, 6),
    prep: extractPreparation(ordered),
    deadline,
    interview: interviewDeadline ? { date: interviewDeadline.date, label: interviewDeadline.label } : null,
    entities,
    firstAt: ordered[0].receivedAt,
    lastAt: last.receivedAt,
    reference
  };

  const summary = options.summarize
    ? options.summarize(thread)
    : { text: summarizeThread(thread), engine: "deterministic-nlu" };
  thread.summary = summary;
  thread.timeline = ordered.map((email) => ({
    id: email.id,
    from: email.from,
    direction: directionOf(email),
    receivedAt: email.receivedAt,
    subject: email.subject,
    gist: gist(email)
  }));

  return thread;
}

export function buildThreads(emails, { reference = new Date(), summarize } = {}) {
  const withThreadId = emails.filter((email) => email.threadId);
  const withoutThreadId = emails.filter((email) => !email.threadId);

  const groups = new Map();
  for (const email of withThreadId) {
    const key = String(email.threadId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(email);
  }

  for (const cluster of clusterBySubject(withoutThreadId)) {
    if (cluster.length > 1) groups.set(`subject:${normalizeSubject(cluster[0].subject)}`, cluster);
  }

  const threads = [...groups.entries()].map(([id, messages]) => {
    const thread = buildThread(messages, reference, { summarize });
    thread.id = id;
    return thread;
  });

  threads.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  return threads;
}

export function attachThreads(emails, options = {}) {
  const threads = buildThreads(emails, options);
  const byEmail = new Map();
  for (const thread of threads) {
    for (const email of thread.messages) byEmail.set(email.id, thread);
  }
  for (const email of emails) {
    email.thread = byEmail.get(email.id) || null;
  }
  return threads;
}

export { formatThreadDate, gist };
