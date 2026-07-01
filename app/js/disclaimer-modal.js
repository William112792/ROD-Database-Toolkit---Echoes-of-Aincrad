// ============================================================
// disclaimer-modal.js
// A legal/scope disclaimer shown once on first load (persisted via
// localStorage, same safe try/catch pattern as the sidebar-collapse
// preference in main.js, since localStorage can throw in locked-down/
// private-browsing contexts), and re-openable any time from Data
// Coverage's Reverse-Engineering Reference section.
//
// Content is deliberately factual and narrow: this toolkit is a fan-
// made, unofficial reference built from the game's own exported data
// files, intended to help mod development and data reference, and all
// game content (names, art, text) belongs to its original developers/
// publisher -- nothing here claims otherwise or implies endorsement.
// ============================================================

const DisclaimerModal = {
  STORAGE_KEY: "rod-disclaimer-dismissed",

  /**
   * Shows the modal UNLESS the user already dismissed it in a previous
   * session AND `force` is false. Called once from App.init() (no
   * force, respects the saved dismissal) and again from the Data
   * Coverage page's "View Disclaimer" button (force=true, always
   * shows regardless of prior dismissal).
   */
  showIfNeeded(force = false) {
    if (!force) {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(this.STORAGE_KEY) === "true";
      } catch (e) {
        // localStorage unavailable -- fall through and show it, the
        // safe default when we can't remember a prior dismissal.
      }
      if (dismissed) return;
    }
    this.render();
  },

  render() {
    if (document.getElementById("disclaimerOverlay")) return; // already open

    const overlay = document.createElement("div");
    overlay.id = "disclaimerOverlay";
    overlay.className = "icon-zoom-overlay disclaimer-overlay";
    overlay.innerHTML = `
      <div class="disclaimer-box">
        <img class="disclaimer-logo" src="Content/ROD/Widget/OutGame/Texture/T_TitleLogo.png" alt="Echoes of Aincrad" />
        <h2>Fan-Made Reference Toolkit</h2>
        <div class="disclaimer-body">
          <p>
            This is an <b>unofficial, fan-made reference tool</b> for
            <i>Echoes of Aincrad</i>. It is not affiliated with, endorsed by,
            or produced by the game's developers or publisher.
          </p>
          <p>
            Every name, image, and piece of text shown in this toolkit is
            sourced directly from the game's own exported data files and
            remains the property of its original creators. Nothing here is
            original artwork or writing — this tool only organizes and
            displays data that already exists in the game.
          </p>
          <p>
            The goal of this project is to help with <b>mod development and
            data reference</b> by making the game's own exported information
            easier to browse, search, and cross-check — not to replace,
            redistribute, or compete with the original game in any way.
          </p>
          <p style="opacity:0.7; font-size:12px;">
            Some information may be incomplete, unverified, or drawn from
            an in-progress export — coverage and confidence levels are
            shown throughout the toolkit, and a full breakdown is always
            available on the Data Coverage page.
          </p>
        </div>
        <label class="disclaimer-checkbox-row">
          <input type="checkbox" id="disclaimerDontShowAgain" />
          Don't show this again
        </label>
        <button class="toggle-btn active" id="disclaimerAcceptBtn">I Understand</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("disclaimerAcceptBtn").addEventListener("click", () => {
      const dontShowAgain = document.getElementById("disclaimerDontShowAgain").checked;
      if (dontShowAgain) {
        try {
          localStorage.setItem(this.STORAGE_KEY, "true");
        } catch (e) {
          // Safe to ignore -- worst case it just shows again next time.
        }
      }
      overlay.remove();
    });

    // Deliberately NO backdrop-click-to-close and NO Escape-to-close
    // here, unlike the icon zoom modal -- this is a one-screen
    // acknowledgement, not a content viewer, so the only way out is
    // the explicit "I Understand" button. This is intentional, not an
    // oversight: a disclaimer that can be accidentally dismissed by a
    // stray click defeats its own purpose.
  },
};
