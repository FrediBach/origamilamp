import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function floorColor(page: Page, screenshot: Buffer) {
  // Sample the exposed floor, clear of the lamp and controls. Measuring the
  // rendered room catches controls that update their values without the light.
  return page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(
      Math.round(image.width * 0.62), Math.round(image.height * 0.58),
      Math.round(image.width * 0.14), Math.round(image.height * 0.11),
    ).data
    image.close()
    const sum = [0, 0, 0]
    for (let index = 0; index < pixels.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[index + channel]
    }
    const [red, green, blue] = sum.map(value => value / (pixels.length / 4))
    return { warmth: red - blue, brightness: red * 0.2126 + green * 0.7152 + blue * 0.0722 }
  }, screenshot.toString('base64'))
}

test('ceiling warmth and intensity change the room independently and survive saving', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const warmth = page.getByRole('spinbutton', { name: 'Ceiling light warmth (kelvin)', exact: true })
  const intensity = page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })
  const lampWarmth = page.getByRole('spinbutton', { name: 'Light warmth (kelvin)', exact: true })
  const lamp = page.getByRole('switch', { name: 'Preview light', exact: true })
  await expect(warmth).toHaveValue('4000')
  await expect(intensity).toHaveValue('100')
  await lamp.click()
  await expect(lamp).not.toBeChecked()

  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  const preview = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
  await preview.focus()
  for (let i = 0; i < 6; i++) await preview.press('-')
  const setControl = async (control: typeof warmth, value: string) => {
    await control.fill(value)
    await control.press('Tab')
    await expect(control).toHaveValue(value)
  }
  const capture = async (name: string) => {
    let previous = await canvas.screenshot()
    await expect.poll(async () => {
      const next = await canvas.screenshot()
      const same = previous.equals(next)
      previous = next
      return same
    }, { timeout: 15_000 }).toBe(true)
    return floorColor(page, await canvas.screenshot({ path: testInfo.outputPath(`ceiling-${name}.png`) }))
  }

  await setControl(warmth, '1800')
  const warm = await capture('warm')
  await setControl(warmth, '6500')
  const cool = await capture('cool')
  expect(warm.warmth - cool.warmth).toBeGreaterThan(10)
  await setControl(intensity, '0')
  const off = await capture('off')
  await setControl(intensity, '200')
  const bright = await capture('bright')
  expect(cool.brightness - off.brightness).toBeGreaterThan(5)
  expect(bright.brightness - cool.brightness).toBeGreaterThan(3)
  await expect(lamp).not.toBeChecked()
  await expect(lampWarmth).toHaveValue('2700')

  await setControl(warmth, '3200')
  await setControl(intensity, '125')
  await setControl(lampWarmth, '2200')
  await lamp.click()
  await expect(warmth).toHaveValue('3200')
  await expect(intensity).toHaveValue('125')
  await intensity.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('ceiling-controls-desktop.png'), fullPage: true })
  await page.reload()
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await expect(warmth).toHaveValue('3200')
  await expect(intensity).toHaveValue('125')
  await expect(lampWarmth).toHaveValue('2200')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save design', exact: true }).click()
  const recipePath = await (await downloadPromise).path()
  expect(recipePath).not.toBeNull()
  await setControl(warmth, '6500')
  await setControl(intensity, '0')
  await setControl(lampWarmth, '6500')
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles(recipePath!)
  await expect(warmth).toHaveValue('3200')
  await expect(intensity).toHaveValue('125')
  await expect(lampWarmth).toHaveValue('2200')
  expect(errors).toEqual([])
})

test('ceiling controls support keyboard editing and fit on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const warmth = page.getByRole('spinbutton', { name: 'Ceiling light warmth (kelvin)', exact: true })
  const intensity = page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })
  const warmthSlider = page.getByRole('slider', { name: 'Ceiling light warmth (kelvin)', exact: true })
  const intensitySlider = page.getByRole('slider', { name: 'Ceiling light intensity (percent)', exact: true })
  await warmthSlider.focus()
  await warmthSlider.press('End')
  await expect(warmth).toHaveValue('6500')
  await warmthSlider.press('ArrowLeft')
  await expect(warmth).toHaveValue('6400')
  await intensitySlider.focus()
  await intensitySlider.press('End')
  await expect(intensity).toHaveValue('200')
  await intensitySlider.press('Home')
  await expect(intensity).toHaveValue('0')
  for (const control of [warmth, intensity]) {
    await control.scrollIntoViewIfNeeded()
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('ceiling-controls-mobile.png'), fullPage: true })
})
