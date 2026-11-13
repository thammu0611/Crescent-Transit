// Browser preview only (npx expo start --web): react-native-maps has no web
// version, so maps render as a drawn stand-in (streets, water, a route line)
// in the app's map colours, labelled "Preview map". Phones use maps.js.
import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { C } from '../theme.js';
import { Text } from './ui.js';

export const CAMPUS = { lat: 12.8737, lng: 80.0823 };
export const ll = (p) => ({ latitude: p.lat, longitude: p.lng });

const PAL = C.dark
  ? { land: '#0E141C', block: '#121A24', park: '#10231B', water: '#0B2131', casing: '#0A0F15', road: '#243040', minor: '#18212D', route: '#8FA8E0', traveled: '#64748B', stop: '#0E141C', campus: '#16A34A', bus: '#2F4E96' }
  : { land: '#EEF2F6', block: '#E4E9EF', park: '#D7ECD9', water: '#CBE1F4', casing: '#D3DAE3', road: '#FFFFFF', minor: '#F8FAFC', route: '#1C315E', traveled: '#94A3B8', stop: '#FFFFFF', campus: '#15803D', bus: '#1C315E' };

export const MapBox = forwardRef(function MapBox({ style }, ref) {
  useImperativeHandle(ref, () => ({ fit: () => {}, focus: () => {} }));
  const c = PAL;
  return (
    <View style={[{ flex: 1, backgroundColor: c.land, overflow: 'hidden' }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 390 440" preserveAspectRatio="xMidYMid slice">
        <Rect x={-50} y={-50} width={490} height={540} fill={c.land} />
        <Path d="M20 20h80v70H20Z M150 30h90v60h-90Z M300 200h70v50h-70Z M20 160h70v60H20Z M210 330h80v70h-80Z M330 300h50v80h-50Z" fill={c.block} />
        <Path d="M300 20h70v60h-70Z M40 230h60v50H40Z" fill={c.park} />
        <Path d="M-20 360C60 335 110 380 190 372S330 330 420 352V400C340 384 280 420 190 418S70 380-20 404Z" fill={c.water} />
        <Path d="M-10 128 400 184 M126-10 178 460 M-10 318 400 252 M262-10 298 460" stroke={c.casing} strokeWidth={14} fill="none" strokeLinecap="round" />
        <Path d="M-10 128 400 184 M126-10 178 460 M-10 318 400 252 M262-10 298 460" stroke={c.road} strokeWidth={10} fill="none" strokeLinecap="round" />
        <Path d="M-10 60 400 92 M-10 230 400 222 M60-10 70 460 M206-10 222 460 M340-10 348 460 M-10 420 400 404" stroke={c.minor} strokeWidth={5} fill="none" strokeLinecap="round" />
        <Path d="M28 418 75 384 130 322" stroke={c.traveled} strokeWidth={5} strokeDasharray="1 9" fill="none" strokeLinecap="round" />
        <Path d="M130 322 160 290 200 250 250 206 300 166 330 112 352 66" stroke={c.route} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {[[75, 384], [160, 290], [250, 206], [300, 166], [330, 112]].map(([x, y]) => <Circle key={x} cx={x} cy={y} r={4.5} fill={c.stop} stroke={c.route} strokeWidth={2.5} />)}
        <Circle cx={352} cy={66} r={11} fill={c.campus} stroke="#fff" strokeWidth={2.5} />
        <Path d="M200 252c-7-7-11-12-11-17a11 11 0 1 1 22 0c0 5-4 10-11 17Z" fill="#F59E0B" stroke="#fff" strokeWidth={2} />
        <Rect x={114} y={306} width={32} height={32} rx={11} fill={c.bus} stroke="#fff" strokeWidth={2.5} />
      </Svg>
      <View style={{ position: 'absolute', left: 10, bottom: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: C.dark ? 'rgba(18,24,33,0.85)' : 'rgba(255,255,255,0.85)' }}>
        <Text style={{ color: C.muted, fontSize: 10.5, fontWeight: '600' }}>Preview map</Text>
      </View>
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
