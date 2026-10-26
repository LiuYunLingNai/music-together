/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/immutability, @typescript-eslint/no-explicit-any, no-control-regex -- 上游 folia-major 原样移植：这些规则是宿主 React Compiler 与 lint 的额外约束，逐条改写会偏离上游实现，故按文件豁免。 */
import { useEffect, useState } from 'react';
import type { TemperaLayerImage } from '../../../types';
import { loadTemperaLayerImageThumbnails } from '../../../services/temperaLayerImages';

// src/components/visualizer/tempera/useTemperaLayerImageThumbnails.ts
// Resolves the pool's stored *preview* blobs to object URLs so the settings UI can show real
// pictures. The files live in IndexedDB and nothing else in the app holds a URL for them, so
// without this the user is picking between filenames. Deliberately the downscaled copy, not the
// artwork: the renderer's full-resolution path is `loadTemperaLayerImageBlobs`.

/**
 * Keyed on the *id set*, not on the array: dragging a placement slider produces a new array
 * every pointermove, and re-reading IndexedDB (and re-minting URLs, which would flash every
 * thumbnail) on each of those is the same mistake that once made the sliders unusable.
 *
 * Every URL minted here is revoked when the set changes or the component unmounts; a stale
 * async resolve is dropped rather than leaked.
 */
export const useTemperaLayerImageThumbnails = (images: TemperaLayerImage[]) => {
    const [thumbnails, setThumbnails] = useState<Map<string, string>>(() => new Map());
    const idKey = images.map(image => image.id).join('|');

    useEffect(() => {
        let cancelled = false;
        const urls: string[] = [];
        if (idKey.length === 0) {
            setThumbnails(new Map());
            return () => { cancelled = true; };
        }

        void loadTemperaLayerImageThumbnails(idKey.split('|').map(id => ({ id })))
            .then(blobs => {
                const resolved = new Map<string, string>();
                blobs.forEach((blob, id) => {
                    const url = URL.createObjectURL(blob);
                    urls.push(url);
                    resolved.set(id, url);
                });
                if (cancelled) {
                    urls.forEach(url => URL.revokeObjectURL(url));
                    return;
                }
                setThumbnails(resolved);
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
            urls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [idKey]);

    return thumbnails;
};
