// Run on macOS: swift scripts/generate-brand-assets.swift
// Assets are committed; production builds do not need Swift or macOS.
import AppKit

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}

func mark(x: CGFloat, y: CGFloat, size: CGFloat) {
    let path = NSBezierPath()
    let strokes: [[CGPoint]] = [
        [CGPoint(x: 24, y: 7), CGPoint(x: 38, y: 15), CGPoint(x: 24, y: 23), CGPoint(x: 10, y: 15), CGPoint(x: 24, y: 7)],
        [CGPoint(x: 10, y: 23), CGPoint(x: 24, y: 31), CGPoint(x: 38, y: 23)],
        [CGPoint(x: 10, y: 31), CGPoint(x: 24, y: 39), CGPoint(x: 38, y: 31)],
        [CGPoint(x: 10, y: 15), CGPoint(x: 10, y: 31)],
        [CGPoint(x: 38, y: 15), CGPoint(x: 38, y: 31)],
        [CGPoint(x: 24, y: 23), CGPoint(x: 24, y: 39)]
    ]
    for stroke in strokes {
        for (index, p) in stroke.enumerated() {
            let point = CGPoint(x: x + p.x * size / 48, y: y + p.y * size / 48)
            if index == 0 { path.move(to: point) } else { path.line(to: point) }
        }
    }
    path.lineWidth = 2 * size / 48
    path.lineJoinStyle = .round
    color(0xfff9ef).setStroke()
    path.stroke()
}

func png(_ filename: String, width: Int, height: Int, draw: () -> Void) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.translateBy(x: 0, y: CGFloat(height))
    context.cgContext.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "public/\(filename)"))
}

for (name, size, inset) in [("icon-192.png", 192, 0.0), ("icon-512.png", 512, 0.0),
                           ("icon-maskable-512.png", 512, 0.12), ("apple-touch-icon.png", 180, 0.0)] {
    try png(name, width: size, height: size) {
        color(0xc34834).setFill()
        NSRect(x: 0, y: 0, width: size, height: size).fill()
        mark(x: CGFloat(size) * inset, y: CGFloat(size) * inset, size: CGFloat(size) * (1 - 2 * inset))
    }
}
