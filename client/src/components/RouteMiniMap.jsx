import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap } from 'react-leaflet';
import BaseTiles from './BaseTiles.jsx';

const CHENNAI = [[12.85, 80.05], [13.15, 80.3]];

function Fit({ points }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join(';');
  useEffect(() => {
    // Wait for the card to finish laying out, then frame what matters.
    const id = setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(points.length > 1 ? points : CHENNAI, { padding: [26, 26], maxZoom: 14 });
    }, 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

const COLOR = { live: '#2b8a3e', delayed: '#b9832a', offline: '#8b909b' };

/**
 * A small, still map: one route with its live buses (student home), or the
 * whole fleet when `route` is undefined (admin dashboard). A preview, not a tool.
 * `route === null` means the route is still loading.
 */
export default function RouteMiniMap({ route, buses = [], highlightSeq, labels = false, tall = false }) {
  if (route === null) return <div className="mini-map skeleton-block" />;
  const stops = route?.stops ?? [];
  const points = stops.length ? stops.map((s) => [s.lat, s.lng]) : buses.map((b) => [b.lat, b.lng]);
  return (
    <div className={`mini-map${tall ? ' tall' : ''}`}>
      <MapContainer
        center={[12.97, 80.17]}
        zoom={11}
        className="map"
        zoomControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
      >
        <BaseTiles className="soft-tiles" />
        <Fit points={points} />
        {stops.length > 0 && <Polyline positions={stops.map((s) => [s.lat, s.lng])} pathOptions={{ color: '#454e70', weight: 4, opacity: 0.85 }} />}
        {stops.map((s) => (
          <CircleMarker
            key={s.seq}
            center={[s.lat, s.lng]}
            radius={s.seq === highlightSeq ? 6 : 3}
            pathOptions={{ color: '#fff', weight: s.seq === highlightSeq ? 3 : 1, fillColor: s.seq === highlightSeq ? '#f7bc31' : '#454e70', fillOpacity: 1 }}
          />
        ))}
        {buses.map((b) => (
          <CircleMarker key={b.busId} center={[b.lat, b.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: COLOR[b.freshness] ?? COLOR.live, fillOpacity: 1 }}>
            {labels && <Tooltip permanent direction="top" offset={[0, -8]} className="bus-tip">{b.routeCode}</Tooltip>}
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
