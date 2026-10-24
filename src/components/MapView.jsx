import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Popup,
  useMap,
} from 'react-leaflet';

// Leaflet is loaded globally from CDN (index.html)
const L = typeof window !== 'undefined' ? window.L : null;

// ─── Agency colour map ────────────────────────────────────────────────────────

const AGENCY_COLORS = {
  BWSSB: '#3b82f6',    // blue
  BESCOM: '#eab308',   // yellow
  GAIL: '#a855f7',     // purple
  TELECOM: '#22c55e',  // green
  BBMP: '#b45309',     // amber-brown
  UNKNOWN: '#94a3b8',  // slate
};

// ─── FlyTo helper ─────────────────────────────────────────────────────────────

function FlyToFocus({ focus, roadsByName }) {
  const map = useMap();
  useEffect(() => {
    if (!focus || !roadsByName || !L) return;
    const coords = [];
    for (const seg of focus.segments ?? []) {
      for (const f of roadsByName[seg] ?? []) {
        if (f?.geometry?.type === 'LineString') {
          coords.push(...f.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
        }
      }
    }
    if (coords.length > 0) {
      map.flyToBounds(L.latLngBounds(coords), { padding: [60, 60], maxZoom: 17, duration: 1 });
    }
  }, [focus, map, roadsByName]);
  return null;
}

// ─── FitBounds on load ────────────────────────────────────────────────────────

function FitBoundsOnLoad({ roadsByName }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !roadsByName || !L) return;
    const allCoords = [];
    for (const features of Object.values(roadsByName)) {
      for (const f of features) {
        if (f?.geometry?.type === 'LineString') {
          allCoords.push(...f.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
        }
      }
    }
    if (allCoords.length > 0) {
      map.fitBounds(L.latLngBounds(allCoords), { padding: [20, 20] });
      done.current = true;
    }
  }, [roadsByName, map]);
  return null;
}

// ─── Road polylines (thin grey base layer) ────────────────────────────────────

function RoadLines({ roadsByName }) {
  return useMemo(() => {
    const lines = [];
    let i = 0;
    for (const [, features] of Object.entries(roadsByName ?? {})) {
      for (const f of features) {
        if (f?.geometry?.type !== 'LineString') continue;
        const positions = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        lines.push(
          <Polyline
            key={`road-${i++}`}
            positions={positions}
            pathOptions={{ color: '#475569', weight: 1.5, opacity: 0.4 }}
          />
        );
      }
    }
    return <>{lines}</>;
  }, [roadsByName]);
}

// ─── Work polylines ───────────────────────────────────────────────────────────
// Each clustered work renders TWO stacked polylines:
//   1) A solid agency-coloured line  → so agency colour is ALWAYS visible
//   2) A wider red dashed stroke on top → indicates conflict cluster membership
// Fresh-road violations add an orange outline on top of the agency colour.

function WorkLines({ works, roadsByName, clusters, freshAlerts, onWorkClick }) {
  const clusteredWorkIds = useMemo(() => {
    const set = new Set();
    for (const cluster of clusters ?? []) {
      for (const w of cluster) set.add(w.id);
    }
    return set;
  }, [clusters]);

  const freshWorkIds = useMemo(() => {
    const set = new Set();
    for (const a of freshAlerts ?? []) set.add(a.workId);
    return set;
  }, [freshAlerts]);

  return useMemo(() => {
    const lines = [];

    for (const work of works ?? []) {
      const isClustered = clusteredWorkIds.has(work.id);
      const isFresh = freshWorkIds.has(work.id);

      // Agency colour is ALWAYS the base — never overridden
      const agencyColor = AGENCY_COLORS[work.agency] ?? AGENCY_COLORS.UNKNOWN;

      const featuresList = [];
      for (const seg of work.segments ?? []) {
        featuresList.push(...(roadsByName?.[seg] ?? []));
      }

      // Shared popup
      const popupContent = (
        <Popup>
          <div style={{ minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{
                background: agencyColor,
                color: agencyColor === '#eab308' ? '#000' : '#fff',
                fontWeight: 700, borderRadius: 4, padding: '2px 8px', fontSize: 12,
              }}>
                {work.agency}
              </span>
              {work.isEmergency && (
                <span style={{ background: '#7f1d1d', color: '#fca5a5', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 700 }}>
                  🚨 EMERGENCY
                </span>
              )}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{work.workType}</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 2 }}>
              📍 {(work.segments ?? []).join(', ')}
            </div>
            <div style={{ fontSize: 12, marginBottom: 2 }}>
              📅 {work.startDate} · {work.durationDays} days
            </div>
            <div style={{ fontSize: 12 }}>
              📐 {work.trenchLengthM}m × {work.trenchWidthM}m
            </div>
            {isClustered && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#f87171', fontWeight: 600 }}>
                ⚠ In conflict cluster — red dashed outline shown
              </div>
            )}
            {isFresh && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#fb923c', fontWeight: 600 }}>
                🟠 Fresh road violation
              </div>
            )}
          </div>
        </Popup>
      );

      for (const f of featuresList) {
        if (f?.geometry?.type !== 'LineString') continue;
        const positions = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const uid = `${work.id}-${f?.properties?.name ?? Math.random()}`;

        // ── LAYER A: Red dashed BACKGROUND ring (drawn first = below) for clustered ──
        // Wider than the agency line so dashes appear as a "halo"
        if (isClustered) {
          lines.push(
            <Polyline
              key={`ring-${uid}`}
              positions={positions}
              pathOptions={{
                color: '#ef4444',
                weight: 11,
                opacity: 0.7,
                dashArray: '12 8',
                lineCap: 'round',
                lineJoin: 'round',
              }}
              eventHandlers={{ click: () => onWorkClick?.(work) }}
            />
          );
        }

        // ── LAYER B: Orange background ring for fresh-road violations ──────────
        if (isFresh && !isClustered) {
          lines.push(
            <Polyline
              key={`fresh-ring-${uid}`}
              positions={positions}
              pathOptions={{
                color: '#f97316',
                weight: 11,
                opacity: 0.6,
                dashArray: '1 0',
                lineCap: 'round',
              }}
              eventHandlers={{ click: () => onWorkClick?.(work) }}
            />
          );
        }

        // ── LAYER C: Agency-colour SOLID line (always on top, always visible) ──
        lines.push(
          <Polyline
            key={`agency-${uid}`}
            positions={positions}
            pathOptions={{
              color: agencyColor,
              weight: 6,
              opacity: 1,
              lineCap: 'round',
              lineJoin: 'round',
            }}
            eventHandlers={{ click: () => onWorkClick?.(work) }}
          >
            {popupContent}
          </Polyline>
        );
      }
    }

    return <>{lines}</>;
  }, [works, roadsByName, clusteredWorkIds, freshWorkIds, onWorkClick]);
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  const entries = [
    { color: AGENCY_COLORS.BWSSB,   label: 'BWSSB Water',         solid: true  },
    { color: AGENCY_COLORS.BESCOM,  label: 'BESCOM Power',         solid: true  },
    { color: AGENCY_COLORS.GAIL,    label: 'GAIL Gas',             solid: true  },
    { color: AGENCY_COLORS.TELECOM, label: 'TELECOM Fibre',        solid: true  },
    { color: AGENCY_COLORS.BBMP,    label: 'BBMP Drains',          solid: true  },
    { color: '#ef4444',             label: 'Conflict cluster halo', dash: true   },
    { color: '#f97316',             label: 'Fresh-road violation',  solid: true  },
    { color: '#475569',             label: 'Road network',          solid: true  },
  ];

  return (
    <div style={{
      position: 'absolute', bottom: 28, right: 10, zIndex: 1000,
      background: 'rgba(15,23,42,0.93)', border: '1px solid #334155',
      borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#f1f5f9',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        fontWeight: 700, marginBottom: 8, fontSize: 10,
        letterSpacing: '0.08em', color: '#64748b', textTransform: 'uppercase',
      }}>
        LEGEND
      </div>

      {entries.map(({ color, label, dash }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <svg width="30" height="8" style={{ flexShrink: 0 }}>
            <line
              x1="2" y1="4" x2="28" y2="4"
              stroke={color}
              strokeWidth={dash ? 5 : 4}
              strokeDasharray={dash ? '8 5' : undefined}
              strokeLinecap="round"
            />
          </svg>
          <span style={{ fontSize: 12 }}>{label}</span>
        </div>
      ))}

      {/* Explainer for layered rendering */}
      <div style={{
        marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e293b',
        fontSize: 10, color: '#475569', lineHeight: 1.4,
      }}>
        Clustered works show agency<br />colour + red dashed halo
      </div>
    </div>
  );
}

// ─── Main MapView ─────────────────────────────────────────────────────────────

export default function MapView({ roadsByName, works, clusters, freshAlerts, focus, onWorkClick }) {
  const centre = [12.9716, 77.5946];

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={centre}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        attributionControl={true}
      >
        {/* Stadia Maps dark tiles: free on localhost, true dark basemap */}
        <TileLayer
          url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          maxZoom={20}
        />
        <FitBoundsOnLoad roadsByName={roadsByName} />
        <FlyToFocus focus={focus} roadsByName={roadsByName} />
        <RoadLines roadsByName={roadsByName} />
        <WorkLines
          works={works}
          roadsByName={roadsByName}
          clusters={clusters}
          freshAlerts={freshAlerts}
          onWorkClick={onWorkClick}
        />
      </MapContainer>
      <Legend />
    </div>
  );
}
