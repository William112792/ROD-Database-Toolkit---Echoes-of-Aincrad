// ============================================================
// animation-settings.js
// Runtime control for the equipment icon scan-bar animation.
// Starts from whatever Content/ROD/animation-config.json says,
// then can be cycled through 3 states via the toggle button next
// to "Database" in the sidebar header:
//
//   1. "Default"    -- exactly what animation-config.json specifies
//                       (enabled/disabled + randomizeStart as authored)
//   2. "Randomized"  -- force the scan bar ON with randomized start
//                       times, regardless of what the JSON says
//   3. "Off"         -- force the scan bar OFF entirely
//
// This only affects the current session (in-memory) -- it does not
// write back to animation-config.json. Refreshing the page resets to
// whichever state animation-config.json's "Default" represents.
// ============================================================

const AnimationSettings = {
  STATES: ["default", "randomized", "off"],
  currentState: "default",

  init() {
    this.currentState = "default";
  },

  cycle() {
    const idx = this.STATES.indexOf(this.currentState);
    this.currentState = this.STATES[(idx + 1) % this.STATES.length];
    this.applyToDocument();
    return this.currentState;
  },

  /**
   * Resolves the *effective* scan bar settings given the current
   * 3-state override and the base config from animation-config.json.
   */
  getEffectiveScanBarConfig() {
    const base = (DataStore.animationConfig && DataStore.animationConfig.scanBar) || {
      enabled: true,
      randomizeStart: true,
      travelDurationMs: 1000,
      pauseDurationMs: 4500,
      color: "rgba(120, 200, 255, 0.35)",
    };

    switch (this.currentState) {
      case "off":
        return { ...base, enabled: false };
      case "randomized":
        return { ...base, enabled: true, randomizeStart: true };
      case "default":
      default:
        return base;
    }
  },

  getStateLabel() {
    const labels = {
      default: "Default",
      randomized: "Forced Random",
      off: "Off",
    };
    return labels[this.currentState];
  },

  /**
   * A short explanation of what the current state actually does,
   * shown so clicking through doesn't look like nothing happened when
   * animation-config.json's randomizeStart is already true (the most
   * common case) -- "Default" and "Forced Random" then look identical
   * on the icons themselves because they ARE identical in that case;
   * the difference only becomes visible if someone edits the JSON to
   * randomizeStart:false, at which point Default would sync and
   * Forced Random would still desync.
   */
  getStateDescription() {
    const cfg = (DataStore.animationConfig && DataStore.animationConfig.scanBar) || {};
    const descriptions = {
      default: cfg.randomizeStart === false
        ? "Following animation-config.json (synced start)"
        : "Following animation-config.json (randomized start)",
      randomized: "Forcing randomized start regardless of JSON",
      off: "Scan bar disabled",
    };
    return descriptions[this.currentState];
  },

  /**
   * Applies the current effective config as CSS custom properties on
   * :root, and toggles a class that disables the animation entirely.
   * Re-running this re-randomizes per-icon delays for any icon that
   * reads --scan-delay fresh (handled by applyScanFrameTiming below).
   */
  applyToDocument() {
    const cfg = this.getEffectiveScanBarConfig();
    const root = document.documentElement;
    root.style.setProperty("--scan-bar-color", cfg.color);
    root.style.setProperty("--scan-travel-ms", `${cfg.travelDurationMs}ms`);
    root.style.setProperty("--scan-cycle-ms", `${cfg.travelDurationMs + cfg.pauseDurationMs}ms`);
    document.body.classList.toggle("scan-bar-disabled", !cfg.enabled);
    document.body.dataset.scanRandomize = cfg.randomizeStart ? "true" : "false";

    this.updateScanBarKeyframe(cfg);
    this.applyScanFrameTiming(document);
  },

  /**
   * Generates the @keyframes scanBarSweep rule with breakpoints that
   * match the ACTUAL configured travel/pause split, and injects it
   * into a dedicated <style id="scan-bar-dynamic-keyframe"> tag,
   * overriding the static ~18.18%-based fallback baked into theme.css
   * (which only matches the *default* 1000ms/4500ms config).
   *
   * CSS keyframe percentage offsets can't reference custom properties
   * or calc(), so this is the only way to keep the sweep accurate if
   * animation-config.json is ever edited to use a different
   * travelDurationMs/pauseDurationMs split -- the rule is fully
   * regenerated and the previous one replaced (a single <style> tag's
   * content is overwritten via textContent, not appended) every time
   * applyToDocument() runs, e.g. on load and on every toggle cycle.
   *
   * IMPORTANT: this must animate `top` from 100% to -<bar height>%,
   * matching the fixed geometry in theme.css's static fallback rule --
   * NOT `transform: translateY(0)` to `translateY(-100%)`, which is
   * what the previous version of this function generated. That
   * transform range never actually entered the visible frame area
   * (see the long comment above the static @keyframes scanBarSweep
   * rule in theme.css for the full diagnosis) -- it's what made the
   * bar invisible even after the *timing* was fixed in an earlier
   * pass. The bar's height is read from CSS (--scan-bar-height-pct,
   * falling back to 35) rather than hardcoded here a second time, so
   * the two places that need to agree on it can't silently drift apart.
   */
  updateScanBarKeyframe(cfg) {
    // Defensive fallback: animation-config.json is hand-editable per
    // the README, so a config missing either field shouldn't produce
    // NaN/Infinity in the generated stylesheet -- fall back to the
    // documented defaults (1000ms travel / 4500ms pause) instead.
    const travelMs = Number.isFinite(cfg.travelDurationMs) ? cfg.travelDurationMs : 1000;
    const pauseMs = Number.isFinite(cfg.pauseDurationMs) ? cfg.pauseDurationMs : 4500;
    const cycleMs = travelMs + pauseMs;
    // Percent of the cycle where the bar finishes its upward sweep
    // and disappears.
    const travelPct = cycleMs > 0
      ? Math.min(99, Math.max(0.5, (travelMs / cycleMs) * 100))
      : 18.18;
    // Fade-in/out edges sit just inside the travel window so the bar
    // never pops in/out abruptly, scaled to stay proportional even
    // for a very short travel duration.
    const fadeInPct = Math.min(travelPct * 0.15, 1);
    const fadeOutPct = Math.max(travelPct - travelPct * 0.05, fadeInPct);

    // Read the bar's own height % from CSS so this stays in sync with
    // .scan-bar's `height` rule in theme.css without duplicating the
    // number here. Falls back to 35 (the shipped default) if the
    // custom property isn't set on :root for any reason.
    const barHeightPct = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--scan-bar-height-pct")
    ) || 35;

    const css = `
      @keyframes scanBarSweep {
        0%                         { top: 100%;              opacity: 0; }
        ${fadeInPct.toFixed(3)}%   { opacity: 1; }
        ${fadeOutPct.toFixed(3)}%  { opacity: 1; }
        ${travelPct.toFixed(3)}%   { top: -${barHeightPct}%;  opacity: 0; }
        100%                       { top: -${barHeightPct}%;  opacity: 0; }
      }
    `;

    let styleTag = document.getElementById("scan-bar-dynamic-keyframe");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "scan-bar-dynamic-keyframe";
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = css;
  },

  /**
   * Sets a random (or zero) negative animation-delay on every
   * .scan-frame .scan-bar element within `root`, so the upward sweep
   * starts at a different point in its cycle per icon. Call this after
   * rendering any new batch of icons (the views call it from their
   * render functions) so newly-added tiles get staggered too.
   */
  applyScanFrameTiming(root) {
    const cfg = this.getEffectiveScanBarConfig();
    const cycleMs = cfg.travelDurationMs + cfg.pauseDurationMs;
    const bars = root.querySelectorAll(".scan-bar");
    bars.forEach((bar) => {
      if (cfg.randomizeStart) {
        const randomOffset = Math.random() * cycleMs;
        bar.style.animationDelay = `-${randomOffset.toFixed(0)}ms`;
      } else {
        bar.style.animationDelay = "0ms";
      }
    });
  },
};
