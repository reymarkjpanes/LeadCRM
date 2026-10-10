// Keep the CommonJS compatibility entrypoints and all their dependencies synchronized.
const { readdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve, relative } = require('node:path');
const root = resolve(__dirname, '..');
function sync(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const source = resolve(folder, entry.name);
    if (entry.isDirectory()) { sync(source); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const target = resolve(root, 'src', relative(resolve(root, 'dist'), source));
    const compiled = readFileSync(source, 'utf8'), current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (compiled.replaceAll('\r\n', '\n') !== current.replaceAll('\r\n', '\n')) writeFileSync(target, compiled);
  }
}
sync(resolve(root, 'dist'));
