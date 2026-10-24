/**
 * demoData.js — Generates synthetic demo data at runtime from real OSM street names.
 * All dates are relative to today so the app never becomes stale.
 */

/** Add N days to a Date, return YYYY-MM-DD string */
function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Subtract N months from a Date, return YYYY-MM-DD string */
function subMonths(base, n) {
  const d = new Date(base);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Seed 7 canonical works whose clustering behaviour the judges will verify.
 * @param {string[]} streetNames - real OSM street names loaded from roads.geojson
 * @returns {object[]}
 */
export function seedWorks(streetNames) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Ensure we have at least 4 distinct streets
  const s = streetNames;
  if (s.length < 4) throw new Error('roads.geojson has fewer than 4 named streets');

  return [
    // (a) BWSSB pipeline on street[0], +12 days, 10 days duration
    {
      id: 'seed-001',
      agency: 'BWSSB',
      workType: 'Pipeline Replacement',
      segments: [s[0]],
      startDate: addDays(today, 12),
      durationDays: 10,
      trenchLengthM: 200,
      trenchWidthM: 0.8,
      isEmergency: false,
      rawText: `BWSSB pipeline replacement on ${s[0]}, starting ${addDays(today, 12)}, 10 days, 200 m stretch`,
      source: 'seed',
      flags: [],
    },
    // (b) BESCOM cable on street[0], +27 days → clusters with (a)
    {
      id: 'seed-002',
      agency: 'BESCOM',
      workType: 'Underground Cabling',
      segments: [s[0]],
      startDate: addDays(today, 27),
      durationDays: 6,
      trenchLengthM: 150,
      trenchWidthM: 0.6,
      isEmergency: false,
      rawText: `BESCOM underground cable laying on ${s[0]}, from ${addDays(today, 27)}, 6 days`,
      source: 'seed',
      flags: [],
    },
    // (c) TELECOM fiber on street[1], +20 days, 4 days
    {
      id: 'seed-003',
      agency: 'TELECOM',
      workType: 'OFC Laying',
      segments: [s[1]],
      startDate: addDays(today, 20),
      durationDays: 4,
      trenchLengthM: 120,
      trenchWidthM: 0.4,
      isEmergency: false,
      rawText: `Telecom OFC laying on ${s[1]}, planned ${addDays(today, 20)}, 4 days, 120 m`,
      source: 'seed',
      flags: [],
    },
    // (d) EMERGENCY BWSSB burst-pipe on street[1], +1 day → clusters with (c), triggers Piggyback
    {
      id: 'seed-004',
      agency: 'BWSSB',
      workType: 'Emergency Burst Pipe Repair',
      segments: [s[1]],
      startDate: addDays(today, 1),
      durationDays: 3,
      trenchLengthM: 40,
      trenchWidthM: 0.6,
      isEmergency: true,
      rawText: `URGENT: BWSSB emergency burst pipe repair on ${s[1]}, starting ${addDays(today, 1)}, 3 days`,
      source: 'seed',
      flags: [],
    },
    // (e) GAIL gas on street[2], +5 days, 8 days
    {
      id: 'seed-005',
      agency: 'GAIL',
      workType: 'Gas Pipeline Installation',
      segments: [s[2]],
      startDate: addDays(today, 5),
      durationDays: 8,
      trenchLengthM: 300,
      trenchWidthM: 1.0,
      isEmergency: false,
      rawText: `GAIL gas pipeline installation on ${s[2]}, from ${addDays(today, 5)}, 8 days`,
      source: 'seed',
      flags: [],
    },
    // (f) BBMP drain on street[2], exactly 61 days after (e) → must NOT cluster (window=60)
    {
      id: 'seed-006',
      agency: 'BBMP',
      workType: 'Drain Rehabilitation',
      segments: [s[2]],
      startDate: addDays(today, 66), // 66 - 5 = 61 days after seed-005
      durationDays: 5,
      trenchLengthM: 180,
      trenchWidthM: 0.7,
      isEmergency: false,
      rawText: `BBMP drain rehabilitation on ${s[2]}, from ${addDays(today, 66)}, 5 days`,
      source: 'seed',
      flags: [],
    },
    // (g) BESCOM cable on street[3], +9 days → street[3] resurfaced 4 months ago → Fresh-Road Guard
    {
      id: 'seed-007',
      agency: 'BESCOM',
      workType: 'Underground Cabling',
      segments: [s[3]],
      startDate: addDays(today, 9),
      durationDays: 3,
      trenchLengthM: 80,
      trenchWidthM: 0.6,
      isEmergency: false,
      rawText: `BESCOM cable laying on ${s[3]}, starting ${addDays(today, 9)}, 3 days, 80 m`,
      source: 'seed',
      flags: [],
    },
  ];
}

/**
 * Segment metadata: resurfacedOn dates for streets[0..7].
 * street[3] = resurfaced 4 months ago (triggers Fresh-Road Guard with 12-month protection).
 * Others: 14–30 months ago.
 * @param {string[]} streetNames
 * @returns {Object.<string, { resurfacedOn: string }>}
 */
export function segmentMeta(streetNames) {
  const today = new Date();
  const meta = {};
  const monthsAgo = [18, 24, 22, 4, 16, 30, 14, 20];
  for (let i = 0; i < Math.min(8, streetNames.length); i++) {
    meta[streetNames[i]] = { resurfacedOn: subMonths(today, monthsAgo[i]) };
  }
  return meta;
}

/**
 * Five messy realistic notices for the Intake demo buttons.
 * Each includes a `cachedParse` for offline fallback.
 * @param {string[]} streetNames
 * @returns {object[]}
 */
export function sampleNotices(streetNames) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Compute "5th of next month"
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(5);
  const nextMonthStr = nextMonth.toISOString().slice(0, 10);

  // Tomorrow string
  const tomorrow = addDays(today, 1);

  // Misspelled version of streetNames[5]: drop a letter and change Road→Rd
  const s5real = streetNames[5] ?? 'Hosur Road';
  // Create a misspelled variant
  const s5words = s5real.split(' ');
  const s5misspelled =
    s5words
      .map((w, i) =>
        i === 0 && w.length > 3
          ? w.slice(0, -1) // drop last letter of first word
          : w.replace(/^Road$/i, 'Rd')
      )
      .join(' ') + (s5real.toLowerCase().includes('road') ? '' : ' Rd');

  // A street definitely NOT in the list
  const absentStreet = 'Mysore Road';

  return [
    // 1) English, BWSSB pipeline on street[4], "from 5th of next month approx 2 weeks"
    {
      id: 'sample-1',
      label: 'Sample 1',
      text:
        `Sir/Madam,\n\nThis is to inform that BWSSB will be laying new water supply pipeline along ${streetNames[4] ?? 'MG Road'} from 5th of next month approx 2 weeks. The stretch is approx 150 mtr. Trench width 0.8 m.\n\nContact: Mr. Ramesh Kumar, Site Engineer, +91 98450 12345\n\nBWSS Board`,
      cachedParse: {
        agency: 'BWSSB',
        workType: 'Pipeline Laying',
        segments: [streetNames[4] ?? 'MG Road'],
        startDate: nextMonthStr,
        durationDays: 14,
        trenchLengthM: 150,
        trenchWidthM: 0.8,
        isEmergency: false,
        confidence: { agency: 0.95, segments: 0.9, startDate: 0.85, durationDays: 0.8 },
        source: 'cached',
        flags: [],
      },
    },

    // 2) Kannada-English mix, BESCOM cable on street[0] → joins cluster (a)/(b)
    {
      id: 'sample-2',
      label: 'Sample 2',
      text:
        `BESCOM ವತಿಯಿಂದ ${streetNames[0] ?? 'Brigade Road'} ನಲ್ಲಿ underground cable ಕಾಮಗಾರಿ ` +
        `ನಡೆಸಲಾಗುವುದು. ದಿನಾಂಕ ${addDays(today, 30)} ರಿಂದ 7 ದಿನ. ` +
        `ಟ್ರೆಂಚ್ 100 ಮೀಟರ್, ಅಗಲ 0.6 ಮೀ.\nContact: +91 80123 45678`,
      cachedParse: {
        agency: 'BESCOM',
        workType: 'Underground Cabling',
        segments: [streetNames[0]],
        startDate: addDays(today, 30),
        durationDays: 7,
        trenchLengthM: 100,
        trenchWidthM: 0.6,
        isEmergency: false,
        confidence: { agency: 0.95, segments: 0.88, startDate: 0.92, durationDays: 0.9 },
        source: 'cached',
        flags: [],
      },
    },

    // 3) Hinglish with MISSPELLED street name of streetNames[5]
    {
      id: 'sample-3',
      label: 'Sample 3',
      text:
        `Namaste,\n\nHumara GAIL Gas ka kaam hoga ${s5misspelled} pe, approx 10 din, ` +
        `600 meter stretch. Trench 1.0 m wide. Shuru hoga ${addDays(today, 15)} se.\n` +
        `Contact: Shri Venkatesh, +91 99001 23456`,
      cachedParse: {
        agency: 'GAIL',
        workType: 'Gas Pipeline',
        segments: [s5real],
        startDate: addDays(today, 15),
        durationDays: 10,
        trenchLengthM: 600,
        trenchWidthM: 1.0,
        isEmergency: false,
        confidence: { agency: 0.9, segments: 0.65, startDate: 0.88, durationDays: 0.85 },
        source: 'cached',
        flags: [`fuzzy_match:${s5misspelled}->${s5real}`, 'low_confidence:segments'],
      },
    },

    // 4) Emergency gas leak on street[2]
    {
      id: 'sample-4',
      label: 'Sample 4',
      text:
        `URGENT: Gas leak detected on ${streetNames[2] ?? 'Outer Ring Road'}. ` +
        `GAIL emergency repair team mobilised immediately. Work starts tomorrow. ` +
        `Estimated 2 days to complete. 30 mtr affected stretch, trench 0.8 m wide. ` +
        `All traffic diversions in place.`,
      cachedParse: {
        agency: 'GAIL',
        workType: 'Emergency Gas Leak Repair',
        segments: [streetNames[2] ?? 'Outer Ring Road'],
        startDate: tomorrow,
        durationDays: 2,
        trenchLengthM: 30,
        trenchWidthM: 0.8,
        isEmergency: true,
        confidence: { agency: 0.97, segments: 0.92, startDate: 0.95, durationDays: 0.88 },
        source: 'cached',
        flags: [],
      },
    },

    // 5) Street NOT in list → must be rejected
    {
      id: 'sample-5',
      label: 'Sample 5',
      text:
        `BBMP proposes drain rehabilitation work on ${absentStreet}, Bengaluru. ` +
        `Work to commence ${addDays(today, 20)} for 7 days. Trench 200 m × 0.7 m.`,
      cachedParse: {
        agency: 'BBMP',
        workType: 'Drain Rehabilitation',
        segments: [],
        startDate: addDays(today, 20),
        durationDays: 7,
        trenchLengthM: 200,
        trenchWidthM: 0.7,
        isEmergency: false,
        confidence: { agency: 0.9, segments: 0.2, startDate: 0.88, durationDays: 0.85 },
        source: 'cached',
        flags: [`rejected_street:${absentStreet}`, 'unmatchedStreets:' + absentStreet],
      },
    },
  ];
}
