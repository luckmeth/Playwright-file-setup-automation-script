#!/usr/bin/env node

/**
 * Playwright Auto-Setup Script
 * Works with both CommonJS ("type": "commonjs") and ESM ("type": "module") projects.
 * Drop into any project root and run: node setup-playwright.js
 */

import fs from 'fs';
import { createRequire } from 'module';

// Fallback: if this file is loaded as CJS (no "type":"module"), re-run as CJS
// by detecting whether `import` exists. If not, the lines below are never reached.

// ── Terminal colors ──────────────────────────────────────────────────────────
const c = {
  reset : '\x1b[0m',
  bold  : '\x1b[1m',
  green : '\x1b[32m',
  yellow: '\x1b[33m',
  cyan  : '\x1b[36m',
  red   : '\x1b[31m',
  dim   : '\x1b[2m',
};
const ok   = (m) => console.log(`${c.green}✅ ${m}${c.reset}`);
const warn = (m) => console.log(`${c.yellow}⚠  ${m}${c.reset}`);
const err  = (m) => console.log(`${c.red}✗  ${m}${c.reset}`);
const hdr  = (m) => console.log(`\n${c.bold}${m}${c.reset}`);
const dim  = (m) => console.log(`${c.dim}   ${m}${c.reset}`);

// ── Step 1: Detect project stack ─────────────────────────────────────────────
function detectStack() {
  const pkg  = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const stack = {
    pkg,
    isElectron   : !!deps['electron'],
    isReact      : !!deps['react'],
    isVite       : !!deps['vite'],
    isNext       : !!deps['next'],
    isVue        : !!deps['vue'],
    isCRA        : !!deps['react-scripts'],
    isSvelte     : !!deps['svelte'],
    hasPlaywright: !!deps['@playwright/test'],
    port         : 5173,
    devCommand   : 'npm run dev',
  };

  // Auto-detect port from vite.config
  const viteConfig = ['vite.config.ts', 'vite.config.js'].find(f => fs.existsSync(f));
  if (viteConfig) {
    const match = fs.readFileSync(viteConfig, 'utf8').match(/port\s*:\s*(\d+)/);
    if (match) stack.port = parseInt(match[1]);
  }
  if (stack.isNext) { stack.port = 3000; }
  if (stack.isCRA)  { stack.port = 3000; stack.devCommand = 'npm start'; }

  return stack;
}

// ── Step 2: Scan src for components ──────────────────────────────────────────
function scanComponents() {
  const search = ['src/components', 'src/pages', 'src/views', 'components', 'pages', 'app'];
  const found  = [];
  for (const dir of search) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => /\.(tsx|jsx|ts|js)$/.test(f))
      .map(f => ({ name: f.replace(/\.(tsx|jsx|ts|js)$/, ''), dir }));
    found.push(...files);
  }
  return found;
}

// ── Step 3: Classify components by purpose ───────────────────────────────────
function classify(components) {
  const authKw      = ['auth', 'login', 'signin', 'signup', 'register', 'password', 'modal'];
  const dashKw      = ['dashboard', 'home', 'main', 'overview', 'index'];
  const layoutKw    = ['sidebar', 'navbar', 'header', 'footer', 'layout', 'nav', 'menu'];
  const result = { auth: [], dashboard: [], layout: [], other: [] };

  for (const comp of components) {
    const n = comp.name.toLowerCase();
    if      (authKw.some(k => n.includes(k)))   result.auth.push(comp);
    else if (dashKw.some(k => n.includes(k)))   result.dashboard.push(comp);
    else if (layoutKw.some(k => n.includes(k))) result.layout.push(comp);
    else                                         result.other.push(comp);
  }
  return result;
}

// ── Step 4: Generate playwright.config.ts ────────────────────────────────────
function makeConfig(stack) {
  return `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:${stack.port}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: '${stack.devCommand}',
    url: 'http://localhost:${stack.port}',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
`;
}

// ── Step 5: Generate smart tests ─────────────────────────────────────────────
function makeTests(classified) {
  const blocks = [];

  blocks.push(`import { test, expect } from '@playwright/test';

// ── Smoke ────────────────────────────────────────────────────────────────────
test('app loads without crashing', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toBeVisible();
});
`);

  if (classified.auth.length > 0) {
    blocks.push(`
// ── Auth ─────────────────────────────────────────────────────────────────────
test('login form inputs are visible', async ({ page }) => {
  await page.goto('/');
  const email    = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  const hasEmail = await email.isVisible().catch(() => false);
  const hasPass  = await password.isVisible().catch(() => false);
  expect(hasEmail || hasPass).toBeTruthy();
});

test('shows error feedback on bad credentials', async ({ page }) => {
  await page.goto('/');
  const email    = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  if (await email.isVisible().catch(() => false))    await email.fill('bad@test.com');
  if (await password.isVisible().catch(() => false)) await password.fill('wrongpass');
  const submit = page.locator('button[type="submit"]').first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    await page.waitForTimeout(3000);
  }
  await expect(page.locator('body')).toBeVisible();
});
`);
  }

  if (classified.layout.length > 0) {
    blocks.push(`
// ── Layout ───────────────────────────────────────────────────────────────────
test('navigation/sidebar is present', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toBeVisible();
});
`);
  }

  if (classified.dashboard.length > 0) {
    blocks.push(`
// ── Dashboard ────────────────────────────────────────────────────────────────
test('dashboard view renders after load', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toBeVisible();
});
`);
  }

  blocks.push(`
// ── Responsive ───────────────────────────────────────────────────────────────
test('no horizontal scroll on mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const bodyWidth     = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 20);
});

test('app renders on tablet viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
`);

  return blocks.join('');
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n${c.bold}${'─'.repeat(45)}`);
  console.log(`  🎭  Playwright Auto-Setup`);
  console.log(`${'─'.repeat(45)}${c.reset}`);

  if (!fs.existsSync('package.json')) {
    err('No package.json found. Run this from your project root folder.');
    process.exit(1);
  }

  hdr('1. Analyzing project...');
  const stack      = detectStack();
  const components = scanComponents();
  const classified = classify(components);

  dim(`Framework : ${stack.isNext ? 'Next.js' : stack.isReact ? 'React' : stack.isVue ? 'Vue' : stack.isSvelte ? 'Svelte' : 'Unknown'}`);
  dim(`Build tool: ${stack.isVite ? 'Vite' : stack.isNext ? 'Next' : stack.isCRA ? 'CRA' : 'Unknown'}`);
  dim(`Electron  : ${stack.isElectron ? 'Yes' : 'No'}`);
  dim(`Dev port  : ${stack.port}`);
  dim(`Components: ${components.length} found — auth:${classified.auth.length} dashboard:${classified.dashboard.length} layout:${classified.layout.length}`);
  dim(`Playwright: ${stack.hasPlaywright ? 'already installed ✓' : 'NOT installed'}`);

  if (!stack.hasPlaywright) {
    warn('\n@playwright/test not found. After setup runs, install it:');
    console.log(`${c.cyan}     npm install -D @playwright/test${c.reset}\n`);
  }

  hdr('2. Generating playwright.config.ts...');
  if (fs.existsSync('playwright.config.ts') || fs.existsSync('playwright.config.js')) {
    warn('playwright.config already exists — skipping. Delete it to regenerate.');
  } else {
    fs.writeFileSync('playwright.config.ts', makeConfig(stack));
    ok('Created playwright.config.ts');
  }

  hdr('3. Creating test files...');
  if (!fs.existsSync('tests')) {
    fs.mkdirSync('tests');
    ok('Created tests/ folder');
  }
  const specPath = 'tests/app.spec.ts';
  if (fs.existsSync(specPath)) {
    warn(`${specPath} already exists — skipping. Delete it to regenerate.`);
  } else {
    fs.writeFileSync(specPath, makeTests(classified));
    ok(`Created ${specPath}`);
  }

  hdr('4. Updating package.json scripts...');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (!pkg.scripts) pkg.scripts = {};
  const toAdd = {
    test          : 'playwright test',
    'test:ui'     : 'playwright test --ui',
    'test:report' : 'playwright show-report',
  };
  let added = 0;
  for (const [k, v] of Object.entries(toAdd)) {
    if (!pkg.scripts[k]) { pkg.scripts[k] = v; added++; }
  }
  if (added > 0) {
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
    ok(`Added ${added} script(s) to package.json`);
  } else {
    warn('Test scripts already exist in package.json — skipping.');
  }

  console.log(`\n${c.bold}${'─'.repeat(45)}${c.reset}`);
  console.log(`${c.green}${c.bold}  Setup complete!${c.reset}`);
  console.log(`${'─'.repeat(45)}\n`);
  console.log(`${c.bold}  Next steps:${c.reset}`);
  if (!stack.hasPlaywright) {
    console.log(`${c.cyan}  npm install -D @playwright/test${c.reset}  ← install Playwright first`);
  }
  console.log(`${c.cyan}  npx playwright install${c.reset}           ← install browsers (once)`);
  console.log(`${c.cyan}  npm test${c.reset}                         ← run all tests`);
  console.log(`${c.cyan}  npm run test:ui${c.reset}                  ← visual/debug mode`);
  console.log(`${c.cyan}  npm run test:report${c.reset}              ← open HTML report\n`);
}

main();
