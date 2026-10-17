import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const flickerName = 'Light flicker (percent)'

async function setControl(control: Locator, value: string, committed = value) {
  await control.fill(value)
  await control.press('Tab')
  await expect(control).toHaveValue(committed)
}

// Only use this for steady/off/manufacturing views. An enabled flicker should
// keep changing; waiting for identical frames would hide or stall that check.
async function settledFrame(canvas: Locator) {
  let previous = await canvas.screenshot()
  await expect.poll(async () => {
    const next = await canvas.screenshot()
    const same = previous.equals(next)
    previous = next
    return same
  }, { timeout: 15_000 }).toBe(true)
  return previous
}

async function shadeBrightness(page: Page, screenshot: Buffer, cropped = false) {
  return page.evaluate(async ({ encoded, cropped }) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    // Front diffuser strip, excluding the support frame and source fittings.
    // This measures visible transmission, rather than just a changing input.
    const pixels = (cropped ? context.getImageData(0, 0, image.width, image.height) : context.getImageData(
      Math.round(image.width * 0.445), Math.round(image.height * 0.18),
      Math.round(image.width * 0.07), Math.round(image.height * 0.60),
    )).data
    image.close()
    let total = 0
    for (let index = 0; index < pixels.length; index += 4) {
      total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
    }
    return total / (pixels.length / 4)
  }, { encoded: screenshot.toString('base64'), cropped })
}

async function shadeFrame(page: Page, canvas: Locator) {
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  // A small screenshot avoids repeatedly encoding the entire room while the
  // light animates. The patch is identical to the steady-frame measurement.
  return page.screenshot({ clip: {
    x: bounds!.x + Math.round(bounds!.width * 0.445),
    y: bounds!.y + Math.round(bounds!.height * 0.18),
    width: Math.round(bounds!.width * 0.07),
    height: Math.round(bounds!.height * 0.60),
  } })
}

test('one flicker setting defaults to steady, persists, resets and imports older designs', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const flicker = page.getByRole('spinbutton', { name: flickerName, exact: true })
  const slider = page.getByRole('slider', { name: flickerName, exact: true })
  await expect(flicker).toHaveValue('0')
  await expect(slider).toHaveCount(1)
  await expect(flicker).toHaveAccessibleDescription(/0% keeps the light steady/)
  await setControl(flicker, '73')
  for (const source of ['One bulb', 'Two bulbs', 'LED column']) {
    await page.getByRole('button', { name: source, exact: true }).click()
    await expect(flicker).toHaveValue('73')
  }
  await page.reload()
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await expect(flicker).toHaveValue('73')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save design', exact: true }).click()
  const recipePath = await (await downloadPromise).path()
  expect(recipePath).toBeTruthy()
  const recipe = JSON.parse(await readFile(recipePath!, 'utf8'))
  expect(recipe.parameters.lightFlicker).toBe(73)
  await page.getByRole('button', { name: 'Reset all design settings', exact: true }).click()
  await expect(flicker).toHaveValue('0')
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles(recipePath!)
  await expect(flicker).toHaveValue('73')

  delete recipe.parameters.lightFlicker
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles({
    name: 'older-design.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)),
  })
  await expect(flicker).toHaveValue('0')
  await expect(page.getByRole('spinbutton', { name: 'Light warmth (kelvin)', exact: true })).toHaveValue('2700')
  await expect(page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })).toHaveValue('100')
  expect(errors).toEqual([])
})

test('flicker is keyboard accessible and fits the mobile Finish controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const flicker = page.getByRole('spinbutton', { name: flickerName, exact: true })
  const slider = page.getByRole('slider', { name: flickerName, exact: true })
  await slider.focus()
  await slider.press('End')
  await expect(flicker).toHaveValue('100')
  await expect(slider).toHaveAttribute('aria-valuetext', '100 percent')
  await slider.press('ArrowLeft')
  await expect(flicker).toHaveValue('99')
  await slider.press('Home')
  await expect(flicker).toHaveValue('0')
  await setControl(flicker, '101', '100')
  await setControl(flicker, '-1', '0')
  await flicker.scrollIntoViewIfNeeded()
  const bounds = await flicker.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).include('.light-controls').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('flicker-mobile.png'), fullPage: true })
})

test('every light source flickers through the shade in room and studio, and can return to steady', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const flicker = page.getByRole('spinbutton', { name: flickerName, exact: true })
  const ceiling = page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })
  const light = page.getByRole('switch', { name: 'Preview light', exact: true })
  const canvas = page.locator('canvas')
  const measurements = []
  for (const environment of ['Tatami', 'Studio']) {
    await page.getByRole('button', { name: environment, exact: true }).click()
    for (const source of ['LED column', 'One bulb', 'Two bulbs']) {
      await page.getByRole('button', { name: source, exact: true }).click()
      const steady = await settledFrame(canvas)
      const steadyBrightness = await shadeBrightness(page, steady)
      await setControl(flicker, '100')
      const frames: Array<{ brightness: number; elapsedMilliseconds: number; screenshot: Buffer }> = []
      const started = Date.now()
      for (let sample = 0; sample < 6; sample++) {
        await page.waitForTimeout(240)
        const screenshot = await shadeFrame(page, canvas)
        frames.push({ brightness: await shadeBrightness(page, screenshot, true), elapsedMilliseconds: Date.now() - started, screenshot })
      }
      const sorted = [...frames].sort((a, b) => a.brightness - b.brightness)
      const variation = sorted.at(-1)!.brightness - sorted[0].brightness
      measurements.push({ environment, source, steadyBrightness, frames: frames.map(({ brightness, elapsedMilliseconds }) => ({ brightness, elapsedMilliseconds })), variation })
      await testInfo.attach(`${environment}-${source}-brightness`, { body: JSON.stringify(measurements.at(-1), null, 2), contentType: 'application/json' })
      for (const [state, frame] of [['darkest', sorted[0]], ['brightest', sorted.at(-1)!]] as const) {
        await testInfo.attach(`${environment}-${source}-${state}`, { body: frame.screenshot, contentType: 'image/png' })
      }
      // A half-level change passed the old test while being imperceptible.
      // Demand a clearly visible swing even under the default ceiling light.
      expect(variation, `${environment}: ${source} visibly modulates the diffuser`).toBeGreaterThanOrEqual(8)
      await setControl(flicker, '0')
      const restored = await settledFrame(canvas)
      expect(Math.abs(await shadeBrightness(page, restored) - steadyBrightness), `${environment}: ${source} restores steady brightness`).toBeLessThan(0.1)
      await page.waitForTimeout(500)
      expect(restored.equals(await canvas.screenshot()), `${environment}: ${source} remains steady`).toBe(true)
      await expect(ceiling).toHaveValue('100')
    }
  }
  await setControl(flicker, '100')
  await light.setChecked(false)
  const off = await settledFrame(canvas)
  await page.waitForTimeout(800)
  expect(off.equals(await canvas.screenshot()), 'switching the lamp off stops visible flicker').toBe(true)
  await expect(flicker).toHaveValue('100')
  await expect(ceiling).toHaveValue('100')
  await testInfo.attach('flicker-brightness-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  expect(errors).toEqual([])
})

test('manufacturing previews stay still with flicker enabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: flickerName, exact: true }), '100')
  const canvas = page.locator('canvas')
  for (const mode of ['TPU', 'Materials', 'Section']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await expect(page.getByRole('region', { name: /^Compressed manufacturing model/ })).toBeVisible()
    const frame = await settledFrame(canvas)
    await page.waitForTimeout(800)
    expect(frame.equals(await canvas.screenshot()), `${mode} remains still`).toBe(true)
  }
})
