// Start the app, then run: node scripts/capture-og-image.mjs [local URL]
// Uses the project's Playwright Chromium installation.
import { chromium } from '@playwright/test'

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  args: ['--use-angle=swiftshader', '--enable-webgl'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await page.goto(process.argv[2] || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await page.locator('canvas').waitFor({ state: 'visible' })
  for (const [name, value] of [
    ['Width (millimetres)', '200'], ['Depth (millimetres)', '200'],
    ['Display height (millimetres)', '380'], ['Full pleats', '20'],
    ['Membrane width (millimetres)', '25'],
  ]) {
    const input = page.getByRole('spinbutton', { name, exact: true })
    await input.fill(value)
    await input.press('Tab')
  }
  // Capture-only framing; the shipped application styles are unchanged.
  await page.addStyleTag({ content: `
    .site-header { min-height: 72px; padding: 0 32px; }
    .main-shell { padding: 20px 32px 24px; }
    .workspace { --workspace-height: 510px; grid-template-columns: 290px minmax(0, 1fr); border-radius: 8px; }
    .design-summary, .validation-bar, .site-footer { display: none; }
  ` })
  await page.evaluate(() => document.fonts.ready)
  // Allow the WebGL scene and soft shadows to settle before capture.
  await page.waitForTimeout(4000)
  await page.screenshot({ path: 'public/og-image.png' })
} finally {
  await browser.close()
}
