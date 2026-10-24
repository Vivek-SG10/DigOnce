import { useState, useEffect, useCallback, useMemo } from 'react';
import MapView from './components/MapView.jsx';
import Intake from './components/Intake.jsx';
import ClusterList from './components/ClusterList.jsx';
import { loadRoads, buildClusters, planCluster, freshRoadAlerts, totals } from './lib/engine.js';
import { seedWorks, segmentMeta, sampleNotices } from './lib/demoData.js';

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  restorationCostPerSqM: 1500,
  windowDays: 60,
  bufferM: 30,
  protectionMonths: 12,
};

const LS_WORKS = 'digonce_works';
const LS_META = 'digonce_meta';
const LS_CONFIG = 'digonce_config';

function loadConfig() {
  try {
    const s = localStorage.getItem(LS_CONFIG);
    return s ? { ...DEFAULT_CONFIG, ...JSON.parse(s) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfig(cfg) {
  localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
}

function fmtRs(n) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// ─── Assumptions panel ────────────────────────────────────────────────────────

function AssumptionsPanel({ config, onChange }) {
  const fields = [
    { key: 'restorationCostPerSqM', label: 'Restoration cost (₹/m²)', min: 100, max: 50000, step: 100 },
    { key: 'windowDays', label: 'Coordination window (days)', min: 1, max: 365, step: 1 },
    { key: 'bufferM', label: 'Spatial buffer (m)', min: 1, max: 500, step: 5 },
    { key: 'protectionMonths', label: 'Fresh-road protection (months)', min: 1, max: 60, step: 1 },
  ];

  return (
    <div>
      <div className="section-title"><span>⚙</span> Assumptions</div>
      <div style={{
        background: '#1c1306', border: '1px solid #78350f',
        borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#fcd34d',
      }}>
        ⚠ These are assumptions, not official rates. Changes take effect immediately.
      </div>
      {fields.map(({ key, label, min, max, step }) => (
        <div key={key} style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
            {label}
            <span style={{ fontSize: 10, color: '#78350f', marginLeft: 6, fontStyle: 'italic' }}>
              assumption, not official rate
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="range"
              min={min} max={max} step={step}
              value={config[key]}
              onChange={(e) => onChange({ ...config, [key]: +e.target.value })}
              style={{ flex: 1, accentColor: '#f59e0b' }}
            />
            <input
              type="number"
              className="input"
              min={min} max={max} step={step}
              value={config[key]}
              onChange={(e) => onChange({ ...config, [key]: +e.target.value })}
              style={{ width: 80 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Totals banner ────────────────────────────────────────────────────────────

function TotalsBanner({ stats }) {
  const items = [
    { value: fmtRs(stats.totalSavingsRs), label: 'Avoidable restoration cost', color: '#4ade80' },
    { value: `${stats.totalDaysSaved}`, label: 'Disruption-days avoidable', color: '#38bdf8' },
    { value: `${stats.numConflicts}`, label: 'Conflicts detected', color: '#f87171' },
    { value: `${stats.numFreshRoadViolations}`, label: 'Fresh-road violations', color: '#fb923c' },
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 1, background: '#334155', borderBottom: '1px solid #334155',
    }}>
      {items.map(({ value, label, color }) => (
        <div key={label} style={{ background: '#1e293b', padding: '12px 16px', textAlign: 'center' }}>
          <div className="stat-big" style={{ color }}>{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [roadsData, setRoadsData] = useState(null); // { roadsByName, streetNames }
  const [roadsError, setRoadsError] = useState(null);
  const [works, setWorks] = useState([]);
  const [meta, setMeta] = useState({});
  const [config, setConfig] = useState(loadConfig);
  const [focusWork, setFocusWork] = useState(null);
  const [notices, setNotices] = useState([]);

  // ── Load roads GeoJSON ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/data/roads.geojson')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((geojson) => {
        const data = loadRoads(geojson);
        if (data.streetNames.length === 0) {
          throw new Error('No named LineString features found in roads.geojson');
        }
        setRoadsData(data);
      })
      .catch((e) => setRoadsError(e.message));
  }, []);

  // ── Init / reset demo data ──────────────────────────────────────────────────
  const initDemoData = useCallback((streetNames) => {
    const sw = seedWorks(streetNames);
    const sm = segmentMeta(streetNames);
    const sn = sampleNotices(streetNames);
    localStorage.setItem(LS_WORKS, JSON.stringify(sw));
    localStorage.setItem(LS_META, JSON.stringify(sm));
    setWorks(sw);
    setMeta(sm);
    setNotices(sn);
  }, []);

  useEffect(() => {
    if (!roadsData) return;
    const { streetNames } = roadsData;

    // Try loading from localStorage
    try {
      const lsWorks = localStorage.getItem(LS_WORKS);
      const lsMeta = localStorage.getItem(LS_META);
      if (lsWorks && lsMeta) {
        setWorks(JSON.parse(lsWorks));
        setMeta(JSON.parse(lsMeta));
        setNotices(sampleNotices(streetNames));
        return;
      }
    } catch (_) {}

    initDemoData(streetNames);
  }, [roadsData, initDemoData]);

  // ── Persist config ──────────────────────────────────────────────────────────
  useEffect(() => { saveConfig(config); }, [config]);

  // ── Engine computation ──────────────────────────────────────────────────────
  const { clusters, plans, alerts, stats } = useMemo(() => {
    if (!roadsData || works.length === 0) {
      return {
        clusters: [], plans: [],
        alerts: [], stats: { totalSavingsRs: 0, totalDaysSaved: 0, numConflicts: 0, numFreshRoadViolations: 0 },
      };
    }
    const cls = buildClusters(works, roadsData.roadsByName, config);
    const pls = cls.map((cl) => planCluster(cl, config));
    const als = freshRoadAlerts(works, meta, config);
    const st = totals(cls, pls, als);
    return { clusters: cls, plans: pls, alerts: als, stats: st };
  }, [works, roadsData, meta, config]);

  // ── Add work from intake ────────────────────────────────────────────────────
  const handleConfirmWork = useCallback((work) => {
    setWorks((prev) => {
      const updated = [...prev, work];
      localStorage.setItem(LS_WORKS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Reset demo ──────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (!roadsData) return;
    localStorage.removeItem(LS_WORKS);
    localStorage.removeItem(LS_META);
    initDemoData(roadsData.streetNames);
  }, [roadsData, initDemoData]);

  // ── Render: loading / error states ─────────────────────────────────────────
  if (roadsError) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12, padding: 24,
      }}>
        <div style={{ fontSize: 40 }}>🗺</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>Failed to load roads.geojson</div>
        <div style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 13 }}>{roadsError}</div>
        <div style={{ color: '#64748b', fontSize: 12 }}>
          Make sure <code>public/data/roads.geojson</code> exists and contains named LineString features.
        </div>
      </div>
    );
  }

  if (!roadsData) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
      }}>
        <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
        <div style={{ color: '#94a3b8' }}>Loading roads…</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
        borderBottom: '1px solid #334155',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <div style={{
              fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em',
              background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              DigOnce
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: -2 }}>
              One trench. One repair. One disruption.
            </div>
          </div>
          <span className="badge badge-demo">
            Demo: synthetic works · real OSM streets
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: '#475569' }}>
            {roadsData.streetNames.length} streets · {works.length} works
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleReset} id="reset-demo-btn" type="button">
            ↺ Reset demo
          </button>
        </div>
      </header>

      {/* ── Totals banner ──────────────────────────────────────────────────── */}
      <TotalsBanner stats={stats} />

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', flex: 1, overflow: 'hidden',
        flexDirection: 'row',
      }}
        className="main-layout"
      >
        {/* Map 60% */}
        <div style={{ flex: '0 0 60%', overflow: 'hidden', position: 'relative' }}>
          <MapView
            roadsByName={roadsData.roadsByName}
            works={works}
            clusters={clusters}
            freshAlerts={alerts}
            focus={focusWork}
            onWorkClick={setFocusWork}
          />
        </div>

        {/* Right panel 40% */}
        <div style={{
          flex: '0 0 40%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          borderLeft: '1px solid #334155',
        }}>
          <div style={{ overflowY: 'auto', flex: 1, padding: 16 }}>

            {/* Intake */}
            <div style={{ marginBottom: 24 }}>
              <Intake
                streetNames={roadsData.streetNames}
                sampleNotices={notices}
                onConfirm={handleConfirmWork}
              />
            </div>

            <div style={{ borderTop: '1px solid #1e293b', marginBottom: 20 }} />

            {/* Conflicts + Fresh-road */}
            <div style={{ marginBottom: 24 }}>
              <ClusterList
                clusters={clusters}
                plans={plans}
                freshAlerts={alerts}
                works={works}
                config={config}
                onFocus={setFocusWork}
              />
            </div>

            <div style={{ borderTop: '1px solid #1e293b', marginBottom: 20 }} />

            {/* Assumptions */}
            <div style={{ marginBottom: 32 }}>
              <AssumptionsPanel config={config} onChange={setConfig} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Responsive breakpoint (<768px) ─────────────────────────────────── */}
      <style>{`
        @media (max-width: 768px) {
          .main-layout { flex-direction: column !important; }
          .main-layout > div:first-child { flex: 0 0 50vh !important; }
          .main-layout > div:last-child { flex: 1 !important; min-height: 0; }
        }
      `}</style>
    </div>
  );
}
