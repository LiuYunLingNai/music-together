// Same marker as Folia parserCore. Android already supplies parsed lyric data.
export const isInterludeLine = (line: { fullText: string }) =>
  line.fullText === "......";
