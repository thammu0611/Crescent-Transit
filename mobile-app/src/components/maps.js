// Native maps in place of the web app's Leaflet maps: route lines, stops,
// live buses coloured by freshness, and the campus marker.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { C, F, FRESH_COLOR } from '../theme.js';
import { Text } from './ui.js';

export const CAMPUS = { lat: 12.8737, lng: 80.0823 };
const CHENNAI = { latitude: 12.99, longitude: 80.17, latitudeDelta: 0.36, longitudeDelta: 0.36 };
const ll = (p) => ({ latitude: p.lat, longitude: p.lng });

// Google Maps on Android (Expo Go has a key built in); on iOS only when a key is
// configured (see app.config.js), otherwise Apple Maps.
const GOOGLE = Platform.OS === 'android' || Boolean(Constants.expoConfig?.extra?.googleMapsIos);

/** Google map style in the app's palette: ivory land, quiet roads, slate water, no clutter. */
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6f7b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f7f7' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d6d6d6' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#1c315e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#e3eadb' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e3e3e3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8e8e8' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d4d4d4' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9d5e3' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5a6b85' }] },
];

/**
 * A map that frames `fitPoints` whenever `fitKey` changes.
 * Exposes focus(point) and fit(points) through its ref.
 */
export const MapBox = forwardRef(function MapBox({ fitPoints = [], fitKey, still, style, children, onLongPress, padding = 50 }, ref) {
  const map = useRef(null);
  const [ready, setReady] = useState(false);
  const fit = (points) => {
    if (!map.current || !points.length) return;
    if (points.length === 1) map.current.animateToRegion({ ...ll(points[0]), latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    else map.current.fitToCoordinates(points.map(ll), { edgePadding: { top: padding, right: padding, bottom: padding, left: padding }, animated: true });
  };
  useImperativeHandle(ref, () => ({
    fit,
    focus: (p, delta = 0.02) => map.current?.animateToRegion({ ...ll(p), latitudeDelta: delta, longitudeDelta: delta }, 600),
  }));
  useEffect(() => {
    if (ready) fit(fitPoints);
    // Only re-frame when the selection changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);
  return (
    <MapView
      ref={map}
      provider={GOOGLE ? PROVIDER_GOOGLE : undefined}
      customMapStyle={GOOGLE ? MAP_STYLE : undefined}
      style={[styles.map, style]}
      initialRegion={CHENNAI}
      onMapReady={() => setReady(true)}
      onLongPress={onLongPress ? (e) => onLongPress({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude }) : undefined}
      scrollEnabled={!still}
      zoomEnabled={!still}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsPointsOfInterest={false}
      pointerEvents={still ? 'none' : 'auto'}
    >
      {children}
    </MapView>
  );
});

/** Custom-view markers must redraw briefly after a change, then stop (Android performance). */
function useTracks(deps) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const id = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return tracks;
}

/** Route line and boarding points. Interpolated stops are drawn hollow ("approx."). */
export function RouteLayer({ stops = [], highlightSeq, color = C.navy, small }) {
  if (!stops.length) return null;
  return (
    <>
      <Polyline coordinates={stops.map(ll)} strokeColor={color} strokeWidth={small ? 3 : 4} />
      {stops.map((s) => (
        <StopDot key={`${s.seq}:${s.lat}:${s.lng}`} stop={s} highlighted={s.seq === highlightSeq} color={color} small={small} />
      ))}
    </>
  );
}

function StopDot({ stop, highlighted, color, small }) {
  const approx = stop.geo_source === 'interpolated';
  const size = highlighted ? 18 : small ? 8 : 12;
  const tracks = useTracks([highlighted]);
  return (
    <Marker
      coordinate={ll(stop)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
      title={`${stop.seq}. ${stop.name}`}
      description={`Scheduled ${stop.scheduled_time ?? '—'}${approx ? ' · approx. location' : ''}`}
      zIndex={highlighted ? 50 : 1}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: highlighted ? C.navy : approx ? color : '#fff',
          borderStyle: approx ? 'dashed' : 'solid',
          backgroundColor: highlighted ? C.gold : approx ? '#fff' : color,
        }}
      />
    </Marker>
  );
}

/** A bus: route code in a disc coloured by freshness, with a heading arrow. */
export function BusPin({ bus, selected, onPress, compact }) {
  const color = FRESH_COLOR[bus.freshness] ?? C.live;
  const showArrow = bus.heading != null && bus.freshness !== 'offline' && !compact;
  const tracks = useTracks([bus.freshness, selected, Math.round((bus.heading ?? 0) / 10), bus.routeCode]);
  return (
    <Marker
      coordinate={ll(bus)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
      onPress={onPress ? () => onPress(bus.busId) : undefined}
      zIndex={selected ? 1000 : 100}
      title={compact ? undefined : bus.fleetCode}
    >
      <View style={{ width: compact ? 22 : 46, height: compact ? 22 : 46, alignItems: 'center', justifyContent: 'center' }}>
        {showArrow && (
          <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${bus.heading}deg` }], alignItems: 'center' }]}>
            <View style={[styles.arrow, { borderBottomColor: color }]} />
          </View>
        )}
        <View
          style={[
            styles.bus,
            compact && { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
            { backgroundColor: color },
            selected && { borderColor: C.gold, transform: [{ scale: 1.12 }] },
          ]}
        >
          {!compact && <Text style={styles.busText}>{bus.routeCode}</Text>}
        </View>
      </View>
    </Marker>
  );
}

export function CampusPin() {
  const tracks = useTracks([]);
  return (
    <Marker coordinate={ll(CAMPUS)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks} title="B.S. Abdur Rahman Crescent Institute of Science & Technology">
      <View style={styles.campus}><Text style={styles.campusText}>BSACIST</Text></View>
    </Marker>
  );
}

/** A plain coloured dot (driver's own position, replay head). */
export function Dot({ point, color = C.live, size = 20 }) {
  const tracks = useTracks([color]);
  if (!point) return null;
  return (
    <Marker coordinate={ll(point)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks} zIndex={500}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 3, borderColor: '#fff' }} />
    </Marker>
  );
}

export { Marker, Polyline, ll };

/**
 * A small, still map: one route with its live buses (student home), or the
 * whole fleet when `stops` is empty (admin dashboard). A preview, not a tool.
 */
export function MiniMap({ stops = [], buses = [], highlightSeq, height = 190, labels }) {
  const points = stops.length ? stops : buses;
  const key = points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join(';').slice(0, 400);
  return (
    <MapBox still fitPoints={points.length ? points : [CAMPUS]} fitKey={stops.length ? key : `fleet:${buses.length}`} style={{ height }} padding={30}>
      <RouteLayer stops={stops} highlightSeq={highlightSeq} color={C.indigo} small />
      {buses.map((b) => <BusPin key={b.busId} bus={b} compact={!labels} />)}
    </MapBox>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  bus: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  busText: { color: '#fff', ...F[800], fontSize: 11 },
  arrow: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  campus: { backgroundColor: C.navy, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 2, borderColor: C.gold },
  campusText: { color: '#fff', ...F[800], fontSize: 11 },
});
