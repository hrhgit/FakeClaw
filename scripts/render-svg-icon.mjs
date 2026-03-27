import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const [inputPath, outputPath, sizeArg] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node render-svg-icon.mjs <input.svg> <output.png> [size]');
  process.exit(1);
}

const size = Number.parseInt(sizeArg ?? '256', 10);
if (!Number.isFinite(size) || size <= 0) {
  console.error(`Invalid render size: ${sizeArg}`);
  process.exit(1);
}

const svg = readFileSync(resolve(inputPath), 'utf8');
const resvg = new Resvg(svg, {
  background: 'rgba(0, 0, 0, 0)',
  fitTo: {
    mode: 'width',
    value: size
  }
});

const pngData = resvg.render();
writeFileSync(resolve(outputPath), pngData.asPng());

const fileName = fileURLToPath(import.meta.url);
console.log(`[ok] Rendered SVG with resvg: ${resolve(outputPath)} (${size}x${size}) from ${dirname(fileName)}`);
