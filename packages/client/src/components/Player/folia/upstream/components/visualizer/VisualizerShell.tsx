import React, { forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, type MotionValue } from 'motion/react';
import { useTranslation } from '../../adapters/i18n';
import { ChevronLeft } from 'lucide-react';
import { type AudioBands, type Theme } from '../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../utils/fontStacks';
import { type VisualizerSharedProps } from './definition';
import { VisualizerBackdropContext, VisualizerBackdropLayers } from './VisualizerBackdrop';

// src/components/visualizer/VisualizerShell.tsx
// Shared outer shell for all visualizers.
// This is where we keep background layering, font injection, and the hover-only back button
// so each renderer can stay focused on lyric timing/layout instead of rebuilding the same frame.
// Inside VisualizerRenderer the background and the opacity are its backdrop's
// (VisualizerBackdrop.tsx), which a style switch keeps; the shell draws them only where it stands
// alone.
//
// ★ 与上游的差异：上游这里还画 folium 的 mod 舞台层（`FoliumStageLayerSlot`），并用
//   `usePlayerOverlayReservation` 向 Electron 主进程预留返回/面板热点、用
//   `useIsPlayerBottomBarHost` + `isMainAppSurface` 判断是否在真实播放页。这些都属于上游
//   Electron 的窗口与 mod 系统，本项目没有对应物。返回按钮与热点判定逻辑按上游原样保留
//   （宿主不传 `onBack` 时不渲染按钮）。
type VisualizerShellSharedProps = Pick<
    VisualizerSharedProps,
    | 'coverUrl'
    | 'isDaylight'
    | 'seed'
    | 'visualizerOpacity'
    | 'background'
    | 'staticMode'
    | 'backgroundStaticMode'
    | 'paused'
    | 'onBack'
    | 'isPanelOpen'
    | 'alwaysShowBackButton'
    | 'onPlayerPanelGuideHotspotChange'
    | 'isPreviewMode'
>;

interface VisualizerShellProps {
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    sharedProps?: VisualizerShellSharedProps;
    visualizerOpacity?: number;
    /** False for a style drawn over no background. Inside VisualizerRenderer the style's registry entry says it instead (`background`). */
    renderBackground?: boolean;
    children: React.ReactNode;
    className?: string;
}

const PLAYER_CHROME_HOTSPOT_SIZE = 120;
const TOUCH_GUIDE_DISPLAY_MS = 1400;

const isNearPlayerPanelHotspot = (clientX: number, clientY: number) => (
    typeof window !== 'undefined'
    && clientX >= window.innerWidth - PLAYER_CHROME_HOTSPOT_SIZE
    && clientY >= window.innerHeight - PLAYER_CHROME_HOTSPOT_SIZE
);

const VisualizerShell = forwardRef<HTMLDivElement, VisualizerShellProps>(({
    theme,
    audioPower,
    audioBands,
    sharedProps,
    visualizerOpacity = 1,
    renderBackground = true,
    children,
    className = '',
}, ref) => {
    const { t } = useTranslation();
    const backdrop = useContext(VisualizerBackdropContext);
    const isInBackdrop = backdrop !== null;
    const pointerArea = backdrop?.pointerArea ?? null;
    const [showBackButton, setShowBackButton] = useState(false);
    const backVisibilityRef = useRef(false);
    const playerPanelGuideHotspotRef = useRef(false);
    const touchGuideHideTimeoutRef = useRef<number | null>(null);
    const resolvedVisualizerOpacity = sharedProps?.visualizerOpacity ?? visualizerOpacity;
    const resolvedOnBack = sharedProps?.onBack;
    const resolvedIsPanelOpen = sharedProps?.isPanelOpen ?? false;
    const onPlayerPanelGuideHotspotChange = sharedProps?.onPlayerPanelGuideHotspotChange;
    const isBackButtonVisible = sharedProps?.alwaysShowBackButton || showBackButton;
    const hasBackAction = Boolean(resolvedOnBack);

    const updateBackVisibility = useCallback((visible: boolean) => {
        if (backVisibilityRef.current === visible) return;
        backVisibilityRef.current = visible;
        setShowBackButton(visible);
    }, []);
    const updatePlayerPanelGuideHotspot = (isActive: boolean) => {
        if (playerPanelGuideHotspotRef.current === isActive) {
            return;
        }

        playerPanelGuideHotspotRef.current = isActive;
        onPlayerPanelGuideHotspotChange?.(isActive);
    };

    const clearTouchGuideHideTimeout = () => {
        if (touchGuideHideTimeoutRef.current === null) {
            return;
        }

        window.clearTimeout(touchGuideHideTimeoutRef.current);
        touchGuideHideTimeoutRef.current = null;
    };

    const showTouchPanelGuide = () => {
        clearTouchGuideHideTimeout();
        updatePlayerPanelGuideHotspot(true);
        touchGuideHideTimeoutRef.current = window.setTimeout(() => {
            touchGuideHideTimeoutRef.current = null;
            updatePlayerPanelGuideHotspot(false);
        }, TOUCH_GUIDE_DISPLAY_MS);
    };

    useEffect(() => () => {
        clearTouchGuideHideTimeout();
        if (playerPanelGuideHotspotRef.current) {
            playerPanelGuideHotspotRef.current = false;
            onPlayerPanelGuideHotspotChange?.(false);
        }
    }, [onPlayerPanelGuideHotspotChange]);

    const pointer = {
        move: (event: { clientX: number; clientY: number }) => {
            // Back button is intentionally hidden most of the time.
            // Only reveal it near the top-left hot area so it does not pollute the visual field.
            updateBackVisibility(event.clientX <= PLAYER_CHROME_HOTSPOT_SIZE && event.clientY <= PLAYER_CHROME_HOTSPOT_SIZE);

            updatePlayerPanelGuideHotspot(!resolvedIsPanelOpen && isNearPlayerPanelHotspot(event.clientX, event.clientY));
        },
        leave: () => {
            updateBackVisibility(false);
            updatePlayerPanelGuideHotspot(false);
        },
        down: (event: { pointerType: string; clientX: number; clientY: number }) => {
            if (resolvedIsPanelOpen || event.pointerType !== 'touch' || !isNearPlayerPanelHotspot(event.clientX, event.clientY)) {
                return;
            }

            showTouchPanelGuide();
        },
        cancel: () => {
            clearTouchGuideHideTimeout();
            updatePlayerPanelGuideHotspot(false);
        },
    };

    // Inside a backdrop the shell's box lets the pointer through (to stage layers under the style), so
    // the same handlers listen on the backdrop's box, which every pointer over the visualizer crosses.
    // A shell that stops listening (it unmounts, or its style starts leaving) hides the guide it showed
    // at once: the shell that listens next starts from a hidden guide, so the two agree. Moves are read
    // on the way down (capture), so a layer that keeps its own moves to itself still reveals the chrome.
    const pointerRef = useRef(pointer);
    useLayoutEffect(() => {
        pointerRef.current = pointer;
    });
    useEffect(() => {
        if (!pointerArea) return undefined;
        const move = (event: MouseEvent) => pointerRef.current.move(event);
        const leave = () => pointerRef.current.leave();
        const down = (event: PointerEvent) => pointerRef.current.down(event);
        const cancel = () => pointerRef.current.cancel();
        pointerArea.addEventListener('mousemove', move, true);
        pointerArea.addEventListener('mouseleave', leave);
        pointerArea.addEventListener('pointerdown', down);
        pointerArea.addEventListener('pointercancel', cancel);
        return () => {
            pointerArea.removeEventListener('mousemove', move, true);
            pointerArea.removeEventListener('mouseleave', leave);
            pointerArea.removeEventListener('pointerdown', down);
            pointerArea.removeEventListener('pointercancel', cancel);
            cancel();
        };
    }, [pointerArea]);

    // Keep the tailwind font utility roughly aligned with the theme category,
    // but still let the real resolved font stack win through inline style.
    const fontClassName = theme.fontStyle === 'mono'
        ? 'font-mono'
        : theme.fontStyle === 'serif'
            ? 'font-serif'
            : 'font-sans';

    return (
        <div
            ref={ref}
            className={`w-full h-full flex flex-col items-center justify-center overflow-hidden relative ${fontClassName} transition-colors duration-1000 ${className}`.trim()}
            style={{
                backgroundColor: 'transparent',
                fontFamily: resolveThemeFontStack(theme),
                fontWeight: resolveThemeFontWeight(theme, 400),
                opacity: isInBackdrop ? undefined : resolvedVisualizerOpacity,
                pointerEvents: isInBackdrop ? 'none' : undefined,
            }}
            onMouseMoveCapture={isInBackdrop ? undefined : pointer.move}
            onMouseLeave={isInBackdrop ? undefined : pointer.leave}
            onPointerDown={isInBackdrop ? undefined : pointer.down}
            onPointerCancel={isInBackdrop ? undefined : pointer.cancel}
        >
            {hasBackAction && (
                <motion.button
                    type="button"
                    aria-label={t('ui.backToHome')}
                    initial={false}
                    animate={{
                        opacity: isBackButtonVisible ? 1 : 0,
                        scale: isBackButtonVisible ? 1 : 0.92,
                        x: isBackButtonVisible ? 0 : -6,
                    }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    onClick={(event) => {
                        event.stopPropagation();
                        resolvedOnBack?.();
                    }}
                    className="absolute top-6 left-6 z-30 h-10 w-10 rounded-full flex items-center justify-center transition-colors backdrop-blur-md bg-black/20 hover:bg-white/10 text-white/60 pointer-events-auto"
                    style={{ pointerEvents: isBackButtonVisible ? 'auto' : 'none' }}
                >
                    <ChevronLeft size={20} />
                </motion.button>
            )}

            {!isInBackdrop && (
                <VisualizerBackdropLayers
                    theme={theme}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    sharedProps={sharedProps}
                    renderBackground={renderBackground}
                />
            )}

            {/* Without a box of its own, so the style lays out as before; it gives the style back the
                pointer that the shell's box lets through. */}
            {isInBackdrop ? <div style={{ display: 'contents', pointerEvents: 'auto' }}>{children}</div> : children}
        </div>
    );
});

VisualizerShell.displayName = 'VisualizerShell';

export default VisualizerShell;
