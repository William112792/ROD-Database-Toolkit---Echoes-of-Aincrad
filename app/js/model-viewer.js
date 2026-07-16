/**
 * In-app 3D model viewer (three.js, ES module -- the ONE module script
 * in the app, everything else stays plain scripts; window.ModelViewer
 * is the bridge the non-module views call at click time).
 *
 * Loads glTF Binary (.glb) / .gltf ONLY. That's a deliberate scope
 * decision, not a temporary gap: psk/pskx/psa are UE-tooling formats,
 * uemodel/ueanim are FModel's own, and fbx/blend are DCC interchange --
 * none of the four families has a dependable in-browser loader, so they
 * stay download-only buttons. The documented round-trip for viewing
 * (also in the Models index's blenderExportNote and the README):
 * import the psk/pskx/fbx into Blender, File > Export > glTF 2.0 with
 * format "glTF Binary (.glb)", upload the .glb next to the asset's
 * JSON with the same stem, and rebuild the Models / Asset Index
 * sections -- the View 3D button lights up wherever that mesh is
 * referenced (Asset Inspector, monster, weapon, armor, partner pages).
 *
 * Files stream through the same /api/pipeline/download-file endpoint
 * the download buttons already use -- no separate model-serving route,
 * no second path-traversal surface.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const ModelViewer = {
  _active: null, // { renderer, scene, controls, mixer, rafId, overlay, clock } of the open modal, for teardown

  /**
   * opts: {
   *   url        (required) fetchable URL of a .glb/.gltf
   *   title      display name (entity name / asset stem)
   *   subtitle   small mono line under the title (e.g. the raw path)
   *   scale      optional {x,y,z} from the game's own Database model
   *              data -- applied so monsters preview at their in-game
   *              proportions, exactly like the game's Database menu
   * }
   */
  open(opts) {
    this.close(); // one viewer at a time; tears down GL context cleanly

    const overlay = document.createElement("div");
    overlay.id = "modelViewerOverlay";
    overlay.style.cssText =
      "position:fixed; inset:0; z-index:4000; background:rgba(4,10,14,0.88); backdrop-filter:blur(3px);" +
      "display:flex; align-items:center; justify-content:center;";
    overlay.innerHTML = `
      <div style="width:min(920px, 94vw); height:min(680px, 90vh); display:flex; flex-direction:column;
                  background:var(--hud-panel-bg, rgba(10,20,26,0.97)); border:1px solid var(--db-cyan-dim, rgba(64,207,216,0.35));
                  border-radius:6px; box-shadow:0 0 40px rgba(64,207,216,0.15); overflow:hidden;">
        <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid rgba(64,207,216,0.2);">
          <div style="flex:1; min-width:0;">
            <div style="font-family:var(--font-display); font-size:14px; font-weight:600; color:var(--db-cyan-bright, #40cfd8);">
              ${this._esc(opts.title || "3D Model")}</div>
            ${opts.subtitle ? `<div style="font-family:var(--font-mono); font-size:10px; color:var(--hud-text-dim, #87c8d2); opacity:0.8;
              overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._esc(opts.subtitle)}</div>` : ""}
          </div>
          <span id="mvAnimBadge" style="display:none; font-size:10px; font-family:var(--font-mono); color:var(--hud-text-dim);"></span>
          <button id="mvCloseBtn" class="toggle-btn" style="font-size:12px;">✕ Close</button>
        </div>
        <div id="mvCanvasHost" style="flex:1; position:relative; min-height:0;">
          <div id="mvStatus" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
               color:var(--hud-text-dim, #87c8d2); font-size:12px; text-align:center; padding:20px;">Loading model…</div>
        </div>
        <div style="padding:6px 14px; font-size:10px; color:var(--hud-text-dim, #87c8d2); opacity:0.75;
                    border-top:1px solid rgba(64,207,216,0.12);">
          Drag to orbit · scroll to zoom · right-drag to pan${opts.scale && (opts.scale.x || 1) !== 1 ? ` · in-game scale ×${opts.scale.x} applied (from the game's own Database model data)` : ""}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this.close(); });
    overlay.querySelector("#mvCloseBtn").addEventListener("click", () => this.close());
    const escHandler = (e) => { if (e.key === "Escape") this.close(); };
    document.addEventListener("keydown", escHandler);

    const host = overlay.querySelector("#mvCanvasHost");
    const statusEl = overlay.querySelector("#mvStatus");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.style.cssText = "position:absolute; inset:0;";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Neutral studio lighting -- game materials often arrive without
    // their UE shading, so hemisphere + key/fill keeps everything
    // readable without pretending to replicate in-game look.
    scene.add(new THREE.HemisphereLight(0xdfeef2, 0x1a2a30, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fd4dc, 0.5);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.01, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const clock = new THREE.Clock();
    const state = { renderer, scene, controls, mixer: null, rafId: null, overlay, clock, escHandler };
    this._active = state;

    const onResize = () => {
      if (!host.clientWidth) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener("resize", onResize);
    state.onResize = onResize;

    new GLTFLoader().load(
      opts.url,
      (gltf) => {
        if (this._active !== state) return; // closed while loading
        statusEl.remove();
        const model = gltf.scene;
        if (opts.scale && opts.scale.x) model.scale.set(opts.scale.x, opts.scale.y || opts.scale.x, opts.scale.z || opts.scale.x);
        scene.add(model);

        // Auto-frame: fit the camera to the model's bounding sphere so
        // a 2m wolf and a 40cm dagger both open filling the view.
        const box = new THREE.Box3().setFromObject(model);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dist = sphere.radius / Math.tan((camera.fov * Math.PI) / 360);
        camera.position.set(sphere.center.x + dist * 0.7, sphere.center.y + dist * 0.35, sphere.center.z + dist * 0.7);
        camera.near = Math.max(sphere.radius / 100, 0.001);
        camera.far = sphere.radius * 100;
        camera.updateProjectionMatrix();
        controls.target.copy(sphere.center);
        controls.update();

        // Play the first animation when the GLB carries one (a Blender
        // export made from the mesh + its idle AnimMontage will).
        if (gltf.animations && gltf.animations.length) {
          state.mixer = new THREE.AnimationMixer(model);
          state.mixer.clipAction(gltf.animations[0]).play();
          const badge = overlay.querySelector("#mvAnimBadge");
          badge.style.display = "inline";
          badge.textContent = `▶ ${gltf.animations[0].name || "animation"} (${gltf.animations.length} clip${gltf.animations.length === 1 ? "" : "s"})`;
        }
      },
      undefined,
      (err) => {
        if (this._active !== state) return;
        statusEl.innerHTML =
          `<div><div style="color:var(--hud-acv, #e0314f); margin-bottom:8px;">Couldn't load this model.</div>` +
          `<div style="max-width:460px;">${this._esc(String(err && err.message || err))}</div>` +
          `<div style="margin-top:10px; opacity:0.8;">The viewer reads glTF Binary (.glb) only — if this file came straight from an extractor, ` +
          `open it in Blender and re-export via File › Export › glTF 2.0 (glTF Binary).</div></div>`;
      }
    );

    const animate = () => {
      state.rafId = requestAnimationFrame(animate);
      if (state.mixer) state.mixer.update(state.clock.getDelta());
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
  },

  close() {
    const s = this._active;
    if (!s) return;
    this._active = null;
    cancelAnimationFrame(s.rafId);
    window.removeEventListener("resize", s.onResize);
    document.removeEventListener("keydown", s.escHandler);
    // Full GL teardown -- repeated open/close must not leak contexts
    // (browsers hard-cap WebGL contexts; leaking them breaks the
    // viewer after ~8-16 opens with no error anywhere else).
    s.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          for (const v of Object.values(m)) { if (v && v.isTexture) v.dispose(); }
          m.dispose();
        });
      }
    });
    s.controls.dispose();
    s.renderer.dispose();
    s.overlay.remove();
  },

  /** Standard "View 3D" button HTML for a raw-export-relative .glb path. */
  buttonHtml(glbRelPath, title, extra) {
    if (!glbRelPath) return "";
    return `<button class="toggle-btn" style="margin:2px 4px 2px 0;"
      onclick='ModelViewer.open({ url: "/api/pipeline/download-file?path=" + encodeURIComponent(${JSON.stringify(glbRelPath)}),
        title: ${JSON.stringify(title || "3D Model")}, subtitle: ${JSON.stringify(glbRelPath)}${extra ? ", " + extra : ""} })'
      title="Open in the in-app 3D viewer (glTF)">▶ View 3D</button>`;
  },

  _esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },
};

window.ModelViewer = ModelViewer;
export default ModelViewer;
