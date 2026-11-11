'use client';

import { useEffect, useRef } from 'react';

// Bengaluru — only used until the first worker location arrives.
const DEFAULT_CENTER = [12.9716, 77.5946];

const drawLayers = ({ L, map, layer, props, view }) => {
  const { markers, trail, selectedId, onSelect } = props;
  layer.clearLayers();

  for (const marker of markers) {
    // Coarse fixes can be off by hundreds of metres; show that honestly.
    if (marker.accuracy) {
      L.circle([marker.lat, marker.lng], {
        radius: marker.accuracy,
        color: marker.color,
        weight: 1,
        fillOpacity: 0.08,
      }).addTo(layer);
    }
    L.circleMarker([marker.lat, marker.lng], {
      radius: marker.id === selectedId ? 10 : 7,
      color: '#fff',
      weight: 2,
      fillColor: marker.color,
      fillOpacity: 1,
    })
      .bindTooltip(marker.label)
      .on('click', () => onSelect?.(marker.id))
      .addTo(layer);
  }

  if (trail?.length > 1) {
    L.polyline(trail, { color: '#2563eb', weight: 3, opacity: 0.7 }).addTo(layer);
  }

  // Re-fit only when the subject changes, not on every 30 s poll.
  const points = trail?.length ? trail : markers.map((m) => [m.lat, m.lng]);
  const subject = trail?.length ? `trail:${selectedId}` : 'fleet';
  if (points.length && view.fittedFor !== subject) {
    map.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15 });
    view.fittedFor = subject;
  }
};

/**
 * markers: [{ id, lat, lng, accuracy, label, color }]
 * trail:   [[lat, lng], ...] — optional path for the selected worker
 */
export const WorkerMap = (props) => {
  const containerRef = useRef(null);
  const stateRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    let cancelled = false;
    let resizeObserver;
    (async () => {
      // Leaflet touches `window` at import time, so load it client-side only.
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      const map = L.map(containerRef.current).setView(DEFAULT_CENTER, 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      stateRef.current = { L, map, layer: L.layerGroup().addTo(map), view: {} };
      // The container resizes when the worker panel opens/closes; Leaflet must be told.
      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
        const state = stateRef.current;
        if (state) {
          state.view.fittedFor = null;
          drawLayers({ ...state, props: propsRef.current });
        }
      });
      resizeObserver.observe(containerRef.current);
      drawLayers({ ...stateRef.current, props: propsRef.current });
    })();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      stateRef.current?.map.remove();
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (stateRef.current) drawLayers({ ...stateRef.current, props: propsRef.current });
  }, [props.markers, props.trail, props.selectedId]);

  return <div ref={containerRef} className="map" />;
};
