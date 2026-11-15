# Folia stage sources

Source: https://github.com/maimai993/folia-sonnet

Revision: 5077f72039f6ca226a79732a7845e75a0e677f0d
Version: 0.7.28.4
License: AGPL-3.0 (LICENSE.folia). Original copyright notices are preserved.

The renderer is embedded as local web assets. Native Android owns playback, authentication and room control. Host adaptations are in src/ and vite.config.mjs.

The snapshot includes the original built-in stage settings panels, settings kit, visual asset helpers, JIZURA editor bridge and seven offline background entries (common, latent, monet, nomand, sonic, sora, particles). `scripts/snapshot.mjs` expands the source dependency closure from a checkout at the revision above. All archived source files remain unmodified; the source archive SHA-256 is recorded in upstream-source.sha256.
