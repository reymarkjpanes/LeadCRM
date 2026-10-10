import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, it } from 'vitest';

it('compiles semantic surfaces and primary actions against their local theme variables', async () => {
  const path = resolve('src/index.css');
  const css = await readFile(path, 'utf8');
  // Explicit utilities exercise these aliases without scanning unrelated project files.
  const scopedCss = css.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const result = await postcss([tailwind()]).process(`${scopedCss}\n@source inline("bg-card bg-primary text-foreground");`, { from: path });
  expect(result.css).toMatch(/\.bg-card\s*\{[^}]*background-color:\s*var\(--card\)/);
  expect(result.css).toMatch(/\.bg-primary\s*\{[^}]*background-color:\s*var\(--primary\)/);
  expect(result.css).toMatch(/\.text-foreground\s*\{[^}]*color:\s*var\(--text-primary\)/);
}, 30000);
