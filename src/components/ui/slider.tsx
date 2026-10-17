import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

function Slider({ className, 'aria-label': label, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, 'aria-valuetext': valueText, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return <SliderPrimitive.Root data-slot="slider" className={cn('slider', className)} {...props}>
    <SliderPrimitive.Track className="slider-track"><SliderPrimitive.Range className="slider-range" /></SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="slider-thumb" aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-valuetext={valueText} />
  </SliderPrimitive.Root>
}
export { Slider }
