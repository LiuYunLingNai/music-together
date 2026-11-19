/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/purity, react-refresh/only-export-components -- Adapted upstream visual runtime and its existing imperative lifecycle. */
// src/utils/whenIdle.ts
// 等页面空下来再做一件事：有 requestIdleCallback 用它（最多等 timeout），没有（WebKit）就用一个短定时器。

/** 页面空下来时跑 run，最晚 timeout 毫秒后。返回的函数把它撤掉。 */
export const whenIdle = (run: () => void, timeout = 500): (() => void) => {
    if (typeof window.requestIdleCallback !== 'function') {
        const timer = window.setTimeout(run, 50);
        return () => window.clearTimeout(timer);
    }
    const idle = window.requestIdleCallback(run, { timeout });
    return () => window.cancelIdleCallback(idle);
};
