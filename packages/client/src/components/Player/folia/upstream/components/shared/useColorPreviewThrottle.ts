/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect, react-hooks/refs, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- 上游 folia-major 原样移植：这些规则是宿主 React Compiler 的额外约束，逐条改写会偏离上游实现，故按文件豁免。 */
import { useEffect, useRef } from 'react';

// src/components/shared/useColorPreviewThrottle.ts
// Colour dragging is continuous; this keeps the picker fluid while limiting what the drag writes
// (store persistence, re-renders of whatever shows the colour) to a modest preview cadence, then
// flushes the final sampled colour.

const PREVIEW_INTERVAL_MS = 60;

export const useColorPreviewThrottle = (onColorChange: (color: string) => void) => {
    const pendingColorRef = useRef<string | null>(null);
    const colorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const colorHandlerRef = useRef(onColorChange);
    colorHandlerRef.current = onColorChange;

    const flushColor = () => {
        if (colorTimerRef.current !== null) clearTimeout(colorTimerRef.current);
        colorTimerRef.current = null;
        const pending = pendingColorRef.current;
        pendingColorRef.current = null;
        if (pending) colorHandlerRef.current(pending);
    };
    const previewColor = (nextColor: string) => {
        pendingColorRef.current = nextColor;
        if (colorTimerRef.current !== null) return;
        colorTimerRef.current = setTimeout(flushColor, PREVIEW_INTERVAL_MS);
    };
    useEffect(() => () => flushColor(), []);

    return { previewColor, flushColor };
};
