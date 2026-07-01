// ============================================================
// loading-skeleton.js
// Reusable skeleton placeholder markup, shown briefly while a
// view's data is loading/re-rendering (language switch, category
// switch) so the UI feels responsive instead of flashing blank.
// ============================================================

const LoadingSkeleton = {
  /**
   * A grid of pulsing placeholder tiles, matching the weapon/armor
   * grid layout. `count` defaults to a number that roughly fills the
   * visible area without over-rendering.
   */
  grid(count = 12) {
    const tiles = Array.from({ length: count }, () => `<div class="skel skel-tile"></div>`).join("");
    return `<div class="skel-grid">${tiles}</div>`;
  },

  /**
   * A placeholder for the detail/preview panel: a square image
   * placeholder plus a few text lines of varying width.
   */
  detailPanel() {
    return `
      <div class="hud-panel skel-detail-panel">
        <div class="skel skel-img"></div>
        <div class="skel skel-line w-60"></div>
        <div class="skel skel-line w-40"></div>
        <div class="skel skel-line w-80" style="margin-top:24px;"></div>
        <div class="skel skel-line w-60"></div>
        <div class="skel skel-line w-80"></div>
      </div>
    `;
  },

  /**
   * A placeholder for the stats/calculator panel (ACV table, EX-MOD
   * slots, etc.) -- a handful of line placeholders.
   */
  statsPanel() {
    return `
      <div class="hud-panel skel-detail-panel">
        <div class="skel skel-line w-40"></div>
        <div class="skel skel-line w-80"></div>
        <div class="skel skel-line w-80"></div>
        <div class="skel skel-line w-60"></div>
        <div class="skel skel-line w-80" style="margin-top:20px;"></div>
        <div class="skel skel-line w-40"></div>
      </div>
    `;
  },
};
