// DOMRects use visible viewport pixels; fixed CSS positions inside the scaled
// document use layout pixels. Keep that conversion at the positioning boundary.
export function getUIScale() {
  if (typeof document === 'undefined') return 1;
  return Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

export function getLayoutRect(element) {
  const rect = element.getBoundingClientRect();
  const scale = getUIScale();
  return Object.fromEntries(['top', 'right', 'bottom', 'left', 'width', 'height', 'x', 'y']
    .map(key => [key, rect[key] / scale]));
}

export function getLayoutViewport() {
  const scale = getUIScale();
  return { width: window.innerWidth / scale, height: window.innerHeight / scale };
}
