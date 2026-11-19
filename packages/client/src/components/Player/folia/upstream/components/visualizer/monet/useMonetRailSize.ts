/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/purity, react-refresh/only-export-components -- Adapted upstream visual runtime and its existing imperative lifecycle. */
import React, { useEffect, useState } from 'react';
import type { MonetRailSize } from './monetRailLayout';

// src/components/visualizer/monet/useMonetRailSize.ts
// 观察歌词栏容器尺寸（ResizeObserver），尺寸不变时不触发 setState。

export const useMonetRailSize = (ref: React.RefObject<HTMLDivElement | null>): MonetRailSize => {
    const [size, setSize] = useState<MonetRailSize>({ width: 0, height: 0 });

    useEffect(() => {
        const node = ref.current;
        if (!node) {
            return;
        }

        const updateSize = () => {
            const nextWidth = Math.round(node.clientWidth);
            const nextHeight = Math.round(node.clientHeight);
            setSize(current => (
                current.width === nextWidth && current.height === nextHeight
                    ? current
                    : { width: nextWidth, height: nextHeight }
            ));
        };

        updateSize();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        return () => observer.disconnect();
    }, [ref]);

    return size;
};
