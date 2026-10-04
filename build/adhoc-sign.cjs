// electron-builder afterPack hook. Packaging edits the Electron bundle and
// leaves its ad-hoc signature invalid, which macOS reports for a downloaded
// copy as "damaged". Re-signing ad-hoc gives the ordinary unidentified-developer
// prompt instead, which Privacy & Security can open.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign({ appOutDir, packager }) {
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
