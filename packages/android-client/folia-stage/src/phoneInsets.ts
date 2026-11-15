let held = { top: 0, right: 0, bottom: 0, left: 0 };
const listeners = new Set<(value: typeof held) => void>();
export const getPhoneInsets = () => ({ ...held });
export const subscribePhoneInsets = (
  listener: (value: typeof held) => void,
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function applyPushedPhoneInsets(value: typeof held) {
  held = value;
  for (const side of ["top", "right", "bottom", "left"] as const)
    document.documentElement.style.setProperty(
      "--folia-safe-area-" + side,
      value[side] + "px",
    );
  listeners.forEach((listener) => listener(held));
}
