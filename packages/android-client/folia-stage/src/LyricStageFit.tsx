import React, { useLayoutEffect, useRef } from "react";

// Fit the complete lyric group outside its animated layers. Measuring layout
// sizes avoids feeding per-word scale/position animation back into the fit.
export default function LyricStageFit({
  children,
}: {
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    const area = content?.parentElement;
    if (!content || !area) return;
    const fit = () => {
      const style = getComputedStyle(area);
      const height =
        area.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const width =
        area.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const contentWidth = Math.max(
        content.offsetWidth,
        ...Array.from(
          content.children,
          (child) => (child as HTMLElement).offsetWidth,
        ),
        // Columns can be narrow while a no-wrap row inside them is much wider.
        // Use its layout width and reserve the original 1.4x word emphasis.
        ...Array.from(
          content.querySelectorAll<HTMLElement>(".whitespace-nowrap"),
          (row) => row.offsetWidth * 1.4,
        ),
      );
      const contentHeight = content.offsetHeight;
      if (height <= 0 || width <= 0 || contentHeight <= 0 || contentWidth <= 0)
        return;
      const scale = Math.min(1, height / contentHeight, width / contentWidth);
      content.style.setProperty(
        "--folia-lyric-fit",
        String(scale < 1 ? scale * 0.98 : 1),
      );
    };
    const resize = new ResizeObserver(fit);
    resize.observe(area);
    resize.observe(content);
    const changes = new MutationObserver(fit);
    changes.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    fit();
    return () => {
      resize.disconnect();
      changes.disconnect();
    };
  }, []);
  return (
    <div ref={contentRef} data-folia-lyric-fit>
      {children}
    </div>
  );
}
