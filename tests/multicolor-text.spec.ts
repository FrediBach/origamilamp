import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { strFromU8, unzipSync } from 'fflate'
import { PerspectiveCamera, Vector3 } from 'three'

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

// Independently project a few interior glyph points onto the actual floor.
// This fixture uses the flat front of the default soft-square shade. The points
// avoid outline edges, and the O counter occupies the same place as H's bar.
// A uniform dimming field cannot satisfy the counter/bar comparison.
function floorShadowProbes(width: number, height: number) {
  const camera = new PerspectiveCamera(35, width / height, 0.01, 30)
  const fit = 0.58 * 2.05 * 1.1 ** 2, targetY = 0.58 * 0.48, theta = 0.46 - 12 * 0.15
  camera.position.set(Math.sin(theta) * fit, targetY + fit * 0.25, Math.cos(theta) * fit)
  camera.lookAt(0, targetY, 0)
  camera.updateMatrixWorld()
  const rise = 480 / 46, span = 22 - 1.2 - 1.2
  const depth = Math.sqrt(span * span - rise * rise)
  const verticalCenter = 480 * 0.35
  const sourceY = (306 + (480 - 2 * 3.2 - 33) * 0.25 + 33 * 0.19) / 1000
  return [
    { name: 'counter', xs: [-8, 0, 8] },
    { name: 'left stroke', xs: [-38, -34] },
    { name: 'right stroke', xs: [34, 38] },
  ].map(region => ({ name: region.name, points: region.xs.flatMap(x => [2, 5, 8].map(y => {
    const z = verticalCenter + y, leg = Math.floor(z / rise), fraction = z / rise - leg
    const inset = 1.2 + (leg % 2 === 0 ? fraction : 1 - fraction) * depth
    const point = new Vector3(x / 1000, (66 + z) / 1000, (90 - inset) / 1000)
    const scale = (-0.01 - sourceY) / (point.y - sourceY)
    point.set(point.x * scale, -0.01, point.z * scale)
    point.project(camera)
    return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 }
  })) }))
}

async function shadowShapeDifference(page: Page, frames: Buffer[], probes: ReturnType<typeof floorShadowProbes>) {
  return page.evaluate(async ({ encoded, probes }) => {
    const contexts = await Promise.all(encoded.map(async frame => {
      const bytes = Uint8Array.from(atob(frame), character => character.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      image.close()
      return context
    }))
    return probes.map(region => {
      const samples = region.points.map(point => {
        const values = contexts.map(context => {
          const pixel = context.getImageData(Math.round(point.x) - 1, Math.round(point.y) - 1, 3, 3).data
          let luminance = 0
          for (let index = 0; index < pixel.length; index += 4) luminance += pixel[index] * 0.2126 + pixel[index + 1] * 0.7152 + pixel[index + 2] * 0.0722
          return luminance / 9
        })
        return { ...point, o: values[0] - values[1], h: values[0] - values[2] }
      })
      const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
      return { name: region.name, o: median(samples.map(sample => sample.o)), h: median(samples.map(sample => sample.h)), samples }
    })
  }, { encoded: frames.map(frame => frame.toString('base64')), probes })
}

test('bulb letter shadows retain the O counter and change shape when replaced by H', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const enabled = page.getByRole('switch', { name: 'Multicolor text', exact: true })
  const text = page.getByRole('textbox', { name: 'Text', exact: true })
  const canvas = page.locator('canvas')
  const preview = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
  await enabled.setChecked(true)
  await text.fill('O')
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'Bulb diameter (millimetres)', exact: true }), '20')
  await setControl(page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true }), '75')
  await setControl(page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true }), '0')
  await setControl(page.getByRole('spinbutton', { name: 'Vertical placement (percent)', exact: true }), '35')
  await preview.focus()
  await preview.press('Home')
  // Keep the entire foreground projection visible beside the frame and above
  // the toolbar, using the same orbit/zoom controls available to the user.
  for (let step = 0; step < 12; step++) await preview.press('ArrowLeft')
  for (let step = 0; step < 2; step++) await preview.press('-')
  const frames: Buffer[] = []
  for (const glyph of ['plain', 'O', 'H']) {
    await enabled.setChecked(glyph !== 'plain')
    if (glyph !== 'plain') await text.fill(glyph)
    const frame = await settledFrame(canvas)
    frames.push(frame)
    await writeFile(testInfo.outputPath(`native-internal-${glyph.toLowerCase()}.png`), frame)
  }
  const bounds = (await canvas.boundingBox())!
  const regions = await shadowShapeDifference(page, frames, floorShadowProbes(bounds.width, bounds.height))
  const metrics = JSON.stringify({ internal: regions }, null, 2)
  await writeFile(testInfo.outputPath('native-shadow-shape.json'), metrics)
  await testInfo.attach('native-shadow-shape', { body: metrics, contentType: 'application/json' })
  const counter = regions.find(region => region.name === 'counter')!
  const strokes = regions.filter(region => region.name !== 'counter')
  expect(Math.min(...strokes.map(region => region.o)), 'both O strokes cast visibly dark shadows on the predicted floor positions').toBeGreaterThan(8)
  expect(counter.o, 'the O counter stays brighter than either surrounding stroke').toBeLessThan(Math.min(...strokes.map(region => region.o)) * 0.5)
  expect(counter.h - counter.o, 'replacing O with H darkens the counter at the predicted center bar, beyond a global brightness change').toBeGreaterThan(8)
  expect(errors).toEqual([])
})

async function shadowInteriorNoise(page: Page, frames: Buffer[]) {
  return page.evaluate(async encoded => {
    const contexts = await Promise.all(encoded.map(async frame => {
      const image = await createImageBitmap(new Blob([Uint8Array.from(atob(frame), character => character.charCodeAt(0))], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      image.close()
      return context
    }))
    // Only the receiver to the right of the frame. Matched plain images isolate
    // attenuation; a blurred black reference identifies shadow interiors. Some
    // floor texture and geometric variation remain in both colored shadows.
    const imageWidth = contexts[0].canvas.width, imageHeight = contexts[0].canvas.height
    const bounds = { x: Math.round(imageWidth * 0.57), y: Math.round(imageHeight * 0.70), width: Math.round(imageWidth * 0.16), height: Math.round(imageHeight * 0.20) }
    const width = bounds.width, height = bounds.height
    const pixels = contexts.map(context => context.getImageData(bounds.x, bounds.y, width, height).data)
    const black = new Float64Array(width * height), beige = new Float64Array(width * height)
    for (let i = 0; i < black.length; i++) {
      const luminance = pixels.map(pixel => pixel[i * 4] * 0.2126 + pixel[i * 4 + 1] * 0.7152 + pixel[i * 4 + 2] * 0.0722)
      black[i] = luminance[0] - luminance[1]
      beige[i] = luminance[0] - luminance[2]
    }
    const blur = (values: Float64Array, radius: number) => {
      const result = new Float64Array(values.length)
      for (let y = radius; y < height - radius; y++) for (let x = radius; x < width - radius; x++) {
        let sum = 0
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) sum += values[(y + dy) * width + x + dx]
        result[y * width + x] = sum / (2 * radius + 1) ** 2
      }
      return result
    }
    const blackMean = blur(black, 2), beigeMean = blur(beige, 2)
    const residuals: number[] = []
    let blackSignal = 0, beigeSignal = 0
    let blackResidualSquares = 0, residualProducts = 0, beigeSpecificSquares = 0
    for (let y = 8; y < height - 8; y++) for (let x = 8; x < width - 8; x++) {
      let interior = true
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (blackMean[(y + dy) * width + x + dx] < 40) interior = false
      if (!interior) continue
      const i = y * width + x
      const blackResidual = black[i] - blackMean[i], beigeResidual = beige[i] - beigeMean[i]
      residuals.push(Math.abs(beigeResidual))
      blackResidualSquares += blackResidual ** 2
      residualProducts += blackResidual * beigeResidual
      // Subtract shared variation at the local attenuation ratio so softened
      // geometry and floor grain are not counted as beige-only stippling. Keep
      // an independent absolute-noise cap so shared noise cannot be hidden.
      beigeSpecificSquares += (beigeResidual - blackResidual * beigeMean[i] / blackMean[i]) ** 2
      blackSignal += blackMean[i]
      beigeSignal += beigeMean[i]
    }
    residuals.sort((a, b) => a - b)
    const count = residuals.length
    const beigeResidualSquares = residuals.reduce((sum, value) => sum + value * value, 0)
    const highFrequencyRms = Math.sqrt(beigeResidualSquares / count)
    return {
      bounds, count, highFrequencyRms,
      blackResidualRms: Math.sqrt(blackResidualSquares / count),
      residualCorrelation: residualProducts / Math.sqrt(blackResidualSquares * beigeResidualSquares),
      beigeSpecificRms: Math.sqrt(beigeSpecificSquares / count),
      percentile95: residuals[Math.floor(count * 0.95)], blackSignal: blackSignal / count, beigeSignal: beigeSignal / count, normalizedNoise: highFrequencyRms / (blackSignal / count),
    }
  }, frames.map(frame => frame.toString('base64')))
}

test('partial-opacity lettering has smooth shadow interiors and responsive controls', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'TPU layers', exact: true }), '1')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const enabled = page.getByRole('switch', { name: 'Multicolor text', exact: true })
  await enabled.setChecked(true)
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('H')
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'Bulb diameter (millimetres)', exact: true }), '20')
  await setControl(page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true }), '75')
  await setControl(page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true }), '0')
  await setControl(page.getByRole('spinbutton', { name: 'Vertical placement (percent)', exact: true }), '35')
  const canvas = page.locator('canvas')
  const preview = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
  await preview.focus()
  await preview.press('Home')
  for (let step = 0; step < 12; step++) await preview.press('ArrowLeft')
  for (let step = 0; step < 2; step++) await preview.press('-')
  const frames: Buffer[] = []
  for (const color of ['plain', 'Black', 'Beige']) {
    await enabled.setChecked(color !== 'plain')
    if (color !== 'plain') await page.getByRole('group', { name: 'Text color', exact: true }).getByRole('button', { name: color, exact: true }).click()
    const frame = await settledFrame(canvas)
    frames.push(frame)
    await writeFile(testInfo.outputPath(`shadow-noise-${color.toLowerCase()}.png`), frame)
  }
  const noise = await shadowInteriorNoise(page, frames)
  const placement = page.getByRole('spinbutton', { name: 'Vertical placement (percent)', exact: true })
  await placement.evaluate(element => {
    const input = element as HTMLInputElement & { frameLatencies: number[] }
    input.frameLatencies = []
    input.addEventListener('input', () => {
      const start = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => input.frameLatencies.push(performance.now() - start)))
    })
  })
  for (let step = 0; step < 5; step++) await placement.press('ArrowUp')
  await expect(placement).toHaveValue('40')
  await expect.poll(() => placement.evaluate(element => (element as HTMLInputElement & { frameLatencies: number[] }).frameLatencies.length)).toBeGreaterThanOrEqual(5)
  const frameLatencies = await placement.evaluate(element => (element as HTMLInputElement & { frameLatencies: number[] }).frameLatencies)
  await settledFrame(canvas)
  await preview.evaluate(element => {
    const region = element as HTMLElement & { frameLatencies: number[] }
    region.frameLatencies = []
    region.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight') return
      const start = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => region.frameLatencies.push(performance.now() - start)))
    })
  })
  await preview.focus()
  for (let step = 0; step < 5; step++) await preview.press('ArrowRight')
  await expect.poll(() => preview.evaluate(element => (element as HTMLElement & { frameLatencies: number[] }).frameLatencies.length)).toBeGreaterThanOrEqual(5)
  const orbitFrameLatencies = await preview.evaluate(element => (element as HTMLElement & { frameLatencies: number[] }).frameLatencies)

  // A short animated/steady cycle catches a quality scheduler that stops
  // requesting frames while text-enabled flicker uses its capped sample count.
  await preview.press('Home')
  const brightness = async (frame: Buffer) => page.evaluate(async encoded => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: 'image/png' }))
    const surface = new OffscreenCanvas(image.width, image.height)
    const context = surface.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(Math.round(image.width * 0.445), Math.round(image.height * 0.18), Math.round(image.width * 0.07), Math.round(image.height * 0.6)).data
    image.close()
    let sum = 0
    for (let index = 0; index < pixels.length; index += 4) sum += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
    return sum / (pixels.length / 4)
  }, frame.toString('base64'))
  const steadyBrightness = await brightness(await settledFrame(canvas))
  const flicker = page.getByRole('spinbutton', { name: 'Light flicker (percent)', exact: true })
  await setControl(flicker, '100')
  const flickerBrightness: number[] = []
  for (let sample = 0; sample < 5; sample++) {
    await page.waitForTimeout(250)
    flickerBrightness.push(await brightness(await canvas.screenshot()))
  }
  await setControl(flicker, '0')
  const restored = await settledFrame(canvas)
  const restoredBrightness = await brightness(restored)
  const metrics = JSON.stringify({ noise, frameLatencies, orbitFrameLatencies, flicker: { steadyBrightness, frames: flickerBrightness, restoredBrightness } }, null, 2)
  await writeFile(testInfo.outputPath('shadow-noise-metrics.json'), metrics)
  await testInfo.attach('shadow-noise-metrics', { body: metrics, contentType: 'application/json' })
  expect(noise.count, 'the measurement includes a substantial shadow interior').toBeGreaterThan(100)
  expect(noise.beigeSignal, 'noise removal must preserve the visible shadow').toBeGreaterThan(8)
  expect.soft(noise.beigeSpecificRms, 'partial-opacity shadows should not add visible stippling beyond shared geometry and floor texture').toBeLessThan(2)
  expect.soft(noise.highFrequencyRms, 'the absolute residual also stays low, including noise shared with the black reference').toBeLessThan(3)
  expect(noise.blackSignal - noise.beigeSignal, 'smoothing retains the lighter beige shadow').toBeGreaterThan(5)
  expect(Math.max(...flickerBrightness) - Math.min(...flickerBrightness), 'flicker visibly animates with lettering and adaptive shadow quality').toBeGreaterThan(8)
  expect(Math.abs(restoredBrightness - steadyBrightness), 'turning flicker off restores steady light').toBeLessThan(0.1)
  await page.waitForTimeout(500)
  expect(restored.equals(await canvas.screenshot()), 'idle refinement finishes and the light remains steady').toBe(true)
  expect(errors).toEqual([])
})
