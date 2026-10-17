import { expect, test, type Page } from '@playwright/test'

async function shadeGlowProfile(page: Page, on: Buffer, off: Buffer) {
  return page.evaluate(async ({ on, off }) => {
    const readPixels = async (encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      // A narrow strip of the front diffuser excludes its frame and background.
      const pixels = context.getImageData(
        Math.round(image.width * 0.445), Math.round(image.height * 0.18),
        Math.round(image.width * 0.07), Math.round(image.height * 0.60),
      )
      image.close()
      return pixels
    }
    const [lit, unlit] = await Promise.all([readPixels(on), readPixels(off)])
    // Average approximately one pleat per band, then subtract the unlit shade
    // to isolate transmission from the fixed room lighting and pleat shadows.
    return Array.from({ length: 20 }, (_, band) => {
      let brightness = 0
      let count = 0
      for (let y = Math.round(lit.height * band / 20); y < Math.round(lit.height * (band + 1) / 20); y++) {
        for (let x = 0; x < lit.width; x++) {
          const pixel = (y * lit.width + x) * 4
          brightness += (lit.data[pixel] - unlit.data[pixel]) * 0.2126
            + (lit.data[pixel + 1] - unlit.data[pixel + 1]) * 0.7152
            + (lit.data[pixel + 2] - unlit.data[pixel + 2]) * 0.0722
          count++
        }
      }
      return brightness / count
    })
  }, { on: on.toString('base64'), off: off.toString('base64') })
}

test('shade illumination follows bulb placement smoothly', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  const height = page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true })
  const ceiling = page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true })
  const light = page.getByRole('switch', { name: 'Preview light', exact: true })
  const canvas = page.locator('canvas')
  const capture = async (name: string) => {
    let previous = await canvas.screenshot()
    await expect.poll(async () => {
      const next = await canvas.screenshot()
      const same = previous.equals(next)
      previous = next
      return same
    }, { timeout: 15_000 }).toBe(true)
    return canvas.screenshot({ path: testInfo.outputPath(`shade-${name}.png`) })
  }
  const peakPositions: number[] = []
  for (const value of ['35', '70']) {
    await height.fill(value)
    await height.press('Tab')
    const on = await capture(`room-${value}`)
    await light.click()
    const off = await capture(`room-${value}-off`)
    await light.click()
    const profile = await shadeGlowProfile(page, on, off)
    const peak = Math.max(...profile)
    const lowerEdge = profile.slice(-3).reduce((sum, brightness) => sum + brightness, 0) / 3
    const largestStep = Math.max(...profile.slice(1).map((brightness, index) => Math.abs(brightness - profile[index])))
    expect(peak).toBeGreaterThan(30)
    // Direct point lighting used to flood all faces below the bulb, leaving a
    // bright plateau to the bottom. A transmitting diffuser fades away from it.
    expect(lowerEdge / peak).toBeLessThan(0.3)
    expect(largestStep / peak).toBeLessThan(0.4)
    peakPositions.push(profile.indexOf(peak))
  }
  expect(peakPositions[0] - peakPositions[1]).toBeGreaterThanOrEqual(3)
  await height.fill('35')
  await height.press('Tab')
  await ceiling.fill('0')
  await ceiling.press('Tab')
  await capture('room-35-ceiling-off')
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await capture('studio-35')
  await height.fill('70')
  await height.press('Tab')
  await capture('studio-70')
  await height.fill('25')
  await height.press('Tab')
  await page.getByRole('button', { name: 'Two bulbs', exact: true }).click()
  await capture('studio-two-bulbs')
  await page.getByRole('button', { name: 'LED column', exact: true }).click()
  await capture('studio-led')
  expect(errors).toEqual([])
})
