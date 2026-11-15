interface Window {
  MusicTogetherStage?: { postMessage(message: string): void };
  FoliaStage?: {
    resizeViewport(width?: number, height?: number): void;
    document(data: unknown): void;
    mode(id: string): void;
    frame(data: unknown): void;
    settings(open: boolean): void;
  };
}
