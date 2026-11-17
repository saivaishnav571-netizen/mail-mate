/**
 * Shared text utilities.
 *
 * Everything here is deterministic and local. HTML is cleaned before any
 * model sees it, and entity extraction only reports what the text actually
 * contains.
 */

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves`.split(
    /\s+/
  )
);

const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“"
};

const MONTH_PATTERN =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_PATTERN = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday)";

export function decodeEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripHtml(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

export function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanEmailText(value) {
  return normalizeWhitespace(stripHtml(value));
}

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function unique(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function extractEntities(value) {
  const text = String(value || "");

  const emails = unique(text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []);
  const urls = unique(text.match(/https?:\/\/[^\s<>"')]+/gi) || []);
  const money = unique(text.match(/(?:£|\$|€)\s?\d[\d,]*(?:\.\d{2})?/g) || []);
  const phones = unique(
    text.match(/(?:\+?\d[\d\s()-]{7,}\d)/g)?.filter((candidate) => candidate.replace(/\D/g, "").length >= 9) || []
  );

  const dates = unique([
    ...(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []),
    ...(text.match(new RegExp(`\\b\\d{1,2}\\s+${MONTH_PATTERN}\\s+\\d{4}\\b`, "gi")) || []),
    ...(text.match(new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b`, "gi")) || []),
    ...(text.match(new RegExp(`\\b${WEEKDAY_PATTERN}\\b`, "gi")) || []),
    ...(text.match(/\b(?:today|tonight|tomorrow|next week|next month|this week|this month)\b/gi) || [])
  ]);

  const organizations = unique(
    text.match(
      /\b(?:[A-Z][\w&.'-]*\s+){0,3}(?:Technologies|Technology|University|College|Bank|Ltd|Limited|Inc|LLC|Team|Desk|Department|Office|Ops|Recruiting|HireLoop|Northwind)\b/g
    ) || []
  );

  return {
    emails,
    urls,
    money,
    phones,
    dates: dates.slice(0, 12),
    organizations: organizations.slice(0, 8)
  };
}

export { STOPWORDS };
