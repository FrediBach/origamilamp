import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root data-slot="switch" className={cn('switch', className)} {...props}><SwitchPrimitive.Thumb className="switch-thumb" /></SwitchPrimitive.Root>
}
export { Switch }
