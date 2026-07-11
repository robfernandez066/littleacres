const TOAST_ID = 'littleacres-update-toast';

/**
 * Shows a dismissible "update available" toast as a DOM overlay (not a Phaser
 * object, so it works regardless of scene state). Idempotent: a second call
 * while the toast is already showing is a no-op rather than stacking toasts.
 */
export function showUpdateToast(onAccept: () => void): void {
  if (document.getElementById(TOAST_ID)) return;

  const root = document.createElement('div');
  root.id = TOAST_ID;
  root.style.cssText = `
    position: fixed;
    left: 50%;
    bottom: calc(16px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 200000;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 8px 10px 8px 16px;
    background: rgba(20, 20, 20, 0.92);
    color: #ffffff;
    font-family: sans-serif;
    font-size: 14px;
    border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    box-sizing: border-box;
  `;

  const label = document.createElement('span');
  label.textContent = 'Update available - tap to restart';
  root.appendChild(label);

  const dismiss = document.createElement('button');
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.style.cssText = `
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: #ffffff;
    border: none;
    border-radius: 50%;
    font-family: sans-serif;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  `;
  dismiss.addEventListener('click', (event) => {
    event.stopPropagation();
    root.remove();
  });
  root.appendChild(dismiss);

  root.addEventListener('click', () => onAccept());

  document.body.appendChild(root);
}
