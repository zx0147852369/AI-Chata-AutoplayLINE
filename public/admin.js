(() => {
  const app = document.getElementById("app");
  const topActions = document.getElementById("topActions");
  const toastEl = document.getElementById("toast");

  const MAX_BODY = 20000;

  let sections = [];
  let updatedAt = null;
  let persistent = true;

  // refs used by the editor view
  let listEl = null;
  let statEls = null;
  let query = "";

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    logout: '<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
    up: '<path d="M6 14l6-6 6 6"/>',
    down: '<path d="M6 10l6 6 6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sparkle: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 9"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V5.5"/><path d="M9 8h7M9 12h5"/>',
  };

  // Static, trusted SVG strings only (never user input)
  function icon(name, size = 18) {
    const s = document.createElement("span");
    s.className = "ico";
    s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
    return s;
  }

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };

  function button(label, { cls = "", ico, type = "button", onclick } = {}) {
    const b = el("button", { className: `btn ${cls}`.trim(), type });
    if (ico) b.append(icon(ico, 18));
    b.append(label);
    if (onclick) b.onclick = onclick;
    return b;
  }

  function iconButton(ico, label, { cls = "", onclick, disabled = false } = {}) {
    const b = el("button", { className: `icon-btn ${cls}`.trim(), type: "button", title: label, disabled });
    b.setAttribute("aria-label", label);
    b.append(icon(ico, 18));
    if (onclick) b.onclick = onclick;
    return b;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "เกิดข้อผิดพลาด"), { status: res.status });
    return data;
  }

  const fmtDate = (iso) =>
    iso
      ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "ยังไม่เคยบันทึก";

  // Apply the server's latest state and redraw
  function applyState(data) {
    sections = data.sections || [];
    updatedAt = data.updatedAt;
    renderList();
  }

  // Session expired mid-action -> back to login
  function handleError(ex) {
    if (ex.status === 401) return showLogin(true);
    toast(ex.message);
  }

  // ---------- Login ----------
  function showLogin(enabled, reason) {
    topActions.replaceChildren();
    listEl = statEls = null;

    const err = el("div", { className: "error", role: "alert" });
    const pw = el("input", { className: "input", type: "password", autocomplete: "current-password", required: true, placeholder: "กรอกรหัสผ่าน" });
    const toggle = iconButton("eye", "แสดงรหัสผ่าน");
    toggle.onclick = () => {
      const show = pw.type === "password";
      pw.type = show ? "text" : "password";
      toggle.replaceChildren(icon(show ? "eyeOff" : "eye", 18));
      toggle.title = show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน";
    };
    const submit = button("เข้าสู่ระบบ", { cls: "primary block", type: "submit" });
    pw.disabled = submit.disabled = toggle.disabled = !enabled;
    if (!enabled) err.textContent = reason || "ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ใน Railway Variables";

    const lock = el("div", { className: "lock" });
    lock.append(icon("lock", 24));

    const form = el(
      "form",
      { className: "login" },
      lock,
      el("h1", { textContent: "เข้าสู่ระบบผู้ดูแล" }),
      el("p", { textContent: "สำหรับฝ่าย HR เพื่อแก้ไขกฎเกณฑ์ที่บอท LINE ใช้ตอบพนักงาน" }),
      el("label", { className: "field" }, "รหัสผ่าน", el("div", { className: "pw" }, pw, toggle)),
      err,
      submit,
      el("p", { className: "foot", textContent: "พนักงานสอบถามผ่าน LINE เท่านั้น หน้านี้สำหรับผู้ดูแล" })
    );

    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = "";
      submit.disabled = true;
      try {
        await api("/api/admin/login", { method: "POST", body: { password: pw.value } });
        await start();
      } catch (ex) {
        err.textContent = ex.message;
        submit.disabled = false;
        pw.select();
      }
    };

    app.replaceChildren(el("div", { className: "login-wrap" }, form));
    if (enabled) pw.focus();
  }

  // ---------- Images ----------
  const MAX_IMAGES = 4;
  const MAX_UPLOAD_BYTES = 900 * 1024; // LINE preview images must stay under 1 MB

  // Shrink any browser-readable image to a JPEG that LINE accepts
  async function shrinkToJpeg(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error("เปิดไฟล์นี้ไม่ได้ กรุณาใช้รูป JPEG, PNG หรือ WebP");
    }
    let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // JPEG has no transparency
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      for (const q of [0.88, 0.78, 0.68, 0.55]) {
        const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
        if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
      }
      scale *= 0.75;
    }
    throw new Error("ย่อรูปให้เล็กพอไม่ได้ ลองใช้รูปอื่น");
  }

  async function uploadImage(blob) {
    const res = await fetch("/api/admin/image", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "อัปโหลดไม่สำเร็จ"), { status: res.status });
    return data.file;
  }

  // ---------- Topic dialog (add / edit one topic) ----------
  function openTopicDialog(topic) {
    const editing = Boolean(topic);
    const dlg = el("dialog", { className: "modal" });

    let images = [...(topic?.images || [])];
    const fresh = new Set(); // uploaded in this dialog and not saved yet
    let saved = false;
    let uploading = 0;

    const category = el("input", { className: "input", value: topic?.category ?? "", placeholder: "เช่น การลา, เวลาทำงาน, สวัสดิการ", maxLength: 80 });
    category.setAttribute("list", "cats");
    const title = el("input", { className: "input", value: topic?.title ?? "", placeholder: "เช่น สิทธิ์การลาพักร้อน", maxLength: 200 });
    const body = el("textarea", { className: "textarea", value: topic?.body ?? "", placeholder: "รายละเอียดของกฎเกณฑ์", maxLength: MAX_BODY });
    const counter = el("span", { className: "hint" });
    const showCount = () => (counter.textContent = `${body.value.length.toLocaleString()} / ${MAX_BODY.toLocaleString()} ตัวอักษร`);
    showCount();
    body.addEventListener("input", showCount);

    const err = el("div", { className: "error", role: "alert" });
    const close = () => dlg.close();
    const cancel = button("ยกเลิก", { onclick: close });
    const saveBtn = button(editing ? "บันทึกการแก้ไข" : "บันทึกหัวข้อ", { cls: "primary", type: "submit" });

    // AI helper: drafts the detail text from short notes; the admin reviews before saving
    const aiToggle = button("ให้ AI ช่วยเขียน", { ico: "sparkle", cls: "small" });
    const aiPrompt = el("textarea", {
      className: "textarea",
      placeholder: "บอก AI เป็นข้อมูลดิบสั้นๆ เช่น ลาพักร้อน 10 วันต่อปี แจ้งล่วงหน้าอย่างน้อย 3 วัน ลาติดกันไม่เกิน 5 วัน",
      maxLength: 4000,
    });
    aiPrompt.style.minHeight = "84px";
    const useCurrent = el("input", { type: "checkbox" });
    const aiGo = button("สร้างข้อความ", { ico: "sparkle", cls: "primary small" });
    const aiUndo = button("เลิกทำ", { cls: "small" });
    aiUndo.hidden = true;
    const aiStatus = el("span", { className: "hint" });
    const aiPanel = el(
      "div",
      { className: "ai-panel", hidden: true },
      el("label", { className: "field" }, "บอก AI ว่าต้องการอะไร", aiPrompt),
      el("label", { className: "check" }, useCurrent, "ใช้เนื้อหาในช่องรายละเอียดเป็นฐาน (ให้ AI ปรับปรุงของเดิม)"),
      el("div", { className: "ai-actions" }, aiGo, aiUndo, aiStatus),
      el("p", { className: "hint", textContent: "AI อาจผิดพลาดได้ ตรวจทานตัวเลขและเงื่อนไขทุกครั้งก่อนบันทึก ข้อความที่ขึ้นเป็น [ระบุ: ...] คือข้อมูลที่ AI ไม่มี ต้องกรอกเอง" })
    );
    const syncUseCurrent = () => {
      const has = body.value.trim().length > 0;
      useCurrent.disabled = !has;
      if (!has) useCurrent.checked = false;
    };
    body.addEventListener("input", syncUseCurrent);
    aiToggle.onclick = () => {
      aiPanel.hidden = !aiPanel.hidden;
      if (!aiPanel.hidden) { syncUseCurrent(); aiPrompt.focus(); }
    };
    let previousBody = null;
    aiGo.onclick = async () => {
      err.textContent = "";
      const instruction = aiPrompt.value.trim();
      if (!instruction) {
        err.textContent = "กรุณาบอก AI ว่าต้องการให้เขียนเรื่องอะไร";
        aiPrompt.focus();
        return;
      }
      aiGo.disabled = true;
      aiStatus.textContent = "AI กำลังเขียน อาจใช้เวลาสักครู่...";
      try {
        const data = await api("/api/admin/generate", {
          method: "POST",
          body: { instruction, category: category.value, title: title.value, current: body.value, useCurrent: useCurrent.checked },
        });
        previousBody = body.value;
        body.value = data.text.slice(0, MAX_BODY);
        showCount();
        syncUseCurrent();
        aiUndo.hidden = false;
        aiStatus.textContent = "สร้างข้อความแล้ว กรุณาตรวจทานก่อนบันทึก";
      } catch (ex) {
        aiStatus.textContent = "";
        if (ex.status === 401) { dlg.close(); return showLogin(true); }
        err.textContent = ex.message;
      } finally {
        aiGo.disabled = false;
      }
    };
    aiUndo.onclick = () => {
      if (previousBody !== null) {
        body.value = previousBody;
        previousBody = null;
        showCount();
        syncUseCurrent();
      }
      aiUndo.hidden = true;
      aiStatus.textContent = "";
    };

    // Image picker
    const thumbs = el("div", { className: "thumbs" });
    const fileInput = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
    const pick = button("เลือกรูป", { ico: "image", cls: "small", onclick: () => fileInput.click() });
    const imgHint = el("span", { className: "hint" });

    function renderThumbs() {
      thumbs.replaceChildren(
        ...images.map((f) => {
          const rm = el("button", { type: "button", className: "thumb-x", title: "เอารูปนี้ออก" });
          rm.setAttribute("aria-label", "เอารูปนี้ออก");
          rm.append(icon("close", 14));
          rm.onclick = () => {
            images = images.filter((x) => x !== f);
            if (fresh.delete(f)) fetch(`/api/admin/image/${f}`, { method: "DELETE" }).catch(() => {});
            renderThumbs();
          };
          return el("figure", { className: "thumb" }, el("img", { src: `/uploads/${f}`, alt: "รูปประกอบ", loading: "lazy" }), rm);
        }),
        ...Array.from({ length: uploading }, () => el("figure", { className: "thumb loading", textContent: "กำลังอัปโหลด" }))
      );
      pick.disabled = images.length + uploading >= MAX_IMAGES;
      saveBtn.disabled = uploading > 0;
      imgHint.textContent = `${images.length}/${MAX_IMAGES} รูป รองรับ JPEG, PNG, WebP`;
    }

    fileInput.onchange = async () => {
      err.textContent = "";
      const files = [...fileInput.files].slice(0, MAX_IMAGES - images.length - uploading);
      fileInput.value = "";
      for (const file of files) {
        uploading++;
        renderThumbs();
        try {
          const f = await uploadImage(await shrinkToJpeg(file));
          images.push(f);
          fresh.add(f);
        } catch (ex) {
          if (ex.status === 401) { dlg.close(); return showLogin(true); }
          err.textContent = ex.message;
        } finally {
          uploading--;
          renderThumbs();
        }
      }
    };

    const head = el(
      "div",
      { className: "modal-head" },
      el("h2", { textContent: editing ? "แก้ไขหัวข้อ" : "เพิ่มหัวข้อใหม่" }),
      iconButton("close", "ปิด", { onclick: close })
    );

    const form = el(
      "form",
      { className: "modal-body" },
      el("label", { className: "field" }, "หมวดหมู่", category),
      el("label", { className: "field" }, "หัวข้อ", title),
      el("label", { className: "field" }, "รายละเอียด", body),
      el("div", { className: "modal-meta" }, el("span", { className: "hint", textContent: "ขึ้นบรรทัดใหม่เพื่อแยกย่อหน้า" }), counter),
      el("div", { className: "ai-row" }, aiToggle),
      aiPanel,
      el(
        "div",
        { className: "field images-field" },
        el("div", { className: "images-head" }, el("span", { textContent: "รูปภาพประกอบ" }), pick, fileInput),
        el("p", { className: "hint", textContent: "บอทจะส่งรูปเหล่านี้ให้พนักงานใน LINE เมื่อตอบเรื่องนี้ (ลิงก์รูปเปิดดูได้โดยผู้ที่มีลิงก์ อย่าใช้รูปที่เป็นความลับ)" }),
        thumbs,
        imgHint
      ),
      err,
      el("div", { className: "modal-actions" }, cancel, saveBtn)
    );

    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = "";
      if (!title.value.trim() && !body.value.trim()) {
        err.textContent = "กรุณากรอกหัวข้อหรือรายละเอียดอย่างน้อยหนึ่งอย่าง";
        title.focus();
        return;
      }
      saveBtn.disabled = true;
      try {
        const data = await api("/api/admin/section", {
          method: "POST",
          body: { id: topic?.id, category: category.value, title: title.value, body: body.value, images },
        });
        saved = true;
        dlg.close();
        applyState(data);
        toast(editing ? "บันทึกการแก้ไขแล้ว บอท LINE ใช้ข้อมูลใหม่ทันที" : "เพิ่มหัวข้อแล้ว บอท LINE ใช้ข้อมูลใหม่ทันที");
      } catch (ex) {
        if (ex.status === 401) { dlg.close(); return showLogin(true); }
        err.textContent = ex.message;
        saveBtn.disabled = false;
      }
    };

    dlg.append(head, form);
    dlg.addEventListener("close", () => {
      // Cancelled: throw away pictures uploaded in this dialog that were never saved
      if (!saved) fresh.forEach((f) => fetch(`/api/admin/image/${f}`, { method: "DELETE" }).catch(() => {}));
      dlg.remove();
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click on backdrop
    document.body.append(dlg);
    renderThumbs();
    dlg.showModal();
    (editing ? body : title).focus();
  }

  // ---------- Editor (topic list) ----------
  function updateStats() {
    if (!statEls) return;
    statEls.count.textContent = String(sections.length);
    statEls.cats.textContent = String(new Set(sections.map((s) => s.category)).size);
    statEls.updated.textContent = fmtDate(updatedAt);
  }

  async function act(fn) {
    try {
      applyState(await fn());
    } catch (ex) {
      handleError(ex);
    }
  }

  function preview(text) {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > 140 ? `${t.slice(0, 140)}...` : t;
  }

  function item(s, i, filtering) {
    const actions = el(
      "div",
      { className: "item-actions" },
      iconButton("edit", "แก้ไข", { onclick: () => openTopicDialog(s) }),
      iconButton("up", "เลื่อนขึ้น", { disabled: i === 0 || filtering, onclick: () => act(() => api(`/api/admin/section/${s.id}/move`, { method: "POST", body: { delta: -1 } })) }),
      iconButton("down", "เลื่อนลง", { disabled: i === sections.length - 1 || filtering, onclick: () => act(() => api(`/api/admin/section/${s.id}/move`, { method: "POST", body: { delta: 1 } })) }),
      iconButton("trash", "ลบ", {
        cls: "danger",
        onclick: () => {
          if (!confirm(`ลบหัวข้อ "${s.title || s.category}" ใช่หรือไม่?`)) return;
          act(async () => {
            const data = await api(`/api/admin/section/${s.id}`, { method: "DELETE" });
            toast("ลบหัวข้อแล้ว");
            return data;
          });
        },
      })
    );

    const main = el(
      "div",
      { className: "item-main" },
      el("span", { className: "tag", textContent: s.category }),
      el("h3", { textContent: s.title || "(ไม่มีหัวข้อ)" }),
      el("p", { className: "preview", textContent: preview(s.body) }),
      ...(s.images?.length
        ? [el("div", { className: "thumbs-row" }, ...s.images.map((f) => el("img", { src: `/uploads/${f}`, alt: "", loading: "lazy" })))]
        : [])
    );

    const c = el("article", { className: "item" }, el("span", { className: "badge", textContent: String(i + 1).padStart(2, "0") }), main, actions);
    c.dataset.idx = String(i);
    c.addEventListener("dblclick", () => openTopicDialog(s));
    return c;
  }

  function renderList() {
    updateStats();
    if (!listEl) return;
    if (!sections.length) {
      const e = el("div", { className: "empty" });
      const ic = icon("book", 28);
      ic.style.width = ic.style.height = "56px";
      e.append(
        ic,
        el("strong", { textContent: "ยังไม่มีหัวข้อ" }),
        "เริ่มใส่กฎเกณฑ์ของบริษัท เพื่อให้บอท LINE ตอบพนักงานได้",
        el("div", {}, button("เพิ่มหัวข้อแรก", { cls: "primary", ico: "plus", onclick: () => openTopicDialog() }))
      );
      listEl.replaceChildren(e);
      return;
    }

    const q = query.trim().toLowerCase();
    const filtering = q !== "";
    const dl = el("datalist", { id: "cats" });
    dl.append(...[...new Set(sections.map((s) => s.category))].map((c) => el("option", { value: c })));

    const rows = sections
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !q || `${s.category}\n${s.title}\n${s.body}`.toLowerCase().includes(q))
      .map(({ s, i }) => item(s, i, filtering));

    const none = el("div", { className: "empty slim" }, el("strong", { textContent: "ไม่พบหัวข้อที่ค้นหา" }), "ลองเปลี่ยนคำค้นหา");
    listEl.replaceChildren(dl, ...(rows.length ? rows : [none]));
  }

  // ---------- AI mode switch (Gemini / LLM) ----------
  function aiModeCard() {
    const seg = el("div", { className: "seg", role: "group" });
    seg.setAttribute("aria-label", "โหมด AI");
    const testBtn = button("ทดสอบการเชื่อมต่อ", { cls: "small" });
    const status = el("span", { className: "hint" });

    const say = (msg, kind = "") => {
      status.textContent = msg;
      status.className = `hint ${kind}`.trim();
    };

    function draw(info) {
      const opt = (key, name) => {
        const ok = info.available[key];
        const b = el("button", { type: "button" });
        b.append(name, el("small", { textContent: ok ? info.models[key] : "ยังไม่ได้ตั้งค่า key" }));
        b.setAttribute("aria-pressed", String(info.active === key));
        b.disabled = !ok;
        if (!ok) b.title = key === "llm" ? "ตั้ง LLM_BASE_URL และ LLM_API_KEY ใน Railway Variables" : "ตั้ง GEMINI_API_KEY ใน Railway Variables";
        b.onclick = async () => {
          if (info.active === key) return;
          try {
            draw(await api("/api/admin/ai", { method: "POST", body: { provider: key } }));
            say("");
            toast(`เปลี่ยนเป็นโหมด ${name} แล้ว ใช้กับบอท LINE และตัวช่วยเขียนทันที`);
          } catch (ex) {
            handleError(ex);
          }
        };
        return b;
      };
      seg.replaceChildren(opt("gemini", "Gemini"), opt("llm", "LLM"));
      testBtn.disabled = info.active === "none";
    }

    testBtn.onclick = async () => {
      say("กำลังทดสอบ...");
      testBtn.disabled = true;
      try {
        const r = await api("/api/admin/ai/test", { method: "POST" });
        say(`เชื่อมต่อได้ ตอบกลับใน ${(r.ms / 1000).toFixed(1)} วินาที`, "ok");
      } catch (ex) {
        if (ex.status === 401) return showLogin(true);
        say(ex.message, "bad");
      } finally {
        testBtn.disabled = false;
      }
    };

    api("/api/admin/ai").then(draw).catch(() => say("โหลดโหมด AI ไม่สำเร็จ", "bad"));

    return el(
      "section",
      { className: "ai-mode" },
      el("div", {}, el("div", { className: "ai-mode-title", textContent: "โหมด AI" }), el("p", { className: "hint", textContent: "เลือก AI ที่บอท LINE และตัวช่วยเขียนใช้ตอบ" })),
      el("div", { className: "ai-mode-controls" }, seg, testBtn, status)
    );
  }

  function stat(label, small = false) {
    const v = el("div", { className: "v" + (small ? " sm" : "") });
    return { node: el("div", { className: "stat" }, el("div", { className: "k", textContent: label }), v), value: v };
  }

  function showEditor() {
    const logout = button("ออกจากระบบ", { cls: "ghost", ico: "logout" });
    logout.onclick = async () => {
      await api("/api/admin/logout", { method: "POST" });
      showLogin(true);
    };
    topActions.replaceChildren(logout);

    const sCount = stat("จำนวนหัวข้อ");
    const sCats = stat("จำนวนหมวดหมู่");
    const sUpd = stat("บันทึกล่าสุด", true);
    statEls = { count: sCount.value, cats: sCats.value, updated: sUpd.value };

    const q = el("input", { className: "input", id: "q", type: "search", placeholder: "ค้นหาในหัวข้อทั้งหมด", autocomplete: "off" });
    q.setAttribute("aria-label", "ค้นหา");
    q.addEventListener("input", () => {
      query = q.value;
      renderList();
    });
    const search = el("label", { className: "search" }, icon("search", 18), q);

    listEl = el("div", { className: "editor" });

    const wrap = el("div", { className: "wrap" });
    wrap.append(
      el(
        "section",
        { className: "page-head" },
        el("span", { className: "eyebrow", textContent: "Knowledge Base" }),
        el("h1", { textContent: "จัดการกฎเกณฑ์บริษัท" }),
        el("p", { textContent: "แต่ละหัวข้อแยกเป็นรายการของตัวเอง เพิ่ม แก้ไข หรือลบได้ทีละหัวข้อ และบันทึกทันที บอท LINE ใช้ข้อมูลใหม่ได้เลย" }),
        el("div", { className: "stats" }, sCount.node, sCats.node, sUpd.node)
      ),
      aiModeCard(),
      el(
        "div",
        { className: "toolbar" },
        search,
        el("div", { className: "actions" }, button("เพิ่มหัวข้อ", { cls: "primary", ico: "plus", onclick: () => openTopicDialog() }))
      )
    );
    if (!persistent) {
      const note = el("div", { className: "notice" });
      note.append(
        icon("info", 18),
        el("span", {
          textContent:
            "ยังไม่ได้แนบที่เก็บข้อมูลถาวร (Railway Volume) ข้อมูลที่บันทึกอาจหายเมื่อระบบ deploy ใหม่ ดูวิธีตั้งค่าใน README",
        })
      );
      wrap.append(note);
    }
    wrap.append(listEl);
    app.replaceChildren(wrap);
    query = "";
    renderList();
  }

  async function start() {
    const st = await api("/api/admin/status");
    persistent = st.persistent;
    if (!st.loggedIn) return showLogin(st.enabled, st.reason);
    const data = await api("/api/admin/rules");
    sections = data.sections || [];
    updatedAt = data.updatedAt;
    showEditor();
  }

  start().catch((ex) => {
    app.replaceChildren(
      el("div", { className: "login-wrap" }, el("div", { className: "login" }, el("h1", { textContent: "เชื่อมต่อไม่ได้" }), el("p", { textContent: ex.message })))
    );
  });
})();
