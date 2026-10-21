// The floating tab bar: a dark liquid-glass capsule above the bottom edge, white
// icons over labels, and a darker pill that slides behind the active tab. Badges
// (options.tabBarBadge) are the site's green: a count, or a dot for `true`.
import { BottomTabBarHeightCallbackContext } from '@react-navigation/bottom-tabs';
import { useContext, useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from '../theme.js';
import { tickSelect } from '../lib/haptics.js';
import Icon from './Icon.js';
import { Frost } from './ui.js';

const PAD = 6;

function Badge({ value }) {
  if (value == null || value === false) return null;
  if (value === true) return <View style={s.dot} />;
  return <View style={s.count}><Text style={s.countText}>{value}</Text></View>;
}

/**
 * tabBar for a bottom-tab navigator. `icons` maps route name to an Icon name, or
 * to a component taking { focused } for a custom icon (the profile avatar).
 */
export default function GlassTabBar({ state, descriptors, navigation, icons }) {
  const insets = useSafeAreaInsets();
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const [width, setWidth] = useState(0);
  const tabW = width ? (width - PAD * 2) / state.routes.length : 0;
  const [x] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(x, { toValue: state.index * tabW, useNativeDriver: true, damping: 18, stiffness: 180, mass: 0.8 }).start();
  }, [state.index, tabW, x]);

  return (
    <View
      style={[s.bar, { bottom: insets.bottom + 10 }]}
      onLayout={(e) => { setWidth(e.nativeEvent.layout.width); reportHeight?.(e.nativeEvent.layout.height); }}
    >
      <Frost tint="dark" intensity={55} style={{ borderRadius: s.bar.borderRadius }} />
      <View pointerEvents="none" style={s.sheen} />
      {tabW ? <Animated.View pointerEvents="none" style={[s.active, { width: tabW, transform: [{ translateX: x }] }]} /> : null}
      {state.routes.map((route, i) => {
        const { options } = descriptors[route.key];
        const focused = state.index === i;
        const label = options.tabBarLabel ?? options.title ?? route.name;
        const icon = icons[route.name];
        const CustomIcon = typeof icon === 'function' ? icon : null;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            tickSelect();
            navigation.navigate(route.name, route.params);
          }
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            style={s.tab}
          >
            <View>
              {CustomIcon
                ? <CustomIcon focused={focused} />
                : <Icon name={icon} size={25} color="#fff" strokeWidth={focused ? 2.1 : 1.8} />}
              <View style={s.badgeAt}><Badge value={options.tabBarBadge} /></View>
            </View>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[s.label, { opacity: focused ? 1 : 0.88 }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute', left: 14, right: 14, height: 74, borderRadius: 37, padding: PAD,
    flexDirection: 'row', overflow: 'hidden',
    backgroundColor: 'rgba(24,30,44,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 22, shadowOffset: { width: 0, height: 10 },
  },
  // Bright top edge, as on the rest of the glass.
  sheen: { position: 'absolute', top: 0, left: 24, right: 24, height: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  active: {
    position: 'absolute', top: PAD, bottom: PAD, left: PAD, borderRadius: 31,
    backgroundColor: 'rgba(6,10,20,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { color: '#fff', fontSize: 11.5, ...F.nav },
  badgeAt: { position: 'absolute', top: -5, left: 17 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#61ce70', borderWidth: 1.5, borderColor: 'rgba(24,30,44,0.9)', marginTop: 3 },
  count: { minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#61ce70', borderWidth: 1.5, borderColor: 'rgba(24,30,44,0.9)' },
  countText: { color: '#0b2a12', fontSize: 11.5, ...F[700] },
});
