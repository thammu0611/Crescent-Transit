import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';

/** Route line and boarding points. Interpolated stops are drawn hollow ("approx."). */
export default function RouteLayer({ route, highlightSeq }) {
  if (!route) return null;
  const line = route.stops.map((s) => [s.lat, s.lng]);
  return (
    <>
      <Polyline positions={line} pathOptions={{ color: '#1c315e', weight: 5, opacity: 0.7 }} />
      {route.stops.map((s) => {
        const highlighted = s.seq === highlightSeq;
        const approx = s.geo_source === 'interpolated';
        return (
          <CircleMarker
            key={s.seq}
            center={[s.lat, s.lng]}
            radius={highlighted ? 9 : 6}
            pathOptions={{
              color: '#1c315e',
              weight: 2,
              fillColor: highlighted ? '#f7bc31' : approx ? '#ffffff' : '#1c315e',
              fillOpacity: 1,
              dashArray: approx ? '3 3' : undefined,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <strong>{s.seq}. {s.name}</strong>
              <br />
              Scheduled {s.scheduled_time}
              {approx ? ' · approx. location' : ''}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
