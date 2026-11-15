import React, { useEffect, useRef, useState } from "react";
import { Row, Button } from "../.work/src/components/modal/settings/kit";
import { getFromCache, saveToCache, removeFromCache } from "./db";
import { useVisualizerSettingsStore } from "./tuningStore";

type StoredFont = { name: string; blob: Blob };
const key = (subtitle: boolean) => (subtitle ? "subtitle-font" : "lyric-font");
const family = (subtitle: boolean) =>
  subtitle ? "MusicTogetherFoliaSubtitle" : "MusicTogetherFoliaLyric";
async function load(font: StoredFont, subtitle: boolean) {
  const face = new FontFace(family(subtitle), await font.blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  return face;
}
export function useStageFonts() {
  const [version, setVersion] = useState(0);
  const [fonts, setFonts] = useState<{ lyric?: string; subtitle?: string }>({});
  useEffect(() => {
    const changed = () => setVersion((version) => version + 1);
    window.addEventListener("folia:font", changed);
    return () => window.removeEventListener("folia:font", changed);
  }, []);
  useEffect(() => {
    let mounted = true;
    const faces: FontFace[] = [];
    void Promise.all(
      [false, true].map(async (subtitle) => {
        const font = await getFromCache<StoredFont>(key(subtitle));
        if (!font) return undefined;
        const face = await load(font, subtitle);
        if (!mounted) {
          document.fonts.delete(face);
          return undefined;
        }
        faces.push(face);
        return family(subtitle);
      }),
    )
      .then(([lyric, subtitle]) => {
        if (mounted) setFonts({ lyric, subtitle });
      })
      .catch(() => {
        window.dispatchEvent(
          new CustomEvent("folia:notice", {
            detail: "字体加载失败，请重新选择字体文件",
          }),
        );
      });
    return () => {
      mounted = false;
      faces.forEach((face) => document.fonts.delete(face));
    };
  }, [version]);
  return fonts;
}
export default function StageFontUpload({
  subtitle = false,
}: {
  subtitle?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const settings = useVisualizerSettingsStore();
  const field = subtitle ? "subtitleFontName" : "fontName";
  const set = settings.setDisplay;
  return (
    <Row
      label={subtitle ? "字幕自定义字体" : "歌词自定义字体"}
      hint={settings.display[field] ?? "支持 TTF、OTF、WOFF、WOFF2"}
    >
      <input
        ref={input}
        hidden
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const face = await load({ name: file.name, blob: file }, subtitle);
            document.fonts.delete(face);
            await saveToCache(key(subtitle), { name: file.name, blob: file });
            set({ [field]: file.name });
            window.dispatchEvent(new Event("folia:font"));
          } catch {
            window.dispatchEvent(
              new CustomEvent("folia:notice", { detail: "该字体文件无法使用" }),
            );
          }
        }}
      />
      <Button onClick={() => input.current?.click()}>选择字体</Button>
      {settings.display[field] && (
        <Button
          variant="quiet"
          onClick={async () => {
            await removeFromCache(key(subtitle));
            set({ [field]: null });
            window.dispatchEvent(new Event("folia:font"));
          }}
        >
          移除
        </Button>
      )}
    </Row>
  );
}
