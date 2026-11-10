import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

const ANIMATION_MS = 1200;

const BUS_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17V6a3 3 0 013-3h8a3 3 0 013 3v11M5 17h14M5 17v2h3v-2M16 17v2h3v-2M5 11h14M8 14h.01M16 14h.01"/></svg>';

/** A pill with the route number; its tip marks the bus's exact position. */
function busIcon({ routeCode, freshness, heading, selected }) {
  const moving = heading !== null && heading !== undefined && freshness !== 'offline';
  const glyph = moving ? `<i class="bus-pin-arrow" style="transform: rotate(${heading}deg)"></i>` : BUS_GLYPH;
  return L.divIcon({
    className: '',
    html: `<div class="bus-pin ${freshness}${selected ? ' selected' : ''}"><span class="bus-pin-body"><span class="bus-pin-disc">${glyph}</span><b>${routeCode}</b></span></div>`,
    iconSize: [84, 46],
    iconAnchor: [42, 42],
  });
}

/**
 * A bus on the map. Plain Leaflet marker driven from React so that each new
 * position glides from the old one instead of jumping.
 */
export default function BusMarker({ bus, selected, onSelect }) {
  const map = useMap();
  const markerRef = useRef(null);
  const frameRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const marker = L.marker([bus.lat, bus.lng], { keyboard: true, title: bus.fleetCode, riseOnHover: true });
    marker.on('click', () => onSelectRef.current?.(bus.busId));
    marker.addTo(map);
    markerRef.current = marker;
    return () => {
      cancelAnimationFrame(frameRef.current);
      marker.remove();
    };
    // Created once per bus; later changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, bus.busId]);

  useEffect(() => {
    markerRef.current?.setIcon(busIcon({ ...bus, selected }));
    markerRef.current?.setZIndexOffset(selected ? 1000 : 0);
  }, [bus.routeCode, bus.freshness, bus.heading, selected]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const from = marker.getLatLng();
    const to = L.latLng(bus.lat, bus.lng);
    if (from.equals(to)) return;
    cancelAnimationFrame(frameRef.current);
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / ANIMATION_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
      marker.setLatLng([from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e]);
      if (k < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
  }, [bus.lat, bus.lng]);

  return null;
}
