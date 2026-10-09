import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

if (Capacitor.isNativePlatform()) {
  window.FuelWisePlatform = {
    native: true,
    get: async (key) => (await Preferences.get({ key })).value,
    set: (key, value) => Preferences.set({ key, value }),
    setTheme: (theme) => SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }),
    exportData: async (data) => {
      const { uri } = await Filesystem.writeFile({
        path: 'fuelwise-backup.json',
        data,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({ title: 'FuelWise backup', files: [uri], dialogTitle: 'Save your fuel data' });
    },
    onBack: (callback) => Capacitor.getPlatform() === 'android' ? App.addListener('backButton', callback) : Promise.resolve(),
    minimize: () => App.minimizeApp(),
  };
}

import('./app.js');
