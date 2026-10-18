import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { strFromU8, unzipSync } from 'fflate'

async function setControl(control: Locator, value: string) {
  await control.fill(value)
  await control.press('Tab')
  await expect(control).toHaveValue(value)
}

async function settledFrame(canvas: Locator) {
  let previous = await canvas.screenshot()
  await expect.poll(async () => {
    const next = await canvas.screenshot()
    const same = previous.equals(next)
    previous = next
    return same
  }, { timeout: 20_000 }).toBe(true)
  return previous
}

async function expectOutsidePatternMouths(layers: Locator, dimensions: { width: number; depth: number; cornerRadius: number; bandWidth: number }) {
  const footprints = await layers.locator('svg.li-footprint polygon').evaluateAll((polygons, p) => polygons.map(polygon => {
    const points = polygon.getAttribute('points')!.split(' ').map(point => point.split(',').map(Number))
    // Signed distance to the rounded rectangle's outer perimeter. Every
    // pocket must reach that perimeter, while stopping short of the aperture.
    const insets = points.map(([x, y]) => {
      const dx = Math.abs(x - p.width / 2) - (p.width / 2 - p.cornerRadius)
      const dy = Math.abs(y - p.depth / 2) - (p.depth / 2 - p.cornerRadius)
      return p.cornerRadius - Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - Math.min(Math.max(dx, dy), 0)
    })
    return { mouth: Math.min(...insets), deepest: Math.max(...insets) }
  }), dimensions)
  for (const [index, footprint] of footprints.entries()) {
    expect(footprint.mouth, `pattern ${index + 1} must open to the outside`).toBeCloseTo(0, 4)
    expect(footprint.deepest, `pattern ${index + 1} must preserve the inner rim`).toBeLessThan(dimensions.bandWidth)
  }
}

async function transmissionDifference(page: Page, frames: Buffer[]) {
  return page.evaluate(async encoded => {
    const images = await Promise.all(encoded.map(async frame => {
      const bytes = Uint8Array.from(atob(frame), character => character.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      image.close()
      return context
    }))
    const measure = (bounds: { x: number; y: number; width: number; height: number }) => {
      const pixels = images.map(context => context.getImageData(
        Math.round(context.canvas.width * bounds.x), Math.round(context.canvas.height * bounds.y),
        Math.round(context.canvas.width * bounds.width), Math.round(context.canvas.height * bounds.height),
      ).data)
      let total = 0
      let signed = 0
      let unlit = 0
      let changed = 0
      for (let index = 0; index < pixels[0].length; index += 4) {
        const luminance = pixels.map(pixel => pixel[index] * 0.2126 + pixel[index + 1] * 0.7152 + pixel[index + 2] * 0.0722)
        // Compare only the light transmitted by each pattern, removing fixed
        // daylight and the shade's ordinary material appearance from both.
        const extraTransmission = (luminance[0] - luminance[1]) - (luminance[2] - luminance[3])
        const difference = Math.abs(extraTransmission)
        total += difference
        signed += extraTransmission
        unlit += Math.abs(luminance[1] - luminance[3])
        if (difference > 0.5) changed++
      }
      return { mean: total / (pixels[0].length / 4), signed: signed / (pixels[0].length / 4), unlit: unlit / (pixels[0].length / 4), changed: changed / (pixels[0].length / 4) }
    }
    return {
      shade: measure({ x: 0.445, y: 0.18, width: 0.07, height: 0.60 }),
      // This floor patch excludes the lamp, so repainting its surface cannot
      // pass the test for transmitted patterns in the surrounding room.
      floor: measure({ x: 0.31, y: 0.80, width: 0.06, height: 0.06 }),
    }
  }, frames.map(frame => frame.toString('base64')))
}

test('edge patterns are optional and survive saved recipes and calibration export', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const patterns = page.getByRole('region', { name: 'Light patterns', exact: true })
  const repeats = patterns.getByRole('spinbutton', { name: 'Pattern repeats', exact: true })
  const depth = patterns.getByRole('spinbutton', { name: 'Pattern depth (percent)', exact: true })
  const remaining = patterns.getByRole('spinbutton', { name: 'Remaining TPU layers', exact: true })
  await expect(patterns.getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(repeats).toHaveCount(0)
  for (const name of ['Triangles', 'Half circles', 'Rectangles']) {
    await patterns.getByRole('button', { name, exact: true }).click()
    await expect(patterns.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(patterns.locator('button[aria-pressed="true"]')).toHaveCount(1)
    await settledFrame(page.locator('canvas'))
    const screenshotName = name === 'Triangles' ? 'triangles-default-desktop.png' : `${name.toLowerCase().replaceAll(' ', '-')}-outer-edge-desktop.png`
    await page.screenshot({ path: testInfo.outputPath(screenshotName), fullPage: true })
    if (name === 'Half circles') {
      const viewer = page.getByRole('region', { name: /^Approximate expanded lamp 3D preview/ })
      await viewer.focus()
      for (let step = 0; step < 18; step++) await viewer.press('=')
      await settledFrame(page.locator('canvas'))
      await page.locator('canvas').screenshot({ path: testInfo.outputPath('half-circles-outer-edge-closeup.png') })
      await viewer.press('Home')
    }
  }
  await setControl(repeats, '16')
  await setControl(depth, '65')
  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'TPU layers', exact: true }), '3')
  await page.getByRole('tab', { name: 'Form', exact: true }).click()
  await setControl(remaining, '2')
  await page.reload()
  await expect(patterns.getByRole('button', { name: 'Rectangles', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(repeats).toHaveValue('16')
  await expect(depth).toHaveValue('65')
  await expect(remaining).toHaveValue('2')

  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save design', exact: true }).click()
  const recipePath = await (await saved).path()
  expect(recipePath).toBeTruthy()
  const recipe = JSON.parse(await readFile(recipePath!, 'utf8'))
  expect(recipe.parameters).toMatchObject({ cutoutPattern: 'rectangles', cutoutCount: 16, cutoutDepth: 65, cutoutLayers: 2, tpuLayers: 3 })
  await page.getByRole('button', { name: 'Reset all design settings', exact: true }).click()
  await expect(patterns.getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles(recipePath!)
  await expect(patterns.getByRole('button', { name: 'Rectangles', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(remaining).toHaveValue('2')

  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
  await page.getByRole('button', { name: 'Inspect print layers', exact: true }).click()
  const layers = page.getByRole('dialog')
  await layers.getByRole('button', { name: 'Top pattern layer', exact: true }).click()
  await expect(layers.getByRole('heading', { name: 'Patterned TPU + PLA recesses', exact: true })).toBeVisible()
  await expect(layers.locator('svg.li-footprint polygon')).toHaveCount(16)
  await expectOutsidePatternMouths(layers, recipe.parameters)
  await expect(layers.locator('.li-detail')).toContainText('top recesses')
  await expect(layers.locator('.li-detail')).toContainText('separator above')
  await expect(layers.locator('.li-detail')).toContainText('remain below')
  await expect(layers.locator('.li-detail')).toContainText('Peel it out from outside the shade.')
  await expect(layers.locator('svg.li-footprint')).toContainText('PLA exits at the outer edge')
  const topFootprints = await layers.locator('svg.li-footprint polygon').evaluateAll(polygons => polygons.map(polygon => polygon.getAttribute('points')))
  const selectedLayer = layers.locator('.li-section rect[stroke="#ab3e2b"]')
  expect(Number(await selectedLayer.getAttribute('y')), 'layer 8 is the upper layer of membrane 2').toBeCloseTo(215 - 8 * (180 / 28), 5)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.screenshot({ path: testInfo.outputPath('pattern-layer-inspector.png') })
  await layers.locator('.li-section').screenshot({ path: testInfo.outputPath('pattern-layer-section.png') })
  await layers.getByRole('button', { name: 'Previous print layer', exact: true }).click()
  await expect(layers.getByRole('heading', { name: 'Full TPU membrane', exact: true })).toBeVisible()
  await expect(layers.locator('svg.li-footprint polygon')).toHaveCount(0)
  await layers.getByRole('button', { name: 'Bottom pattern layer', exact: true }).click()
  await expect(layers.getByRole('heading', { name: 'Patterned TPU + PLA recesses', exact: true })).toBeVisible()
  await expect(layers.locator('svg.li-footprint polygon')).toHaveCount(16)
  await expectOutsidePatternMouths(layers, recipe.parameters)
  await expect(layers.locator('.li-detail')).toContainText('bottom recesses')
  await expect(layers.locator('.li-detail')).toContainText('separator below')
  await expect(layers.locator('.li-detail')).toContainText('remain above')
  await expect(layers.locator('.li-detail')).toContainText('Peel it out from outside the shade.')
  await expect(layers.locator('svg.li-footprint')).toContainText('PLA exits at the outer edge')
  expect(await layers.locator('svg.li-footprint polygon').evaluateAll(polygons => polygons.map(polygon => polygon.getAttribute('points')))).toEqual(topFootprints)
  expect(Number(await selectedLayer.getAttribute('y')), 'layer 11 is the lower layer of membrane 3').toBeCloseTo(215 - 11 * (180 / 28), 5)
  await page.screenshot({ path: testInfo.outputPath('bottom-pattern-layer-inspector.png') })
  await layers.locator('.li-section').screenshot({ path: testInfo.outputPath('bottom-pattern-layer-section.png') })
  await layers.getByRole('button', { name: 'Next print layer', exact: true }).click()
  await expect(layers.getByRole('heading', { name: 'Full TPU membrane', exact: true })).toBeVisible()
  await expect(layers.locator('svg.li-footprint polygon')).toHaveCount(0)
  await layers.getByRole('button', { name: 'Outer join', exact: true }).click()
  await expect(layers.getByRole('heading', { name: 'Outer join + PLA separator', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('tab', { name: 'Form', exact: true }).click()

  await page.getByRole('button', { name: 'Prepare to make', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export the full design', exact: false })).toBeEnabled()
  const calibrationDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Start with a calibration print', exact: false }).click()
  const calibration = await calibrationDownload
  expect(calibration.suggestedFilename()).toBe('origami-lamp-calibration.zip')
  const archivePath = await calibration.path()
  const archive = unzipSync(await readFile(archivePath!))
  const exported = JSON.parse(strFromU8(archive['design.json']))
  expect(exported.parameters).toMatchObject({ cutoutPattern: 'rectangles', cutoutCount: 16, cutoutDepth: 65, cutoutLayers: 2, tpuLayers: 3, pleats: 4 })
  expect(archive['shade-tpu.stl'].byteLength).toBeGreaterThan(84)
  expect(archive['separators-pla.stl'].byteLength).toBeGreaterThan(84)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  // Older version-one recipes did not contain pattern settings. Restoring one
  // must give it the original solid membrane without discarding other choices.
  for (const setting of ['cutoutPattern', 'cutoutCount', 'cutoutDepth', 'cutoutLayers']) delete recipe.parameters[setting]
  await page.getByLabel('Import a saved design recipe', { exact: true }).setInputFiles({
    name: 'design-before-patterns.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)),
  })
  await expect(patterns.getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(repeats).toHaveCount(0)
  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'TPU layers', exact: true })).toHaveValue('3')
  expect(errors).toEqual([])
})

test('patterns require a continuous thinner membrane and remain accessible on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const patterns = page.getByRole('region', { name: 'Light patterns', exact: true })
  const triangles = patterns.getByRole('button', { name: 'Triangles', exact: true })
  await triangles.focus()
  await triangles.press('Enter')
  await expect(triangles).toHaveAttribute('aria-pressed', 'true')
  await patterns.locator('.pattern-options').screenshot({ path: testInfo.outputPath('light-pattern-options-mobile.png') })
  const depthSlider = patterns.getByRole('slider', { name: 'Pattern depth (percent)', exact: true })
  await depthSlider.focus()
  await depthSlider.press('End')
  await expect(patterns.getByRole('spinbutton', { name: 'Pattern depth (percent)', exact: true })).toHaveValue('75')
  await depthSlider.press('Home')
  await expect(patterns.getByRole('spinbutton', { name: 'Pattern depth (percent)', exact: true })).toHaveValue('10')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).include('.pattern-controls').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('light-patterns-mobile.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'TPU layers', exact: true }), '1')
  await page.getByRole('tab', { name: 'Form', exact: true }).click()
  await expect(patterns.getByRole('status')).toContainText('A pattern must be thinner than the full membrane.')
  await expect(page.getByRole('region', { name: 'Live feasibility checks', exact: true })).toContainText('Patterns need a thinner membrane')
  await page.getByRole('button', { name: 'Prepare to make', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export the full design', exact: false })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start with a calibration print', exact: false })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await patterns.getByRole('button', { name: 'None', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare to make', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export the full design', exact: false })).toBeEnabled()
})

test('pattern shapes change transmitted shade and room light without making open holes', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'One bulb', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'Bulb diameter (millimetres)', exact: true }), '20')
  await setControl(page.getByRole('spinbutton', { name: 'Ceiling light intensity (percent)', exact: true }), '0')
  await page.getByRole('tab', { name: 'Print setup', exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'TPU layers', exact: true }), '4')
  await page.getByRole('tab', { name: 'Form', exact: true }).click()
  const patterns = page.getByRole('region', { name: 'Light patterns', exact: true })
  const light = page.getByRole('switch', { name: 'Light', exact: true })
  const canvas = page.locator('canvas')
  const frames: Record<string, Buffer[]> = {}
  for (const height of ['25', '75']) {
    await page.getByRole('tab', { name: 'Finish', exact: true }).click()
    await setControl(page.getByRole('spinbutton', { name: 'Bulb height (percent)', exact: true }), height)
    await page.getByRole('tab', { name: 'Form', exact: true }).click()
    for (const pattern of ['None', 'Triangles', 'Half circles', 'Rectangles']) {
      await patterns.getByRole('button', { name: pattern, exact: true }).click()
      if (pattern !== 'None') await setControl(patterns.getByRole('spinbutton', { name: 'Pattern depth (percent)', exact: true }), '75')
      await light.setChecked(true)
      const on = await settledFrame(canvas)
      await light.setChecked(false)
      const off = await settledFrame(canvas)
      frames[`${pattern}-${height}`] = [on, off]
      for (const [state, frame] of [['on', on], ['off', off]] as const) {
        const path = testInfo.outputPath(`${pattern.toLowerCase().replaceAll(' ', '-')}-${height}-${state}.png`)
        await writeFile(path, frame)
        await testInfo.attach(`${pattern}-${height}-${state}`, { path, contentType: 'image/png' })
      }
    }
  }
  const difference = await transmissionDifference(page, [...frames['Triangles-25'], ...frames['Rectangles-25']])
  await testInfo.attach('pattern-transmission-difference', { body: JSON.stringify(difference, null, 2), contentType: 'application/json' })
  await writeFile(testInfo.outputPath('pattern-transmission-difference.json'), JSON.stringify(difference, null, 2))
  expect(difference.shade.mean, 'pattern-dependent transmission is visible on the shade').toBeGreaterThan(0.25)
  expect(difference.floor.mean, 'pattern-dependent transmission reaches the floor').toBeGreaterThan(0.01)
  expect(difference.shade.unlit, 'switching off the lamp leaves continuous TPU, without glowing holes').toBeLessThan(0.1)
  for (const pattern of ['Triangles', 'Half circles', 'Rectangles']) {
    const added = await transmissionDifference(page, [...frames[`${pattern}-25`], ...frames['None-25']])
    await testInfo.attach(`${pattern}-versus-solid`, { body: JSON.stringify(added, null, 2), contentType: 'application/json' })
    expect(added.shade.signed, `${pattern}: thinner TPU brightens the shade`).toBeGreaterThan(0.25)
    expect(added.floor.signed, `${pattern}: thinning must not reduce light reaching the room`).toBeGreaterThanOrEqual(-0.01)
  }

  await page.getByText('Fine-tune your form', { exact: true }).click()
  await setControl(page.getByRole('spinbutton', { name: 'Object rotation (degrees)', exact: true }), '45')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'Two bulbs', exact: true }).click()
  await page.getByRole('switch', { name: 'Preview light', exact: true }).setChecked(true)
  await settledFrame(canvas)
  expect(errors).toEqual([])
})
