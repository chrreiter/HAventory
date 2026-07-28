#!/usr/bin/env node
// Rasterize docs/assets/social-preview.html to the 1280x640 PNG GitHub wants
// under Settings > General > Social preview (which has no API — the upload
// stays manual; see docs/repo_hardening.md).
//
//   node scripts/render_social_preview.mjs
//
// Fonts come from the rendering machine, so a regenerated PNG can differ
// slightly from the committed one; commit the result either way.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Playwright is the card package's devDependency, not the repo root's.
const require = createRequire(new URL('../cards/haventory-card/package.json', import.meta.url));
const { chromium } = require('playwright');

const source = new URL('../docs/assets/social-preview.html', import.meta.url);
const target = fileURLToPath(new URL('../docs/assets/social-preview.png', import.meta.url));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.goto(source.href, { waitUntil: 'load' });
  await page.screenshot({ path: target, type: 'png' });
  console.log(`wrote ${target}`);
} finally {
  await browser.close();
}
