import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import L from '../lib/leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [40.7128, -74.0060];
const DEFAULT_ZOOM = 10;
const NEWEST_PULSES = 6;          // newest reports get an animated ring
const HOTSPOT_CELL_DEG = 0.008;   // ~800 m grid used to find the densest area
const LEGEND_COLLAPSED_ROWS = 4;  // compact legend shows the top types only
// All five boroughs; used for the opening view before any question is asked
const NYC_BOUNDS = [[40.4774, -74.2591], [40.9176, -73.7004]];

// Preferred colour per complaint family. Checked in order, so heat comes before
// water: NYC's "HEAT/HOT WATER" type contains the word "water".
const FAMILY_COLORS = [
  { keys: ['heat', 'hot water', 'boiler'],                           color: '#fb923c' }, // orange
  { keys: ['rodent', 'pest', 'rat'],                                 color: '#84cc16' }, // lime
  { keys: ['noise'],                                                 color: '#a78bfa' }, // violet
  { keys: ['water', 'sewer', 'flood', 'leak', 'drain'],              color: '#38bdf8' }, // sky
  { keys: ['sanit', 'dirty', 'garbage', 'trash', 'litter', 'waste'], color: '#f472b6' }, // pink
  { keys: ['traffic', 'parking', 'vehicle', 'driveway'],             color: '#facc15' }, // yellow
  { keys: ['electric', 'power', 'street light'],                     color: '#2dd4bf' }, // teal
  { keys: ['building', 'elevator', 'plumbing', 'paint', 'door'],     color: '#e2e8f0' }, // light grey
];
// Extra well-separated colours for additional types (e.g. two kinds of Noise)
const EXTRA_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#d946ef', '#f59e0b', '#14b8a6', '#fda4af', '#93c5fd', '#bef264', '#c4b5fd'];
const MAX_TYPES = 10;
const OTHER = { label: 'Other', color: '#64748b' };

const HEAT_GRADIENT = { 0.15: '#1e3a8a', 0.35: '#2563eb', 0.55: '#22d3ee', 0.75: '#facc15', 1.0: '#ef4444' };

function familyColor(type) {
  const t = (type || '').toLowerCase();
  const fam = FAMILY_COLORS.find(f => f.keys.some(k => t.includes(k)));
  return fam ? fam.color : null;
}

// Give each actual complaint type its own colour: most frequent types first,
// family colour when still free, otherwise the next unused extra colour.
function assignTypeColors(locations) {
  const counts = new Map();
  for (const loc of locations || []) {
    const t = loc?.type || 'Incident';
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const used = new Set();
  const map = new Map();
  ordered.slice(0, MAX_TYPES).forEach(type => {
    let color = familyColor(type);
    if (!color || used.has(color)) color = EXTRA_COLORS.find(c => !used.has(c)) || OTHER.color;
    used.add(color);
    map.set(type, { label: type, color });
  });
  return map;
}

// Deterministic jitter so stacked reports at one address separate slightly
// without markers jumping around on every re-render.
function jitter(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295 - 0.5) * 0.0004;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Bounds of the central 96% of points so one stray report doesn't zoom the map out to the whole region.
function robustBounds(points) {
  if (points.length < 20) return L.latLngBounds(points.map(p => [p.lat, p.lon]));
  const lats = points.map(p => p.lat).sort((a, b) => a - b);
  const lons = points.map(p => p.lon).sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  return L.latLngBounds([q(lats, 0.02), q(lons, 0.02)], [q(lats, 0.98), q(lons, 0.98)]);
}

function findHotspot(points) {
  if (points.length < 10) return null;
  const cells = new Map();
  for (const p of points) {
    const key = `${Math.floor(p.lat / HOTSPOT_CELL_DEG)}|${Math.floor(p.lon / HOTSPOT_CELL_DEG)}`;
    const c = cells.get(key) || { n: 0, lat: 0, lon: 0 };
    c.n += 1; c.lat += p.lat; c.lon += p.lon;
    cells.set(key, c);
  }
  let best = null;
  for (const c of cells.values()) if (!best || c.n > best.n) best = c;
  if (!best || best.n < 3) return null;
  return { lat: best.lat / best.n, lon: best.lon / best.n, count: best.n };
}

export default function MapChart({ locations, mapCenter, overview = false }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const layersRef = useRef({});
  const userMovedRef = useRef(false);
  const [mode, setMode] = useState('points');       // 'points' | 'heat'
  const [hidden, setHidden] = useState(() => new Set());
  const [legendOpen, setLegendOpen] = useState(false);

  const typeColors = useMemo(() => assignTypeColors(locations), [locations]);

  // Normalise incoming locations once per dataset
  const points = useMemo(() => {
    if (!Array.isArray(locations)) return [];
    const out = [];
    locations.forEach((loc, i) => {
      const lat = Number(loc?.lat);
      const lon = Number(loc?.lon);
      if (!isFinite(lat) || !isFinite(lon) || lat === 0 || lon === 0) return;
      const seed = `${lat},${lon},${i}`;
      const cls = typeColors.get(loc?.type || 'Incident') || OTHER;
      out.push({
        lat: lat + jitter(seed + 'a'),
        lon: lon + jitter(seed + 'b'),
        type: loc?.type || 'Incident',
        date: loc?.date,
        status: loc?.status,
        color: cls.color,
        label: cls.label,
        order: i,
      });
    });
    return out;
  }, [locations, typeColors]);

  const legend = useMemo(() => {
    const counts = new Map();
    for (const p of points) {
      const e = counts.get(p.label) || { label: p.label, color: p.color, count: 0 };
      e.count += 1;
      counts.set(p.label, e);
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [points]);

  const visible = useMemo(() => points.filter(p => !hidden.has(p.label)), [points, hidden]);

  // New dataset: show every category again and allow auto-framing
  useEffect(() => {
    setHidden(new Set());
    setLegendOpen(false);
    userMovedRef.current = false;
  }, [points]);

  const fitToData = useCallback((animate = true) => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    if (overview) {
      map.fitBounds(NYC_BOUNDS, { padding: [12, 12], animate });
      return;
    }
    const pts = visible.length ? visible : points;
    if (pts.length) {
      map.fitBounds(robustBounds(pts), { padding: [48, 48], maxZoom: 15, animate });
    } else {
      const center = mapCenter ? [mapCenter.lat, mapCenter.lon] : DEFAULT_CENTER;
      map.setView(center, mapCenter?.zoom || DEFAULT_ZOOM, { animate });
    }
  }, [visible, points, mapCenter, overview]);

  // Create the map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      worldCopyJump: false,
    });
    // Esri Dark Gray Canvas: keyless dark basemap (CARTO tiles now require an API key).
    // Darkened base + faded labels to match the original near-black CARTO look.
    const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
    L.tileLayer(`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap',
      maxZoom: 16,
      className: 'cp-basemap',
    }).addTo(map);
    L.tileLayer(`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 16,
      opacity: 0.4,
    }).addTo(map);

    layersRef.current = {
      // tolerance widens the hover/click hit area around the small canvas markers
      renderer: L.canvas({ padding: 0.5, tolerance: 7 }),
      points: L.layerGroup().addTo(map),
      overlay: L.layerGroup().addTo(map),
      heat: null,
    };

    // Stop auto-reframing once the user pans or zooms themselves
    const markUser = () => { userMovedRef.current = true; };
    map.on('dragstart', markUser);
    containerRef.current.addEventListener('wheel', markUser, { passive: true });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep the map sized to its panel (it mounts inside a flex layout that settles after first paint)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!mapRef.current) return;
      mapRef.current.invalidateSize();
      if (!userMovedRef.current) fitToData(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToData]);

  // Draw points / heat / hotspot / newest-report pulses
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers.points) return;

    layers.points.clearLayers();
    layers.overlay.clearLayers();
    if (layers.heat) { map.removeLayer(layers.heat); layers.heat = null; }

    if (mode === 'heat') {
      layers.heat = L.heatLayer(visible.map(p => [p.lat, p.lon, 0.6]), {
        radius: 18, blur: 22, minOpacity: 0.25, maxZoom: 15, gradient: HEAT_GRADIENT,
      }).addTo(map);
    } else {
      for (const p of visible) {
        // Soft halo + bright core reads as a glow on the dark basemap
        L.circleMarker([p.lat, p.lon], {
          renderer: layers.renderer, radius: 9, stroke: false,
          fillColor: p.color, fillOpacity: 0.12, interactive: false,
        }).addTo(layers.points);
        const core = L.circleMarker([p.lat, p.lon], {
          renderer: layers.renderer, radius: 3.5, weight: 1,
          color: '#0b0b14', fillColor: p.color, fillOpacity: 0.95,
        });
        core.bindTooltip(escapeHtml(p.type), { direction: 'top', offset: [0, -6], className: 'cp-tip' });
        const when = formatDate(p.date);
        const status = p.status ? `<span class="cp-pop-status ${String(p.status).toLowerCase() === 'closed' ? 'closed' : 'open'}">${escapeHtml(p.status)}</span>` : '';
        core.bindPopup(`
          <div class="cp-pop">
            <div class="cp-pop-head"><span class="cp-pop-dot" style="background:${p.color}"></span>${escapeHtml(p.type)}</div>
            ${when ? `<div class="cp-pop-row">Reported <b>${escapeHtml(when)}</b></div>` : ''}
            ${status ? `<div class="cp-pop-row">Status ${status}</div>` : ''}
            <div class="cp-pop-coords">${p.lat.toFixed(4)}°N, ${Math.abs(p.lon).toFixed(4)}°W</div>
          </div>`, { className: 'cp-popup', closeButton: false, maxWidth: 240 });
        core.on('mouseover', () => core.setStyle({ radius: 6, weight: 2, color: '#ffffff' }));
        core.on('mouseout', () => core.setStyle({ radius: 3.5, weight: 1, color: '#0b0b14' }));
        core.addTo(layers.points);
      }

      // Pulsing rings on the newest reports (backend sends rows newest-first);
      // skipped on the opening city overview to keep it calm
      if (!overview) [...visible].sort((a, b) => a.order - b.order).slice(0, NEWEST_PULSES).forEach(p => {
        L.marker([p.lat, p.lon], {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'cp-noevents', html: `<div class="cp-pulse" style="--c:${p.color}"></div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        }).addTo(layers.overlay);
      });
    }

    const hot = overview ? null : findHotspot(visible);
    if (hot) {
      L.circle([hot.lat, hot.lon], {
        renderer: layers.renderer,  // same canvas as markers so it can't swallow their clicks
        radius: 650, color: '#f87171', weight: 1.5, dashArray: '4 6',
        fill: true, fillColor: '#ef4444', fillOpacity: 0.06, interactive: false,
      }).addTo(layers.overlay);
      L.marker([hot.lat, hot.lon], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'cp-noevents', html: `<div class="cp-hotspot-label">HOTSPOT · ${hot.count}</div>`, iconSize: [96, 18], iconAnchor: [48, 44] }),
      }).addTo(layers.overlay);
    }
  }, [visible, mode, overview]);

  // Frame each new dataset
  useEffect(() => {
    if (!mapRef.current) return;
    const id = requestAnimationFrame(() => fitToData(true));
    return () => cancelAnimationFrame(id);
  }, [points, mapCenter, overview]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleType = (label) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      if (next.size === legend.length) return new Set(); // never hide everything
      return next;
    });
  };

  const zoomBy = (d) => { userMovedRef.current = true; mapRef.current?.zoomIn(d); };

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-white/5 relative z-0 cp-map">
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#080810' }} />

      {/* Interactive legend: click a type to show/hide it */}
      {legend.length > 0 && (
        <div className="cp-legend">
          <div className="cp-legend-title">Incident types</div>
          {(legendOpen ? legend : legend.slice(0, LEGEND_COLLAPSED_ROWS)).map(({ label, color, count }) => {
            const off = hidden.has(label);
            return (
              <button key={label} type="button" className={`cp-legend-row${off ? ' off' : ''}`} onClick={() => toggleType(label)}
                title={off ? `Show ${label}` : `Hide ${label}`}>
                <span className="cp-legend-dot" style={{ background: color, boxShadow: off ? 'none' : `0 0 6px ${color}99` }} />
                <span className="cp-legend-label" title={label}>{label}</span>
                <span className="cp-legend-count">{count}</span>
              </button>
            );
          })}
          {legend.length > LEGEND_COLLAPSED_ROWS && (
            <button type="button" className="cp-legend-more" onClick={() => setLegendOpen(o => !o)}>
              {legendOpen ? 'Show less' : `+${legend.length - LEGEND_COLLAPSED_ROWS} more types`}
            </button>
          )}
          <div className="cp-legend-foot">
            {visible.length === points.length ? `${points.length} incidents plotted` : `${visible.length} of ${points.length} shown`}
          </div>
        </div>
      )}

      {/* View controls */}
      <div className="cp-controls">
        <div className="cp-seg" role="group" aria-label="Map style">
          <button type="button" className={mode === 'points' ? 'on' : ''} onClick={() => setMode('points')}>Points</button>
          <button type="button" className={mode === 'heat' ? 'on' : ''} onClick={() => setMode('heat')}>Heatmap</button>
        </div>
        <div className="cp-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>−</button>
          <button type="button" aria-label="Fit to incidents"
            title={overview ? 'Show all of NYC' : 'Fit to incidents'}
            onClick={() => { userMovedRef.current = false; fitToData(true); }}>⤢</button>
        </div>
      </div>
    </div>
  );
}
