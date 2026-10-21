import { registerRootComponent } from 'expo';

import { installCrashGuard, makeRoot } from './src/CrashGuard';

// The safety net goes in first, so even an error while the app's own modules
// load shows an error screen instead of closing the app.
installCrashGuard();

let App = null;
let loadError = null;
try {
  App = require('./App').default;
} catch (err) {
  loadError = err;
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(makeRoot(App, loadError));
