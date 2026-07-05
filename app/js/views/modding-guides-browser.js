// ============================================================
// modding-guides-browser.js
// The Modding Guides section: browse, search, create, and edit
// user-written Markdown guides with inline screenshots.
//
// This is USER content, not derived game data -- guides live outside
// the pipeline entirely (guides/*.md + uploads/<guideId>/ under the
// statically-served project root), managed by the server's
// /api/guides endpoints. All limits (guide count, images per guide,
// image size, MD size, editing on/off) come from guides/manifest.json
// and are shown in the UI rather than discovered by hitting them.
//
// The editor is deliberately simple (a themed textarea + preview
// toggle). Screenshots: paste an image from the clipboard or drag &
// drop a file anywhere onto the editor -- it uploads to this guide's
// uploads folder and a standard Markdown image line is inserted AT
// THE CURSOR / DROP POINT, so the image shows up exactly where it was
// added. Missing screenshot files render as styled placeholder boxes
// (that's how the seeded Getting Started guide's per-step
// placeholders work before real screenshots are pasted in).
//
// The Markdown renderer below is intentionally minimal and
// escape-first: ALL content is HTML-escaped before any Markdown
// transforms run, so guide text can never inject markup. Supported:
// headings, bold/italic, inline code, fenced code blocks, links,
// images, unordered/ordered lists, blockquotes, horizontal rules.
// ============================================================

const ModdingGuidesView = {
  state: {
    guides: [],
    config: null,
    loaded: false,
    loadError: null,
    search: "",
    mode: "list",        // list | view | edit
    selectedId: null,
    current: null,        // { id, title, content } when viewing/editing
    editorDirty: false,
    editorPreview: false,
    uploadBusy: false,
  },

  async render(container) {
    this.container = container;
    container.innerHTML = `<div class="hud-panel"><p style="color:var(--hud-text-dim);">Loading guides…</p></div>`;
    await this.loadGuides();
    this.renderMain();
  },

  async loadGuides() {
    this.state.loadError = null;
    try {
      const res = await fetch("/api/guides");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      this.state.guides = data.guides || [];
      this.state.config = data.config || {};
      this.state.loaded = true;
    } catch (e) {
      // The static build (serve.py / file host) has no guides API --
      // browsing/editing needs the Node server, same as the Build
      // Dashboard. Say so instead of showing an empty list.
      this.state.loadError = e.message;
    }
  },

  // ---------- Markdown rendering (escape-first, minimal) ----------
  renderMarkdown(md) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let inCode = false, codeBuf = [], listType = null, inQuote = false;

    const closeList = () => { if (listType) { out.push(listType === "ul" ? "</ul>" : "</ol>"); listType = null; } };
    const closeQuote = () => { if (inQuote) { out.push("</blockquote>"); inQuote = false; } };

    const inline = (raw) => {
      let s = esc(raw);
      // images first (so links don't eat them): ![alt](url)
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
        if (/^(https?:\/\/|uploads\/|Content\/)/.test(url) === false) return m; // only relative uploads/, Content/, or http(s)
        return `<img class="guide-img" src="${url}" alt="${alt}" loading="lazy" onerror="this.outerHTML='<span class=&quot;guide-img-placeholder&quot;>🖼 Screenshot placeholder: ${alt.replace(/'/g, "&#39;")}</span>'"/>`;
      });
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
        /^(https?:\/\/|#|uploads\/|Content\/)/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>` : m);
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      s = s.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<i>$2</i>");
      return s;
    };

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCode) { out.push(`<pre class="guide-code">${esc(codeBuf.join("\n"))}</pre>`); codeBuf = []; inCode = false; }
        else { closeList(); closeQuote(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { closeList(); closeQuote(); out.push(`<h${h[1].length + 1} class="guide-h">${inline(h[2])}</h${h[1].length + 1}>`); continue; }
      if (/^\s*---+\s*$/.test(line)) { closeList(); closeQuote(); out.push('<hr class="guide-hr"/>'); continue; }

      const ul = /^\s*[-*]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        closeQuote();
        const want = ul ? "ul" : "ol";
        if (listType !== want) { closeList(); out.push(want === "ul" ? '<ul class="guide-list">' : '<ol class="guide-list">'); listType = want; }
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
        continue;
      }
      closeList();

      const q = /^>\s?(.*)$/.exec(line);
      if (q) {
        if (!inQuote) { out.push('<blockquote class="guide-quote">'); inQuote = true; }
        out.push(inline(q[1]) + "<br/>");
        continue;
      }
      closeQuote();

      if (line.trim() === "") { out.push(""); continue; }
      out.push(`<p class="guide-p">${inline(line)}</p>`);
    }
    if (inCode) out.push(`<pre class="guide-code">${esc(codeBuf.join("\n"))}</pre>`);
    closeList(); closeQuote();
    return out.join("\n");
  },

  // ---------- Layout ----------
  renderMain() {
    const c = this.container;
    if (this.state.loadError) {
      c.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">📓</div>
            <h4>Guides need the build server</h4>
            <p>Couldn't reach the guides API (${escapeHtml(this.state.loadError)}). Modding Guides
            are stored and edited through the Node server (server.js), the same one the Build
            Dashboard uses — start it with <code>node server.js</code> and reload.</p>
          </div>
        </div>
      `;
      return;
    }
    const cfg = this.state.config || {};
    c.innerHTML = `
      <div class="coverage-banner">
        <span><b>${this.state.guides.length}</b>/${cfg.maxGuides} guides</span>
        <span>limits: <b>${cfg.maxImagesPerGuide}</b> images/guide · <b>${cfg.maxImageSizeMB}</b> MB/image · <b>${cfg.maxGuideFileSizeMB}</b> MB/guide</span>
        ${cfg.allowEditing === false ? '<span class="pill unverified" title="Set allowEditing to true in guides/manifest.json to enable editing">read-only (manifest)</span>' : ""}
        <span style="margin-left:auto; opacity:0.6;" title="All limits are plain numbers in guides/manifest.json — change them to any value">configurable in guides/manifest.json</span>
      </div>
      <div class="toolbar" id="guideToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 300px;">
        <div id="guideListPane" style="max-height:70vh; overflow-y:auto;"></div>
        <div id="guideMainPane"></div>
      </div>
    `;
    this.renderToolbar();
    this.renderListPane();
    this.renderMainPane();
  },

  renderToolbar() {
    const el = document.getElementById("guideToolbar");
    const cfg = this.state.config || {};
    const canCreate = cfg.allowEditing !== false && this.state.guides.length < cfg.maxGuides;
    el.innerHTML = `
      <input type="text" class="search-input" id="guideSearchInput" placeholder="Search guides by title or content…" value="${escapeHtml(this.state.search)}" />
      <button class="toggle-btn" id="guideNewBtn" ${canCreate ? "" : "disabled"} title="${cfg.allowEditing === false ? "Editing is disabled in guides/manifest.json" : (canCreate ? "Create a new guide" : `Guide limit reached (${cfg.maxGuides})`)}">＋ New Guide</button>
    `;
    document.getElementById("guideSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("guideNewBtn").addEventListener("click", () => this.createGuide());
  },

  getFilteredGuides() {
    const q = this.state.search.trim().toLowerCase();
    if (!q) return this.state.guides;
    return this.state.guides.filter((g) => g.title.toLowerCase().includes(q) || g.id.includes(q));
  },

  renderListPane() {
    const pane = document.getElementById("guideListPane");
    const guides = this.getFilteredGuides();
    if (!guides.length) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state" style="padding:30px 10px;"><div class="empty-icon">📓</div><h4>${this.state.guides.length ? "No guides match" : "No guides yet"}</h4><p>${this.state.guides.length ? "Try a different search." : "Create the first one with ＋ New Guide."}</p></div></div>`;
      return;
    }
    const el = document.createElement("div");
    guides.forEach((g) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (g.id === this.state.selectedId ? " selected" : "");
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(g.title)}</div>
          <div class="wl-id">${new Date(g.updatedAt).toLocaleDateString()} · ${(g.sizeBytes / 1024).toFixed(1)} KB${g.imageCount ? ` · ${g.imageCount} image${g.imageCount === 1 ? "" : "s"}` : ""}</div>
        </div>
      `;
      row.addEventListener("click", () => this.openGuide(g.id));
      el.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(el);
  },

  async openGuide(id) {
    if (this.state.mode === "edit" && this.state.editorDirty
        && !confirm("Discard unsaved changes to the current guide?")) return;
    const res = await fetch(`/api/guides/${encodeURIComponent(id)}`);
    if (!res.ok) { alert("Couldn't load that guide."); return; }
    this.state.current = await res.json();
    this.state.selectedId = id;
    this.state.mode = "view";
    this.state.editorDirty = false;
    this.renderListPane();
    this.renderMainPane();
  },

  renderMainPane() {
    const pane = document.getElementById("guideMainPane");
    if (this.state.mode === "edit" && this.state.current) return this.renderEditor(pane);
    if (this.state.mode === "view" && this.state.current) return this.renderViewer(pane);
    pane.innerHTML = `
      <div class="hud-panel">
        <div class="empty-state" style="padding:40px 10px;">
          <div class="empty-icon">📓</div>
          <h4>Modding Guides</h4>
          <p>Select a guide on the left to read it, or create a new one. Guides are plain
          Markdown files in <code>guides/</code> with screenshots in
          <code>uploads/&lt;guide&gt;/</code> — paste or drag &amp; drop images straight into the
          editor and they appear where you dropped them.</p>
        </div>
      </div>
    `;
  },

  renderViewer(pane) {
    const cfg = this.state.config || {};
    const g = this.state.current;
    pane.innerHTML = `
      <div class="hud-panel" style="padding:16px 20px;">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
          <div style="font-family:var(--font-display); font-size:16px; font-weight:600; color:var(--hud-text); flex:1;">${escapeHtml(g.title)}</div>
          <button class="toggle-btn" id="guideEditBtn" ${cfg.allowEditing === false ? "disabled" : ""} title="${cfg.allowEditing === false ? "Editing is disabled in guides/manifest.json (allowEditing: false)" : "Edit this guide"}">✎ Edit</button>
          <button class="toggle-btn" id="guideDeleteBtn" ${cfg.allowEditing === false ? "disabled" : ""}>🗑 Delete</button>
        </div>
        <div class="guide-rendered" id="guideRendered">${this.renderMarkdown(g.content)}</div>
        <div style="font-size:11px; color:var(--hud-text-dim); margin-top:12px;">
          File: <code>guides/${escapeHtml(g.id)}.md</code> — plain Markdown, portable anywhere.
        </div>
      </div>
    `;
    document.getElementById("guideEditBtn").addEventListener("click", () => {
      this.state.mode = "edit";
      this.state.editorPreview = false;
      this.renderMainPane();
    });
    document.getElementById("guideDeleteBtn").addEventListener("click", () => this.deleteGuide());
  },

  // ---------- Editor ----------
  renderEditor(pane) {
    const cfg = this.state.config || {};
    const g = this.state.current;
    const meta = this.state.guides.find((x) => x.id === g.id);
    pane.innerHTML = `
      <div class="hud-panel" style="padding:14px 16px;">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px; flex-wrap:wrap;">
          <div style="font-family:var(--font-display); font-size:14px; font-weight:600; color:var(--hud-text); flex:1;">Editing: ${escapeHtml(g.title)}${this.state.editorDirty ? " *" : ""}</div>
          <span style="font-size:11px; color:var(--hud-text-dim);" id="guideImgCount">${meta ? meta.imageCount : 0}/${cfg.maxImagesPerGuide} images</span>
          <button class="toggle-btn" id="guidePreviewBtn">${this.state.editorPreview ? "✎ Editor" : "👁 Preview"}</button>
          <button class="toggle-btn" id="guideSaveBtn">💾 Save</button>
          <button class="toggle-btn" id="guideCancelBtn">Cancel</button>
        </div>
        ${this.state.editorPreview
          ? `<div class="guide-rendered" style="min-height:420px;">${this.renderMarkdown(document.getElementById("guideEditorTA") ? document.getElementById("guideEditorTA").value : g.content)}</div>`
          : `<textarea id="guideEditorTA" class="guide-editor" spellcheck="false">${escapeHtml(g.content)}</textarea>
             <div style="font-size:11px; color:var(--hud-text-dim); margin-top:6px;" id="guideEditorHint">
               Markdown supported (headings, lists, bold, code, links, images). Paste an image
               from the clipboard or drag &amp; drop an image file — it uploads and a
               <code>![screenshot](…)</code> line is inserted right where your cursor / drop
               point is. Limits: ${cfg.maxImageSizeMB} MB per image, ${cfg.maxImagesPerGuide} images per guide.
             </div>`}
      </div>
    `;
    document.getElementById("guidePreviewBtn").addEventListener("click", () => {
      // Keep the latest text when toggling to preview
      const ta = document.getElementById("guideEditorTA");
      if (ta) this.state.current.content = ta.value;
      this.state.editorPreview = !this.state.editorPreview;
      this.renderMainPane();
    });
    document.getElementById("guideSaveBtn").addEventListener("click", () => this.saveGuide());
    document.getElementById("guideCancelBtn").addEventListener("click", async () => {
      if (this.state.editorDirty && !confirm("Discard unsaved changes?")) return;
      await this.openGuide(g.id);
    });

    const ta = document.getElementById("guideEditorTA");
    if (!ta) return;
    ta.addEventListener("input", () => {
      this.state.editorDirty = true;
      this.state.current.content = ta.value;
    });
    // Paste: any image on the clipboard uploads and inserts at the cursor.
    ta.addEventListener("paste", (e) => {
      const items = Array.from((e.clipboardData || {}).items || []);
      const imgItem = items.find((i) => i.type && i.type.startsWith("image/"));
      if (!imgItem) return; // plain text pastes normally
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (file) this.uploadAndInsert(file, ta, ta.selectionStart);
    });
    // Drag & drop: insert at the drop point (caret position from the
    // drop coordinates where the browser supports it, else cursor).
    ta.addEventListener("dragover", (e) => { e.preventDefault(); ta.classList.add("drop-target"); });
    ta.addEventListener("dragleave", () => ta.classList.remove("drop-target"));
    ta.addEventListener("drop", (e) => {
      e.preventDefault();
      ta.classList.remove("drop-target");
      const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      let pos = ta.selectionStart;
      if (document.caretRangeFromPoint) {
        // best-effort: focus + use current caret; textareas don't expose
        // exact drop offsets portably, so the selection point is the
        // documented insertion rule.
        ta.focus();
        pos = ta.selectionStart;
      }
      this.uploadAndInsert(file, ta, pos);
    });
  },

  async uploadAndInsert(file, ta, pos) {
    if (this.state.uploadBusy) return;
    const cfg = this.state.config || {};
    if (file.size > cfg.maxImageSizeMB * 1024 * 1024) {
      alert(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${cfg.maxImageSizeMB} MB (configurable in guides/manifest.json).`);
      return;
    }
    this.state.uploadBusy = true;
    const hint = document.getElementById("guideEditorHint");
    if (hint) hint.textContent = `Uploading ${file.name || "image"}…`;
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await fetch(`/api/guides/${encodeURIComponent(this.state.current.id)}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name || "pasted.png", dataBase64 }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Image upload failed"); return; }
      const insert = `![screenshot](${data.url})`;
      const v = ta.value;
      ta.value = v.slice(0, pos) + insert + v.slice(pos);
      ta.selectionStart = ta.selectionEnd = pos + insert.length;
      ta.focus();
      this.state.editorDirty = true;
      this.state.current.content = ta.value;
      const cnt = document.getElementById("guideImgCount");
      if (cnt && data.imageCount != null) cnt.textContent = `${data.imageCount}/${cfg.maxImagesPerGuide} images`;
    } catch (e) {
      alert(`Image upload failed: ${e.message}`);
    } finally {
      this.state.uploadBusy = false;
      const hint2 = document.getElementById("guideEditorHint");
      if (hint2) hint2.innerHTML = `Markdown supported. Paste or drag &amp; drop images — inserted at the cursor. Limits: ${cfg.maxImageSizeMB} MB per image, ${cfg.maxImagesPerGuide} images per guide.`;
    }
  },

  async saveGuide() {
    const ta = document.getElementById("guideEditorTA");
    const content = ta ? ta.value : this.state.current.content;
    const res = await fetch(`/api/guides/${encodeURIComponent(this.state.current.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Save failed"); return; }
    this.state.editorDirty = false;
    await this.loadGuides();
    await this.openGuide(this.state.current.id);
  },

  async createGuide() {
    const title = prompt("Guide title:");
    if (!title) return;
    const res = await fetch("/api/guides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: `# ${title}\n\nWrite your guide here…\n` }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Couldn't create guide"); return; }
    await this.loadGuides();
    this.renderMain();
    await this.openGuide(data.id);
    this.state.mode = "edit";
    this.renderMainPane();
  },

  async deleteGuide() {
    const g = this.state.current;
    if (!confirm(`Delete "${g.title}" and its uploaded images? This can't be undone.`)) return;
    const res = await fetch(`/api/guides/${encodeURIComponent(g.id)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Delete failed"); return; }
    this.state.current = null;
    this.state.selectedId = null;
    this.state.mode = "list";
    await this.loadGuides();
    this.renderMain();
  },
};
