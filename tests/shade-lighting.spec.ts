import { writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function shadeBrightness(page: Page, screenshot: Buffer) {
  return page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(
      Math.round(image.width * 0.445), Math.round(image.height * 0.18),
      Math.round(image.width * 0.07), Math.round(image.height * 0.60),
    )
    let warmth = 0
    const rows = Array.from({ length: pixels.height }, (_, y) => {
      let brightness = 0
      for (let x = 0; x < pixels.width; x++) {
        const pixel = (y * pixels.width + x) * 4
        brightness += pixels.data[pixel] * 0.2126 + pixels.data[pixel + 1] * 0.7152 + pixels.data[pixel + 2] * 0.0722
        warmth += pixels.data[pixel] - pixels.data[pixel + 2]
      }
      return brightness / pixels.width
    }).sort((a, b) => a - b)
    image.close()
    return {
      mean: rows.reduce((sum, value) => sum + value, 0) / rows.length,
      dark: rows[Math.floor(rows.length * 0.1)],
      bright: rows[Math.floor(rows.length * 0.9)],
      warmth: warmth / (pixels.width * pixels.height),
    }
  }, screenshot.toString('base64'))
}

test('shade stays bright and shows the bulb warmth in each environment', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  const intensity = page.getByRole('spinbutton', { name: 'Lamp light intensity (percent)', exact: true })
  const height = page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true })
  const temperature = page.getByRole('spinbutton', { name: 'Light warmth (kelvin)', exact: true })
  await intensity.fill('200')
  await intensity.press('Tab')
  await height.fill('70')
  await height.press('Tab')
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
    return shadeBrightness(page, await canvas.screenshot({ path: testInfo.outputPath(`${name}.png`) }))
  }
  const measurements = []
  for (const environment of ['Tatami', 'Brutalist', 'Studio']) {
    await page.getByRole('button', { name: environment, exact: true }).click()
    await light.setChecked(false)
    const off = await capture(`${environment}-off`)
    await light.setChecked(true)
    const on = await capture(`${environment}-200`)
    await temperature.fill('1800')
    await temperature.press('Tab')
    const warm = await capture(`${environment}-warm`)
    await temperature.fill('6500')
    await temperature.press('Tab')
    const cool = await capture(`${environment}-cool`)
    await temperature.fill('2700')
    await temperature.press('Tab')
    measurements.push({ environment, off, on, warm, cool })
  }
  await testInfo.attach('shade-brightness', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  await writeFile(testInfo.outputPath('shade-brightness.json'), JSON.stringify(measurements, null, 2))
  for (const { environment, off, on, warm, cool } of measurements) {
    // Check the whole surface as well as shaded faces. Softening fold contrast
    // alone left the Tatami mean at 174/255 and still looked too dark.
    expect(off.mean, `${environment}: overall diffuser brightness`).toBeGreaterThan(190)
    expect(off.dark, `${environment}: shaded TPU`).toBeGreaterThan(180)
    expect(off.bright - off.dark, `${environment}: visible folds`).toBeGreaterThan(4)
    expect(off.bright - off.dark, `${environment}: soft fold shading`).toBeLessThan(environment === 'Studio' ? 50 : 25)
    expect(on.mean - off.mean, `${environment}: bulb glow`).toBeGreaterThan(10)
    expect(on.mean, `${environment}: one bulb at 200%`).toBeGreaterThan(228)
    expect(on.dark, `${environment}: shaded TPU with one bulb at 200%`).toBeGreaterThan(215)
    expect(warm.warmth - cool.warmth, `${environment}: bulb warmth remains visible on the shade`).toBeGreaterThan(35)
  }
  expect(errors).toEqual([])
})

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
    const largestStep = Math.max(...profile.slice(1).map((brightness, index) => Math.abs(brightness - profile[index])))
    expect(peak).toBeGreaterThan(30)
    // Broad transmission stays smooth while remaining centered near its source.
    // The old direct-light artifact peaked well below the bulb instead.
    expect(largestStep / peak).toBeLessThan(0.16)
    peakPositions.push(profile.indexOf(peak))
  }
  expect(peakPositions[0]).toBeGreaterThanOrEqual(9)
  expect(peakPositions[0]).toBeLessThanOrEqual(13)
  expect(peakPositions[1]).toBeGreaterThanOrEqual(4)
  expect(peakPositions[1]).toBeLessThanOrEqual(8)
  expect(peakPositions[0] - peakPositions[1]).toBeGreaterThanOrEqual(2)
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

test('TPU membrane thickness changes transmitted brightness and falloff', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  const bulbHeight = page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true })
  await bulbHeight.fill('70')
  await bulbHeight.press('Tab')
  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()

  const tpuLayers = page.getByRole('spinbutton', { name: 'TPU layers', exact: true })
  const separatorLayers = page.getByRole('spinbutton', { name: 'PLA layers', exact: true })
  const layerHeight = page.getByRole('spinbutton', { name: 'Layer height (millimetres)', exact: true })
  const light = page.getByRole('switch', { name: 'Light', exact: true })
  const canvas = page.locator('canvas')
  const setControl = async (control: typeof tpuLayers, value: string) => {
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
    return canvas.screenshot({ path: testInfo.outputPath(`transmission-${name}.png`) })
  }
  const captureProfile = async (name: string) => {
    const on = await capture(`${name}-on`)
    await light.click()
    const off = await capture(`${name}-off`)
    await light.click()
    return { profile: await shadeGlowProfile(page, on, off), off }
  }
  const average = (profile: number[]) => profile.reduce((sum, value) => sum + value, 0) / profile.length
  const normalizedTail = (profile: number[]) => average(profile.slice(-4)) / Math.max(...profile)

  await expect(layerHeight).toHaveValue('0.2')
  await setControl(tpuLayers, '1')
  const thin = await captureProfile('thin-0.2mm')
  await setControl(tpuLayers, '5')
  const thick = await captureProfile('thick-1.0mm')
  expect(average(thin.profile) - average(thick.profile)).toBeGreaterThan(5)
  expect(normalizedTail(thin.profile) - normalizedTail(thick.profile)).toBeGreaterThan(0.03)

  // Removable PLA is absent from the expanded diffuser, so only TPU contributes
  // to its optical thickness. Keep the same camera and display expansion.
  await setControl(separatorLayers, '5')
  const separatorChange = await shadeGlowProfile(page, await capture('more-separator-layers'), thick.off)
  expect(Math.max(...separatorChange.map((value, index) => Math.abs(value - thick.profile[index])))).toBeLessThan(0.1)

  // 2 × 0.1 mm and 1 × 0.2 mm have the same membrane thickness. This exercises
  // the separate layer-height control and catches layer-count-only shading.
  await setControl(layerHeight, '0.1')
  await setControl(tpuLayers, '2')
  const equivalent = await captureProfile('equivalent-0.2mm')
  expect(Math.max(...equivalent.profile.map((value, index) => Math.abs(value - thin.profile[index])))).toBeLessThan(0.1)
  expect(errors).toEqual([])
})
