// Browser preview only (npx expo start --web): react-native-maps has no web
// version, so maps render as a labelled placeholder. Phones use maps.js.
import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
import { C } from '../theme.js';
import { Text } from './ui.js';

export const CAMPUS = { lat: 12.8737, lng: 80.0823 };
export const ll = (p) => ({ latitude: p.lat, longitude: p.lng });

export const MapBox = forwardRef(function MapBox({ style }, ref) {
  useImperativeHandle(ref, () => ({ fit: () => {}, focus: () => {} }));
  return (
    <View style={[{ flex: 1, backgroundColor: '#dfe8e4', alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: C.muted, fontWeight: '700' }}>Map (shown on the phone)</Text>
    </View>
  );
});

const Nothing = () => null;
export const RouteLayer = Nothing;
export const BusPin = Nothing;
export const CampusPin = Nothing;
export const Dot = Nothing;
export const Marker = Nothing;
export const Polyline = Nothing;
export const MiniMap = ({ height = 190 }) => <View style={{ height }}><MapBox /></View>;
