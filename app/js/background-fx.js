// ============================================================
// background-fx.js
// Generates the two dynamic background layers that can't be pure
// CSS loops: edge lines with randomized length/speed/vertical
// position, and monitor-style boxes that open/close at random
// positions and intervals. The rotating ring layer is static SVG
// + CSS animation, declared directly in index.html.
// ============================================================

const BackgroundFX = {
  edgeLineTimer: null,
  monitorBoxTimer: null,

  init() {
    this.spawnEdgeLines();
    this.scheduleMonitorBox();
  },

  /**
   * Edge lines: a handful of thin horizontal lines near the very
   * top and bottom of the screen, each independently looping across
   * at its own speed/delay, matching the reference screenshots where
   * top/bottom lines are mid-flight at different positions per frame.
   */
  spawnEdgeLines() {
    const container = document.getElementById("bgEdgeLines");
    if (!container) return;
    container.innerHTML = "";

    const lineCount = 7;
    for (let i = 0; i < lineCount; i++) {
      const line = document.createElement("div");
      const direction = Math.random() > 0.5 ? "slide-right" : "slide-left";
      const topPercent = Math.random() < 0.5
        ? 2 + Math.random() * 10   // cluster near top
        : 88 + Math.random() * 10; // cluster near bottom
      const duration = 14 + Math.random() * 16; // seconds, varied speed
      const delay = -Math.random() * duration;   // negative so they're already mid-flight on load
      const widthPercent = 20 + Math.random() * 30;

      line.className = `bg-edge-line ${direction}`;
      line.style.top = `${topPercent}%`;
      line.style.width = `${widthPercent}%`;
      line.style.animationDuration = `${duration}s`;
      line.style.animationDelay = `${delay}s`;
      container.appendChild(line);
    }
  },

  /**
   * Monitor boxes: rectangles that "power on" (point -> line ->
   * rectangle) at a random position, hold briefly, then power off
   * the same way in reverse. One spawns every few seconds, each with
   * randomized size/position/duration so they never feel templated.
   */
  scheduleMonitorBox() {
    const spawn = () => {
      this.spawnOneMonitorBox();
      const nextDelay = 2200 + Math.random() * 3000;
      this.monitorBoxTimer = setTimeout(spawn, nextDelay);
    };
    this.monitorBoxTimer = setTimeout(spawn, 800 + Math.random() * 1500);
  },

  spawnOneMonitorBox() {
    const layer = document.getElementById("bgMonitorLayer");
    if (!layer) return;
    if (document.body.classList.contains("bg-fx-disabled")) return;

    const box = document.createElement("div");
    box.className = "bg-monitor-box opening";

    const widthPx = 60 + Math.random() * 160;
    const heightPx = 30 + Math.random() * 90;
    const leftPercent = 5 + Math.random() * 80;
    const topPercent = 8 + Math.random() * 78;

    box.style.left = `${leftPercent}%`;
    box.style.top = `${topPercent}%`;
    box.style.setProperty("--target-w", `${widthPx}px`);
    box.style.setProperty("--target-h", `${heightPx}px`);

    layer.appendChild(box);

    const holdMs = 1400 + Math.random() * 1800;
    setTimeout(() => {
      box.classList.remove("opening");
      box.classList.add("closing");
      setTimeout(() => box.remove(), 1500);
    }, 1600 + holdMs);
  },

  stop() {
    clearTimeout(this.monitorBoxTimer);
  },
};
