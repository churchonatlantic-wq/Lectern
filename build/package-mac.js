// Packages unsigned macOS apps (arm64 + x64) from any OS with @electron/packager.
// On a Mac, prefer `npm run dist:mac` (electron-builder: universal, signed, notarized DMG).
const { packager } = require('@electron/packager');
const path = require('path');
const fs = require('fs');
const pkg = require('../package.json');

(async () => {
  const root = path.join(__dirname, '..');
  for (const arch of ['arm64', 'x64']) {
    const keep = 'darwin_' + arch;
    const out = await packager({
      dir: root,
      out: path.join(root, 'dist', 'mac'),
      overwrite: true,
      platform: 'darwin',
      arch,
      name: 'Lectern',
      executableName: 'Lectern',
      appBundleId: pkg.build.appId,
      appVersion: pkg.version,
      appCategoryType: 'public.app-category.video',
      icon: path.join(__dirname, 'icon.icns'),
      asar: false,
      prune: true,
      extendInfo: {
        ...pkg.build.mac.extendInfo,
        CFBundleDocumentTypes: [{ CFBundleTypeName: 'Lectern Service', CFBundleTypeRole: 'Editor', CFBundleTypeExtensions: ['lectern'] }],
      },
      ignore: [/^\/dist($|\/)/, /^\/test($|\/)/, /^\/build($|\/)/, /^\/\.git/,
        new RegExp('^/node_modules/koffi/build/koffi/(?!' + keep + ')[^/]+'), /^\/node_modules\/koffi\/(src|vendor|doc)($|\/)/],
    });
    console.log('packaged', out.join(', '));
  }
  fs.writeFileSync(path.join(root, 'dist', 'mac', '.done'), '');
})().catch((e) => { console.error(e); process.exit(1); });
