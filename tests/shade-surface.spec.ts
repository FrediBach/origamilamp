import { writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'

async function settledFrame(canvas: Locator) {
  let previous = await canvas.screenshot()
  let stableFrames = 0
  await expect.poll(async () => {
    const next = await canvas.screenshot()
    stableFrames = previous.equals(next) ? stableFrames + 1 : 0
    previous = next
    return stableFrames
  }, { timeout: 20_000, intervals: [350] }).toBeGreaterThanOrEqual(3)
  return previous
}

async function surfaceVariation(page: Page, frame: Buffer) {
  return page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    // The middle of one front membrane, clear of creases, hardware and UI.
    // Remove each row's lighting gradient to isolate stippling and cloudiness.
    const { data, width, height } = context.getImageData(
      Math.round(image.width * 0.35), Math.round(image.height * 0.46),
      Math.round(image.width * 0.30), Math.round(image.height * 0.05),
    )
    image.close()
    let residualSquares = 0, total = 0
    const center = (width - 1) / 2
    const xSquares = width * (width * width - 1) / 12
    for (let y = 0; y < height; y++) {
      const row = Array.from({ length: width }, (_, x) => {
        const pixel = (y * width + x) * 4
        return data[pixel] * 0.2126 + data[pixel + 1] * 0.7152 + data[pixel + 2] * 0.0722
      })
      const mean = row.reduce((sum, value) => sum + value, 0) / width
      const slope = row.reduce((sum, value, x) => sum + (x - center) * value, 0) / xSquares
      total += mean * width
      row.forEach((value, x) => { residualSquares += (value - mean - slope * (x - center)) ** 2 })
    }
    return { mean: total / (width * height), residualRms: Math.sqrt(residualSquares / (width * height)) }
  }, frame.toString('base64'))
}

test('unlit shade remains smooth when viewed close up', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('switch', { name: 'Preview light', exact: true }).setChecked(false)
  const canvas = page.locator('canvas')
  const preview = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
  const measurements = []
  for (const environment of ['Tatami', 'Brutalist', 'Studio']) {
    await page.getByRole('button', { name: environment, exact: true }).click()
    await preview.focus()
    await preview.press('Home')
    for (let step = 0; step < 17; step++) await preview.press('+')
    const frame = await settledFrame(canvas)
    await writeFile(testInfo.outputPath(`${environment}-plain.png`), frame)
    const surface = await surfaceVariation(page, frame)
    measurements.push({ environment, surface })
    // The former texture and hashed shadows measured 1.35–1.57 here.
    expect.soft(surface.residualRms, `${environment}: close-up surface noise`).toBeLessThan(0.75)
    expect(surface.mean).toBeGreaterThan(180)
    expect(surface.mean).toBeLessThan(240)
  }
  await testInfo.attach('shade-surface-variation', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  await writeFile(testInfo.outputPath('shade-surface-variation.json'), JSON.stringify(measurements, null, 2))
  expect(errors).toEqual([])
})
