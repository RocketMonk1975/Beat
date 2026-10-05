import { packager } from '@electron/packager';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('work', { recursive: true });
const paths = await packager({
  dir: '.', out: 'release/0.11.0', name: 'BEAT Windows', platform: 'win32', arch: 'x64',
  overwrite: true, asar: true, prune: false,
  ignore: [/^\/src($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/automation($|\/)/, /^\/work($|\/)/, /^\/release($|\/)/, /^\/node_modules($|\/)/, /tsconfig\.json$/, /\.map$/],
  tmpdir: `${process.cwd()}/work/package-temp`,
  download: { cacheRoot: `${process.cwd()}/../../work/electron-cache` }
});
for (const folder of paths) {
  await copyFile('../LICENSE.md', `${folder}/BEAT-LICENSE.md`);
  await copyFile('README.md', `${folder}/START-HERE.md`);
  await copyFile('PARSER-PARITY.md', `${folder}/PARSER-PARITY.md`);
  await copyFile('RELEASE-CHECKS.md', `${folder}/RELEASE-CHECKS.md`);
  await copyFile('CONNECTION.md', `${folder}/CODEX-CONNECTION.md`);
  await copyFile('COPYING', `${folder}/COPYING`);
  await copyFile('dist/THIRD-PARTY-NOTICES.txt', `${folder}/THIRD-PARTY-NOTICES.txt`);
  await writeFile(`${folder}/Launch BEAT Windows.cmd`, '@echo off\r\nsetlocal\r\nicacls "%~dp0." /grant "*S-1-15-2-1:(OI)(CI)(RX)" >nul\r\nif errorlevel 1 (\r\n  echo Windows could not grant the sandbox read permission. Run this launcher as Administrator once.\r\n  pause\r\n  exit /b 1\r\n)\r\nset "BEAT_SMOKE_TEST="\r\nset "BEAT_USER_DATA=%~dp0user-data"\r\ncd /d "%~dp0"\r\nstart "" "BEAT Windows.exe"\r\n');
}
console.log(paths.join('\n'));
