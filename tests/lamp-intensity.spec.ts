import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const intensityName = 'Lamp light intensity (percent)'
const crop = { x: 0.31, y: 0.18, width: 0.205, height: 0.68 }
const patches = {
  shade: { x: 0.445, y: 0.18, width: 0.07, height: 0.60 },
  floor: { x: 0.31, y: 0.80, width: 0.06, height: 0.06 },
}

async function setControl(control: Locator, value: string, committed = value) {
  await control.fill(value)
  await control.press('Tab')
  await expect(control).toHaveValue(committed)
}

async function lightingFrame(page: Page, canvas: Locator) {
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  return page.screenshot({ clip: {
    x: bounds!.x + Math.round(bounds!.width * crop.x),
    y: bounds!.y + Math.round(bounds!.height * crop.y),
    width: Math.round(bounds!.width * crop.width),
    height: Math.round(bounds!.height * crop.height),
  } })
}

async function settledFrame(page: Page, canvas: Locator) {
  let previous = await lightingFrame(page, canvas)
  await expect.poll(async () => {
    const next = await lightingFrame(page, canvas)
    const same = previous.equals(next)
    previous = next
    return same
  }, { timeout: 15_000 }).toBe(true)
  return previous
}

async function brightness(page: Page, screenshot: Buffer) {
  return page.evaluate(async ({ encoded, crop, patches }) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const measure = (patch: typeof patches.shade) => {
      const x = Math.round(image.width * (patch.x - crop.x) / crop.width)
      const y = Math.round(image.height * (patch.y - crop.y) / crop.height)
      const width = Math.min(image.width - x, Math.round(image.width * patch.width / crop.width))
      const height = Math.min(image.height - y, Math.round(image.height * patch.height / crop.height))
      const pixels = context.getImageData(x, y, width, height).data
      let total = 0
      for (let index = 0; index < pixels.length; index += 4) {
        total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
      }
      return total / (pixels.length / 4)
    }
    const result = { shade: measure(patches.shade), floor: measure(patches.floor) }
    image.close()
    return result
  }, { encoded: screenshot.toString('base64'), crop, patches })
}

test('lamp intensity is independent, retained by its switch, and survives saved and older designs', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const intensity = page.getByRole('spinbutton', { name: intensityName, exact: true })
  const ceiling = page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })
  const flicker = page.getByRole('spinbutton', { name: 'Light flicker (percent)', exact: true })
  const light = page.getByRole('switch', { name: 'Preview light', exact: true })
  await expect(intensity).toHaveValue('100')
  await expect(page.getByRole('slider', { name: intensityName, exact: true })).toHaveCount(1)
  await setControl(ceiling, '62')
  await setControl(intensity, '137')
  await setControl(flicker, '47')
  for (const source of ['One bulb', 'Two bulbs', 'LED column']) {
    await page.getByRole('button', { name: source, exact: true }).click()
    await expect(intensity).toHaveValue('137')
  }
  await light.setChecked(false)
  await expect(intensity).toHaveValue('137')
  await expect(ceiling).toHaveValue('62')
  await expect(flicker).toHaveValue('47')
  await light.setChecked(true)
  await expect(intensity).toHaveValue('137')
  await page.reload()
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await expect(intensity).toHaveValue('137')
  await expect(ceiling).toHaveValue('62')
  await expect(flicker).toHaveValue('47')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save design', exact: true }).click()
  const recipePath = await (await downloadPromise).path()
  expect(recipePath).toBeTruthy()
  const recipe = JSON.parse(await readFile(recipePath!, 'utf8'))
  expect(recipe.parameters.lightIntensity).toBe(137)
  await page.getByRole('button', { name: 'Reset all design settings', exact: true }).click()
  await expect(intensity).toHaveValue('100')
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles(recipePath!)
  await expect(intensity).toHaveValue('137')
  await expect(ceiling).toHaveValue('62')
  await expect(flicker).toHaveValue('47')
  delete recipe.parameters.lightIntensity
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles({
    name: 'design-before-intensity.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)),
  })
  await expect(intensity).toHaveValue('100')
  await expect(ceiling).toHaveValue('62')
  await expect(flicker).toHaveValue('47')
  expect(errors).toEqual([])
})

test('lamp intensity supports keyboard editing, bounds and mobile accessibility', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const intensity = page.getByRole('spinbutton', { name: intensityName, exact: true })
  const slider = page.getByRole('slider', { name: intensityName, exact: true })
  await slider.focus()
  await slider.press('End')
  await expect(intensity).toHaveValue('200')
  await expect(slider).toHaveAttribute('aria-valuetext', '200 percent')
  await slider.press('ArrowLeft')
  await expect(intensity).toHaveValue('199')
  await slider.press('Home')
  await expect(intensity).toHaveValue('0')
  await setControl(intensity, '201', '200')
  await setControl(intensity, '-1', '0')
  await intensity.scrollIntoViewIfNeeded()
  const bounds = await intensity.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).include('.light-controls').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('lamp-intensity-mobile.png'), fullPage: true })
})

for (const environment of ['Tatami', 'Studio']) {
  test(`lamp intensity visibly scales each source's shade and cast light in ${environment}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.getByRole('tab', { name: 'Finish', exact: true }).click()
    await page.getByRole('button', { name: environment, exact: true }).click()
    const intensity = page.getByRole('spinbutton', { name: intensityName, exact: true })
    const ceiling = page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })
    const light = page.getByRole('switch', { name: 'Preview light', exact: true })
    const flicker = page.getByRole('spinbutton', { name: 'Light flicker (percent)', exact: true })
    const canvas = page.locator('canvas')
    for (const source of ['LED column', 'One bulb', 'Two bulbs']) {
      await page.getByRole('button', { name: source, exact: true }).click()
      const measurements: Array<{ intensity: number; shade: number; floor: number }> = []
      const frames: Buffer[] = []
      for (const value of [0, 50, 100, 200]) {
        await setControl(intensity, String(value))
        const frame = await settledFrame(page, canvas)
        frames.push(frame)
        measurements.push({ intensity: value, ...await brightness(page, frame) })
      }
      await testInfo.attach(`${source}-brightness`, { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
      for (const [index, state] of [[0, 'off'], [3, 'bright']] as const) {
        await testInfo.attach(`${source}-${state}`, { body: frames[index], contentType: 'image/png' })
      }
      for (let index = 1; index < measurements.length; index++) {
        const change = `${source}, ${measurements[index - 1].intensity}% → ${measurements[index].intensity}%`
        expect(measurements[index].shade - measurements[index - 1].shade, `${change}: transmitted shade light`).toBeGreaterThan(2)
        expect(measurements[index].floor - measurements[index - 1].floor, `${change}: light cast onto the floor`).toBeGreaterThan(0.3)
      }
      expect(measurements[3].shade - measurements[0].shade, `${source}: total visible shade range`).toBeGreaterThan(20)
      expect(measurements[3].floor - measurements[0].floor, `${source}: total cast-light range`).toBeGreaterThan(3)
      await expect(ceiling).toHaveValue('100')
      await expect(light).toBeChecked()

      if (source === 'Two bulbs') {
        await light.setChecked(false)
        expect((await settledFrame(page, canvas)).equals(frames[0]), 'the master switch and zero intensity produce the same unlit scene').toBe(true)
        await expect(intensity).toHaveValue('200')
        await light.setChecked(true)
        expect((await settledFrame(page, canvas)).equals(frames[3]), 'the master switch restores the selected brightness').toBe(true)
        await setControl(intensity, '0')
        await setControl(flicker, '100')
        const off = await settledFrame(page, canvas)
        await page.waitForTimeout(800)
        expect(off.equals(await lightingFrame(page, canvas)), 'zero intensity remains dark and still with flicker at 100%').toBe(true)
        expect(off.equals(frames[0])).toBe(true)
        await expect(light).toBeChecked()
        await expect(ceiling).toHaveValue('100')
      }
    }
    expect(errors).toEqual([])
  })
}
