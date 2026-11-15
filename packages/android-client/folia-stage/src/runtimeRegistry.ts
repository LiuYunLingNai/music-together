const entries = import.meta.glob(
  "../.work/src/components/visualizer/*/entry.tsx",
  { eager: true },
) as Record<string, { default: any }>;
export const stageEntries = Object.values(entries).map(
  (module) => module.default,
);
const backgrounds = import.meta.glob(
  [
    "../.work/src/components/visualizer/backgrounds/common/entry.tsx",
    "../.work/src/components/visualizer/backgrounds/latent/entry.tsx",
    "../.work/src/components/visualizer/backgrounds/monet/entry.tsx",
    "../.work/src/components/visualizer/backgrounds/nomand/entry.tsx",
    "../.work/src/components/visualizer/backgrounds/sonic/entry.tsx",
    "../.work/src/components/visualizer/backgrounds/sora/entry.tsx",
    "../.work/src/components/visualizer/backgrounds/particles/entry.tsx",
  ],
  { eager: true },
) as Record<string, { default: any }>;
export const backgroundEntries = Object.values(backgrounds)
  .map((module) => module.default)
  .sort((a, b) => a.order - b.order);
