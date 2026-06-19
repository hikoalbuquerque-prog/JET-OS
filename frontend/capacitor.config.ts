import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'com.jet.os',
  appName: 'JET OS',
  webDir:  'dist',

  android: {
    allowMixedContent: false,
  },

  server: {
    androidScheme: 'https',
    cleartext: false,
  },

  plugins: {
    SplashScreen: {
      backgroundColor:       '#0d1220',
      showSpinner:           false,
      launchAutoHide:        true,
      launchFadeOutDuration: 300,
    },
    Geolocation: {},
    LocalNotifications: {
      smallIcon:  'ic_stat_icon_config_sample',
      iconColor:  '#10b981',
    },
    Camera: {
      permissions: ['camera', 'photos'],
    },
  },
};

export default config;