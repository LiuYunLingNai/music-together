import * as React from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Keep a single-value range endpoint aligned with the visual center of the 16px thumb. */
  alignRangeWithThumb?: boolean
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  alignRangeWithThumb = false,
  ...props
}: SliderProps) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  )
  const rangePercentage = Math.min(100, Math.max(0, (((_values[0] ?? min) - min) / (max - min || 1)) * 100))
  const thumbRadius = 8
  const rangeThumbOffset = thumbRadius * (1 - (2 * rangePercentage) / 100)

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        'group/slider relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          'bg-input relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
        )}
      >
        {alignRangeWithThumb ? (
          <span
            data-slot="slider-range"
            className="absolute inset-y-0 start-0 bg-primary"
            style={{ inlineSize: `calc(${rangePercentage}% + ${rangeThumbOffset}px)` }}
          />
        ) : (
          <SliderPrimitive.Range
            data-slot="slider-range"
            className={cn(
              'bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
            )}
          />
        )}
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="border-border ring-ring/20 block size-4 shrink-0 rounded-full border bg-background shadow-sm opacity-0 transition-[color,box-shadow,opacity] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden focus:opacity-100 group-hover/slider:opacity-100 disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
