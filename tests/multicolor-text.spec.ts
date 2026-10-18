import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { strFromU8, unzipSync } from 'fflate'

const projectionControls = [
  ['Letter height (millimetres)', '150'],
  ['Text rotation (degrees)', '12'],
  ['Around the shade (degrees)', '15'],
  ['Horizontal offset (millimetres)', '10'],
  ['Vertical placement (percent)', '55'],
] as const

async function setControl(control: Locator, value: string) {
  await control.fill(value)
  await control.press('Tab')
  await expect(control).toHaveValue(value)
}

async function settledFrame(canvas: Locator) {
  let previous = await canvas.screenshot()
  let stableFrames = 1
  await expect.poll(async () => {
    const next = await canvas.screenshot()
    const same = previous.equals(next)
    previous = next
    stableFrames = same ? stableFrames + 1 : 1
    return stableFrames
  }, { timeout: 20_000, intervals: [250] }).toBeGreaterThanOrEqual(3)
  return previous
}

function stlBounds(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangles = data.getUint32(80, true)
  expect(bytes.byteLength).toBe(84 + triangles * 50)
  expect(triangles).toBeGreaterThan(0)
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  let finite = true
  for (let triangle = 0; triangle < triangles; triangle++) {
    for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) {
      const value = data.getFloat32(84 + triangle * 50 + 12 + vertex * 12 + axis * 4, true)
      finite &&= Number.isFinite(value)
      minimum[axis] = Math.min(minimum[axis], value)
      maximum[axis] = Math.max(maximum[axis], value)
    }
  }
  expect(finite, 'STL vertices remain finite').toBe(true)
  return { minimum, maximum }
}

test('second-color lettering persists, appears in print layers, and exports registered TPU parts', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const enabled = page.getByRole('switch', { name: 'Multicolor text', exact: true })
  const text = page.getByRole('textbox', { name: 'Text', exact: true })
  const colors = page.getByRole('group', { name: 'Text color', exact: true })
  await expect(enabled).not.toBeChecked()
  await expect(text).toHaveCount(0)
  await enabled.setChecked(true)
  await expect(text).toHaveValue('HI')
  await settledFrame(page.locator('canvas'))
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('multicolor-default-hi-room.png') })
  await expect(colors.getByRole('button')).toHaveCount(3)
  for (const color of ['Black', 'Brown', 'Beige']) await expect(colors.getByRole('button', { name: color, exact: true })).toBeVisible()
  await text.fill('CURVE')
  await colors.getByRole('button', { name: 'Brown', exact: true }).click()
  for (const [name, value] of projectionControls) await setControl(page.getByRole('spinbutton', { name, exact: true }), value)
  await page.reload()
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await expect(enabled).toBeChecked()
  await expect(text).toHaveValue('CURVE')
  await expect(colors.getByRole('button', { name: 'Brown', exact: true })).toHaveAttribute('aria-pressed', 'true')
  for (const [name, value] of projectionControls) await expect(page.getByRole('spinbutton', { name, exact: true })).toHaveValue(value)
  await settledFrame(page.locator('canvas'))
  await page.screenshot({ path: testInfo.outputPath('multicolor-text-room.png'), fullPage: true })

  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save design', exact: true }).click()
  const recipePath = await (await saved).path()
  const recipe = JSON.parse(await readFile(recipePath!, 'utf8'))
  expect(recipe.parameters).toMatchObject({ textEnabled: true, text: 'CURVE', textColor: 'brown', textSize: 150, textRotation: 12, textAzimuth: 15, textHorizontal: 10, textVertical: 55 })
  await page.getByRole('button', { name: 'Reset all design settings', exact: true }).click()
  await expect(enabled).not.toBeChecked()
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles(recipePath!)
  await expect(enabled).toBeChecked()
  await expect(text).toHaveValue('CURVE')

  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
  await page.getByRole('button', { name: 'Inspect print layers', exact: true }).click()
  const layers = page.getByRole('dialog')
  await expect(layers.getByLabel('Material legend', { exact: true })).toContainText('Brown TPU · text accent')
  await layers.getByRole('button', { name: 'Text accent', exact: true }).click()
  await expect(layers.getByRole('heading', { name: 'Two-color TPU membrane', exact: true })).toBeVisible()
  const footprint = layers.locator('.li-footprint [data-material="accent-tpu"]')
  await expect(footprint).toHaveCount(1)
  expect((await footprint.getAttribute('d'))!.length).toBeGreaterThan(20)
  expect(await layers.locator('.li-section [data-material="accent-tpu"]').count()).toBeGreaterThan(0)
  await expect(layers.locator('.li-detail')).toContainText('accent replaces base TPU')
  await layers.screenshot({ path: testInfo.outputPath('multicolor-print-layers.png') })
  await layers.getByRole('button', { name: 'Outer join', exact: true }).click()
  await expect(footprint).toHaveCount(0)
  await expect(layers.locator('.li-detail')).toContainText('Joining rims keep the original TPU')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await page.getByRole('button', { name: 'Prepare to make', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export the full design', exact: false }).click()
  const archivePath = await (await download).path()
  const archive = unzipSync(await readFile(archivePath!))
  expect(Object.keys(archive).filter(name => name.endsWith('.stl')).sort()).toEqual(['separators-pla.stl', 'shade-text-tpu.stl', 'shade-tpu.stl'])
  const shade = stlBounds(archive['shade-tpu.stl'])
  const accent = stlBounds(archive['shade-text-tpu.stl'])
  stlBounds(archive['separators-pla.stl'])
  for (let axis = 0; axis < 3; axis++) {
    expect(accent.minimum[axis]).toBeGreaterThanOrEqual(shade.minimum[axis] - 0.001)
    expect(accent.maximum[axis]).toBeLessThanOrEqual(shade.maximum[axis] + 0.001)
  }
  expect(accent.maximum[2] - accent.minimum[2], 'lettering occupies TPU across multiple printer layers').toBeGreaterThan(recipe.parameters.layerHeight)
  expect(JSON.parse(strFromU8(archive['design.json'])).parameters).toMatchObject(recipe.parameters)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  // Version-one recipes saved before lettering must restore a plain shade,
  // even if a second color was enabled immediately before importing them.
  for (const key of ['textEnabled', 'text', 'textColor', 'textSize', 'textRotation', 'textAzimuth', 'textHorizontal', 'textVertical']) delete recipe.parameters[key]
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles({ name: 'before-multicolor.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) })
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await expect(enabled).not.toBeChecked()
  await enabled.setChecked(true)
  await expect(text).toHaveValue('HI')
  await expect(colors.getByRole('button', { name: 'Black', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('lettering controls remain usable and accessible on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const enabled = page.getByRole('switch', { name: 'Multicolor text', exact: true })
  await enabled.focus()
  await enabled.press('Space')
  await expect(enabled).toBeChecked()
  const controls = page.getByRole('region', { name: 'Multicolor lettering', exact: true })
  const beige = controls.getByRole('button', { name: 'Beige', exact: true })
  await beige.focus()
  await beige.press('Enter')
  await expect(beige).toHaveAttribute('aria-pressed', 'true')
  const size = controls.getByRole('slider', { name: 'Letter height (millimetres)', exact: true })
  await size.focus()
  await size.press('End')
  await expect(controls.getByRole('spinbutton', { name: 'Letter height (millimetres)', exact: true })).toHaveValue('300')
  await size.press('Home')
  await expect(controls.getByRole('spinbutton', { name: 'Letter height (millimetres)', exact: true })).toHaveValue('40')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).include('.text-controls').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([])
  await controls.screenshot({ path: testInfo.outputPath('multicolor-controls-mobile.png') })
})

test('bold curved lettering wraps across both sides and the back of the printable shade', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('switch', { name: 'Multicolor text', exact: true }).setChecked(true)
  const text = page.getByRole('textbox', { name: 'Text', exact: true })
  await text.fill('ORIGAMI')
  const lettering = page.getByRole('region', { name: 'Multicolor lettering', exact: true })
  const height = lettering.getByRole('spinbutton', { name: 'Letter height (millimetres)', exact: true })
  await setControl(height, '300')
  await expect(lettering.getByRole('status')).toContainText('The ends overlap around the shade')
  await lettering.getByRole('button', { name: 'Fit around shade', exact: true }).click()
  expect(Number(await height.inputValue()), 'fitting reduces oversized lettering').toBeLessThan(300)
  await expect(lettering.getByRole('status')).toHaveCount(0)
  const canvas = page.locator('canvas')
  const preview = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
  for (const shape of ['Soft square', 'Circle']) {
    await page.getByRole('tab', { name: 'Finish', exact: true }).click()
    await setControl(page.getByRole('spinbutton', { name: 'Letter height (millimetres)', exact: true }), shape === 'Circle' ? '95' : '110')
    await page.getByRole('tab', { name: 'Form', exact: true }).click()
    await page.getByRole('button', { name: shape, exact: true }).click()
    await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect print layers', exact: true }).click()
    const layers = page.getByRole('dialog')
    await layers.getByRole('button', { name: 'Text accent', exact: true }).click()
    const bounds = await layers.locator('.li-footprint [data-material="accent-tpu"]').evaluate(path => {
      const coordinates = (path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number)
      return coordinates.reduce((bounds, value, index) => {
        if (index % 2 === 0) { bounds.left = Math.min(bounds.left, value); bounds.right = Math.max(bounds.right, value) }
        else { bounds.back = Math.min(bounds.back, value); bounds.front = Math.max(bounds.front, value) }
        return bounds
      }, { left: Infinity, right: -Infinity, back: Infinity, front: -Infinity })
    })
    // The top view has its back at SVG y=0. The old front-only projection
    // cannot color that half of the actual manufactured membrane.
    expect(bounds.left, `${shape}: text reaches the left side`).toBeLessThan(30)
    expect(bounds.right, `${shape}: text reaches the right side`).toBeGreaterThan(150)
    expect(bounds.back, `${shape}: text wraps onto the back`).toBeLessThan(30)
    expect(bounds.front, `${shape}: text remains on the front`).toBeGreaterThan(150)
    await layers.screenshot({ path: testInfo.outputPath(`wrapped-${shape.toLowerCase().replaceAll(' ', '-')}-print-footprint.png`) })
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await page.getByRole('button', { name: 'Studio', exact: true }).click()
    await preview.focus()
    await preview.press('Home')
    await settledFrame(canvas)
    await canvas.screenshot({ path: testInfo.outputPath(`wrapped-${shape.toLowerCase().replaceAll(' ', '-')}-front.png`) })
    for (let step = 0; step < 10; step++) await preview.press('ArrowRight')
    await settledFrame(canvas)
    await canvas.screenshot({ path: testInfo.outputPath(`wrapped-${shape.toLowerCase().replaceAll(' ', '-')}-side.png`) })
    for (let step = 0; step < 11; step++) await preview.press('ArrowRight')
    await settledFrame(canvas)
    await canvas.screenshot({ path: testInfo.outputPath(`wrapped-${shape.toLowerCase().replaceAll(' ', '-')}-back.png`) })
  }

  expect(errors).toEqual([])
})

test('curved bold type remains visible when the preview is magnified', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('switch', { name: 'Multicolor text', exact: true }).setChecked(true)
  const text = page.getByRole('textbox', { name: 'Text', exact: true })
  await setControl(page.getByRole('spinbutton', { name: 'Letter height (millimetres)', exact: true }), '100')
  const studio = page.getByRole('button', { name: 'Studio', exact: true })
  const canvas = page.locator('canvas')
  const preview = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
  // Rounded C, U, R and O outlines are inspected at high magnification;
  // HI alone would not reveal a bitmap alphabet or coarse curve tessellation.
  for (const shape of ['Soft square', 'Circle']) {
    await page.getByRole('tab', { name: 'Form', exact: true }).click()
    await page.getByRole('button', { name: shape, exact: true }).click()
    await page.getByRole('tab', { name: 'Finish', exact: true }).click()
    for (const content of ['CURVE', 'O']) {
      await text.fill(content)
      await expect(text).toHaveValue(content)
      await settledFrame(canvas)
      await studio.click()
      await preview.focus()
      await preview.press('Home')
      for (let step = 0; step < 8; step++) await preview.press('=')
      await settledFrame(canvas)
      await expect(studio).toHaveAttribute('aria-pressed', 'true')
      await canvas.screenshot({ path: testInfo.outputPath(`curved-${content.toLowerCase()}-${shape.toLowerCase().replaceAll(' ', '-')}-closeup.png`) })
    }
  }
  expect(errors).toEqual([])
})

async function roomTransmissionDifference(page: Page, frames: Buffer[]) {
  return page.evaluate(async encoded => {
    const contexts = await Promise.all(encoded.map(async frame => {
      const bytes = Uint8Array.from(atob(frame), character => character.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      image.close()
      return context
    }))
    // Receiver patches exclude the shade. Subtract light-off frames so a
    // dark painted surface alone cannot satisfy the cast-shadow test.
    return [{ name: 'left floor', x: 0.25, y: 0.8, width: 0.12, height: 0.12 }, { name: 'right floor', x: 0.61, y: 0.7, width: 0.2, height: 0.2 }].map(bounds => {
      const pixels = contexts.map(context => context.getImageData(Math.round(context.canvas.width * bounds.x), Math.round(context.canvas.height * bounds.y), Math.round(context.canvas.width * bounds.width), Math.round(context.canvas.height * bounds.height)).data)
      let difference = 0
      let absolute = 0
      let changed = 0
      const contrasts: number[] = []
      for (let index = 0; index < pixels[0].length; index += 4) {
        const luminance = pixels.map(pixel => pixel[index] * 0.2126 + pixel[index + 1] * 0.7152 + pixel[index + 2] * 0.0722)
        const blocked = (luminance[0] - luminance[1]) - (luminance[2] - luminance[3])
        difference += blocked
        absolute += Math.abs(blocked)
        contrasts.push(blocked)
        if (blocked > 5) changed++
      }
      const count = pixels[0].length / 4
      contrasts.sort((a, b) => a - b)
      return { name: bounds.name, blockedLight: difference / count, meanDifference: absolute / count, strongShadowFraction: changed / count, percentile95: contrasts[Math.floor(count * 0.95)] }
    })
  }, frames.map(frame => frame.toString('base64')))
}

test('opaque lettering casts visibly contrasted shadows onto the room', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const enabled = page.getByRole('switch', { name: 'Multicolor text', exact: true })
  await enabled.setChecked(true)
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('SUN')
  await setControl(page.getByRole('spinbutton', { name: 'Letter height (millimetres)', exact: true }), '200')
  await setControl(page.getByRole('spinbutton', { name: 'Vertical placement (percent)', exact: true }), '35')
  const light = page.getByRole('switch', { name: 'Light', exact: true })
  const canvas = page.locator('canvas')
  const ledBlackOn = await settledFrame(canvas)
  await writeFile(testInfo.outputPath('multicolor-default-led-room-light.png'), ledBlackOn)
  await light.setChecked(false)
  const ledBlackOff = await settledFrame(canvas)
  await enabled.setChecked(false)
  const ledPlainOff = await settledFrame(canvas)
  await light.setChecked(true)
  const ledPlainOn = await settledFrame(canvas)
  await writeFile(testInfo.outputPath('multicolor-default-led-plain-room-light.png'), ledPlainOn)
  const defaultLed = await roomTransmissionDifference(page, [ledPlainOn, ledPlainOff, ledBlackOn, ledBlackOff])
  await enabled.setChecked(true)
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'Bulb diameter (millimetres)', exact: true }), '20')
  await setControl(page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true }), '75')
  await setControl(page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true }), '0')
  const frames: Record<string, Buffer[]> = {}
  for (const variant of ['plain', 'black', 'beige']) {
    await enabled.setChecked(variant !== 'plain')
    if (variant !== 'plain') await page.getByRole('group', { name: 'Text color', exact: true }).getByRole('button', { name: variant === 'black' ? 'Black' : 'Beige', exact: true }).click()
    await light.setChecked(true)
    const on = await settledFrame(canvas)
    await light.setChecked(false)
    const off = await settledFrame(canvas)
    frames[variant] = [on, off]
    await writeFile(testInfo.outputPath(`multicolor-${variant}-room-light.png`), on)
  }
  const black = await roomTransmissionDifference(page, [...frames.plain, ...frames.black])
  const beige = await roomTransmissionDifference(page, [...frames.plain, ...frames.beige])
  await writeFile(testInfo.outputPath('text-room-transmission.json'), JSON.stringify({ defaultLed, black, beige }, null, 2))
  await testInfo.attach('text-room-transmission', { body: JSON.stringify({ defaultLed, black, beige }, null, 2), contentType: 'application/json' })
  expect(Math.max(...defaultLed.map(patch => patch.blockedLight)), 'default LED lighting shows visible diffuse text occlusion').toBeGreaterThan(1)
  expect(Math.max(...defaultLed.map(patch => patch.strongShadowFraction)), 'the diffuse LED shadow covers a visible receiver area').toBeGreaterThan(0.05)
  expect(Math.max(...black.map(patch => patch.blockedLight)), 'the shadow must darken a substantial receiver area, beyond sub-pixel noise').toBeGreaterThan(1)
  expect(Math.max(...black.map(patch => patch.strongShadowFraction)), 'at least five percent of a room receiver has visibly darker text-shadow contrast').toBeGreaterThan(0.05)
  expect(Math.max(...black.map(patch => patch.percentile95)), 'the receiver includes clear shadow contrast across multiple luminance levels').toBeGreaterThan(8)
  expect(black.reduce((total, patch) => total + patch.blockedLight, 0), 'black blocks more transmitted light than beige').toBeGreaterThan(beige.reduce((total, patch) => total + patch.blockedLight, 0))
  expect(errors).toEqual([])
})
