import { lazy, Suspense } from 'react'
import type { MotionValue } from 'motion/react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Theme, AudioBands } from '../types'

const SoraBackground = lazy(() => import('../upstream/components/visualizer/backgrounds/sora/SoraBackground'))
const CommonFluid = lazy(() => import('../upstream/components/visualizer/backgrounds/common/FluidBackground'))
const CommonGeometry = lazy(() => import('../upstream/components/visualizer/backgrounds/common/GeometricBackground'))
const LatentBackground = lazy(() => import('../upstream/components/visualizer/backgrounds/latent/LatentBackground'))
const MonetBackground = lazy(() => import('../upstream/components/visualizer/backgrounds/monet/MonetBackgroundLayer'))
const NomandBackground = lazy(
  () => import('../upstream/components/visualizer/backgrounds/nomand/NomandBackgroundLayer'),
)
const UrlBackground = lazy(() => import('../upstream/components/visualizer/backgrounds/url/UrlBackgroundLayer'))

export function FoliaBackground({
  theme,
  coverUrl,
  audio,
  renderState,
}: {
  theme: Theme
  coverUrl: string | null
  audio: { audioPower: MotionValue<number>; audioBands: AudioBands }
  renderState: { paused: boolean; staticMode: boolean }
}) {
  const settings = useSettingsStore((s) => s.foliaSettings)
  const paused = !settings.backgroundMotion || renderState.paused || renderState.staticMode
  const config = settings.backgroundConfig
  const common = config.common
  return (
    <div
      className="folia-background pointer-events-none absolute inset-0"
      data-static={paused || undefined}
      aria-hidden="true"
      style={{ backgroundColor: theme.backgroundColor }}
    >
      <Suspense fallback={null}>
        {settings.background === 'common' && (
          <>
            {common?.useCoverColorBg && <CommonFluid theme={theme} coverUrl={coverUrl} />}
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: theme.backgroundColor,
                opacity: common?.useCoverColorBg ? (common.opacity ?? 0.75) : 1,
              }}
            />
            <CommonGeometry
              theme={theme}
              {...audio}
              paused={paused}
              hideShapes={common?.disableGeometricBackground}
              disableVignette={common?.disableVignette}
            />
          </>
        )}
        {settings.background === 'latent' && (
          <LatentBackground
            theme={theme}
            coverUrl={coverUrl}
            {...audio}
            staticMode={paused}
            paused={paused}
            tuning={config.latent?.tuning}
          />
        )}
        {settings.background === 'monet' && (
          <MonetBackground
            theme={theme}
            coverUrl={coverUrl}
            monetBackgroundImage={config.customImage}
            tuning={config.monet?.tuning}
            staticMode={paused}
          />
        )}
        {settings.background === 'nomand' && (
          <NomandBackground
            theme={theme}
            coverUrl={coverUrl}
            monetBackgroundImage={config.customImage}
            tuning={config.nomand?.tuning}
          />
        )}
        {settings.background === 'url' && (
          <UrlBackground urlBackgroundList={config.url?.items} urlBackgroundSelectedId={config.url?.selectedId} />
        )}
        {settings.background === 'sora' && (
          // 上游 entry 的包装语义：blank 时只渲染纯色帧，完全不挂 WebGL 星空。
          <div className="absolute inset-0 z-0" style={{ backgroundColor: '#000000' }}>
            {!config.sora?.tuning?.blank && (
              <SoraBackground theme={theme} isDaylight={false} paused={paused} />
            )}
          </div>
        )}
      </Suspense>
      <div className="absolute inset-0 bg-black" style={{ opacity: settings.backgroundDim }} />
    </div>
  )
}
