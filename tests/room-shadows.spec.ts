import { expect, test, type Page } from '@playwright/test'

async function benchFloorDifference(page: Page, first: Buffer, second: Buffer) {
  // Decode screenshots away from the app's WebGL canvas. This checks the
  // furniture and floor, so changing only the lamp's glow cannot pass.
  return page.evaluate(async ({ first, second }) => {
    const readPixels = async (encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(
        Math.round(image.width * 0.25), Math.round(image.height * 0.48),
        Math.round(image.width * 0.17), Math.round(image.height * 0.16),
      ).data
      image.close()
      return pixels
    }
    const [a, b] = await Promise.all([readPixels(first), readPixels(second)])
    let totalDifference = 0
    for (let index = 0; index < a.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) {
        totalDifference += Math.abs(a[index + channel] - b[index + channel])
      }
    }
    return totalDifference / (a.length / 4 * 3)
  }, { first: first.toString('base64'), second: second.toString('base64') })
}

test('lamp light and bulb height change the bench and floor shadows', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  const preview = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
  await preview.focus()
  for (let i = 0; i < 6; i++) await preview.press('-')
  const settle = async () => {
    let previous = await canvas.screenshot()
    await expect.poll(async () => {
      const next = await canvas.screenshot()
      const same = previous.equals(next)
      previous = next
      return same
    }, { timeout: 15_000 }).toBe(true)
  }
  const capture = async (name: string) => {
    await settle()
    return canvas.screenshot({ path: testInfo.outputPath(`room-shadow-${name}.png`) })
  }
  const on = await capture('on')
  const light = page.getByRole('switch', { name: 'Preview light', exact: true })
  await light.click()
  await expect(light).not.toBeChecked()
  const off = await capture('off')
  expect(await benchFloorDifference(page, on, off)).toBeGreaterThan(3)
  await light.click()
  const height = page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true })
  await height.fill('0')
  await height.press('Tab')
  const low = await capture('low')
  await height.fill('100')
  await height.press('Tab')
  const high = await capture('high')
  expect(await benchFloorDifference(page, low, high)).toBeGreaterThan(1)

  await height.fill('25')
  await height.press('Tab')
  for (const source of ['Two bulbs', 'LED column']) {
    await page.getByRole('button', { name: source, exact: true }).click()
    const sourceOn = await capture(`${source}-on`)
    await light.click()
    await expect(light).not.toBeChecked()
    const sourceOff = await capture(`${source}-off`)
    expect(await benchFloorDifference(page, sourceOn, sourceOff)).toBeGreaterThan(3)
    await light.click()
    await expect(light).toBeChecked()
  }
  expect(errors).toEqual([])
})
