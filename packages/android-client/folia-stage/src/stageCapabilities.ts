// Only offer settings that the selected upstream renderer consumes. Styles
// with no canvas still share the global quality used by other styles.
export const hasStaticStage = (mode: string) =>
  [
    "sonnet",
    "hanabi",
    "machi",
    "fume",
    "monet",
    "nebbia",
    "lumiere",
    "prompt",
    "tempera",
  ].includes(mode);
export const hasCanvasQuality = (mode: string) =>
  [
    "sonnet",
    "hanabi",
    "machi",
    "fume",
    "monet",
    "nebbia",
    "lumiere",
    "diorama",
    "pendolo",
    "tempera",
  ].includes(mode);
export const hasCanvasAntialias = (mode: string) =>
  [
    "sonnet",
    "hanabi",
    "machi",
    "lumiere",
    "diorama",
    "pendolo",
    "tempera",
  ].includes(mode);
export const hasAnimationIntensity = (mode: string) =>
  [
    "classic",
    "partita",
    "cadenza",
    "cappella",
    "claddagh",
    "diorama",
    "fume",
    "pendolo",
    "tilt",
  ].includes(mode);
