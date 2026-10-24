import { useState, useRef } from 'react';
import { fallbackParse } from '../lib/fallbackParser.js';

const AGENCIES = ['BWSSB', 'BESCOM', 'GAIL', 'TELECOM', 'BBMP', 'UNKNOWN'];
const WORK_TYPES = [
  'Pipeline Replacement', 'Pipeline Laying', 'Underground Cabling',
  'OFC Laying', 'Gas Pipeline Installation', 'Drain Rehabilitation',
  'Emergency Burst Pipe Repair', 'Emergency Gas Leak Repair',
  'Emergency Repair', 'Utility Works',
];

function Badge({ source }) {
  if (source === 'ai') return <span className="badge badge-ai">✦ AI</span>;
  if (source === 'fallback') return <span className="badge badge-fallback">⚡ Fallback Parser</span>;
  if (source === 'cached') return <span className="badge badge-cached">◉ Cached</span>;
  return null;
}

function SegmentChips({ segments, streetNames, onChange, flags }) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');

  const rejectedSet = new Set(
    (flags ?? [])
      .filter((f) => f.startsWith('rejected_street:'))
      .map((f) => f.replace('rejected_street:', ''))
  );
  const fuzzyMap = {};
  for (const f of flags ?? []) {
    const m = f.match(/^fuzzy_match:(.+)->(.+)$/);
    if (m) fuzzyMap[m[2]] = m[1];
  }

  const filtered = streetNames.filter(
    (s) => !segments.includes(s) && s.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {segments.map((seg) => {
          const isRejected = rejectedSet.has(seg);
          const isFuzzy = !!fuzzyMap[seg];
          const chipClass = isRejected ? 'chip chip-error' : isFuzzy ? 'chip chip-warn' : 'chip';
          return (
            <span key={seg} className={chipClass} title={isFuzzy ? `Fuzzy match for: ${fuzzyMap[seg]}` : undefined}>
              {seg}
              {isFuzzy && <span style={{ fontSize: 10, color: '#fcd34d', marginLeft: 2 }}>~</span>}
              <span className="chip-remove" onClick={() => onChange(segments.filter((s) => s !== seg))}>×</span>
            </span>
          );
        })}
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(!adding)} type="button">
          + Add street
        </button>
      </div>
      {adding && (
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 8 }}>
          <input
            className="input"
            placeholder="Search streets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
            {filtered.slice(0, 50).map((s) => (
              <div
                key={s}
                onClick={() => { onChange([...segments, s]); setAdding(false); setSearch(''); }}
                style={{
                  padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 12,
                  color: '#f1f5f9', transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#1e293b'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                {s}
              </div>
            ))}
            {filtered.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12, padding: 6 }}>No streets found</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function FlagList({ flags }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      {flags.map((f) => (
        <div key={f} style={{
          fontSize: 11, padding: '4px 8px', borderRadius: 4, marginBottom: 4,
          background: f.startsWith('rejected') ? '#1c0606' : '#1c1306',
          color: f.startsWith('rejected') ? '#f87171' : '#fcd34d',
          border: `1px solid ${f.startsWith('rejected') ? '#7f1d1d' : '#78350f'}`,
          fontFamily: 'monospace',
        }}>
          ⚑ {f}
        </div>
      ))}
    </div>
  );
}

export default function Intake({ streetNames, sampleNotices, onConfirm }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState(null); // { work, flags, redactedText, source }
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef(null);

  const handleSample = (notice) => {
    setText(notice.text);
    setResult(null);
    setSaved(false);
  };

  const handleParse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    setResult(null);
    setSaved(false);

    const today = new Date().toISOString().slice(0, 10);
    let finalResult = null;

    // 1) Try AI
    try {
      const resp = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, streetNames, today }),
      });
      const data = await resp.json();
      if (!data.useFallback) {
        finalResult = data;
      }
    } catch (_e) {
      // network error → fall through
    }

    // 2) Fallback parser
    if (!finalResult) {
      const fb = fallbackParse(text, streetNames);
      if (fb.work.agency !== 'UNKNOWN' || fb.work.segments.length > 0) {
        finalResult = fb;
      }
    }

    // 3) Cached parse from sample notices
    if (!finalResult) {
      const matchingSample = sampleNotices.find((s) => s.text.trim() === text.trim());
      if (matchingSample?.cachedParse) {
        finalResult = {
          work: { id: `cached-${Date.now()}`, ...matchingSample.cachedParse, rawText: text, flags: matchingSample.cachedParse.flags ?? [] },
          flags: matchingSample.cachedParse.flags ?? [],
          redactedText: null,
          source: 'cached',
        };
      }
    }

    // 4) Worst-case: return fallback anyway
    if (!finalResult) {
      finalResult = fallbackParse(text, streetNames);
    }

    setResult(finalResult);
    setParsing(false);
  };

  const handleConfirm = () => {
    if (!result?.work) return;
    onConfirm(result.work);
    setSaved(true);
    setText('');
    setResult(null);
  };

  const updateWork = (field, value) => {
    setResult((prev) => ({
      ...prev,
      work: { ...prev.work, [field]: value },
    }));
  };

  const hasWarning = (field) => {
    if (!result) return false;
    return (result.flags ?? []).some(
      (f) =>
        f.includes(field) ||
        (field === 'segments' && (f.startsWith('rejected_street') || f.startsWith('fuzzy_match')))
    );
  };

  return (
    <div>
      <div className="section-title">
        <span>📋</span> Notice Intake
      </div>

      {/* Sample buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {sampleNotices.map((s) => (
          <button key={s.id} className="btn btn-secondary btn-sm" onClick={() => handleSample(s)} type="button">
            {s.label}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className="input"
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); setSaved(false); }}
        placeholder="Paste a work notice here… (English, Kannada, Hindi, or mixed)"
        rows={5}
        style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          className="btn btn-primary"
          onClick={handleParse}
          disabled={parsing || !text.trim()}
          id="parse-btn"
          type="button"
        >
          {parsing ? <><span className="spinner" /> Parsing…</> : '⚡ Parse Notice'}
        </button>
        {result && (
          <button
            className="btn btn-secondary"
            onClick={() => { setResult(null); }}
            type="button"
          >
            Clear
          </button>
        )}
      </div>

      {/* Result preview */}
      {result && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Parsed Preview</div>
            <Badge source={result.source} />
          </div>

          {/* Redacted text notice */}
          {result.redactedText && (
            <div style={{
              background: '#1c1306', border: '1px solid #78350f', borderRadius: 6,
              padding: '8px 10px', marginBottom: 10, fontSize: 11, color: '#fcd34d',
            }}>
              🔒 PII redacted before AI processing
              <div style={{ fontFamily: 'monospace', marginTop: 4, color: '#94a3b8', whiteSpace: 'pre-wrap', fontSize: 10 }}>
                {result.redactedText}
              </div>
            </div>
          )}

          {/* Editable fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* Agency */}
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Agency</label>
              <select
                className={`input ${hasWarning('agency') ? 'input-warn' : ''}`}
                value={result.work.agency}
                onChange={(e) => updateWork('agency', e.target.value)}
              >
                {AGENCIES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>

            {/* Work Type */}
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Work Type</label>
              <select
                className="input"
                value={result.work.workType}
                onChange={(e) => updateWork('workType', e.target.value)}
              >
                {WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Start Date */}
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Start Date</label>
              <input
                type="date"
                className={`input ${hasWarning('date') ? 'input-warn' : ''}`}
                value={result.work.startDate ?? ''}
                onChange={(e) => updateWork('startDate', e.target.value)}
              />
            </div>

            {/* Duration */}
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Duration (days)</label>
              <input
                type="number"
                className={`input ${hasWarning('duration') ? 'input-warn' : ''}`}
                value={result.work.durationDays ?? ''}
                min={1} max={365}
                onChange={(e) => updateWork('durationDays', +e.target.value)}
              />
            </div>

            {/* Trench Length */}
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Trench Length (m)</label>
              <input
                type="number"
                className="input"
                value={result.work.trenchLengthM ?? ''}
                min={1}
                onChange={(e) => updateWork('trenchLengthM', +e.target.value)}
              />
            </div>

            {/* Trench Width */}
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Trench Width (m)</label>
              <input
                type="number"
                className="input"
                value={result.work.trenchWidthM ?? ''}
                min={0.1} step={0.1}
                onChange={(e) => updateWork('trenchWidthM', +e.target.value)}
              />
            </div>
          </div>

          {/* Segments */}
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Streets / Segments</label>
            <SegmentChips
              segments={result.work.segments ?? []}
              streetNames={streetNames}
              flags={result.flags}
              onChange={(segs) => updateWork('segments', segs)}
            />
          </div>

          {/* Emergency checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={!!result.work.isEmergency}
              onChange={(e) => updateWork('isEmergency', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#ef4444' }}
            />
            <span>Emergency work</span>
            {result.work.isEmergency && <span style={{ color: '#f87171' }}>🚨</span>}
          </label>

          {/* Flags */}
          <FlagList flags={result.flags} />

          {/* Confirm */}
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={saved}
              id="confirm-add-btn"
              type="button"
            >
              {saved ? '✓ Added to map' : '✚ Confirm & add to map'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
