/**
 * api/parse.js — Vercel serverless function (ES module, default export).
 * POST {text, streetNames, today} → {work, flags, redactedText, source:"ai"}
 * Falls back gracefully: responds {useFallback:true, error} on any failure.
 */

// ─── Redaction (server-side) ──────────────────────────────────────────────────

const PHONE_RE = /(\+?91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}/g;
const NAME_RE = /\b(Mr\.|Mrs\.|Ms\.|Shri|Smt\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;

function redact(text) {
  PHONE_RE.lastIndex = 0; NAME_RE.lastIndex = 0;
  let redacted = text.replace(PHONE_RE, '[PHONE REDACTED]');
  redacted = redacted.replace(NAME_RE, '$1 [NAME REDACTED]');
  return { redacted, didRedact: redacted !== text };
}

// ─── Body parsing helper ──────────────────────────────────────────────────────

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(parsed, streetNames) {
  const flags = [];
  const unmatchedStreets = parsed.unmatchedStreets ?? [];

  // Validate segments: drop any not in streetNames
  const validSegments = [];
  for (const seg of parsed.segments ?? []) {
    if (streetNames.includes(seg)) {
      validSegments.push(seg);
    } else {
      flags.push(`rejected_street:${seg}`);
    }
  }

  // Unmatched streets from AI response
  for (const s of unmatchedStreets) {
    flags.push(`unmatchedStreets:${s}`);
  }

  // Date validation
  if (!parsed.startDate || isNaN(new Date(parsed.startDate).getTime())) {
    flags.push('invalid_date');
  }

  // Duration validation
  const dur = parsed.durationDays;
  if (!dur || dur < 1 || dur > 365) {
    flags.push('invalid_duration');
  }

  // Missing agency
  if (!parsed.agency || parsed.agency === 'UNKNOWN') {
    flags.push('missing_agency');
  }

  // Low confidence
  const conf = parsed.confidence ?? {};
  for (const [field, val] of Object.entries(conf)) {
    if (typeof val === 'number' && val < 0.7) {
      flags.push(`low_confidence:${field}`);
    }
  }

  return { validSegments, flags };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!apiKey) {
    return res.status(200).json({ useFallback: true, error: 'GEMINI_API_KEY not set' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return res.status(200).json({ useFallback: true, error: `Body parse error: ${e.message}` });
  }

  const { text, streetNames = [], today } = body;
  if (!text) {
    return res.status(200).json({ useFallback: true, error: 'No text provided' });
  }

  // Server-side redaction
  const { redacted: redactedText, didRedact } = redact(text);

  // Build Gemini prompt
  const streetListJson = JSON.stringify(streetNames.slice(0, 500)); // cap for prompt size
  const prompt = `You are a road-works permit extraction system for Bengaluru ward.
Extract the following fields from the notice and return ONLY valid JSON matching the schema.

AUTHORITATIVE STREET LIST (copy segment names exactly from this list):
${streetListJson}

TODAY'S DATE: ${today || new Date().toISOString().slice(0, 10)}

Rules:
- segments: must be copied EXACTLY from the street list above. If a name in the notice is close (spelling/abbreviation), choose the matching list name and lower confidence for segments.
- If a street in the notice cannot be matched at all, put it in unmatchedStreets[] and leave segments empty.
- Never invent street names not in the list.
- Resolve relative dates ("tomorrow", "next month", "5th of next month") against TODAY'S DATE.
- Read English, Kannada, Hindi and mixed (Hinglish/Kanglish) text fluently.
- isEmergency = true if words like urgent/emergency/leak/burst/immediate/ತುರ್ತು/तुरंत appear.
- durationDays: convert weeks→days; "approx 2 weeks" = 14.
- Confidence 0–1 for each field.

NOTICE TEXT:
${redactedText}`;

  const requestSchema = {
    type: 'object',
    properties: {
      agency: { type: 'string', enum: ['BWSSB', 'BESCOM', 'GAIL', 'TELECOM', 'BBMP', 'UNKNOWN'] },
      workType: { type: 'string' },
      segments: { type: 'array', items: { type: 'string' } },
      unmatchedStreets: { type: 'array', items: { type: 'string' } },
      startDate: { type: 'string', description: 'YYYY-MM-DD' },
      durationDays: { type: 'number' },
      trenchLengthM: { type: 'number' },
      trenchWidthM: { type: 'number' },
      isEmergency: { type: 'boolean' },
      confidence: {
        type: 'object',
        properties: {
          agency: { type: 'number' },
          segments: { type: 'number' },
          startDate: { type: 'number' },
          durationDays: { type: 'number' },
        },
      },
    },
    required: ['agency', 'workType', 'segments', 'startDate', 'durationDays', 'isEmergency'],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: requestSchema,
            temperature: 0.1,
          },
        }),
      }
    );
    clearTimeout(timeout);

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      return res.status(200).json({ useFallback: true, error: `Gemini HTTP ${apiRes.status}: ${errText}` });
    }

    const data = await apiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(200).json({ useFallback: true, error: 'Empty Gemini response' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      return res.status(200).json({ useFallback: true, error: `JSON parse: ${e.message}` });
    }

    const { validSegments, flags } = validate(parsed, streetNames);

    const work = {
      id: `ai-${Date.now()}`,
      agency: parsed.agency ?? 'UNKNOWN',
      workType: parsed.workType ?? 'Utility Works',
      segments: validSegments,
      startDate: parsed.startDate,
      durationDays: Math.round(parsed.durationDays ?? 7),
      trenchLengthM: parsed.trenchLengthM ?? 100,
      trenchWidthM: parsed.trenchWidthM ?? 0.6,
      isEmergency: !!parsed.isEmergency,
      rawText: text,
      source: 'ai',
      flags,
    };

    return res.status(200).json({
      work,
      flags,
      redactedText: didRedact ? redactedText : null,
      source: 'ai',
      useFallback: false,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === 'AbortError';
    return res.status(200).json({
      useFallback: true,
      error: isTimeout ? 'Gemini API timeout (8s)' : String(err),
    });
  }
}
