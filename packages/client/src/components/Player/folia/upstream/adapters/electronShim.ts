/**
 * 上游设置窗口读 `window.electron` 做三件事：桌面版专属行、系统字体上传、外部链接。
 * 宿主是纯 Web 构建，没有这个对象 —— 这里只补类型与一个恒空的实现，
 * 让上游代码原样保留分支，行为自然落到 Web 那一支。
 */
export interface ElectronShim {
    openExternalUrl?: (url: string) => Promise<void>
    [key: string]: unknown
}

declare global {
    interface Window {
        electron?: ElectronShim
    }
}

export const isDesktopApp = (): boolean =>
    typeof window !== 'undefined' && Boolean(window.electron)
