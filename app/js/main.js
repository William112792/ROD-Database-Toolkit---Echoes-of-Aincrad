// ============================================================
// main.js
// App bootstrap + simple hash-free router between views.
// ============================================================

const App = {
  currentRoute: "equipment",
  equipmentSubTab: "weapons", // "weapons" | "armor" | "swordSkills"
  worldSubTab: "lore", // lore | towns | quests | areas | dungeons | gates -- structured the same way as equipmentSubTab; adding more is just another button + case
  monstersSubTab: "monsters", // monsters | spawns | drops -- same pattern; converted from a single view when Spawns/Drops were added
  abilityMultiplierTable: null,

  async init() {
    BackgroundFX.init();

    try {
      let dataLoadError = null;
      try {
        await DataStore.loadAll();
        this.abilityMultiplierTable = buildMultiplierTable(DataStore.abilityScoreTable);
      } catch (err) {
        // A fresh/emptied backend (no Content/ROD/ output yet -- e.g.
        // right after deleting it to test rebuilding from scratch) means
        // every fetch() in loadAll() fails, since there's genuinely
        // nothing there to fetch. That used to be a hard, unrecoverable
        // dead end: the ENTIRE app, including the Build Dashboard (the
        // one tool that could actually fix this), was gated behind this
        // same try/catch, so there was no way to reach it. Caught this
        // directly from a real report of that exact scenario -- fixed
        // by degrading gracefully instead of failing shut, since
        // Build Dashboard itself only touches its own pipeline-status
        // endpoints (not DataStore's eagerly-loaded fields, except for
        // its own separately-guarded Phase 4 check), so it doesn't
        // actually need any of this to have succeeded.
        dataLoadError = err;
        console.error("DataStore.loadAll() failed -- starting in degraded (Build Dashboard only) mode:", err);
      }

      try {
        AnimationSettings.init();
        AnimationSettings.applyToDocument();
      } catch (err) {
        // Best-effort visual polish only -- never worth blocking startup
        // over, degraded mode or not.
        console.error("AnimationSettings failed to initialize:", err);
      }

      document.getElementById("loadingScreen").style.display = "none";

      this.bindNav();
      this.bindAnimToggle();
      this.bindLanguageSelector();
      this.bindSidebarCollapse();

      document.getElementById("shell").style.display = "flex";

      if (dataLoadError) {
        this.enterDegradedMode(dataLoadError);
      } else {
        this.renderRoute("equipment");
        DisclaimerModal.showIfNeeded();
      }
    } catch (err) {
      // A genuinely unexpected failure somewhere in the sequence
      // above (NOT the specific, already-handled "no data" case) --
      // this is the original fatal-error fallback, kept as a real
      // safety net rather than removed, so this category of failure
      // still shows SOME error UI instead of an uncaught, silent one.
      this.renderFatalError(err);
    }
  },

  /**
   * Every nav item except Build Dashboard needs real DataStore data to
   * render anything meaningful -- rather than let a click on any of
   * them produce a SECOND confusing failure, they're explicitly
   * disabled (reusing the exact same .disabled class/CSS and bindNav()
   * click-guard already used elsewhere for not-yet-built sections),
   * with a title explaining why, and the user is dropped straight
   * onto Build Dashboard -- the one place that can actually resolve
   * this (upload raw files, then Rebuild Full Pipeline).
   */
  enterDegradedMode(err) {
    document.querySelectorAll(".nav-item").forEach((el) => {
      if (el.dataset.route !== "build-dashboard") {
        el.classList.add("disabled");
        el.title = "Unavailable — no data loaded yet. Use Build Dashboard to upload raw files and rebuild.";
      }
    });
    this.setActiveNav("build-dashboard");
    this.renderRoute("build-dashboard");
    this.showDegradedModeBanner(err);
  },

  showDegradedModeBanner(err) {
    const scroll = document.getElementById("contentScroll");
    if (!scroll) return;
    const banner = document.createElement("div");
    banner.className = "hud-panel";
    banner.style.marginBottom = "14px";
    banner.style.borderColor = "var(--rank-a)";
    banner.innerHTML = `
      <h3 style="color:var(--rank-a); margin-top:0;">No data loaded</h3>
      <p style="font-size:13px; color:var(--hud-text-dim); margin:0;">
        This instance has no built data yet — <code>Content/ROD/</code> is empty or missing,
        so every other section is unavailable until the pipeline has run at least once.
        Drop a raw export ZIP (or the loose files you already have) into the box below, then
        click <b>Rebuild Full Pipeline</b>. Once that succeeds, reload this page.
      </p>
      <p style="font-size:11px; color:var(--hud-text-dim); opacity:0.6; margin:8px 0 0;">
        Underlying error: ${escapeHtml(err.message || String(err))}
      </p>
    `;
    // renderRoute("build-dashboard") already appended Build Dashboard's
    // own content (synchronously, before any of its internal awaits --
    // see build-dashboard.js's render()) by the time this runs, so
    // inserting as the first child here reliably puts the banner above
    // it, not racing its own async status load.
    scroll.insertBefore(banner, scroll.firstChild);
  },

  /**
   * Wires the circular « toggle button to collapse/expand the sidebar
   * to icons-only mode (see .sidebar.collapsed in theme.css). The
   * choice is persisted to localStorage so it survives a page refresh
   * -- primarily useful on narrow/mobile viewports where the sidebar's
   * normal 300px eats a large share of the screen.
   *
   * DEFAULT (no saved preference yet): collapsed if the viewport is
   * narrow (<= 700px) at load time, expanded otherwise. There's no
   * other responsive handling on the sidebar at all, so a first-time
   * visitor on a phone would otherwise see a 300px-wide sidebar eat
   * most of a ~390px screen before ever touching the toggle. Once the
   * person has clicked the toggle even once, their explicit choice
   * always wins on every later visit regardless of viewport width --
   * this auto-default only fills the gap before any preference exists.
   *
   * Applied as early as possible (called from init(), before the
   * shell is un-hidden) so there's no flash of the wrong state.
   */
  bindSidebarCollapse() {
    const sidebar = document.querySelector(".sidebar");
    const btn = document.getElementById("sidebarCollapseBtn");
    const mobileMenuBtn = document.getElementById("mobileMenuBtn");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (!sidebar || !btn) return;

    const STORAGE_KEY = "rod-sidebar-collapsed";
    const NARROW_VIEWPORT_PX = 700;
    const MOBILE_BREAKPOINT_PX = 768; // matches the @media max-width in theme.css -- the sidebar becomes a slide-out drawer below this width, not just a narrower rail
    let savedValue = null;
    try {
      savedValue = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      // localStorage can throw in some locked-down/private-browsing
      // contexts -- collapse state just won't persist across reloads
      // in that case, which is a reasonable degradation rather than a
      // crash.
    }

    // At the mobile breakpoint, "collapsed" means "drawer closed
    // (off-screen)" rather than desktop's "narrowed to icons" -- a
    // SAVED desktop preference of "expanded" would otherwise cover a
    // phone screen with the full drawer on every page load, which is
    // never the right default for a screen this narrow. The drawer
    // always starts closed below this width, regardless of any
    // earlier desktop choice; only an explicit tap on the menu button
    // THIS session opens it, and that choice isn't persisted across
    // reloads for the mobile case (the auto-default is correct often
    // enough here that remembering a manual open doesn't carry the
    // same value it does for desktop's icon-only/full choice).
    const isMobileWidth = window.innerWidth <= MOBILE_BREAKPOINT_PX;
    const isCollapsed = isMobileWidth
      ? true
      : (savedValue !== null ? savedValue === "true" : window.innerWidth <= NARROW_VIEWPORT_PX);
    this.applySidebarCollapsed(sidebar, btn, isCollapsed, backdrop);

    const toggle = () => {
      const next = !sidebar.classList.contains("collapsed");
      this.applySidebarCollapsed(sidebar, btn, next, backdrop);
      // Only persist the choice on non-mobile widths -- see the
      // comment above for why a mobile drawer-open state shouldn't
      // survive a reload the way desktop's icon-only/full choice does.
      if (window.innerWidth > MOBILE_BREAKPOINT_PX) {
        try {
          localStorage.setItem(STORAGE_KEY, String(next));
        } catch (e) {
          // Same defensive no-op as above -- persistence is a nice-to-
          // have, not a requirement for the toggle to work this session.
        }
      }
    };

    btn.addEventListener("click", toggle);
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener("click", toggle);
    }
    if (backdrop) {
      // Tapping the backdrop closes the drawer -- same "tap outside to
      // dismiss" convention the icon-zoom modal already uses elsewhere
      // in this app, not a new interaction pattern.
      backdrop.addEventListener("click", () => {
        this.applySidebarCollapsed(sidebar, btn, true, backdrop);
      });
    }

    // Selecting a nav item should close the drawer on mobile (so the
    // newly-loaded content is actually visible, not still covered by
    // the open drawer) -- desktop's icon-only collapse is unaffected,
    // since closing it there isn't expected or wanted on every click.
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        if (window.innerWidth <= MOBILE_BREAKPOINT_PX) {
          this.applySidebarCollapsed(sidebar, btn, true, backdrop);
        }
      });
    });
  },

  applySidebarCollapsed(sidebar, btn, collapsed, backdrop) {
    sidebar.classList.toggle("collapsed", collapsed);
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar to icons only";
    btn.setAttribute("aria-label", btn.title);
    if (backdrop) {
      backdrop.classList.toggle("visible", !collapsed);
    }
  },

  bindLanguageSelector() {
    const sel = document.getElementById("langSelector");
    if (!sel || !DataStore.localizationManifest) return;

    const manifest = DataStore.localizationManifest;
    const codes = Object.keys(manifest).filter((k) => !k.startsWith("_"));
    sel.innerHTML = codes.map((code) => {
      const meta = manifest[code];
      const hasData = meta.verifiedCount > 0;
      const suffix = hasData ? ` (${meta.verifiedCount}/${meta.totalCount})` : " — no data yet";
      return `<option value="${code}">${escapeHtml(meta.label)}${suffix}</option>`;
    }).join("");
    sel.value = DataStore.currentLanguage;

    sel.addEventListener("change", async (e) => {
      const scroll = document.getElementById("contentScroll");
      const skeletonHolder = document.createElement("div");
      skeletonHolder.innerHTML = LoadingSkeleton.grid(12);
      scroll.appendChild(skeletonHolder);

      const ok = await DataStore.setLanguage(e.target.value);
      skeletonHolder.remove();
      if (ok) {
        this.renderRoute(this.currentRoute);
      }
    });
  },

  bindAnimToggle() {
    const btn = document.getElementById("animToggleBtn");
    const label = document.getElementById("animToggleLabel");
    if (!btn) return;
    btn.title = AnimationSettings.getStateDescription();
    btn.addEventListener("click", () => {
      AnimationSettings.cycle();
      label.textContent = AnimationSettings.getStateLabel();
      btn.dataset.state = AnimationSettings.currentState;
      btn.title = AnimationSettings.getStateDescription();
      // Brief flash so the click always has an immediate, obvious visual
      // confirmation even on the Default->Forced Random transition, where
      // the animation itself often looks identical (both are randomized
      // by default per animation-config.json) -- without this, clicking
      // through states with no animation change looks like nothing
      // happened, even though the label/tooltip did update.
      btn.classList.remove("anim-toggle-flash");
      requestAnimationFrame(() => btn.classList.add("anim-toggle-flash"));
    });
  },

  bindNav() {
    document.querySelectorAll(".nav-item").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.classList.contains("disabled")) return;
        const route = el.dataset.route;
        this.setActiveNav(route);
        this.renderRoute(route);
      });
    });
  },

  setActiveNav(route) {
    document.querySelectorAll(".nav-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.route === route);
    });
  },

  renderRoute(route) {
    this.currentRoute = route;
    const crumb = document.getElementById("crumb");
    const scroll = document.getElementById("contentScroll");
    scroll.innerHTML = "";
    scroll.scrollTop = 0;

    switch (route) {
      case "equipment":
        this.renderEquipmentRoute(scroll);
        break;
      case "inspector":
        crumb.textContent = "Tools / JSON Inspector";
        JsonInspectorView.render(scroll);
        break;
      case "dt-inspector":
        crumb.textContent = "Tools / DT Inspector";
        DtInspectorView.render(scroll);
        break;
      case "bp-inspector":
        crumb.textContent = "Tools / BP Inspector";
        BpInspectorView.render(scroll);
        break;
      case "asset-inspector":
        crumb.textContent = "Tools / Asset Inspector";
        AssetInspectorView.render(scroll);
        break;
      case "materials":
        crumb.textContent = "Tools / Materials";
        MaterialsBrowserView.render(scroll);
        break;
      case "rodschema":
        crumb.textContent = "Tools / RODSchema";
        RodSchemaView.render(scroll);
        break;
      case "lua-scripting":
        crumb.textContent = "Tools / Lua Scripting";
        LuaScriptingView.render(scroll);
        break;
      case "wwise-audio":
        crumb.textContent = "Tools / Wwise Audio";
        WwiseAudioView.render(scroll);
        break;
      case "modding-guides":
        crumb.textContent = "Tools / Modding Guides";
        ModdingGuidesView.render(scroll);
        break;
      case "coverage":
        crumb.textContent = "Tools / Data Coverage Report";
        CoverageReportView.render(scroll);
        break;
      case "build-dashboard":
        crumb.textContent = "Tools / Build Dashboard";
        BuildDashboardView.render(scroll);
        break;
      case "monsters":
        this.renderMonstersRoute(scroll);
        break;
      case "items":
        crumb.textContent = "Database / Items";
        ItemsBrowserView.render(scroll);
        break;
      case "world":
        this.renderWorldRoute(scroll);
        break;
      case "characters":
        crumb.textContent = "Database / Characters";
        CharactersBrowserView.render(scroll);
        break;
      default:
        scroll.innerHTML = "<p>Unknown route.</p>";
    }
  },

  renderEquipmentRoute(scroll) {
    const crumb = document.getElementById("crumb");
    const subLabel = this.equipmentSubTab === "weapons" ? "Weapons" : this.equipmentSubTab === "armor" ? "Armor" : "Sword Skills";
    crumb.textContent = `Database / Equipment / ${subLabel}`;

    const subNav = document.createElement("div");
    subNav.className = "equip-subnav";
    subNav.innerHTML = `
      <button class="equip-subnav-btn ${this.equipmentSubTab === "weapons" ? "active" : ""}" id="subTabWeapons">⚔ Weapons</button>
      <button class="equip-subnav-btn ${this.equipmentSubTab === "armor" ? "active" : ""}" id="subTabArmor">🛡 Armor</button>
      <button class="equip-subnav-btn ${this.equipmentSubTab === "swordSkills" ? "active" : ""}" id="subTabSwordSkills">🗡 Sword Skills</button>
    `;
    scroll.appendChild(subNav);

    document.getElementById("subTabWeapons").addEventListener("click", () => {
      this.equipmentSubTab = "weapons";
      this.renderRoute("equipment");
    });
    document.getElementById("subTabArmor").addEventListener("click", () => {
      this.equipmentSubTab = "armor";
      this.renderRoute("equipment");
    });
    document.getElementById("subTabSwordSkills").addEventListener("click", () => {
      this.equipmentSubTab = "swordSkills";
      this.renderRoute("equipment");
    });

    const viewContainer = document.createElement("div");
    scroll.appendChild(viewContainer);

    if (this.equipmentSubTab === "weapons") {
      WeaponsBrowserView.render(viewContainer);
    } else if (this.equipmentSubTab === "armor") {
      EquipmentBrowserView.render(viewContainer);
    } else {
      SwordSkillsBrowserView.render(viewContainer);
    }
  },

  /**
   * World, like Equipment, has sub-sections rather than being a single
   * flat view -- currently just Lore (177 entries, World > Lore in the
   * reference screenshots), with more to come later (Areas, etc., per
   * the user's own framing: "Lore... but will have more later", the
   * same way Items started with Consumables/Materials/Key Items and
   * will later get Recipes). Structured with a sub-nav exactly like
   * renderEquipmentRoute so adding a second sub-tab later is just
   * another button + case, not a restructure.
   */
  renderMonstersRoute(scroll) {
    const crumb = document.getElementById("crumb");
    const subLabels = { monsters: "Monsters", spawns: "Spawns", drops: "Drops", stats: "Stats" };
    crumb.textContent = `Database / Monsters / ${subLabels[this.monstersSubTab] || capitalize(this.monstersSubTab)}`;

    const subNav = document.createElement("div");
    subNav.className = "equip-subnav";
    subNav.innerHTML = `
      <button class="equip-subnav-btn ${this.monstersSubTab === "monsters" ? "active" : ""}" id="subTabMonsters">👹 Monsters</button>
      <button class="equip-subnav-btn ${this.monstersSubTab === "spawns" ? "active" : ""}" id="subTabSpawns">🧬 Spawns</button>
      <button class="equip-subnav-btn ${this.monstersSubTab === "drops" ? "active" : ""}" id="subTabDrops">💰 Drops</button>
      <button class="equip-subnav-btn ${this.monstersSubTab === "stats" ? "active" : ""}" id="subTabStats">📈 Stats</button>
    `;
    scroll.appendChild(subNav);

    document.getElementById("subTabMonsters").addEventListener("click", () => {
      this.monstersSubTab = "monsters";
      this.renderRoute("monsters");
    });
    document.getElementById("subTabSpawns").addEventListener("click", () => {
      this.monstersSubTab = "spawns";
      this.renderRoute("monsters");
    });
    document.getElementById("subTabDrops").addEventListener("click", () => {
      this.monstersSubTab = "drops";
      this.renderRoute("monsters");
    });
    document.getElementById("subTabStats").addEventListener("click", () => {
      this.monstersSubTab = "stats";
      this.renderRoute("monsters");
    });

    const viewContainer = document.createElement("div");
    scroll.appendChild(viewContainer);

    if (this.monstersSubTab === "monsters") {
      MonstersBrowserView.render(viewContainer);
    } else if (this.monstersSubTab === "spawns") {
      MonsterSpawnsBrowserView.render(viewContainer);
    } else if (this.monstersSubTab === "drops") {
      MonsterDropsBrowserView.render(viewContainer);
    } else if (this.monstersSubTab === "stats") {
      MonsterStatsBrowserView.render(viewContainer);
    }
  },

  /**
   * Deep link: open World > Map > Field Map on a specific area, with an
   * optional chest pre-selected (its pin highlights and its contents
   * float to the top of the side panel). Used by the item-sources
   * "open on map" buttons; safe to call from anywhere.
   */
  openMapArea(gateId, chestId) {
    this.worldSubTab = "map";
    if (typeof WorldMapBrowserView !== "undefined") {
      WorldMapBrowserView.state.mode = "field";
      WorldMapBrowserView.state.fieldSub = "area";
      WorldMapBrowserView.state.areaGateId = gateId;
      WorldMapBrowserView.state.selectedChestId = chestId || null;
      WorldMapBrowserView._lastChestArea = gateId; // keep the selection through the area-change reset
    }
    this.renderRoute("world");
  },

  renderWorldRoute(scroll) {
    const crumb = document.getElementById("crumb");
    const subLabels = { lore: "Lore", towns: "Towns", quests: "Quests", areas: "Areas", dungeons: "Dungeons", gates: "Gates", map: "Map" };
    crumb.textContent = `Database / World / ${subLabels[this.worldSubTab] || capitalize(this.worldSubTab)}`;

    const subNav = document.createElement("div");
    subNav.className = "equip-subnav";
    subNav.innerHTML = `
      <button class="equip-subnav-btn ${this.worldSubTab === "lore" ? "active" : ""}" id="subTabLore">📜 Lore</button>
      <button class="equip-subnav-btn ${this.worldSubTab === "towns" ? "active" : ""}" id="subTabTowns">🗺 Towns</button>
      <button class="equip-subnav-btn ${this.worldSubTab === "quests" ? "active" : ""}" id="subTabQuests">❖ Quests</button>
      <button class="equip-subnav-btn ${this.worldSubTab === "areas" ? "active" : ""}" id="subTabAreas">⛰ Areas</button>
      <button class="equip-subnav-btn ${this.worldSubTab === "dungeons" ? "active" : ""}" id="subTabDungeons">🏛 Dungeons</button>
      <button class="equip-subnav-btn ${this.worldSubTab === "gates" ? "active" : ""}" id="subTabGates">🌀 Gates</button>
      <button class="equip-subnav-btn ${this.worldSubTab === "map" ? "active" : ""}" id="subTabMap">📍 Map</button>
    `;
    scroll.appendChild(subNav);

    document.getElementById("subTabLore").addEventListener("click", () => {
      this.worldSubTab = "lore";
      this.renderRoute("world");
    });
    document.getElementById("subTabTowns").addEventListener("click", () => {
      this.worldSubTab = "towns";
      this.renderRoute("world");
    });
    document.getElementById("subTabQuests").addEventListener("click", () => {
      this.worldSubTab = "quests";
      this.renderRoute("world");
    });
    document.getElementById("subTabAreas").addEventListener("click", () => {
      this.worldSubTab = "areas";
      this.renderRoute("world");
    });
    document.getElementById("subTabDungeons").addEventListener("click", () => {
      this.worldSubTab = "dungeons";
      this.renderRoute("world");
    });
    document.getElementById("subTabGates").addEventListener("click", () => {
      this.worldSubTab = "gates";
      this.renderRoute("world");
    });
    document.getElementById("subTabMap").addEventListener("click", () => {
      this.worldSubTab = "map";
      this.renderRoute("world");
    });

    const viewContainer = document.createElement("div");
    scroll.appendChild(viewContainer);

    if (this.worldSubTab === "lore") {
      LoreBrowserView.render(viewContainer);
    } else if (this.worldSubTab === "towns") {
      TownsBrowserView.render(viewContainer);
    } else if (this.worldSubTab === "quests") {
      QuestsBrowserView.render(viewContainer);
    } else if (this.worldSubTab === "areas") {
      AreasBrowserView.render(viewContainer);
    } else if (this.worldSubTab === "map") {
      WorldMapBrowserView.render(viewContainer);
    } else if (this.worldSubTab === "dungeons") {
      DungeonsBrowserView.render(viewContainer);
    } else if (this.worldSubTab === "gates") {
      GatesBrowserView.render(viewContainer);
    }
  },

  renderComingSoon(container, label) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `
      <div class="empty-icon">⏳</div>
      <h4>${label} module not yet built</h4>
      <p>The toolkit currently focuses on Equipment / Weapons. ${label} data
      will plug into the same Content/ROD/ pipeline once that raw export is
      added.</p>
    `;
    container.appendChild(div);
  },

  renderFatalError(err) {
    const loadingScreen = document.getElementById("loadingScreen");
    // If bindNav()/renderRoute() etc. threw AFTER the loading screen
    // was already hidden and the shell made visible, writing into the
    // (now display:none) loading screen would be invisible -- bring it
    // back to the front instead of silently failing to report anything.
    loadingScreen.style.display = "flex";
    loadingScreen.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠</div>
        <h4>Something went wrong loading the app</h4>
        <p>${escapeHtml(err.message || String(err))}</p>
        <p style="margin-top:10px; font-size:11px; opacity:0.7;">
          If this is a fresh/empty instance with no data built yet, deleting
          <code>Content/ROD/</code> is expected to disable most sections --
          that case is now handled separately (a Build-Dashboard-only mode,
          not this screen). If you ARE seeing this, something else is wrong --
          check that you're serving this folder over HTTP (not opening
          index.html directly via file://), and check the browser console
          for the underlying error.
        </p>
      </div>
    `;
    console.error(err);
  },
};

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.addEventListener("DOMContentLoaded", () => App.init());
