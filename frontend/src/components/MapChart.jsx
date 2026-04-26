import React, { useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [40.7128, -74.0060];
const DEFAULT_ZOOM = 10;

const TYPE_COLOR_MAP = [
  { keys: ['electrical', 'power', 'street light'],      color: '#facc15', label: 'Electrical / Power' },
  { keys: ['water', 'sewer', 'flood'],                   color: '#38bdf8', label: 'Water / Sewer' },
  { keys: ['noise'],                                     color: '#a78bfa', label: 'Noise' },
  { keys: ['heat', 'hot water'],                         color: '#fb923c', label: 'Heat / Hot Water' },
  { keys: ['rodent', 'pest'],                            color: '#84cc16', label: 'Rodent / Pest' },
  { keys: ['sanit', 'dirty', 'garbage', 'trash'],        color: '#f472b6', label: 'Sanitation' },
  { keys: ['traffic', 'parking'],                        color: '#f97316', label: 'Traffic / Parking' },
  { keys: ['building', 'elevator'],                      color: '#e2e8f0', label: 'Building' },
];
const DEFAULT_COLOR = '#ef4444';
const DEFAULT_LABEL  = 'Other Incident';

function getMarkerColor(type) {
  if (!type) return DEFAULT_COLOR;
  const t = type.toLowerCase();
  for (const entry of TYPE_COLOR_MAP) {
    if (entry.keys.some(k => t.includes(k))) return entry.color;
  }
  return DEFAULT_COLOR;
}

function getLegendEntries(locations) {
  if (!locations || locations.length === 0) return [];
  const seen = new Map();
  for (const loc of locations) {
    const t = (loc?.type || '').toLowerCase();
    let matched = false;
    for (const entry of TYPE_COLOR_MAP) {
      if (entry.keys.some(k => t.includes(k))) {
        if (!seen.has(entry.label)) seen.set(entry.label, entry.color);
        matched = true;
        break;
      }
    }
    if (!matched && !seen.has(DEFAULT_LABEL)) seen.set(DEFAULT_LABEL, DEFAULT_COLOR);
  }
  return Array.from(seen.entries()).map(([label, color]) => ({ label, color }));
}

export default function MapChart({ locations, mapCenter }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markersLayerRef = useRef(null);

  const legendEntries = useMemo(() => getLegendEntries(locations), [locations]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }).addTo(mapRef.current);
      markersLayerRef.current = L.layerGroup().addTo(mapRef.current);
    }

    markersLayerRef.current.clearLayers();

    const center = mapCenter ? [mapCenter.lat, mapCenter.lon] : DEFAULT_CENTER;
    const zoom   = mapCenter?.zoom || DEFAULT_ZOOM;

    if (Array.isArray(locations) && locations.length > 0) {
      const validLocs = [];
      locations.forEach(loc => {
        let lat = Number(loc?.lat);
        let lon = Number(loc?.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        lat += (Math.random() - 0.5) * 0.0005;
        lon += (Math.random() - 0.5) * 0.0005;
        validLocs.push([lat, lon]);

        const color = getMarkerColor(loc?.type);
        const circle = L.circleMarker([lat, lon], {
          radius: 5,
          fillColor: color,
          color: color,
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.55
        });
        circle.bindPopup(`
          <div style="background:#1a1b26;color:white;border:1px solid rgba(255,255,255,0.15);padding:8px 12px;font-size:12px;border-radius:8px;min-width:160px;">
            <strong style="color:${color};display:block;margin-bottom:4px;">${String(loc?.type || 'Incident')}</strong>
            <span style="color:#94a3b8;font-size:10px;">${lat.toFixed(4)}°N, ${Math.abs(lon).toFixed(4)}°W</span>
          </div>
        `);
        circle.addTo(markersLayerRef.current);
      });

      if (validLocs.length > 0) {
        const bounds = L.latLngBounds(validLocs);
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } else {
        mapRef.current.setView(center, zoom);
      }
    } else {
      mapRef.current.setView(center, zoom);
    }

    setTimeout(() => {
      if (mapRef.current) mapRef.current.invalidateSize();
    }, 250);
  }, [locations, mapCenter]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-white/5 relative z-0">
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#080810' }} />

      {/* Dynamic Color Legend */}
      {legendEntries.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '12px',
          left: '12px',
          background: 'rgba(8,8,16,0.88)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '10px',
          padding: '8px 12px',
          zIndex: 1000,
          pointerEvents: 'none',
          maxWidth: '180px',
        }}>
          <div style={{ fontSize: '8px', fontWeight: '900', letterSpacing: '0.15em', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
            INCIDENT TYPES
          </div>
          {legendEntries.map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
              <div style={{
                width: '9px', height: '9px', borderRadius: '50%',
                background: color, boxShadow: `0 0 6px ${color}88`, flexShrink: 0
              }} />
              <span style={{ fontSize: '9px', color: '#cbd5e1', fontWeight: '600', lineHeight: 1.2 }}>{label}</span>
            </div>
          ))}
          <div style={{ marginTop: '5px', paddingTop: '5px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '8px', color: '#475569', fontWeight: '700' }}>
            {locations?.length || 0} INCIDENTS PLOTTED
          </div>
        </div>
      )}
    </div>
  );
}
