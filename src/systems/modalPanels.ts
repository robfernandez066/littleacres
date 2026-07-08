/**
 * Tracks whether a modal-style panel (order board, inventory) is currently
 * open, so field input (`FarmScene`) and the onboarding pulse (`SeedBar`,
 * `OnboardingGuide`) can react without importing the UI classes that own the
 * panels - mirrors the provider-registry approach in `pulseTargets.ts`.
 * Panels call `setPanelOpen` on toggle/hide; open panels are mutually
 * exclusive today (the HUD closes one before opening the other), but this
 * tracks each by id so that isn't load-bearing here.
 */

const openPanels = new Set<string>();

export function setPanelOpen(id: string, open: boolean): void {
  if (open) {
    openPanels.add(id);
  } else {
    openPanels.delete(id);
  }
}

export function isModalOpen(): boolean {
  return openPanels.size > 0;
}
