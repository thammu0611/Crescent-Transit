import { useEffect, useMemo } from 'react';
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

const COLOR = { live: '#237a36', delayed: '#b9832a', offline: '#8b909b' };

// Styles are fixed objects: the map restyles a shape whenever it is handed a new style object,
// so styles made afresh on every render restyled every stop and line each time a bus moved.
const LINE_STYLE = { color: 'var(--chart-navy)', weight: 4, opacity: 0.85 };
const STOP_STYLE = { color: '#fff', weight: 1, fillColor: '#454e70', fillOpacity: 1 };
const MY_STOP_STYLE = { color: '#fff', weight: 3, fillColor: '#f7bc31', fillOpacity: 1 };
const BUS_STYLE = Object.fromEntries(Object.entries(COLOR).map(([k, fillColor]) => [k, { color: '#fff', weight: 3, fillColor, fillOpacity: 1 }]));
const TIP_OFFSET = [0, -8];

/**
 * A small, still map: one route with its live buses (student home), or the
 * whole fleet when `route` is undefined (admin dashboard). A preview, not a tool.
 * `route === null` means the route is still loading.
 */
export default function RouteMiniMap({ route, buses = [], highlightSeq, labels = false, tall = false }) {
  const stops = route?.stops;
  // The route and its stops are drawn once and kept; only the buses change as they move.
  const stopPoints = useMemo(() => (stops ?? []).map((s) => [s.lat, s.lng]), [stops]);
  const stopLayer = useMemo(() => (stops ?? []).map((s) => (
    <CircleMarker key={s.seq} center={[s.lat, s.lng]} radius={s.seq === highlightSeq ? 6 : 3} pathOptions={s.seq === highlightSeq ? MY_STOP_STYLE : STOP_STYLE} />
  )), [stops, highlightSeq]);
  if (route === null) return <div className="mini-map skeleton-block" />;
  const points = stopPoints.length ? stopPoints : buses.map((b) => [b.lat, b.lng]);
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
        {stopPoints.length > 0 && <Polyline positions={stopPoints} pathOptions={LINE_STYLE} />}
        {stopLayer}
        {buses.map((b) => (
          <CircleMarker key={b.busId} center={[b.lat, b.lng]} radius={8} pathOptions={BUS_STYLE[b.freshness] ?? BUS_STYLE.live}>
            {labels && <Tooltip permanent direction="top" offset={TIP_OFFSET} className="bus-tip">{b.routeCode}</Tooltip>}
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
