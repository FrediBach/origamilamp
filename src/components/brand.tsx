export function OrigamiMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M20 3 36 12 20 21 4 12 20 3Z" /><path d="m4 21 16 9 16-9M4 30l16 9 16-9M4 12v18m32-18v18M20 21v18" /></svg>
}

export function LampDrawing({ variant = 0 }: { variant?: number }) {
  const layers = Array.from({ length: 12 }, (_, i) => {
    const y = 17 + i * 5
    const half = variant === 1 ? 19 + Math.sin(i / 11 * Math.PI) * 6 : variant === 2 ? 24 - i * 0.65 : 20
    return <path key={i} d={`M${50 - half} ${y} Q50 ${y + 7} ${50 + half} ${y} L${50 + half - 4} ${y + 4} Q50 ${y + 10} ${50 - half + 4} ${y + 4} Z`} />
  })
  return <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className="lamp-drawing"><path className="drawing-frame" d="M24 87V11h52v76M21 87h58M50 13v68" />{layers}</svg>
}
