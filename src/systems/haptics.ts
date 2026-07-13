import { gameState } from './gameState';

/**
 * Central haptics helper. All vibration in the game goes through `buzz` so
 * the settings toggle (T3.12) has exactly one place to land.
 *
 * Feature-detected: a silent no-op where the Vibration API is missing (iOS
 * Safari has none - that is fine and expected).
 */
export function buzz(ms: number): void {
  if (!gameState.getState().settings.hapticsOn) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Some browsers throw without user activation; haptics never crash play.
  }
}
