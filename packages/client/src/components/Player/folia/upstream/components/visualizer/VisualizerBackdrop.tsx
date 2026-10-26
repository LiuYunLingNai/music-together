import React, { createContext, useMemo, useState } from 'react';
import type { MotionValue } from 'motion/react';
import type { AudioBands, Theme } from '../../types';
import type { VisualizerSharedProps } from './definition';
import VisualizerBackgroundRenderer from './backgrounds/VisualizerBackgroundRenderer';
import VideoLayer from './videoLayer/VideoLayer';
import VisualizerBackgroundTransition from './styleTransition/VisualizerBackgroundTransition';
import type { LayerTransition } from './styleTransition/layerTransition';
import { getSizedCoverUrl } from '../../utils/coverUrl';

// src/components/visualizer/VisualizerBackdrop.tsx
// What a lyric style is drawn over: the background. VisualizerRenderer draws it once around
// whichever style is on screen, so a style switch keeps it. A change of background plays the
// style switch's transition too (styleTransition/VisualizerBackgroundTransition).
//
// 与上游的差异：上游这里还画 folium 的 mod 舞台层（`FoliumStageLayerSlot`），
//   那属于上游 Electron 的 mod 系统，本项目没有对应物。`VideoLayer` 已按上游接上。

/* eslint-disable react-refresh/only-export-components -- 上游把 Context 与组件放同一个文件，这里保留文件布局。 */

/**
 * Set inside a VisualizerBackdrop: the shell of the style inside leaves the layers and the opacity to
 * it. The shell's own box lets the pointer through to what is under the style.
 */
export interface VisualizerBackdropFrame {
    pointerArea: HTMLElement | null;
}

export const VisualizerBackdropContext = createContext<VisualizerBackdropFrame | null>(null);

export type VisualizerBackdropSharedProps = Pick<
    VisualizerSharedProps,
    | 'coverUrl'
    | 'isDaylight'
    | 'seed'
    | 'background'
    | 'staticMode'
    | 'backgroundStaticMode'
    | 'paused'
    | 'isPreviewMode'
>;

interface VisualizerBackdropLayersProps {
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    sharedProps?: VisualizerBackdropSharedProps;
    renderBackground: boolean;
    /** The transition a background change plays; left out or null, the new background shows at once. */
    transition?: LayerTransition | null;
    /** A background change made now waits to start, with the style switch it is made with. */
    waits?: boolean;
}

/** The layers under a style's lyrics, bottom first. */
export const VisualizerBackdropLayers: React.FC<VisualizerBackdropLayersProps> = ({
    theme,
    audioPower,
    audioBands,
    sharedProps,
    renderBackground,
    transition = null,
    waits = false,
}) => {
    const staticMode = sharedProps?.staticMode ?? false;
    const paused = sharedProps?.paused ?? false;

    return (
        <VisualizerBackgroundTransition
            inputs={{
                config: sharedProps?.background,
                theme,
                isDaylight: sharedProps?.isDaylight ?? false,
                coverUrl: getSizedCoverUrl(sharedProps?.coverUrl, 1024) || undefined,
                audioPower,
                audioBands,
                seed: sharedProps?.seed,
                staticMode: staticMode || (sharedProps?.backgroundStaticMode ?? false),
                paused,
                blendMs: transition ? (transition.enter.delay ?? 0) + transition.enter.duration : 0,
                blendProgress: transition?.progress,
            }}
            drawn={renderBackground}
            transition={transition}
            waits={waits}
            render={inputs => <VisualizerBackgroundRenderer {...inputs} />}
        />
    );
};

interface VisualizerBackdropProps {
    /**
     * The style on screen: it says which background it is drawn over.
     * `false` = no background at all; a function = the props tuned for that style.
     */
    background: false | ((props: VisualizerSharedProps) => VisualizerSharedProps['background']) | undefined;
    props: VisualizerSharedProps;
    /** The transition a background change plays, the style switch's; left out or null to cut. */
    transition?: LayerTransition | null;
    /** The style switch waits for the new style's first frame: a background change made now waits with it. */
    waits?: boolean;
    children: React.ReactNode;
}

/**
 * The style on screen over its layers, all at the visualizer's opacity.
 * The box is the one the style's shell had (full size, clipped), so the layers sit and paint where
 * they did inside it.
 */
const VisualizerBackdrop: React.FC<VisualizerBackdropProps> = ({ background, props, transition, waits, children }) => {
    const [pointerArea, setPointerArea] = useState<HTMLDivElement | null>(null);
    const frame = useMemo<VisualizerBackdropFrame>(() => ({ pointerArea }), [pointerArea]);

    return (
        <div
            ref={setPointerArea}
            className="relative h-full w-full overflow-hidden"
            style={{ opacity: props.visualizerOpacity ?? 1 }}
        >
            <VisualizerBackdropLayers
                theme={props.theme}
                audioPower={props.audioPower}
                audioBands={props.audioBands}
                sharedProps={
                    typeof background === 'function'
                        ? { ...props, background: background(props) }
                        : props
                }
                renderBackground={background !== false}
                transition={transition}
                waits={waits}
            />
            {/* 上游同位置：歌词背后的本地视频层（设置里选的文件或链接，跟随播放）。
                预览与静态模式下不画。 */}
            {!props.isPreviewMode && !props.staticMode && <VideoLayer paused={props.paused ?? false} />}
            <VisualizerBackdropContext.Provider value={frame}>
                {children}
            </VisualizerBackdropContext.Provider>
        </div>
    );
};

export default VisualizerBackdrop;
