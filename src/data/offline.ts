/**
 * Offline summary config. The "while you were away" panel only appears for a
 * session gap long enough to be worth reporting - a quick app-switch should
 * never interrupt the player with a popup.
 */
export const OFFLINE_SUMMARY_MIN_MS = 120_000;
