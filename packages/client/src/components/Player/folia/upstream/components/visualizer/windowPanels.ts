import { createElement, lazy, type ComponentType, type ReactNode } from 'react'

/**
 * 各模式的参数面板，键是上游模式 id。
 *
 * 上游由每个 `entry.tsx` 的 `renderSettingsPanel` 提供；宿主的模式注册表是纯数据，
 * 所以在这里集中登记，窗口按当前模式取自己的那一个。用 `lazy` 是为了打开窗口时
 * 不把所有面板一起拉进来 —— 与模式渲染器按需加载是同一取舍。
 *
 * 七种模式的参数面板在上游写在同一个 `settingsPanels.tsx` 里（经典系共用一套
 * 滑块/开关组件），其余模式各有自己的面板文件。
 */
type PanelLoader = () => Promise<{ default: ComponentType<Record<string, unknown>> }>

const lazyPanel = (load: PanelLoader) => {
    const Panel = lazy(load)
    return (props: Record<string, unknown>): ReactNode => createElement(Panel, props)
}

const fromModule = (
    load: () => Promise<Record<string, unknown>>,
    name: string,
): PanelLoader => () => load().then((module) => ({ default: module[name] as ComponentType<Record<string, unknown>> }))

const sharedPanels = () => import('./settingsPanels')

export const MODE_SETTINGS_PANELS: Record<string, (props: Record<string, unknown>) => ReactNode> = {
    // settingsPanels.tsx：上游共用一套控件的七个模式。
    classic: lazyPanel(fromModule(sharedPanels, 'ClassicSettingsPanel')),
    partita: lazyPanel(fromModule(sharedPanels, 'PartitaSettingsPanel')),
    fume: lazyPanel(fromModule(sharedPanels, 'FumeSettingsPanel')),
    cappella: lazyPanel(fromModule(sharedPanels, 'CappellaSettingsPanel')),
    tilt: lazyPanel(fromModule(sharedPanels, 'TiltSettingsPanel')),
    diorama: lazyPanel(fromModule(sharedPanels, 'DioramaSettingsPanel')),
    claddagh: lazyPanel(fromModule(sharedPanels, 'CladdaghSettingsPanel')),
    // 独立面板文件的模式。
    hanabi: lazyPanel(() => import('./hanabi/HanabiSettingsPanel') as unknown as ReturnType<PanelLoader>),
    sonnet: lazyPanel(() => import('./sonnet/SonnetSettingsPanel') as unknown as ReturnType<PanelLoader>),
    lumiere: lazyPanel(() => import('./lumiere/LumiereSettingsPanel') as unknown as ReturnType<PanelLoader>),
    tempera: lazyPanel(() => import('./tempera/TemperaSettingsPanel') as unknown as ReturnType<PanelLoader>),
    monet: lazyPanel(() => import('./monet/MonetSettingsPanel') as unknown as ReturnType<PanelLoader>),
    pendolo: lazyPanel(() => import('./pendolo/PendoloSettingsPanel') as unknown as ReturnType<PanelLoader>),
}
