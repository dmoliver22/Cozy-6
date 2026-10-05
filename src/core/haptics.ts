/** navigator.vibrate wrapper with a settings toggle. */
export const haptics = {
  enabled: true,
  buzz(pattern: number | number[]): void {
    if (!this.enabled) return;
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
    } catch {
      /* unsupported */
    }
  },
};
