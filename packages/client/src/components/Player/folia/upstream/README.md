# Folia visualizer port

This directory contains the Folia visualizer implementations and supporting visual utilities from [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major), under AGPL-3.0. Original copyright and attribution comments are preserved.

It contains the nine additional modes (cadenza, claddagh, diorama, fume, lumiere, monet, pendolo, sonnet, tempera) and all six upstream background families. The five existing modes stay in the adjacent `modes` directory. Upstream `classic` maps to host `luminous`, because `classic` already identifies Music Together's fallback player.

Adaptations replace the Electron shell with host layering, use `motion/react`, provide local visual labels, inject the host's room timeline and audio MotionValues, and keep playback/account/provider state outside this directory. The type file includes visual contracts and defaults only. React lifecycle and Pixi command types follow the host's existing lint and TypeScript rules. Pure compiler, timing and sequencer tests are ported alongside the implementation.

Shader/Pixi/three renderers load only when selected. Custom Electron mod contributions, OBS plumbing and upstream accounts are outside this visualizer port.
