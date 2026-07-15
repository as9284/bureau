import type { ForgeConfig } from '@electron-forge/shared-types';
import MakerNSIS from '@felixrieseberg/electron-forge-maker-nsis';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import path from 'node:path';

const iconBase = path.resolve(__dirname, 'assets/icon');
const iconIco = path.resolve(__dirname, 'assets/icon.ico');
const iconPng = path.resolve(__dirname, 'assets/icon.png');
const updateUrl = process.env.BUREAU_UPDATE_URL?.trim();

const isPackagedMainRuntime = (filePath: string): boolean =>
  filePath.startsWith('/.vite') ||
  filePath === '/node_modules' ||
  filePath.startsWith('/node_modules/node-pty') ||
  filePath.startsWith('/node_modules/node-addon-api');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: iconBase,
    extraResource: [iconIco],
    ignore: (filePath) => filePath.length > 0 && !isPackagedMainRuntime(filePath),
  },
  rebuildConfig: {},
  makers: [
    new MakerNSIS({
      updater: updateUrl
        ? {
            url: updateUrl,
            updaterCacheDirName: 'bureau-updater',
          }
        : undefined,
      getAppBuilderConfig: async () => ({
        artifactName: '${productName}-Setup-${version}.${ext}',
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          installerIcon: iconIco,
          uninstallerIcon: iconIco,
        },
      }),
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDeb({
      options: {
        icon: iconPng,
      },
    }),
    new MakerRpm({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
