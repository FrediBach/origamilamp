import { expect, test, type Page } from '@playwright/test'

async function woodColors(page: Page, screenshot: Buffer) {
  return page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    // Interior patches of the visible front box wall, front-right post and
    // horizontal lid. Fixing the viewport and camera keeps the background,
    // shade and hardware out of these measurements.
    const regions = {
      box: [0.455, 0.785, 0.045, 0.025],
      post: [0.5325, 0.40, 0.0025, 0.19],
      lid: [0.465, 0.724, 0.025, 0.008],
    }
    const colors = Object.fromEntries(Object.entries(regions).map(([name, [x, y, width, height]]) => {
      const pixels = context.getImageData(
        Math.round(image.width * x), Math.round(image.height * y),
        Math.max(1, Math.round(image.width * width)), Math.max(1, Math.round(image.height * height)),
      ).data
      const brightness: number[] = []
      const rgb = [0, 0, 0]
      for (let pixel = 0; pixel < pixels.length; pixel += 4) {
        brightness.push(pixels[pixel] * 0.2126 + pixels[pixel + 1] * 0.7152 + pixels[pixel + 2] * 0.0722)
        for (let channel = 0; channel < 3; channel++) rgb[channel] += pixels[pixel + channel]
      }
      brightness.sort((a, b) => a - b)
      return [name, {
        luminance: brightness.reduce((sum, value) => sum + value, 0) / brightness.length,
        p10: brightness[Math.floor(brightness.length * 0.1)],
        p90: brightness[Math.floor(brightness.length * 0.9)],
        rgb: rgb.map(value => value / brightness.length),
      }]
    }))
    image.close()
    return colors
  }, screenshot.toString('base64'))
}

test('wooden frame and electronics box retain readable shaded faces in both rooms', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByText('Top and bottom mounting', { exact: true }).click()
  await page.getByRole('button', { name: 'Metal springs', exact: true }).click()
  await page.getByRole('switch', { name: 'Wooden electronics box', exact: true }).click()
  const height = page.getByRole('spinbutton', { name: 'Internal box height (millimetres)', exact: true })
  await height.fill('80')
  await height.press('Tab')
  await page.getByRole('button', { name: 'Reset camera view', exact: true }).click()

  const canvas = page.locator('canvas')
  const light = page.getByRole('switch', { name: 'Preview light', exact: true })
  const ceiling = page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })
  const capture = async (name: string) => {
    let previous = await canvas.screenshot()
    await expect.poll(async () => {
      const next = await canvas.screenshot()
      const same = previous.equals(next)
      previous = next
      return same
    }, { timeout: 15_000 }).toBe(true)
    const screenshot = await canvas.screenshot({ path: testInfo.outputPath(`wood-${name}.png`) })
    return woodColors(page, screenshot)
  }

  const measurements = []
  for (const room of ['Tatami', 'Brutalist']) {
    await page.getByRole('button', { name: room, exact: true }).click()
    await light.setChecked(true)
    await ceiling.fill('100')
    await ceiling.press('Tab')
    const on = await capture(`${room.toLowerCase()}-on`)
    await light.setChecked(false)
    await ceiling.fill('0')
    await ceiling.press('Tab')
    const off = await capture(`${room.toLowerCase()}-off`)
    measurements.push({ room, on, off })
  }
  await testInfo.attach('wood-lighting-measurements', {
    body: JSON.stringify(measurements, null, 2), contentType: 'application/json',
  })

  for (const { room, on, off } of measurements) {
    for (const part of ['box', 'post']) {
      // Broad bounds around visually reviewed oak, allowing renderer variation.
      // The original near-black box averaged 39/255 with the lights on. Keep
      // shaded wood readable while allowing a brighter, directly lit lid.
      expect(on[part].luminance, `${room}: illuminated ${part}`).toBeGreaterThan(75)
      expect(on[part].luminance / on.lid.luminance, `${room}: ${part} / lid`).toBeGreaterThan(0.35)
      expect(off[part].luminance, `${room}: ${part} with lamp and ceiling off`).toBeGreaterThan(60)
      expect(on[part].rgb[0] - on[part].rgb[2], `${room}: warm wood ${part}`).toBeGreaterThan(25)
    }
    expect(on.lid.luminance - on.box.luminance, `${room}: lid / wall contrast`).toBeGreaterThan(15)
    expect(on.lid.luminance - off.lid.luminance, `${room}: lighting response`).toBeGreaterThan(10)
  }
  expect(errors).toEqual([])
})
