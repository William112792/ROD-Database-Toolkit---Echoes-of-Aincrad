// ============================================================
// budget-tracker-modal.js
// An on-demand informational popup (Data Coverage > Reverse-
// Engineering Reference > "Budget Tracker" button) estimating the
// professional-team value of the effort represented by this toolkit.
//
// Deliberately NOT a real financial appraisal -- every number here is
// a stated, hour-based estimate against a stated $60/hr baseline rate,
// labeled as such throughout rather than presented as fact. Unlike
// DisclaimerModal, this is a content VIEWER opened repeatedly on
// demand, not a one-time acknowledgment gate -- so backdrop-click and
// Escape both close it (matching the icon-zoom modal's UX), and there
// is no "don't show again" persistence at all.
// ============================================================

const BudgetTrackerModal = {
  show() {
    if (document.getElementById("budgetTrackerOverlay")) return; // already open

    const overlay = document.createElement("div");
    overlay.id = "budgetTrackerOverlay";
    overlay.className = "icon-zoom-overlay disclaimer-overlay";
    overlay.innerHTML = `
      <div class="disclaimer-box budget-tracker-box">
        <button class="budget-tracker-close" id="budgetTrackerCloseBtn" aria-label="Close">&times;</button>
        <h2>Budget Tracker</h2>
        <p class="budget-tracker-subtitle">Estimated value of the effort behind this application.</p>

        <div class="disclaimer-body">
          <p style="opacity:0.7; font-size:12px;">
            A good-faith estimate of the professional effort represented by this toolkit —
            not a formal appraisal. Hours are estimated from the actual scope of work
            completed, not tracked time. All figures use <b>$60/hour</b> as a stated
            baseline rate.
          </p>

          <div class="budget-tracker-section-label">Project Timeline</div>
          <table class="acv-table budget-tracker-table">
            <thead>
              <tr><th style="text-align:left;">Phase</th><th style="text-align:left;">Dates</th><th>Duration</th></tr>
            </thead>
            <tbody>
              <tr><td style="text-align:left;">Research &amp; documentation</td><td style="text-align:left;">Jun 20–22, 2026</td><td>3 days</td></tr>
              <tr><td style="text-align:left;">Formula verification</td><td style="text-align:left;">Jun 22–27, 2026</td><td>5 days</td></tr>
              <tr><td style="text-align:left;">Application build</td><td style="text-align:left;">Jun 27–30, 2026</td><td>4 days</td></tr>
            </tbody>
          </table>
          <p style="font-size:11px; opacity:0.65; margin-top:6px;">
            10 days, start to current state. <b>608 MB</b> across <b>8,912 files</b> in
            <b>839 folders</b> of exported game data, individually reviewed before being
            reverse-engineered and built into the app. 31 full application builds tracked,
            growing from 14.6 MB to 205.7 MB as sections were added.
          </p>

          <div class="budget-tracker-section-label">Value Delivered</div>
          <table class="acv-table budget-tracker-table">
            <thead>
              <tr><th style="text-align:left;">Discipline</th><th>Hours</th></tr>
            </thead>
            <tbody>
              <tr><td style="text-align:left;">Reverse-engineering &amp; data analysis</td><td>260</td></tr>
              <tr><td style="text-align:left;">Backend / pipeline engineering</td><td>170</td></tr>
              <tr><td style="text-align:left;">Frontend engineering</td><td>430</td></tr>
              <tr><td style="text-align:left;">QA &amp; verification</td><td>90</td></tr>
              <tr><td style="text-align:left;">Coordination</td><td>115</td></tr>
              <tr style="border-top:1px solid var(--hud-border); font-weight:700;"><td style="text-align:left;">Total</td><td>1,065 hrs</td></tr>
            </tbody>
          </table>

          <div class="budget-tracker-big-figure">
            <div class="budget-tracker-big-number">$63,900</div>
            <div class="budget-tracker-big-caption">in professional effort — at $60/hour</div>
          </div>
          <p style="font-size:12px; opacity:0.8;">
            A dedicated 5-person team (analyst, backend, frontend, QA, PM) working full-time
            would need roughly <b>5–6 weeks</b> to reach this same point — delivered here in
            <b>10 days</b>.
          </p>

          <div class="budget-tracker-section-label">Continuing to Grow: Next 3 Weeks (Projected)</div>
          <p style="font-size:12px; opacity:0.8; margin-bottom:8px;">
            At a similar pace, with roughly double the revision/testing passes typical of a
            maturing project:
          </p>
          <table class="acv-table budget-tracker-table">
            <tbody>
              <tr><td style="text-align:left;">Base continued pace (3 wks × ~200 hrs/wk)</td><td>600 hrs</td></tr>
              <tr><td style="text-align:left;">+ revision/QA overhead (~50% additional)</td><td>+300 hrs</td></tr>
              <tr style="border-top:1px solid var(--hud-border); font-weight:700;"><td style="text-align:left;">Additional projected</td><td>+900 hrs</td></tr>
            </tbody>
          </table>

          <div class="budget-tracker-big-figure">
            <div class="budget-tracker-big-number">~$117,900</div>
            <div class="budget-tracker-big-caption">projected total value by mid-July 2026 (~1,965 hrs)</div>
          </div>

          <p style="font-size:11px; opacity:0.6; text-align:center; margin-top:16px; margin-bottom:0;">
            Estimates only, for illustrative purposes — not a financial appraisal.
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById("budgetTrackerCloseBtn").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(); // backdrop click, not a click inside the box
    });
    const onEscape = (e) => {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onEscape);
      }
    };
    document.addEventListener("keydown", onEscape);
  },
};
