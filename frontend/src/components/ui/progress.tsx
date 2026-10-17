"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /** A second row used to display prepaid time after the current cycle reaches 100%. */
  secondaryValue?: number
}

function Progress({
  className,
  value,
  secondaryValue,
  ...props
}: ProgressProps) {
  const overflow = Number.isFinite(secondaryValue) ? Math.min(100, Math.max(0, secondaryValue ?? 0)) : 0
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      data-overflow={overflow > 0 ? "true" : undefined}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
      {overflow > 0 && <ProgressPrimitive.Indicator
        data-slot="progress-overflow-indicator"
        className="h-full w-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - overflow}%)` }}
      />}
    </ProgressPrimitive.Root>
  )
}

export { Progress }
