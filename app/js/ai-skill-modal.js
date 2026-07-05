// ============================================================
// ai-skill-modal.js
// An on-demand informational popup (Data Coverage > Reverse-
// Engineering Reference > "AI Skill" button) offering a downloadable
// Claude Skill package that lets Claude (via Claude Cowork, or any
// other Skill-aware Claude surface) query THIS toolkit's own /api
// REST layer directly.
//
// Same UX pattern as BudgetTrackerModal: a content viewer opened
// repeatedly on demand, not a one-time acknowledgment gate --
// backdrop-click and Escape both close it, no "don't show again"
// persistence.
//
// Deliberately explicit about ONE thing throughout: this toolkit is
// SELF-HOSTED and every instance has its OWN base URL. The skill
// package has no fixed server address baked in -- it asks whoever is
// using it (in chat) for the URL, tests the connection, and only then
// queries the API. This modal's copy explains that up front so the
// download makes sense before the user even opens the file.
// ============================================================

const AISkillModal = {
  DOWNLOAD_PATH: "skill-downloads/ROD-EOA-Toolkit.skill",

  show() {
    if (document.getElementById("aiSkillOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "aiSkillOverlay";
    overlay.className = "icon-zoom-overlay disclaimer-overlay";
    overlay.innerHTML = `
      <div class="disclaimer-box budget-tracker-box ai-skill-box">
        <button class="budget-tracker-close" id="aiSkillCloseBtn" aria-label="Close">&times;</button>
        <h2>AI Skill</h2>
        <p class="budget-tracker-subtitle">A downloadable Claude Skill that queries this toolkit's own API.</p>

        <div class="disclaimer-body">
          <p style="opacity:0.85;">
            This packages the toolkit's read-only <code>/api</code> REST layer (see
            <b>APIRouting.md</b>) into a <b>Claude Skill</b> — a set of instructions and small
            helper scripts Claude can load in <b>Claude Cowork</b> (or any other Skill-aware
            Claude surface) to look up Echoes of Aincrad game data on your behalf: weapons,
            armor, monsters, monster stats, skills, localization, DataTables, and more.
          </p>

          <div class="budget-tracker-section-label">Two different things — don't mix them up</div>
          <table class="acv-table budget-tracker-table" style="margin-bottom:4px;">
            <tbody>
              <tr>
                <td style="text-align:left; width:38%;"><b>The game</b></td>
                <td style="text-align:left;">Echoes of Aincrad, published by Bandai Namco. Official
                  site: <a href="https://www.bandainamcoent.com/games/echoes-of-aincrad" target="_blank" rel="noopener">bandainamcoent.com/games/echoes-of-aincrad</a>
                  — marketing/support content, no API.</td>
              </tr>
              <tr>
                <td style="text-align:left;"><b>This toolkit</b></td>
                <td style="text-align:left;">A separate, fan-built, <b>self-hosted</b> app + API.
                  Every person running it hosts their own copy at their own URL — there is
                  no single fixed toolkit address. The skill asks for yours in chat.</td>
              </tr>
            </tbody>
          </table>

          <div class="budget-tracker-section-label">What's in the package</div>
          <ul style="font-size:12.5px; line-height:1.7; padding-left:18px; margin:0 0 12px;">
            <li><code>SKILL.md</code> — triggers on Echoes of Aincrad / ROD / toolkit questions;
              asks for your toolkit's base URL before doing anything if it isn't already known.</li>
            <li><code>scripts/test_connection.py</code> — confirms the API is reachable and
              reports its live schema version and endpoint list before trusting any data.</li>
            <li><code>scripts/api_client.py</code> — shortcuts for common lookups (search,
              item/weapon/armor/monster by id, datatables, structs, functions, skills,
              localization, tutorials), plus a raw <code>get</code> command for any endpoint,
              including ones added after this skill was built.</li>
            <li><code>references/endpoints.md</code> — the full endpoint reference. The skill
              is told to treat this as a starting point, not gospel: it re-checks
              <code>GET /api</code>'s own live endpoint list before anything non-trivial, so
              new endpoints this toolkit adds later are picked up automatically rather than
              requiring a new skill download every time.</li>
          </ul>

          <div class="budget-tracker-section-label">Loading it into Claude Cowork</div>
          <ol style="font-size:12.5px; line-height:1.8; padding-left:18px; margin:0 0 12px;">
            <li>Click <b>Download Skill</b> below to save <code>ROD-EOA-Toolkit.skill</code>.</li>
            <li>In Claude Cowork, open the Skills manager and upload/install the
              <code>.skill</code> file (a plain zip — if your Claude surface takes a folder
              instead of a <code>.skill</code> file, unzip it first and point it at the
              resulting folder).</li>
            <li>Start a chat and mention Echoes of Aincrad, ROD, or the toolkit — Claude
              should pick up the skill automatically. If it asks for a URL, give it the
              address this toolkit is running at (the one in your browser's address bar
              right now, for a locally-run instance, or wherever it's actually deployed).</li>
            <li>Ask Claude to test the connection first if you want to confirm everything
              works before diving into real questions.</li>
          </ol>

          <p style="font-size:11px; opacity:0.65; margin-top:4px;">
            The skill is read-only — it can query this toolkit's API but can't create, edit,
            or delete anything (Modding Guides, Build Dashboard actions, etc. are untouched).
          </p>

          <div style="text-align:center; margin-top:18px;">
            <a class="toggle-btn" id="aiSkillDownloadBtn" href="${AISkillModal.DOWNLOAD_PATH}" download style="display:inline-block; text-decoration:none; padding:10px 28px; font-size:14px;">⬇ Download Skill</a>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById("aiSkillCloseBtn").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
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
