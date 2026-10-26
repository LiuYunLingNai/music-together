# Folia visualizer port

This directory contains the Folia visualizer implementations and supporting visual utilities from [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major), under AGPL-3.0. Original copyright and attribution comments are preserved.

It holds all fifteen modes, the six background families, the style-transition layers, the shared lyric/subtitle helpers and the upstream utility modules the renderers read. Upstream `classic` maps to host `luminous`, because `classic` already identifies Music Together's fallback player; the id map is `src/lib/foliaModes.ts`.

Adaptations replace the Electron shell with host layering, use `motion/react`, provide local visual labels, inject the host's room timeline and audio MotionValues, and keep playback/account/provider state outside this directory. The type file includes visual contracts and defaults only. React lifecycle and Pixi command types follow the host's existing lint and TypeScript rules. Pure compiler, timing and sequencer tests are ported alongside the implementation.

Shader/Pixi/three renderers load only when selected. Custom Electron mod contributions, OBS plumbing and upstream accounts are outside this visualizer port.

The visualizer settings window is ported too: `components/modal/settings/kit` (the settings kit), `components/shared/StudioWindow` (the work-window frame), `components/visualizer/window` (VisPlayground and its five pages) and the per-mode and per-background parameter panels. The host supplies the layer beneath them: `adapters/hostStores.ts` maps the upstream stores onto `settingsStore.foliaSettings` / `smartBeat`, `adapters/hostRuntime.ts` provides the mod registries and the playback signals the window reads, `windowRegistry.ts` replaces the `import.meta.glob` discovery with the host's mode list, and `windowRenderer.tsx` hands the window's picture requests to the host's `FoliaRenderer`.
