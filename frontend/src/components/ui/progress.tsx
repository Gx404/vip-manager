"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /** Remaining time sits after the consumed portion of a billing period. */
  fillFrom?: "start" | "end"
}

function Progress({
  className,
  value,
  fillFrom = "start",
  ...props
}: ProgressProps) {
  const percentage = Number.isFinite(value) ? Math.min(100, Math.max(0, value ?? 0)) : 0
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={percentage}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(${fillFrom === "end" ? "" : "-"}${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
