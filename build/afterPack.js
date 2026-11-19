// Stamps the Windows .exe with Lectern's icon and version info using a pure-JS
// resource editor, so Windows builds can be made on Linux/macOS without Wine.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, productFilename + '.exe');

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map((i) => i.data));

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  const strings = {
    FileDescription: 'Lectern',
    ProductName: 'Lectern',
    CompanyName: 'Lectern',
    InternalName: 'Lectern',
    OriginalFilename: productFilename + '.exe',
    LegalCopyright: 'Copyright © ' + new Date().getFullYear() + ' Lectern',
    FileVersion: version,
    ProductVersion: version,
  };
  const langs = vi.getAllLanguagesForStringValues();
  (langs.length ? langs : [{ lang: 1033, codepage: 1200 }]).forEach((l) => vi.setStringValues(l, strings));
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • stamped icon and version info into', path.basename(exePath));
};
