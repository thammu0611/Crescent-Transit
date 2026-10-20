// Four roles, four entirely different sets of screens (doc section 4) - the
// same split as the web app's NAV table, with React Navigation in place of
// hash routes: bottom tabs for daily screens, stack screens for the rest.
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createNavigationContainerRef } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AttendancePrompt from './components/AttendancePrompt.js';
import BoardingCheck from './components/BoardingCheck.js';
import { ChangePasswordButton, ChangePasswordSheet } from './components/ChangePassword.js';
import Icon from './components/Icon.js';
import {
  Frost, Avatar, Button, confirm, GradientCard, IconBubble, PillHeader, PillIconButton, Screen, SectionTitle, Text, Txt,
} from './components/ui.js';
import { onNotificationOpened, registerForPush } from './lib/notify.js';
import { startSampler, stopSampler } from './lib/sampler.js';
import { useSession } from './lib/session.js';
import AttendanceAdmin from './screens/admin/AttendanceAdmin.js';
import Dashboard from './screens/admin/Dashboard.js';
import Fleet from './screens/admin/Fleet.js';
import Notices from './screens/admin/Notices.js';
import Reports from './screens/admin/Reports.js';
import RoutesAdmin from './screens/admin/RoutesAdmin.js';
import Trips from './screens/admin/Trips.js';
import DriverApp from './screens/DriverApp.js';
import Collections from './screens/finance/Collections.js';
import FinanceStudents from './screens/finance/FinanceStudents.js';
import Payments from './screens/finance/Payments.js';
import Reconcile from './screens/finance/Reconcile.js';
import LiveMap from './screens/LiveMap.js';
import Login from './screens/Login.js';
import PublicHome from './screens/PublicHome.js';
import Alerts from './screens/student/Alerts.js';
import StudentAttendance from './screens/student/Attendance.js';
import Schedule from './screens/student/Schedule.js';
import Settings from './screens/student/Settings.js';
import StudentHome from './screens/student/StudentHome.js';
import Subscription from './screens/student/Subscription.js';
import { C, F, G, shadow, shadowLg } from './theme.js';

const Stack = createNativeStackNavigator();
// Lets a tapped notification open a screen from outside the navigators (App.js passes it in).
export const navigationRef = createNavigationContainerRef();
const Tab = createBottomTabNavigator();

const ROLE_LABEL = { student: 'Student', driver: 'Driver', admin: 'Transport admin', finance: 'Finance officer' };

// Every header is the floating navigation pill, as in the web app.
const header = {
  header: (props) => <PillHeader {...props} />,
  contentStyle: { backgroundColor: C.bg },
};

function SignOutButton() {
  const { signOut } = useSession();
  return <PillIconButton icon="logout" label="Sign out" onPress={async () => (await confirm('Sign out?', 'You can sign in again any time.', 'Sign out')) && signOut()} />;
}

/** Header buttons for roles without a settings screen: change password, sign out. */
const AccountButtons = () => <><ChangePasswordButton /><SignOutButton /></>;

/** Tab icon; the active one glows red in a soft pill under a short red rule. */
const TabIcon = ({ name, focused }) => (
  <View style={{ width: 50, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? 'rgba(247, 188, 49,0.14)' : 'transparent' }}>
    {focused ? <View style={{ position: 'absolute', top: -5, width: 18, height: 2, borderRadius: 1, backgroundColor: C.gold }} /> : null}
    <Icon name={name} size={19} color={focused ? C.gold : 'rgba(255,255,255,0.5)'} strokeWidth={focused ? 2.2 : 1.8} />
  </View>
);

/**
 * The tab bar floats as a rounded pill above the bottom edge, like the web app's
 * phone tab bar. Navigators pass safeAreaInsets={{ bottom: 0 }} so the bar adds no
 * inset padding of its own; screens leave room for it (useTabBarSpace in ui.js).
 */
const tabOptions = (icons, insets) => ({ route }) => ({
  ...header,
  sceneStyle: { backgroundColor: C.bg },
  tabBarActiveTintColor: C.gold,
  tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
  tabBarLabelStyle: { fontSize: 10, ...F[600], letterSpacing: 0.1 },
  tabBarStyle: {
    position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 10, height: 66, paddingTop: 8, paddingBottom: 8,
    borderRadius: 30, borderTopWidth: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderTopColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(20,37,72,0.62)', overflow: 'hidden', ...shadowLg, elevation: 0,
  },
  // Liquid glass tab bar: frosted, with a bright top edge.
  tabBarBackground: () => <Frost tint="dark" intensity={60} style={{ borderRadius: 30 }} />,
  tabBarIcon: ({ focused }) => <TabIcon name={icons[route.name]} focused={focused} />,
});

// ---- Guest: the free view and sign-in ------------------------------------------------

function GuestNav() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="PublicHome" component={PublicHome} options={{ title: 'Crescent Transit', headerShown: false }} />
      <Stack.Screen name="Login" component={Login} options={{ title: 'Sign in', headerShown: false }} />
    </Stack.Navigator>
  );
}

// ---- Student: five tabs used daily, like the web app's phone tab bar ---------------------

const STUDENT_ICONS = { Home: 'home', Track: 'map', Schedule: 'clock', Attendance: 'check', Profile: 'users' };

function StudentTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator safeAreaInsets={{ bottom: 0 }} screenOptions={tabOptions(STUDENT_ICONS, insets)}>
      <Tab.Screen name="Home" component={StudentHome} options={{ title: 'Home', headerShown: false }} />
      <Tab.Screen name="Track" component={LiveMap} options={{ title: 'Live map', tabBarLabel: 'Track' }} />
      <Tab.Screen name="Schedule" component={Schedule} />
      <Tab.Screen name="Attendance" component={StudentAttendance} options={{ headerShown: false }} />
      <Tab.Screen name="Profile" component={Settings} options={{ title: 'Settings', tabBarLabel: 'Profile', headerShown: false }} />
    </Tab.Navigator>
  );
}

function StudentNav() {
  const { token } = useSession();
  // The attendance sampler runs for students, whichever screen is open.
  useEffect(() => {
    startSampler(token);
    return () => stopSampler();
  }, [token]);
  return (
    <>
      <Stack.Navigator screenOptions={header}>
        <Stack.Screen name="StudentTabs" component={StudentTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Alerts" component={Alerts} options={{ title: 'Notifications' }} />
        {/* Reached only when the university requires the subscription (entitlement.required). */}
        <Stack.Screen name="Subscription" component={Subscription} options={{ headerTitle: '' }} />
      </Stack.Navigator>
      <AttendancePrompt />
      <BoardingCheck />
    </>
  );
}

// ---- Driver: one screen --------------------------------------------------------------

function DriverNav() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="Driver" component={DriverApp} options={{ title: 'My trip', headerRight: () => <AccountButtons /> }} />
    </Stack.Navigator>
  );
}

// ---- Transport admin: daily tabs + "More" for the rest of the web menu --------------------

const ADMIN_ICONS = { Dashboard: 'chart', FleetMap: 'map', Trips: 'clock', More: 'menu' };
const ADMIN_MORE = [
  ['AttendanceAdmin', 'Attendance', 'check', 'Review queue, students, corrections', 'emerald'],
  ['RoutesAdmin', 'Routes', 'route', 'Route builder and stops', 'indigo'],
  ['Fleet', 'Buses and drivers', 'bus', 'Add, edit and assign', 'sky'],
  ['Notices', 'Alerts and incidents', 'bell', 'Announcements and incident log', 'red'],
  ['Reports', 'Reports', 'list', 'Registers, demand, occupancy, accuracy', 'violet'],
];

function MoreMenu({ navigation }) {
  const { user, signOut } = useSession();
  const [changingPassword, setChangingPassword] = useState(false);
  return (
    <Screen>
      <GradientCard colors={G.navy}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={user?.name} size={56} light />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 22, ...F.display }}>{user?.name}</Text>
            <Text style={{ color: C.gold, ...F[700], marginTop: 4, fontSize: 11, letterSpacing: 1.8 }}>{ROLE_LABEL[user?.role]?.toUpperCase()}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>@{user?.username}</Text>
          </View>
        </View>
      </GradientCard>
      <SectionTitle title="Transport office" />
      <View style={{ backgroundColor: C.glass, borderRadius: 22, padding: 6, borderWidth: 1, borderColor: C.glassEdge, ...shadow }}>
        {ADMIN_MORE.map(([name, title, icon, hint, accent], i) => (
          <Pressable key={name} onPress={() => navigation.navigate(name)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16, backgroundColor: pressed ? C.surface : 'transparent', borderTopWidth: i ? 1 : 0, borderTopColor: C.line2 })}>
            <IconBubble name={icon} accent={accent} size={44} />
            <View style={{ flex: 1 }}><Txt bold>{title}</Txt><Txt muted small>{hint}</Txt></View>
            <Icon name="arrow" size={16} color={C.faint} />
          </Pressable>
        ))}
      </View>
      <Button title="Change password" variant="ghost" icon="lock" onPress={() => setChangingPassword(true)} />
      <Button title="Sign out" variant="ghost" icon="logout" textStyle={{ color: C.danger }} onPress={async () => (await confirm('Sign out?', '', 'Sign out')) && signOut()} />
      <ChangePasswordSheet visible={changingPassword} onClose={() => setChangingPassword(false)} />
    </Screen>
  );
}

function AdminTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator safeAreaInsets={{ bottom: 0 }} screenOptions={tabOptions(ADMIN_ICONS, insets)}>
      <Tab.Screen name="Dashboard" component={Dashboard} options={{ title: 'Dashboard', headerShown: false }} />
      <Tab.Screen name="FleetMap" component={LiveMap} options={{ title: 'Fleet map' }} />
      <Tab.Screen name="Trips" component={Trips} options={{ headerShown: false }} />
      <Tab.Screen name="More" component={MoreMenu} />
    </Tab.Navigator>
  );
}

function AdminNav() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="AdminTabs" component={AdminTabs} options={{ headerShown: false }} />
      <Stack.Screen name="AttendanceAdmin" component={AttendanceAdmin} options={{ title: 'Attendance', headerTitle: '' }} />
      <Stack.Screen name="RoutesAdmin" component={RoutesAdmin} options={{ title: 'Routes' }} />
      <Stack.Screen name="Fleet" component={Fleet} options={{ title: 'Buses and drivers', headerTitle: '' }} />
      <Stack.Screen name="Notices" component={Notices} options={{ title: 'Alerts', headerTitle: '' }} />
      <Stack.Screen name="Reports" component={Reports} options={{ headerTitle: '' }} />
    </Stack.Navigator>
  );
}

// ---- Finance officer: four tabs, no live locations ------------------------------------------

const FINANCE_ICONS = { Collections: 'wallet', Payments: 'card', Students: 'users', Reconcile: 'shield' };

function FinanceNav() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator safeAreaInsets={{ bottom: 0 }} screenOptions={(p) => ({ ...tabOptions(FINANCE_ICONS, insets)(p), headerRight: () => <AccountButtons /> })}>
      <Tab.Screen name="Collections" component={Collections} options={{ title: 'Collections', headerShown: false }} />
      <Tab.Screen name="Payments" component={Payments} options={{ headerTitle: '' }} />
      <Tab.Screen name="Students" component={FinanceStudents} options={{ headerTitle: '' }} />
      <Tab.Screen name="Reconcile" component={Reconcile} options={{ title: 'Reconciliation', tabBarLabel: 'Reconcile', headerTitle: '' }} />
    </Tab.Navigator>
  );
}

const BY_ROLE = { student: StudentNav, driver: DriverNav, admin: AdminNav, finance: FinanceNav };

// Where a tapped notification leads, by role: route alerts to the alerts list,
// an SOS to the transport office's incident log. The boarding questions need
// no screen: opening the app loads them as in-app sheets.
const OPEN_ON_TAP = { student: { notification: 'Alerts' }, admin: { incident: 'Notices', notification: 'Notices' } };

/** Register this phone for push after sign-in, and follow taps on notifications. */
function usePushNotifications(token, user) {
  const role = useRef(user?.role);
  role.current = user?.role;
  useEffect(() => {
    if (token) registerForPush(token);
  }, [token]);
  useEffect(() => onNotificationOpened((data) => {
    const target = OPEN_ON_TAP[role.current]?.[data.type];
    if (!target) return;
    // On a cold start the navigators may still be mounting.
    let tries = 0;
    const go = () => {
      if (navigationRef.isReady() && role.current) navigationRef.navigate(target);
      else if ((tries += 1) < 20) setTimeout(go, 250);
    };
    go();
  }), []);
}

export default function RootNavigator() {
  const { ready, user, token } = useSession();
  usePushNotifications(token, user);
  if (!ready) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator size="large" color={C.navy} /></View>;
  }
  const Nav = BY_ROLE[user?.role] ?? GuestNav;
  // A new tree per role, so nothing from one account's screens survives sign-out.
  return <Nav key={user ? `${user.role}:${user.id}` : 'guest'} />;
}
