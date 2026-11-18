// Four roles, four entirely different sets of screens (doc section 4) - the
// same split as the web app's NAV table, with React Navigation in place of
// hash routes: bottom tabs for daily screens, stack screens for the rest.
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createNavigationContainerRef } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import AttendancePrompt from './components/AttendancePrompt.js';
import BoardingCheck from './components/BoardingCheck.js';
import BusAlternatives from './components/BusAlternatives.js';
import { ChangePasswordButton, ChangePasswordSheet, ChoosePassword } from './components/ChangePassword.js';
import GlassTabBar from './components/GlassTabBar.js';
import Icon from './components/Icon.js';
import {
  Avatar, Button, confirm, GradientCard, IconBubble, PillHeader, PillIconButton, Screen, SectionTitle, Text, Txt,
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
import VerifyEmail from './screens/student/VerifyEmail.js';
// The finance office app is switched off for now. To bring it back, restore
// these imports, FinanceNav below and its entry in BY_ROLE.
// import Collections from './screens/finance/Collections.js';
// import FinanceStudents from './screens/finance/FinanceStudents.js';
// import Payments from './screens/finance/Payments.js';
// import Reconcile from './screens/finance/Reconcile.js';
import LiveMap from './screens/LiveMap.js';
import BusCare from './screens/admin/BusCare.js';
import ServiceDesk from './screens/admin/ServiceDesk.js';
import Suggestions from './screens/admin/Suggestions.js';
import Appearance from './components/Appearance.js';
import ParentHome from './screens/parent/ParentHome.js';
import BusPass from './screens/student/Pass.js';
import Services from './screens/student/Services.js';
import { useT } from './lib/offline.js';
import Login from './screens/Login.js';
import PublicHome from './screens/PublicHome.js';
import Alerts from './screens/student/Alerts.js';
import StudentAttendance from './screens/student/Attendance.js';
import Schedule from './screens/student/Schedule.js';
import Settings from './screens/student/Settings.js';
import StudentHome from './screens/student/StudentHome.js';
import Subscription from './screens/student/Subscription.js';
import { C, F, G, shadow } from './theme.js';
import MyAvatar from './components/MyAvatar.js';

const Stack = createNativeStackNavigator();
// Lets a tapped notification open a screen from outside the navigators (App.js passes it in).
export const navigationRef = createNavigationContainerRef();
const Tab = createBottomTabNavigator();

const ROLE_LABEL = { student: 'Student', driver: 'Driver', admin: 'Transport admin', finance: 'Finance officer', parent: 'Parent' };

// Every header is the floating navigation pill, as in the web app.
const header = {
  header: (props) => <PillHeader {...props} />,
  contentStyle: { backgroundColor: C.bg },
  // Screens slide in from the right and follow the finger back, on both platforms.
  animation: 'ios_from_right',
  gestureEnabled: true,
};

function SignOutButton() {
  const { signOut } = useSession();
  return <PillIconButton icon="logout" label="Sign out" onPress={async () => (await confirm('Are you sure you want to log out?', '', 'Yes, Log Out', true)) && signOut()} />;
}

/** Header buttons for roles without a settings screen: change password, sign out. */
const AccountButtons = () => <><ChangePasswordButton /><SignOutButton /></>;

/** The signed-in user's initials, as the profile tab's icon. */
function ProfileTabIcon() {
  const { user } = useSession();
  return <MyAvatar size={27} light={C.dark} />;
}

/**
 * The tab bar floats as a dark glass capsule above the bottom edge (GlassTabBar).
 * Navigators pass safeAreaInsets={{ bottom: 0 }} so the bar adds no inset padding
 * of its own; screens leave room for it (useTabBarSpace in ui.js).
 */
const tabBar = (icons) => function TabBar(props) { return <GlassTabBar {...props} icons={icons} />; };
const tabOptions = {
  ...header,
  sceneStyle: { backgroundColor: C.bg },
  // Tab screens slide a little and fade as you switch between them.
  animation: 'shift',
};

// ---- Guest: the public home and sign-in ------------------------------------------------

function GuestNav() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="PublicHome" component={PublicHome} options={{ title: 'Crescent Transit', headerShown: false }} />
      <Stack.Screen name="Login" component={Login} options={{ title: 'Sign in', headerShown: false, animation: 'fade_from_bottom' }} />
    </Stack.Navigator>
  );
}

// A temporary password from the transport office is replaced first.
function ChoosePasswordNav() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ChoosePassword" component={ChoosePassword} options={{ title: 'Choose your password' }} />
    </Stack.Navigator>
  );
}

// A student whose university email is not confirmed sees only that step.
function VerifyEmailNav() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="VerifyEmail" component={VerifyEmail} options={{ title: 'Verify your email' }} />
    </Stack.Navigator>
  );
}

// ---- Student: five tabs used daily, like the web app's phone tab bar ---------------------

const STUDENT_ICONS = { Home: 'home', Track: 'map', Schedule: 'clock', Attendance: 'check', Profile: ProfileTabIcon };

function StudentTabs() {
  const t = useT();
  return (
    <Tab.Navigator safeAreaInsets={{ bottom: 0 }} tabBar={tabBar(STUDENT_ICONS)} screenOptions={tabOptions}>
      <Tab.Screen name="Home" component={StudentHome} options={{ title: t('Home'), headerShown: false }} />
      <Tab.Screen name="Track" component={LiveMap} options={{ title: t('Live map'), tabBarLabel: t('Track'), headerShown: false }} />
      <Tab.Screen name="Schedule" component={Schedule} options={{ title: t('Schedule'), headerShown: false }} />
      <Tab.Screen name="Attendance" component={StudentAttendance} options={{ title: t('Attendance'), headerShown: false }} />
      <Tab.Screen name="Profile" component={Settings} options={{ title: t('Settings'), tabBarLabel: t('Profile'), headerShown: false }} />
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
        <Stack.Screen name="BusPass" component={BusPass} options={{ title: 'Bus pass' }} />
        <Stack.Screen name="Services" component={Services} options={{ title: 'Services', headerTitle: '' }} />
        {/* Reached only when the university requires the subscription (entitlement.required). */}
        <Stack.Screen name="Subscription" component={Subscription} options={{ headerTitle: '' }} />
      </Stack.Navigator>
      <AttendancePrompt />
      <BoardingCheck />
      <BusAlternatives onTrack={(routeCode) => navigationRef.navigate('StudentTabs', { screen: 'Track', params: { routeCode } })} />
    </>
  );
}

// ---- Parent: one screen --------------------------------------------------------------

function ParentNav() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="ParentHome" component={ParentHome} options={{ title: t('My children'), headerShown: false }} />
    </Stack.Navigator>
  );
}

// ---- Driver: one screen --------------------------------------------------------------

function DriverNav() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="Driver" component={DriverApp} options={{ title: 'My trip', headerShown: false }} />
    </Stack.Navigator>
  );
}

// ---- Transport admin: daily tabs + "More" for the rest of the web menu --------------------

const ADMIN_ICONS = { Dashboard: 'chart', FleetMap: 'map', Trips: 'clock', AttendanceAdmin: 'check', More: 'menu' };
const ADMIN_MORE = [
  ['RoutesAdmin', 'Routes', 'route', 'Route builder and stops', 'indigo'],
  ['Fleet', 'Buses and drivers', 'bus', 'Add, edit and assign', 'sky'],
  ['Notices', 'Alerts and incidents', 'bell', 'Announcements and incident log', 'red'],
  ['ServiceDesk', 'Service desk', 'sparkle', 'Complaints, route requests, lost items, driver checks', 'emerald'],
  ['BusCare', 'Bus care', 'shield', 'Documents, service, fuel, scorecards, stops', 'indigo'],
  ['Reports', 'Reports', 'list', 'Registers, demand, occupancy, accuracy', 'violet'],
  ['Suggestions', 'Suggestions', 'sparkle', 'Timetable fixes, crowded routes, replacement buses, weekly report', 'emerald'],
];

function MoreMenu({ navigation }) {
  const { user, signOut } = useSession();
  const [changingPassword, setChangingPassword] = useState(false);
  return (
    <Screen>
      <GradientCard colors={G.navy}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <MyAvatar size={56} light />
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
          <Pressable accessibilityRole="button" key={name} onPress={() => navigation.navigate(name)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: pressed ? 16 : 0, backgroundColor: pressed ? C.surface : 'transparent', borderTopWidth: i ? 1 : 0, borderTopColor: C.line2 })}>
            <IconBubble name={icon} accent={accent} size={44} />
            <View style={{ flex: 1 }}><Txt bold>{title}</Txt><Txt muted small>{hint}</Txt></View>
            <Icon name="arrow" size={16} color={C.faint} />
          </Pressable>
        ))}
      </View>
      <Appearance />
      <Button title="Change password" variant="ghost" icon="lock" onPress={() => setChangingPassword(true)} />
      <Button title="Sign out" variant="ghost" icon="logout" textStyle={{ color: C.danger }} onPress={async () => (await confirm('Are you sure you want to log out?', '', 'Yes, Log Out', true)) && signOut()} />
      <ChangePasswordSheet visible={changingPassword} onClose={() => setChangingPassword(false)} />
    </Screen>
  );
}

function AdminTabs() {
  return (
    <Tab.Navigator safeAreaInsets={{ bottom: 0 }} tabBar={tabBar(ADMIN_ICONS)} screenOptions={tabOptions}>
      <Tab.Screen name="Dashboard" component={Dashboard} options={{ title: 'Dashboard', headerShown: false }} />
      <Tab.Screen name="FleetMap" component={LiveMap} options={{ title: 'Fleet map', headerShown: false }} />
      <Tab.Screen name="Trips" component={Trips} options={{ headerShown: false }} />
      <Tab.Screen name="AttendanceAdmin" component={AttendanceAdmin} options={{ title: 'Attendance' }} />
      <Tab.Screen name="More" component={MoreMenu} />
    </Tab.Navigator>
  );
}

function AdminNav() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="AdminTabs" component={AdminTabs} options={{ headerShown: false }} />
      <Stack.Screen name="RoutesAdmin" component={RoutesAdmin} options={{ title: 'Routes' }} />
      <Stack.Screen name="Fleet" component={Fleet} options={{ title: 'Buses and drivers', headerTitle: '' }} />
      <Stack.Screen name="Notices" component={Notices} options={{ title: 'Alerts', headerTitle: '' }} />
      <Stack.Screen name="ServiceDesk" component={ServiceDesk} options={{ title: 'Service desk', headerTitle: '' }} />
      <Stack.Screen name="BusCare" component={BusCare} options={{ title: 'Bus care', headerTitle: '' }} />
      <Stack.Screen name="Reports" component={Reports} options={{ headerTitle: '' }} />
      <Stack.Screen name="Suggestions" component={Suggestions} options={{ title: 'Suggestions', headerTitle: '' }} />
    </Stack.Navigator>
  );
}

// // ---- Finance officer: four tabs, no live locations ------------------------------------------

// const FINANCE_ICONS = { Collections: 'wallet', Payments: 'card', Students: 'users', Reconcile: 'shield' };

// function FinanceNav() {
//   return (
//     <Tab.Navigator safeAreaInsets={{ bottom: 0 }} tabBar={tabBar(FINANCE_ICONS)} screenOptions={{ ...tabOptions, headerRight: () => <AccountButtons /> }}>
//       <Tab.Screen name="Collections" component={Collections} options={{ title: 'Collections', headerShown: false }} />
//       <Tab.Screen name="Payments" component={Payments} options={{ headerTitle: '' }} />
//       <Tab.Screen name="Students" component={FinanceStudents} options={{ headerTitle: '' }} />
//       <Tab.Screen name="Reconcile" component={Reconcile} options={{ title: 'Reconciliation', tabBarLabel: 'Reconcile', headerTitle: '' }} />
//     </Tab.Navigator>
//   );
// }

/** What a finance account sees while the finance app is switched off. */
function FinanceOff() {
  return (
    <Screen>
      <GradientCard colors={G.navy}>
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <IconBubble name="wallet" accent="amber" size={56} />
          <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', ...F.display }}>The finance office app is switched off</Text>
          <Text style={{ color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 20 }}>Collections, payments and reconciliation are not available right now. Sign out with the button at the top, or contact the transport office.</Text>
        </View>
      </GradientCard>
    </Screen>
  );
}

function FinanceOffNav() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="FinanceOff" component={FinanceOff} options={{ title: 'Finance office', headerRight: () => <AccountButtons /> }} />
    </Stack.Navigator>
  );
}

const BY_ROLE = { parent: ParentNav, student: StudentNav, driver: DriverNav, admin: AdminNav, finance: FinanceOffNav };

// Where a tapped notification leads, by role: route alerts to the alerts list,
// an SOS to the transport office's incident log. The boarding questions need
// no screen: opening the app loads them as in-app sheets.
const OPEN_ON_TAP = {
  student: { notification: 'Alerts', renew: 'Subscription', subscription: 'Subscription' },
  admin: { incident: 'Notices', notification: 'Notices', suggestion: 'Suggestions', feedback: 'ServiceDesk' },
};

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
  const { ready, user, token, emailCheck } = useSession();
  usePushNotifications(token, user);
  if (!ready) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator size="large" color={C.navy} /></View>;
  }
  const choosing = Boolean(user?.mustChangePassword);
  const verifying = user?.role === 'student' && Boolean(emailCheck?.required);
  const step = choosing ? 'password' : verifying ? 'verify' : '';
  const Nav = choosing ? ChoosePasswordNav : verifying ? VerifyEmailNav : BY_ROLE[user?.role] ?? GuestNav;
  // A new tree per role, so nothing from one account's screens survives sign-out.
  return <Nav key={user ? `${user.role}:${user.id}:${step}` : 'guest'} />;
}
