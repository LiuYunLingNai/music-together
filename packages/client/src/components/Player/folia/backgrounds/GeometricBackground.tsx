import type { CSSProperties } from 'react'
import type { Theme } from '../types'

/** Folia's floating circles/squares/triangles/crosses, with stable positions across renders. */
export function GeometricBackground({ theme, speed }: { theme: Theme; speed: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: theme.backgroundColor }}>
      {Array.from({ length: 15 }, (_, index) => {
        const shape = index % 4
        const size = 40 + ((index * 37) % 100)
        return (
          <div
            key={index}
            className="folia-geometric__shape"
            style={{
              left: `${(index * 31 + 7) % 100}%`,
              top: `${(index * 47 + 13) % 100}%`,
              width: size,
              height: size,
              opacity: 0.11 + (index % 4) * 0.025,
              border: shape < 2 ? `1px solid ${theme.secondaryColor}` : undefined,
              borderRadius: shape === 0 ? '50%' : undefined,
              background: shape >= 2 ? theme.secondaryColor : undefined,
              clipPath:
                shape === 2
                  ? 'polygon(50% 0%,0% 100%,100% 100%)'
                  : shape === 3
                    ? 'polygon(20% 0%,0% 20%,30% 50%,0% 80%,20% 100%,50% 70%,80% 100%,100% 80%,70% 50%,100% 20%,80% 0%,50% 30%)'
                    : undefined,
              animationDuration: `${(30 + ((index * 7) % 30)) / speed}s`,
              animationDelay: `${-index * 3}s`,
            }}
          />
        )
      })}
      {Array.from({ length: 20 }, (_, index) => (
        <div
          key={index}
          className="folia-geometric__particle"
          style={
            {
              '--folia-particle-opacity': 0.12 + (index % 5) * 0.04,
              width: 1 + (index % 4),
              height: 1 + (index % 4),
              left: `${(index * 23 + 5) % 100}%`,
              top: `${(index * 41 + 17) % 100}%`,
              background: theme.accentColor,
              animationDuration: `${(15 + (index % 20)) / speed}s`,
              animationDelay: `${-index * 2}s`,
            } as CSSProperties
          }
        />
      ))}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle, transparent 40%, rgb(0 0 0 / 60%) 100%)' }}
      />
    </div>
  )
}
