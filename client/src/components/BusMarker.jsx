import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

const ANIMATION_MS = 1200;

function busIcon({ routeCode, freshness, heading, selected }) {
  const arrow =
    heading === null || heading === undefined || freshness === 'offline'
      ? ''
      : `<i class="bus-arrow" style="transform: rotate(${heading}deg)"></i>`;
  return L.divIcon({
    className: '',
    html: `<div class="bus-marker ${freshness}${selected ? ' selected' : ''}">${arrow}<span>${routeCode}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
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
