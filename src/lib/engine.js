/**
 * engine.js — Pure functions for DigOnce conflict detection and planning.
 * NO AI calls. All deterministic. Judges verify this module.
 */
import * as turf from '@turf/turf';

// ─── Road loading ────────────────────────────────────────────────────────────

/**
 * Parse a roads GeoJSON into a name→features map and sorted street list.
 * @param {object} geojson - GeoJSON FeatureCollection
 * @returns {{ roadsByName: Object.<string, import('@turf/turf').Feature[]>, streetNames: string[] }}
 */
export function loadRoads(geojson) {
  const roadsByName = {};
  const features = geojson?.features ?? [];
  for (const f of features) {
    const geomType = f?.geometry?.type;
    if (geomType !== 'LineString' && geomType !== 'MultiLineString') continue;
    const name = f?.properties?.name;
    if (!name || typeof name !== 'string') continue;
    if (!roadsByName[name]) roadsByName[name] = [];
    roadsByName[name].push(f);
  }
  const streetNames = Object.keys(roadsByName).sort();
  return { roadsByName, streetNames };
}

// ─── Work geometry ────────────────────────────────────────────────────────────

/**
 * Get a FeatureCollection of geometries for a work's segments.
 * @param {object} work
 * @param {object} roadsByName
 * @returns {import('@turf/turf').FeatureCollection}
 */
export function workGeometry(work, roadsByName) {
  const features = [];
  for (const seg of work.segments ?? []) {
    const roadFeatures = roadsByName[seg] ?? [];
    features.push(...roadFeatures);
  }
  return turf.featureCollection(features);
}

// ─── Overlap detection ────────────────────────────────────────────────────────

/**
 * Check if two works share space (same segment name OR buffered line intersection).
 * @param {object} a - Work A
 * @param {object} b - Work B
 * @param {object} roadsByName
 * @param {number} bufferM - Buffer in metres
 * @returns {boolean}
 */
export function overlapSpace(a, b, roadsByName, bufferM = 30) {
  // Fast path: shared segment name
  const segA = new Set(a.segments ?? []);
  const segB = new Set(b.segments ?? []);
  for (const s of segA) {
    if (segB.has(s)) return true;
  }
  // Geometric check via buffer intersection
  try {
    const fcA = workGeometry(a, roadsByName);
    const fcB = workGeometry(b, roadsByName);
    for (const fA of fcA.features) {
      const bufA = turf.buffer(fA, bufferM, { units: 'meters' });
      if (!bufA) continue;
      for (const fB of fcB.features) {
        const bufB = turf.buffer(fB, bufferM, { units: 'meters' });
        if (!bufB) continue;
        if (turf.booleanIntersects(bufA, bufB)) return true;
      }
    }
  } catch (_e) {
    return false;
  }
  return false;
}

/**
 * Check if two works overlap in time within the configured window.
 * @param {object} a
 * @param {object} b
 * @param {number} windowDays
 * @returns {boolean}
 */
export function overlapTime(a, b, windowDays = 60) {
  const msPerDay = 86400000;
  const startA = new Date(a.startDate).getTime();
  const startB = new Date(b.startDate).getTime();
  return Math.abs(startA - startB) / msPerDay <= windowDays;
}

// ─── Clustering (Union-Find) ──────────────────────────────────────────────────

/**
 * Build clusters of works that overlap in space AND time.
 * Returns only clusters with 2 or more works.
 * @param {object[]} works
 * @param {object} roadsByName
 * @param {{ windowDays: number, bufferM: number }} config
 * @returns {object[][]} Array of clusters (each cluster = array of works)
 */
export function buildClusters(works, roadsByName, config) {
  const { windowDays = 60, bufferM = 30 } = config;
  const n = works.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);

  function find(i) {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i, j) {
    const pi = find(i), pj = find(j);
    if (pi === pj) return;
    if (rank[pi] < rank[pj]) parent[pi] = pj;
    else if (rank[pi] > rank[pj]) parent[pj] = pi;
    else { parent[pj] = pi; rank[pi]++; }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        overlapTime(works[i], works[j], windowDays) &&
        overlapSpace(works[i], works[j], roadsByName, bufferM)
      ) {
        union(i, j);
      }
    }
  }

  // Group by root
  const groups = {};
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups[root]) groups[root] = [];
    groups[root].push(works[i]);
  }

  return Object.values(groups).filter((g) => g.length >= 2);
}

// ─── Cluster planning ─────────────────────────────────────────────────────────

/**
 * Plan a shared dig window for a cluster and compute savings.
 * @param {object[]} cluster
 * @param {{ restorationCostPerSqM: number, windowDays: number }} config
 * @returns {object} Plan details
 */
export function planCluster(cluster, config) {
  const { restorationCostPerSqM = 1500 } = config;

  const hasEmergency = cluster.some((w) => w.isEmergency);
  let sharedStart;
  if (hasEmergency) {
    // Earliest emergency start
    const emergencies = cluster.filter((w) => w.isEmergency);
    sharedStart = emergencies
      .map((w) => new Date(w.startDate))
      .reduce((a, b) => (a < b ? a : b));
  } else {
    // Latest start among all works (everyone waits for the latest)
    sharedStart = cluster
      .map((w) => new Date(w.startDate))
      .reduce((a, b) => (a > b ? a : b));
  }

  const longestDuration = Math.max(...cluster.map((w) => w.durationDays ?? 7));
  const sharedDuration = longestDuration + 2; // +2 days buffer

  const totalDays = cluster.reduce((sum, w) => sum + (w.durationDays ?? 7), 0);
  const daysSaved = Math.max(0, totalDays - sharedDuration);

  // Savings: (n-1) individual restorations saved
  // Use smallest trench area as conservative estimate of the repeated area
  const areas = cluster.map(
    (w) => (w.trenchLengthM ?? 50) * (w.trenchWidthM ?? 0.6)
  );
  const minArea = Math.min(...areas);
  const n = cluster.length;
  const savingsRs = (n - 1) * minArea * restorationCostPerSqM;

  // All unique streets in the cluster
  const streets = [...new Set(cluster.flatMap((w) => w.segments ?? []))];

  // Piggyback alerts: if emergency, pull forward non-emergency works
  const piggyback = hasEmergency
    ? cluster
        .filter((w) => !w.isEmergency)
        .map((w) => ({
          workId: w.id,
          agency: w.agency,
          text: `Pull forward to join open trench on ${(w.segments ?? []).join(', ')} from ${fmt(sharedStart)}`,
        }))
    : [];

  const formulaText =
    `Savings = (${n}-1) × ${minArea.toFixed(1)} m² × ₹${restorationCostPerSqM}/m² = ₹${savingsRs.toLocaleString('en-IN')} | ` +
    `Days saved = max(0, ${totalDays} − ${sharedDuration}) = ${daysSaved}`;

  return {
    sharedStart: fmt(sharedStart),
    sharedDuration,
    savingsRs,
    daysSaved,
    streets,
    hasEmergency,
    piggyback,
    formulaText,
    agencies: [...new Set(cluster.map((w) => w.agency))],
  };
}

/** Format date as YYYY-MM-DD */
function fmt(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}

// ─── Fresh-road alerts ────────────────────────────────────────────────────────

/**
 * Flag works that cut roads resurfaced within protectionMonths.
 * @param {object[]} works
 * @param {object} segmentMeta - street name → { resurfacedOn: "YYYY-MM-DD" }
 * @param {{ protectionMonths: number, restorationCostPerSqM: number }} config
 * @returns {object[]} Alert objects
 */
export function freshRoadAlerts(works, segmentMeta, config) {
  const { protectionMonths = 12, restorationCostPerSqM = 1500 } = config;
  const alerts = [];

  for (const work of works) {
    for (const street of work.segments ?? []) {
      const meta = segmentMeta?.[street];
      if (!meta?.resurfacedOn) continue;
      const resurfaced = new Date(meta.resurfacedOn);
      const start = new Date(work.startDate);
      const monthsSince =
        (start.getFullYear() - resurfaced.getFullYear()) * 12 +
        (start.getMonth() - resurfaced.getMonth());
      if (monthsSince < protectionMonths) {
        const area = (work.trenchLengthM ?? 50) * (work.trenchWidthM ?? 0.6);
        alerts.push({
          workId: work.id,
          street,
          monthsSince,
          estCostRs: area * restorationCostPerSqM,
          agency: work.agency,
        });
      }
    }
  }

  return alerts;
}

// ─── Totals ───────────────────────────────────────────────────────────────────

/**
 * Aggregate headline numbers for the dashboard banner.
 * @param {object[][]} clusters
 * @param {object[]} plans
 * @param {object[]} alerts
 * @returns {{ totalSavingsRs, totalDaysSaved, numConflicts, numFreshRoadViolations }}
 */
export function totals(clusters, plans, alerts) {
  const totalSavingsRs = plans.reduce((s, p) => s + (p.savingsRs ?? 0), 0);
  const totalDaysSaved = plans.reduce((s, p) => s + (p.daysSaved ?? 0), 0);
  return {
    totalSavingsRs,
    totalDaysSaved,
    numConflicts: clusters.length,
    numFreshRoadViolations: alerts.length,
  };
}
