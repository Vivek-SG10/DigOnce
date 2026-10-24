/**
 * fallbackParser.js — Offline regex/heuristic parser with same output shape as api/parse.js.
 * Used when AI is unavailable or times out.
 */

// ─── Redaction ────────────────────────────────────────────────────────────────

const PHONE_RE = /(\+?91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}/g;
const NAME_RE =
  /\b(Mr\.|Mrs\.|Ms\.|Shri|Smt\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;

/**
 * Redact Indian phone numbers and honorific names from text.
 * @param {string} text
 * @returns {{ redacted: string, didRedact: boolean }}
 */
export function redactText(text) {
  let redacted = text;
  let didRedact = false;
  if (PHONE_RE.test(redacted)) { didRedact = true; }
  if (NAME_RE.test(redacted)) { didRedact = true; }
  PHONE_RE.lastIndex = 0; NAME_RE.lastIndex = 0;
  redacted = redacted.replace(PHONE_RE, '[PHONE REDACTED]');
  redacted = redacted.replace(NAME_RE, '$1 [NAME REDACTED]');
  return { redacted, didRedact };
}

// ─── Normalisation & Levenshtein ──────────────────────────────────────────────

/**
 * Normalise a street name for fuzzy matching.
 */
function normalise(s) {
  return s
    .toLowerCase()
    .replace(/\brd\b/g, 'road')
    .replace(/\bmn\b/g, 'main')
    .replace(/\bst\b/g, 'street')
    .replace(/\bav(e)?\b/g, 'avenue')
    .replace(/[^\w\s]/g, '')       // remove punctuation
    .replace(/\b(1st|2nd|3rd|\d+th)\b/g, (m) => m.replace(/\D/g, '')) // strip ordinal suffix
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Fuzzy-match a raw street name against the authoritative list.
 * Accepts if Levenshtein ratio <= 0.25.
 * @param {string} raw
 * @param {string[]} streetNames
 * @returns {{ match: string|null, isFuzzy: boolean, ratio: number }}
 */
function matchStreet(raw, streetNames) {
  const normRaw = normalise(raw);
  // Exact match first
  for (const s of streetNames) {
    if (normalise(s) === normRaw) return { match: s, isFuzzy: false, ratio: 0 };
  }
  // Fuzzy
  let best = null, bestRatio = Infinity;
  for (const s of streetNames) {
    const ns = normalise(s);
    const dist = levenshtein(normRaw, ns);
    const ratio = dist / Math.max(normRaw.length, ns.length);
    if (ratio < bestRatio) { bestRatio = ratio; best = s; }
  }
  if (bestRatio <= 0.25) return { match: best, isFuzzy: true, ratio: bestRatio };
  return { match: null, isFuzzy: false, ratio: bestRatio };
}

// ─── Agency detection ─────────────────────────────────────────────────────────

const AGENCY_PATTERNS = [
  { agency: 'BWSSB', re: /\b(bwssb|water|pipeline|waterline|ನೀರು|पानी)\b/i },
  { agency: 'BESCOM', re: /\b(bescom|electric|electricity|cable|ವಿದ್ಯುತ್|बिजली)\b/i },
  { agency: 'GAIL', re: /\b(gail|gas|gasline)\b/i },
  { agency: 'TELECOM', re: /\b(telecom|fibre|fiber|ofc|optic|broadband)\b/i },
  { agency: 'BBMP', re: /\b(bbmp|drain|drainage|ಚರಂಡಿ|ಚರಂಡಿ|नाली)\b/i },
];

function detectAgency(text) {
  for (const { agency, re } of AGENCY_PATTERNS) {
    if (re.test(text)) return agency;
  }
  return 'UNKNOWN';
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(text, today) {
  const t = today || new Date();
  t.setHours(0, 0, 0, 0);

  // "tomorrow" / "kal"
  if (/\b(tomorrow|kal|ನಾಳೆ)\b/i.test(text)) return addDays(t, 1);
  // "today"
  if (/\btoday\b/i.test(text)) return t.toISOString().slice(0, 10);
  // "next month"
  if (/next\s*month/i.test(text)) {
    const d = new Date(t); d.setMonth(d.getMonth() + 1); d.setDate(5);
    return d.toISOString().slice(0, 10);
  }
  // "5th of next month" / "5 nov" / "05/11/2026"
  const dmySlash = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmySlash) {
    const [, d, m, y] = dmySlash;
    const year = y.length === 2 ? 2000 + +y : +y;
    const dt = new Date(year, +m - 1, +d);
    if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  }
  const wordDate = text.match(/(\d{1,2})\s*(st|nd|rd|th)?\s+of?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (wordDate) {
    const day = +wordDate[1];
    const monthIdx = MONTH_MAP[wordDate[3].toLowerCase()];
    let year = t.getFullYear();
    const candidate = new Date(year, monthIdx, day);
    if (candidate < t) year++;
    return new Date(year, monthIdx, day).toISOString().slice(0, 10);
  }
  // "5th of next month" pattern
  const nthNext = text.match(/(\d{1,2})\s*(st|nd|rd|th)?\s+of\s+next\s+month/i);
  if (nthNext) {
    const d2 = new Date(t);
    d2.setMonth(d2.getMonth() + 1);
    d2.setDate(+nthNext[1]);
    return d2.toISOString().slice(0, 10);
  }
  // ISO date in text
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return null;
}

// ─── Duration parsing ─────────────────────────────────────────────────────────

function parseDuration(text) {
  // "2 weeks" / "approx 2 weeks"
  const weeks = text.match(/(\d+)\s*week/i);
  if (weeks) return +weeks[1] * 7;
  // "10 days" / "10 ದಿನ" / "10 din"
  const days = text.match(/(\d+)\s*(days?|day|ದಿನ|din)/i);
  if (days) return +days[1];
  return 7; // default
}

// ─── Length/width parsing ─────────────────────────────────────────────────────

function parseLength(text) {
  const m = text.match(/(\d+)\s*(m\b|mtr|meter|metre|ಮೀಟರ್|ಮೀ)/i);
  return m ? +m[1] : 100;
}

function parseWidth(text) {
  const m = text.match(/(\d+\.?\d*)\s*m\s*(wide|width|ಅಗಲ)/i);
  if (m) return +m[1];
  // "trench 0.8 m" style
  const m2 = text.match(/trench[^,\n]{0,20}?(\d+\.?\d*)\s*m/i);
  if (m2) return +m2[1];
  return 0.6;
}

// ─── Street extraction ────────────────────────────────────────────────────────

function extractStreets(text, streetNames) {
  const segments = [];
  const flags = [];
  // Try to match each street name directly (sorted longest first to avoid partial matches)
  const sorted = [...streetNames].sort((a, b) => b.length - a.length);
  let remaining = text;
  const found = new Set();
  for (const name of sorted) {
    if (new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(remaining)) {
      if (!found.has(name)) { segments.push(name); found.add(name); }
    }
  }
  if (segments.length > 0) return { segments, flags };

  // Heuristic: look for "on <Street>" or "ನಲ್ಲಿ" pattern
  const onPattern = text.match(/(?:on|along|at|ನಲ್ಲಿ|pe\b)\s+([A-Z][^,.;\n]{3,50})/i);
  if (onPattern) {
    const raw = onPattern[1].trim().replace(/\s*(from|starting|for|approx).*/i, '');
    const { match, isFuzzy } = matchStreet(raw, streetNames);
    if (match) {
      segments.push(match);
      if (isFuzzy) flags.push(`fuzzy_match:${raw}->${match}`);
    } else {
      flags.push(`rejected_street:${raw}`);
    }
  }

  return { segments, flags };
}

// ─── Emergency detection ──────────────────────────────────────────────────────

function detectEmergency(text) {
  return /\b(urgent|emergency|burst|leak|immediate|तुरंत|ತುರ್ತು)\b/i.test(text);
}

// ─── Main parser ──────────────────────────────────────────────────────────────

let _idCounter = Date.now();

/**
 * Parse a raw text notice into a Work object. Same output shape as api/parse.js.
 * @param {string} text - Raw notice text
 * @param {string[]} streetNames - Authoritative list
 * @param {Date} [todayOverride]
 * @returns {{ work: object, flags: string[], redactedText: string, source: 'fallback' }}
 */
export function fallbackParse(text, streetNames, todayOverride) {
  const today = todayOverride ?? new Date();
  const { redacted, didRedact } = redactText(text);

  const agency = detectAgency(text);
  const isEmergency = detectEmergency(text);
  const { segments, flags } = extractStreets(text, streetNames);
  const startDate = parseDate(text, today) ?? new Date(today).toISOString().slice(0, 10);
  const durationDays = parseDuration(text);
  const trenchLengthM = parseLength(text);
  const trenchWidthM = parseWidth(text);

  // Validate
  if (agency === 'UNKNOWN') flags.push('missing_agency');
  if (durationDays < 1 || durationDays > 365) flags.push('invalid_duration');

  const work = {
    id: `fallback-${++_idCounter}`,
    agency,
    workType: isEmergency ? 'Emergency Repair' : 'Utility Works',
    segments,
    startDate,
    durationDays,
    trenchLengthM,
    trenchWidthM,
    isEmergency,
    rawText: text,
    source: 'fallback',
    flags,
  };

  return { work, flags, redactedText: didRedact ? redacted : null, source: 'fallback' };
}
