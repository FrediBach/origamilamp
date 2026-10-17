import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const woods = ['Oak', 'Ash', 'Maple', 'Cherry', 'Walnut', 'Smoked oak'] as const

test('support and box woods select independently, follow the frame and survive save/import', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  const support = page.getByRole('group', { name: 'Support wood', exact: true })
  const box = page.getByRole('group', { name: 'Box wood', exact: true })
  const boxToggle = page.getByRole('switch', { name: 'Wooden electronics box', exact: true })
  await expect(support.getByRole('button', { name: 'Oak', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(box).toBeHidden()
  await boxToggle.click()
  await expect(box.getByRole('button', { name: 'Match frame', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await support.getByRole('button', { name: 'Walnut', exact: true }).click()
  await expect(box.locator('.wood-description')).toContainText('Walnut.')
  await box.getByRole('button', { name: 'Maple', exact: true }).click()
  await support.getByRole('button', { name: 'Cherry', exact: true }).click()
  await expect(support.locator('.wood-description')).toContainText('Cherry.')
  await expect(box.locator('.wood-description')).toContainText('Maple.')
  await expect(box.getByRole('button', { name: 'Maple', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(box.getByRole('button', { name: 'Match frame', exact: true })).toHaveAttribute('aria-pressed', 'false')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save design', exact: true }).click()
  const recipePath = await (await downloadPromise).path()
  expect(recipePath).toBeTruthy()
  await page.reload()
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await expect(support.getByRole('button', { name: 'Cherry', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(box.getByRole('button', { name: 'Maple', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Reset all design settings', exact: true }).click()
  await expect(boxToggle).not.toBeChecked()
  await expect(support.getByRole('button', { name: 'Oak', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Import a saved design recipe').setInputFiles(recipePath!)
  await expect(boxToggle).toBeChecked()
  await expect(support.getByRole('button', { name: 'Cherry', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(box.getByRole('button', { name: 'Maple', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await box.getByRole('button', { name: 'Match frame', exact: true }).click()
  await support.getByRole('button', { name: 'Smoked oak', exact: true }).click()
  await expect(box.locator('.wood-description')).toContainText('Smoked oak.')
  await boxToggle.click()
  await boxToggle.click()
  await expect(box.getByRole('button', { name: 'Match frame', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await support.getByRole('button', { name: 'Ash', exact: true }).click()
  await expect(box.locator('.wood-description')).toContainText('Ash.')
  expect(errors).toEqual([])
})

test('wood choices are keyboard accessible and fit a narrow mobile screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByRole('switch', { name: 'Wooden electronics box', exact: true }).click()
  for (const label of ['Support wood', 'Box wood']) {
    const picker = page.getByRole('group', { name: label, exact: true })
    for (const wood of woods) await expect(picker.getByRole('button', { name: wood, exact: true })).toBeAttached()
    const walnut = picker.getByRole('button', { name: 'Walnut', exact: true })
    await walnut.focus()
    await walnut.press('Space')
    await expect(walnut).toBeFocused()
    await expect(walnut).toHaveAttribute('aria-pressed', 'true')
    await expect(picker.locator('button[aria-pressed="true"]')).toHaveCount(1)
    await expect(picker).toHaveAccessibleDescription(/^Walnut\./)
    expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).include('.wood-picker').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('wood-options-mobile.png'), fullPage: true })
})

async function woodLuminance(page: Page, screenshot: Buffer) {
  return page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    // Interior samples of the front box wall and front-right post, with the
    // default camera, spring supports and an 80 mm internal box height.
    const regions = { box: [0.455, 0.785, 0.045, 0.025], post: [0.5325, 0.40, 0.0025, 0.19] }
    const luminance = Object.fromEntries(Object.entries(regions).map(([part, [x, y, width, height]]) => {
      const pixels = context.getImageData(
        Math.round(image.width * x), Math.round(image.height * y),
        Math.max(1, Math.round(image.width * width)), Math.max(1, Math.round(image.height * height)),
      ).data
      let total = 0
      for (let pixel = 0; pixel < pixels.length; pixel += 4) {
        total += pixels[pixel] * 0.2126 + pixels[pixel + 1] * 0.7152 + pixels[pixel + 2] * 0.0722
      }
      return [part, total / (pixels.length / 4)]
    }))
    image.close()
    return luminance
  }, screenshot.toString('base64'))
}

test('wood finishes render distinct natural brightness on the frame and box', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Finish', exact: true }).click()
  await page.getByText('Top and bottom mounting', { exact: true }).click()
  await page.getByRole('button', { name: 'Metal springs', exact: true }).click()
  await page.getByRole('switch', { name: 'Wooden electronics box', exact: true }).click()
  const height = page.getByRole('spinbutton', { name: 'Internal box height (millimetres)', exact: true })
  await height.fill('80')
  await height.press('Tab')
  await page.getByRole('button', { name: 'Reset camera view', exact: true }).click()
  const support = page.getByRole('group', { name: 'Support wood', exact: true })
  const box = page.getByRole('group', { name: 'Box wood', exact: true })
  const canvas = page.locator('canvas')
  const capture = async (name: string) => {
    let previous = await canvas.screenshot()
    await expect.poll(async () => {
      const next = await canvas.screenshot()
      const same = previous.equals(next)
      previous = next
      return same
    }, { timeout: 15_000 }).toBe(true)
    const screenshot = await canvas.screenshot({ path: testInfo.outputPath(`wood-${name}.png`) })
    return woodLuminance(page, screenshot)
  }

  const measurements: Record<string, Record<string, Record<string, number>>> = {}
  for (const environment of ['Studio', 'Tatami']) {
    if (environment === 'Tatami') await page.getByRole('button', { name: 'In a room', exact: true }).click()
    await page.getByRole('button', { name: environment, exact: true }).click()
    measurements[environment] = {}
    for (const wood of environment === 'Studio' ? woods : ['Maple', 'Oak', 'Walnut']) {
      await support.getByRole('button', { name: wood, exact: true }).click()
      measurements[environment][wood] = await capture(`${environment.toLowerCase()}-${wood.toLowerCase().replaceAll(' ', '-')}`)
    }
  }

  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await support.getByRole('button', { name: 'Maple', exact: true }).click()
  await box.getByRole('button', { name: 'Walnut', exact: true }).click()
  const mixed = await capture('studio-maple-support-walnut-box')
  await testInfo.attach('wood-finish-measurements', { body: JSON.stringify({ measurements, mixed }, null, 2), contentType: 'application/json' })

  for (const environment of ['Studio', 'Tatami']) {
    for (const part of ['box', 'post']) {
      const readings = measurements[environment]
      expect(readings.Maple[part] - readings.Oak[part], `${environment}: maple / oak ${part}`).toBeGreaterThan(8)
      expect(readings.Oak[part] - readings.Walnut[part], `${environment}: oak / walnut ${part}`).toBeGreaterThan(8)
      expect(readings.Walnut[part], `${environment}: readable walnut ${part}`).toBeGreaterThan(35)
    }
  }
  expect(measurements.Studio.Maple.box - mixed.box, 'independent walnut box').toBeGreaterThan(15)
  expect(Math.abs(measurements.Studio.Maple.post - mixed.post), 'maple support stays unchanged').toBeLessThan(3)
  expect(errors).toEqual([])
})
