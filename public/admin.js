(() => {
  const app = document.getElementById("app");
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
    dashboard: '<rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9h8M8 12h5"/>',
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
    if (!res.ok) throw Object.assign(new Error(data.error || "เกิดข้อผิดพลาด"), { status: res.status, detail: data.detail });
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
    listEl = statEls = pageEl = shellEl = null;

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
      el("p", { textContent: "สำหรับผู้ดูแล เพื่อแก้ไขข้อมูลเกมและโปรโมชั่นที่บอท LINE ใช้ตอบลูกค้า" }),
      el("label", { className: "field" }, "รหัสผ่าน", el("div", { className: "pw" }, pw, toggle)),
      err,
      submit,
      el("p", { className: "foot", textContent: "ลูกค้าสอบถามผ่าน LINE เท่านั้น หน้านี้สำหรับผู้ดูแล" })
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

    const mark = el("span", { className: "brand-mark" });
    mark.append(icon("book", 22));
    const brand = el("div", { className: "login-brand" }, mark, el("div", {}, el("div", { className: "brand-name", textContent: "Game Info" }), el("div", { className: "brand-sub", textContent: "ระบบจัดการข้อมูลสำหรับบอท LINE" })));
    app.replaceChildren(el("div", { className: "login-wrap" }, brand, form));
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

    const category = el("input", { className: "input", value: topic?.category ?? "", placeholder: "เช่น โปรโมชั่น, เกมสล็อต, ฝาก-ถอน", maxLength: 80 });
    category.setAttribute("list", "cats");
    const title = el("input", { className: "input", value: topic?.title ?? "", placeholder: "เช่น เครดิตฟรีสำหรับสมาชิกใหม่", maxLength: 200 });
    const body = el("textarea", { className: "textarea", value: topic?.body ?? "", placeholder: "รายละเอียด เช่น\n- ยอดเครดิตที่ได้รับ:\n- ยอดเทิร์นที่ต้องทำ:\n- ยอดถอนสูงสุด:\n- ระยะเวลาโปรโมชั่น:\n- เกมที่ร่วมรายการ:\n- ข้อจำกัด:", maxLength: MAX_BODY });
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
      placeholder: "บอก AI เป็นข้อมูลดิบสั้นๆ เช่น เครดิตฟรีสมาชิกใหม่ [ยอด] บาท ทำเทิร์น [กี่เท่า] ถอนได้สูงสุด [ยอด] บาท ใช้ได้ [กี่วัน]",
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
        el("p", { className: "hint", textContent: "บอทจะส่งรูปเหล่านี้ให้ลูกค้าใน LINE เมื่อตอบเรื่องนี้ (ลิงก์รูปเปิดดูได้โดยผู้ที่มีลิงก์ อย่าใช้รูปที่เป็นความลับ)" }),
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

  // ---------- Shell: left menu + pages ----------
  const NAV = [
    { id: "overview", label: "ภาพรวม", title: "ภาพรวมระบบ", ico: "dashboard" },
    { id: "topics", label: "ข้อมูลเกมและโปรโมชั่น", title: "ข้อมูลเกมและโปรโมชั่น", ico: "book" },
    { id: "line", label: "สถานะ LINE", title: "สถานะการเชื่อมต่อ LINE", ico: "chat" },
    { id: "ai", label: "ตั้งค่าโหมด AI", title: "ตั้งค่าโหมด AI", ico: "sparkle" },
  ];

  let route = "overview";
  let aiInfo = null;
  let shellEl = null;
  let pageEl = null;
  let crumbEl = null;
  let chipEl = null;
  let navLinks = {};
  let hashBound = false;

  const AI_NAMES = { gemini: "Gemini", llm: "LLM" };

  const routeFromHash = () => {
    const r = location.hash.replace(/^#\/?/, "");
    return NAV.some((n) => n.id === r) ? r : "overview";
  };
  const go = (id) => { location.hash = `#/${id}`; };

  async function loadAi() {
    try {
      aiInfo = await api("/api/admin/ai");
    } catch (ex) {
      if (ex.status === 401) return showLogin(true);
      aiInfo = null;
    }
    drawChip();
  }

  function drawChip() {
    if (!chipEl) return;
    const a = aiInfo?.active;
    chipEl.textContent = a && a !== "none" ? `AI: ${AI_NAMES[a]} / ${aiInfo.models[a]}` : "AI: ยังไม่ได้ตั้งค่า";
    chipEl.className = `chip ${a && a !== "none" ? "ok" : "bad"}`;
  }

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

  const preview = (text) => {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > 140 ? `${t.slice(0, 140)}...` : t;
  };

  const notice = (text) => {
    const n = el("div", { className: "notice" });
    n.append(icon("info", 18), el("span", { textContent: text }));
    return n;
  };

  const pageHead = (title, desc, ...actions) =>
    el(
      "div",
      { className: "page-head" },
      el("div", {}, el("h1", { textContent: title }), el("p", { textContent: desc })),
      el("div", { className: "page-actions" }, ...actions)
    );

  const panel = (title, ...kids) =>
    el("section", { className: "panel" }, ...(title ? [el("div", { className: "panel-head" }, el("h2", { textContent: title }))] : []), ...kids);

  const kv = (k, v) => el("div", { className: "kv" }, el("dt", { textContent: k }), el("dd", {}, v));

  function stat(label, small = false) {
    const v = el("div", { className: "v" + (small ? " sm" : "") });
    return { node: el("div", { className: "stat" }, el("div", { className: "k", textContent: label }), v), value: v };
  }

  // ----- Page: overview -----
  function pageOverview() {
    const sCount = stat("จำนวนหัวข้อ");
    const sCats = stat("จำนวนหมวดหมู่");
    const sUpd = stat("บันทึกล่าสุด", true);
    statEls = { count: sCount.value, cats: sCats.value, updated: sUpd.value };
    updateStats();

    const a = aiInfo?.active;
    const aiText = a && a !== "none" ? `${AI_NAMES[a]} (${aiInfo.models[a]})` : "ยังไม่ได้ตั้งค่า";
    const quick = el(
      "div",
      { className: "quick" },
      button("เพิ่มหัวข้อใหม่", { cls: "primary", ico: "plus", onclick: () => { go("topics"); openTopicDialog(); } }),
      button("จัดการข้อมูลเกมและโปรโมชั่น", { onclick: () => go("topics") }),
      button("ตั้งค่าโหมด AI", { onclick: () => go("ai") })
    );

    pageEl.replaceChildren(
      pageHead("ภาพรวมระบบ", "สรุปข้อมูลที่บอท LINE ใช้ตอบลูกค้า และสถานะของระบบ"),
      ...(persistent ? [] : [notice("ยังไม่ได้แนบที่เก็บข้อมูลถาวร (Railway Volume) ข้อมูลที่บันทึกอาจหายเมื่อระบบ deploy ใหม่ ดูวิธีตั้งค่าใน README")]),
      el("div", { className: "stats" }, sCount.node, sCats.node, sUpd.node),
      el(
        "div",
        { className: "cols" },
        panel(
          "สถานะระบบ",
          el(
            "dl",
            { className: "kvs" },
            kv("โหมด AI ที่ใช้งาน", aiText),
            kv("พื้นที่เก็บข้อมูล", persistent ? "ถาวร (Railway Volume)" : "ชั่วคราว"),
            kv("การตอบลูกค้า", "ผ่าน LINE ตามข้อมูลที่บันทึกในระบบเท่านั้น")
          )
        ),
        panel("ทางลัด", quick)
      )
    );
  }

  // ----- Page: topics -----
  function drawTable() {
    if (!listEl) return;
    if (!sections.length) {
      const e = el("div", { className: "empty" });
      e.append(
        icon("book", 28),
        el("strong", { textContent: "ยังไม่มีหัวข้อ" }),
        "เริ่มใส่ข้อมูลเกมและโปรโมชั่น เพื่อให้บอท LINE ตอบลูกค้าได้",
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
      .map(({ s, i }) => {
        const actions = el(
          "div",
          { className: "row-actions" },
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
        const imgs = s.images?.length
          ? el("div", { className: "thumbs-row" }, ...s.images.map((f) => el("img", { src: `/uploads/${f}`, alt: "", loading: "lazy" })))
          : el("span", { className: "muted", textContent: "-" });
        const tr = el(
          "tr",
          {},
          el("td", { className: "c-no", textContent: String(i + 1) }),
          el(
            "td",
            { className: "c-main" },
            el("span", { className: "tag", textContent: s.category }),
            el("div", { className: "t-title", textContent: s.title || "(ไม่มีหัวข้อ)" }),
            el("div", { className: "preview", textContent: preview(s.body) })
          ),
          el("td", { className: "c-img" }, imgs),
          el("td", { className: "c-act" }, actions)
        );
        tr.addEventListener("dblclick", () => openTopicDialog(s));
        return tr;
      });

    if (!rows.length) {
      listEl.replaceChildren(el("div", { className: "empty slim" }, el("strong", { textContent: "ไม่พบหัวข้อที่ค้นหา" }), "ลองเปลี่ยนคำค้นหา"));
      return;
    }

    const table = el(
      "table",
      { className: "tbl" },
      el("thead", {}, el("tr", {}, ...["ลำดับ", "หมวดหมู่ / หัวข้อ / รายละเอียด", "รูปภาพ", "จัดการ"].map((h) => el("th", { textContent: h })))),
      el("tbody", {}, ...rows)
    );
    listEl.replaceChildren(dl, table);
  }

  function pageTopics() {
    statEls = null;
    const q = el("input", { className: "input", type: "search", placeholder: "ค้นหาหมวดหมู่ หัวข้อ หรือรายละเอียด", autocomplete: "off", value: query });
    q.setAttribute("aria-label", "ค้นหา");
    q.addEventListener("input", () => {
      query = q.value;
      drawTable();
    });
    listEl = el("div", { className: "table-wrap" });

    pageEl.replaceChildren(
      pageHead(
        "ข้อมูลเกมและโปรโมชั่น",
        "แต่ละหัวข้อเป็นรายการแยกกัน เพิ่ม แก้ไข หรือลบได้ทีละหัวข้อ บันทึกทันที และบอท LINE ใช้ข้อมูลใหม่ได้เลย",
        button("เพิ่มหัวข้อ", { cls: "primary", ico: "plus", onclick: () => openTopicDialog() })
      ),
      ...(persistent ? [] : [notice("ยังไม่ได้แนบที่เก็บข้อมูลถาวร (Railway Volume) ข้อมูลที่บันทึกอาจหายเมื่อระบบ deploy ใหม่ ดูวิธีตั้งค่าใน README")]),
      panel(null, el("div", { className: "table-tools" }, el("label", { className: "search" }, icon("search", 18), q), el("span", { className: "muted", id: "count", textContent: `${sections.length} รายการ` })), listEl)
    );
    drawTable();
  }

  // ----- Page: LINE connection status -----
  const fmtTime = (ms) =>
    ms ? new Date(ms).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "ยังไม่มี";

  // Turn the raw counters into plain advice
  function diagnose(d) {
    const s = d.stats;
    const out = [];
    if (!d.secretSet || !d.tokenSet) {
      out.push({ bad: true, text: `ยังไม่ได้ตั้ง ${[!d.secretSet && "LINE_CHANNEL_SECRET", !d.tokenSet && "LINE_CHANNEL_ACCESS_TOKEN"].filter(Boolean).join(" และ ")} ใน Railway Variables` });
    }
    if (d.secretSet && !d.secretFormatOk) {
      out.push({
        bad: true,
        text: "ค่า LINE_CHANNEL_SECRET ที่ตั้งไว้ รูปแบบไม่ใช่ Channel secret (ของจริงเป็นตัวอักษร a-f และตัวเลขรวม 32 ตัว ไม่ใช่สตริงยาว) น่าจะวางผิดช่อง เช่น เอา Channel access token มาใส่ ให้คัดลอก Channel secret จากแท็บ Basic settings ใน LINE Developers",
      });
    }
    if (d.tokenSet && !d.tokenFormatOk) {
      out.push({ bad: true, text: "ค่า LINE_CHANNEL_ACCESS_TOKEN สั้นผิดปกติ Channel access token (long-lived) เป็นสตริงยาวมาก ตรวจว่าคัดลอกมาครบ" });
    }
    if (d.secretHasSpaces || d.tokenHasSpaces) {
      out.push({ bad: true, text: "ค่า LINE ที่ตั้งไว้มีช่องว่างหรือขึ้นบรรทัดใหม่ปนอยู่ ระบบตัดออกให้อัตโนมัติแล้ว แต่ควรลบแล้ววางใหม่ให้สะอาด (ใช้ปุ่มคัดลอกข้างช่องใน LINE Developers แทนการลากคลุมข้อความ)" });
    }
    if (s.badSignature > 0) {
      out.push({
        bad: true,
        text: "มีคำขอจาก LINE ที่ลายเซ็นไม่ถูกต้อง แปลว่า LINE_CHANNEL_SECRET ใน Railway ไม่ตรงกับ Channel secret ใน LINE Developers (Basic settings) ถ้าเพิ่งกด Reissue ต้องอัปเดตค่าใน Railway แล้ว deploy ใหม่ และตรวจว่าไม่มีช่องว่างติดมา",
      });
    }
    if (s.received === 0 && s.badSignature === 0) {
      out.push({
        bad: true,
        text: "ยังไม่มีคำขอจาก LINE เข้ามาที่เซิร์ฟเวอร์เลย ให้ตรวจใน LINE Developers > Messaging API ว่า Webhook URL ตรงกับด้านบน กด Verify ให้ผ่าน และเปิด Use webhook (หรือส่งข้อความหาบอทอีกครั้งหลังเปิดหน้านี้แล้วกดรีเฟรช เพราะตัวนับเริ่มใหม่ทุกครั้งที่ระบบ deploy)",
      });
    }
    if (s.lastReply && !s.lastReply.ok) {
      out.push({
        bad: true,
        text: `LINE ปฏิเสธการตอบกลับ (HTTP ${s.lastReply.status || "ต่อไม่ได้"}) ${s.lastReply.status === 401 ? "แปลว่า Channel access token ไม่ถูกต้องหรือถูกยกเลิก ให้ออก token ใหม่แล้วอัปเดตใน Railway" : "ดูรายละเอียดด้านบน"}`,
      });
    }
    if (s.lastAiError) {
      out.push({ bad: true, text: "AI ตอบไม่ได้ในครั้งล่าสุด ไปที่หน้า 'ตั้งค่าโหมด AI' แล้วกดทดสอบการเชื่อมต่อ" });
    }
    if (d.topics === 0) {
      out.push({ bad: false, text: "ยังไม่มีหัวข้อในระบบ บอทจะตอบ 'ยังไม่มีข้อมูลนี้ค่ะ' ทุกคำถาม ไปเพิ่มข้อมูลที่หน้า 'ข้อมูลเกมและโปรโมชั่น'" });
    }
    if (!out.some((x) => x.bad) && s.received > 0 && s.lastReply?.ok) {
      out.push({ bad: false, ok: true, text: "ระบบรับข้อความจาก LINE และตอบกลับสำเร็จแล้ว ทำงานปกติ" });
    }
    return out;
  }

  async function pageLine() {
    statEls = null;
    pageEl.replaceChildren(pageHead("สถานะการเชื่อมต่อ LINE", "ตรวจว่าข้อความจาก LINE เข้ามาถึงระบบและตอบกลับได้หรือไม่"), el("p", { className: "muted", textContent: "กำลังโหลด..." }));
    let d;
    try {
      d = await api("/api/admin/line");
    } catch (ex) {
      if (ex.status === 401) return showLogin(true);
      pageEl.replaceChildren(pageHead("สถานะการเชื่อมต่อ LINE", ""), notice(ex.message));
      return;
    }
    if (route !== "line") return; // user navigated away while loading

    const tokenStatus = el("span", { className: "hint" });
    const sayToken = (msg, kind = "") => {
      tokenStatus.textContent = msg;
      tokenStatus.className = `hint ${kind}`.trim();
    };
    const tokenBtn = button("ทดสอบ Channel access token", { ico: "chat" });
    tokenBtn.disabled = !d.tokenSet;
    tokenBtn.onclick = async () => {
      sayToken("กำลังตรวจสอบกับ LINE...");
      tokenBtn.disabled = true;
      try {
        const r = await api("/api/admin/line/test-token", { method: "POST" });
        sayToken(`token ใช้ได้ บอท: ${r.displayName || "-"}${r.basicId ? ` (${r.basicId})` : ""}`, "ok");
      } catch (ex) {
        if (ex.status === 401) return showLogin(true);
        sayToken(ex.detail ? `${ex.message}: ${ex.detail}` : ex.message, "bad");
      } finally {
        tokenBtn.disabled = false;
      }
    };

    const copyBtn = button("คัดลอก", { cls: "small" });
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(d.webhookUrl);
        toast("คัดลอก Webhook URL แล้ว");
      } catch {
        toast("คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง");
      }
    };

    const yesNo = (ok, yes, no) => el("span", { className: `pill ${ok ? "ok" : "bad"}`, textContent: ok ? yes : no });
    const s = d.stats;
    const reply = s.lastReply;
    const replyView = !reply
      ? "ยังไม่เคยตอบกลับ"
      : reply.ok
        ? `สำเร็จ เมื่อ ${fmtTime(reply.at)}`
        : `ล้มเหลว เมื่อ ${fmtTime(reply.at)} (HTTP ${reply.status || "ต่อไม่ได้"}) ${reply.detail}`;
    const findings = diagnose(d);
    const list = el("ul", { className: "findings" }, ...findings.map((f) => el("li", { className: f.ok ? "ok" : f.bad ? "bad" : "" }, f.text)));

    pageEl.replaceChildren(
      pageHead("สถานะการเชื่อมต่อ LINE", "ตรวจว่าข้อความจาก LINE เข้ามาถึงระบบและตอบกลับได้หรือไม่", button("รีเฟรช", { onclick: () => render() })),
      panel("ผลการตรวจสอบ", findings.length ? list : el("p", { className: "para", textContent: "ยังไม่พบปัญหา" })),
      panel(
        "การตั้งค่า",
        el(
          "dl",
          { className: "kvs" },
          kv("Webhook URL", el("span", { className: "inline" }, el("code", { textContent: d.webhookUrl }), copyBtn)),
          kv("Channel secret", yesNo(d.secretSet, "ตั้งค่าแล้ว", "ยังไม่ได้ตั้งค่า")),
          kv("Channel access token", yesNo(d.tokenSet, "ตั้งค่าแล้ว", "ยังไม่ได้ตั้งค่า")),
          kv("หัวข้อในระบบ", `${d.topics} หัวข้อ`)
        ),
        el("div", { className: "test-row" }, tokenBtn, tokenStatus)
      ),
      panel(
        `กิจกรรมล่าสุด (นับตั้งแต่ระบบเริ่มทำงาน ${fmtTime(d.startedAt)})`,
        el(
          "dl",
          { className: "kvs" },
          kv("คำขอจาก LINE ที่ผ่านการตรวจ", `${s.received} ครั้ง (ล่าสุด ${fmtTime(s.lastReceivedAt)})`),
          kv("ลายเซ็นไม่ถูกต้อง", `${s.badSignature} ครั้ง (ล่าสุด ${fmtTime(s.lastBadSignatureAt)})`),
          kv("การตอบกลับ LINE ล่าสุด", replyView),
          kv("ข้อผิดพลาดของ AI ล่าสุด", s.lastAiError ? `${fmtTime(s.lastAiError.at)}: ${s.lastAiError.message}` : "ไม่มี")
        )
      )
    );
  }

  // ----- Page: AI mode -----
  function pageAi() {
    statEls = null;
    const status = el("span", { className: "hint" });
    const say = (msg, kind = "") => {
      status.textContent = msg;
      status.className = `hint ${kind}`.trim();
    };
    const testBtn = button("ทดสอบการเชื่อมต่อ", { ico: "sparkle" });
    testBtn.disabled = !aiInfo || aiInfo.active === "none";
    testBtn.onclick = async () => {
      say("กำลังทดสอบ...");
      testBtn.disabled = true;
      try {
        const r = await api("/api/admin/ai/test", { method: "POST" });
        say(`เชื่อมต่อได้ ตอบกลับใน ${(r.ms / 1000).toFixed(1)} วินาที`, "ok");
      } catch (ex) {
        if (ex.status === 401) return showLogin(true);
        say(ex.detail ? `${ex.message}: ${ex.detail}` : ex.message, "bad");
      } finally {
        testBtn.disabled = false;
      }
    };

    const option = (key, name, hint) => {
      const ok = Boolean(aiInfo?.available[key]);
      const on = aiInfo?.active === key;
      const b = el("button", { type: "button", className: `provider${on ? " on" : ""}` });
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(on));
      b.disabled = !ok;
      b.append(
        el("span", { className: "radio" }),
        el("span", { className: "p-main" }, el("strong", { textContent: name }), el("small", { textContent: ok ? `โมเดล: ${aiInfo.models[key]}` : hint })),
        el("span", { className: `pill ${on ? "ok" : ok ? "" : "bad"}`, textContent: on ? "ใช้งานอยู่" : ok ? "พร้อมใช้งาน" : "ยังไม่ได้ตั้งค่า" })
      );
      b.onclick = async () => {
        if (on) return;
        try {
          aiInfo = await api("/api/admin/ai", { method: "POST", body: { provider: key } });
          drawChip();
          pageAi();
          toast(`เปลี่ยนเป็นโหมด ${name} แล้ว ใช้กับบอท LINE และตัวช่วยเขียนทันที`);
        } catch (ex) {
          handleError(ex);
        }
      };
      return b;
    };

    const group = el("div", { className: "providers", role: "radiogroup" });
    group.setAttribute("aria-label", "โหมด AI");
    group.append(
      option("gemini", "Gemini", "ตั้ง GEMINI_API_KEY ใน Railway Variables"),
      option("llm", "LLM (API แบบ OpenAI-compatible)", "ตั้ง LLM_BASE_URL และ LLM_API_KEY ใน Railway Variables")
    );

    pageEl.replaceChildren(
      pageHead("ตั้งค่าโหมด AI", "เลือก AI ที่บอท LINE และตัวช่วยเขียนใช้ตอบ การเปลี่ยนโหมดมีผลทันทีโดยไม่ต้อง deploy ใหม่"),
      panel("เลือกโหมด", group, el("div", { className: "test-row" }, testBtn, status)),
      panel(
        "การตั้งค่า key และโมเดล",
        el("p", { className: "para", textContent: "key, URL และชื่อโมเดลตั้งใน Railway Variables เพื่อความปลอดภัย (ไม่แสดงบนหน้านี้)" }),
        el(
          "dl",
          { className: "kvs" },
          kv("Gemini", "GEMINI_API_KEY, GEMINI_MODEL"),
          kv("LLM", "LLM_BASE_URL, LLM_API_KEY, LLM_MODEL")
        )
      )
    );
  }

  const PAGES = { overview: pageOverview, topics: pageTopics, line: pageLine, ai: pageAi };

  function render() {
    route = routeFromHash();
    const item = NAV.find((n) => n.id === route);
    for (const [id, a] of Object.entries(navLinks)) {
      a.classList.toggle("active", id === route);
      if (id === route) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    crumbEl.replaceChildren(el("span", { textContent: "ระบบจัดการ" }), el("span", { className: "sep", textContent: "/" }), el("strong", { textContent: item.title }));
    shellEl.classList.remove("open");
    listEl = null;
    PAGES[route]();
    window.scrollTo(0, 0);
  }

  // Keep whichever page is open in sync after data changes
  function renderList() {
    updateStats();
    if (route === "topics" && listEl) {
      drawTable();
      const c = document.getElementById("count");
      if (c) c.textContent = `${sections.length} รายการ`;
    }
  }

  async function showEditor() {
    await loadAi();

    const logout = button("ออกจากระบบ", { cls: "side-btn", ico: "logout" });
    logout.onclick = async () => {
      await api("/api/admin/logout", { method: "POST" });
      showLogin(true);
    };

    navLinks = {};
    const nav = el("nav", { className: "nav" });
    nav.setAttribute("aria-label", "เมนูหลัก");
    nav.append(el("div", { className: "nav-label", textContent: "เมนู" }));
    for (const n of NAV) {
      const a = el("a", { href: `#/${n.id}`, className: "nav-item" });
      a.append(icon(n.ico, 18), el("span", { textContent: n.label }));
      navLinks[n.id] = a;
      nav.append(a);
    }

    const mark = el("span", { className: "brand-mark" });
    mark.append(icon("book", 22));
    const side = el(
      "aside",
      { className: "sidebar" },
      el("div", { className: "side-brand" }, mark, el("div", {}, el("div", { className: "brand-name", textContent: "Game Info" }), el("div", { className: "brand-sub", textContent: "ระบบจัดการข้อมูลสำหรับบอท LINE" }))),
      nav,
      el("div", { className: "side-foot" }, el("div", { className: "who" }, el("span", { className: "dot" }), "ผู้ดูแลระบบ"), logout)
    );

    const menuBtn = iconButton("menu", "เปิดเมนู", { cls: "menu-btn" });
    crumbEl = el("div", { className: "crumb" });
    chipEl = el("a", { href: "#/ai", className: "chip", title: "ตั้งค่าโหมด AI" });
    pageEl = el("main", { className: "content", id: "page" });
    const scrim = el("div", { className: "scrim" });

    shellEl = el(
      "div",
      { className: "shell" },
      side,
      scrim,
      el("div", { className: "main" }, el("header", { className: "main-top" }, menuBtn, crumbEl, chipEl), pageEl)
    );
    menuBtn.onclick = () => shellEl.classList.toggle("open");
    scrim.onclick = () => shellEl.classList.remove("open");

    app.replaceChildren(shellEl);
    drawChip();
    if (!hashBound) {
      window.addEventListener("hashchange", () => { if (pageEl && document.body.contains(pageEl)) render(); });
      hashBound = true;
    }
    query = "";
    render();
  }

  async function start() {
    const st = await api("/api/admin/status");
    persistent = st.persistent;
    if (!st.loggedIn) return showLogin(st.enabled, st.reason);
    const data = await api("/api/admin/rules");
    sections = data.sections || [];
    updatedAt = data.updatedAt;
    await showEditor();
  }

  start().catch((ex) => {
    app.replaceChildren(
      el("div", { className: "login-wrap" }, el("div", { className: "login" }, el("h1", { textContent: "เชื่อมต่อไม่ได้" }), el("p", { textContent: ex.message })))
    );
  });
})();
