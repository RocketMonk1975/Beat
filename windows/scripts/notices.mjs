import { readFile, writeFile } from 'node:fs/promises';
const project = JSON.parse(await readFile('package.json', 'utf8'));
const visited = new Set();
const entries = [];
async function visit(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const root = `node_modules/${name}`;
  const pkg = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { license = await readFile(`${root}/${file}`, 'utf8'); break; } catch {}
  }
  if (!license) throw new Error(`Missing license text for bundled dependency ${name}`);
  entries.push(`${name} ${pkg.version}\n${license}`);
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await visit(dependency);
}
for (const dependency of Object.keys(project.dependencies)) await visit(dependency);
await writeFile('dist/THIRD-PARTY-NOTICES.txt', `BEAT Windows bundles the following third-party libraries.\nElectron and Chromium license texts are shipped separately alongside the executable.\n\n${entries.join('\n\n----------------------------------------\n\n')}`);
console.log(`Preserved license texts for ${visited.size} bundled dependencies.`);
