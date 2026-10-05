(() => {
  const app = document.getElementById("app");
  const topActions = document.getElementById("topActions");
  const toastEl = document.getElementById("toast");

  const MAX_BODY = 20000;

  let sections = [];
  let updatedAt = null;
  let dirty = false;
  let persistent = true;

  // refs used by the editor view
  let statusEl = null;
  let listEl = null;
  let statEls = null;
  let query = "";

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    logout: '<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
    up: '<path d="M6 14l6-6 6 6"/>',
    down: '<path d="M6 10l6 6 6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
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
    setTimeout(() => toastEl.classList.remove("show"), 2400);
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

  function setDirty(v) {
    dirty = v;
    if (statusEl) {
      statusEl.textContent = v ? "มีการแก้ไขที่ยังไม่บันทึก" : "บันทึกแล้ว";
      statusEl.className = "status" + (v ? " dirty" : "");
    }
    updateStats();
  }

  window.addEventListener("beforeunload", (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  const fmtDate = (iso) =>
    iso
      ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "ยังไม่เคยบันทึก";

  // ---------- Login ----------
  function showLogin(enabled, reason) {
    topActions.replaceChildren();

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

  // ---------- Editor ----------
  const newSection = () => ({ id: crypto.randomUUID(), category: "", title: "", body: "" });

  function updateStats() {
    if (!statEls) return;
    statEls.count.textContent = String(sections.length);
    statEls.cats.textContent = String(new Set(sections.map((s) => s.category.trim()).filter(Boolean)).size);
    statEls.updated.textContent = fmtDate(updatedAt);
  }

  function applyFilter() {
    const q = query.trim().toLowerCase();
    listEl.querySelectorAll("[data-idx]").forEach((card) => {
      const s = sections[Number(card.dataset.idx)];
      const hit = !q || `${s.category}\n${s.title}\n${s.body}`.toLowerCase().includes(q);
      card.hidden = !hit;
    });
  }

  function card(s, i) {
    const category = el("input", { className: "input", value: s.category, placeholder: "หมวดหมู่ เช่น การลา", maxLength: 80 });
    category.setAttribute("list", "cats");
    category.setAttribute("aria-label", "หมวดหมู่");
    const title = el("input", { className: "input title-input", value: s.title, placeholder: "หัวข้อ เช่น สิทธิ์การลาพักร้อน", maxLength: 200 });
    title.setAttribute("aria-label", "หัวข้อ");
    const body = el("textarea", { className: "textarea", value: s.body, placeholder: "รายละเอียดของกฎเกณฑ์", maxLength: MAX_BODY });
    body.setAttribute("aria-label", "รายละเอียด");
    const counter = el("span", { className: "hint" });
    const showCount = () => (counter.textContent = `${body.value.length.toLocaleString()} / ${MAX_BODY.toLocaleString()} ตัวอักษร`);
    showCount();

    for (const [node, key] of [[category, "category"], [title, "title"], [body, "body"]]) {
      node.addEventListener("input", () => {
        s[key] = node.value;
        if (key === "body") showCount();
        setDirty(true);
      });
    }

    const filtering = query.trim() !== "";
    const tools = el(
      "div",
      { className: "tools" },
      iconButton("up", "เลื่อนขึ้น", { disabled: i === 0 || filtering, onclick: () => move(i, -1) }),
      iconButton("down", "เลื่อนลง", { disabled: i === sections.length - 1 || filtering, onclick: () => move(i, 1) }),
      iconButton("trash", "ลบหัวข้อ", {
        cls: "danger",
        onclick: () => {
          if (!confirm("ลบหัวข้อนี้ใช่หรือไม่?")) return;
          sections.splice(i, 1);
          setDirty(true);
          renderList();
        },
      })
    );

    const c = el(
      "article",
      { className: "card" },
      el(
        "div",
        { className: "card-head" },
        el("span", { className: "badge", textContent: String(i + 1).padStart(2, "0") }),
        el("div", { className: "grid" }, category, title)
      ),
      body,
      el("div", { className: "card-foot" }, counter, tools)
    );
    c.dataset.idx = String(i);
    return c;
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    [sections[i], sections[j]] = [sections[j], sections[i]];
    setDirty(true);
    renderList();
  }

  function addSection() {
    sections.unshift(newSection());
    query = "";
    const q = document.getElementById("q");
    if (q) q.value = "";
    setDirty(true);
    renderList();
    listEl.querySelector("input.input")?.focus();
  }

  function renderList() {
    if (!sections.length) {
      const e = el("div", { className: "empty" });
      const ic = icon("book", 28);
      ic.style.width = ic.style.height = "56px";
      e.append(
        ic,
        el("strong", { textContent: "ยังไม่มีหัวข้อ" }),
        "เริ่มใส่กฎเกณฑ์ของบริษัท เพื่อให้บอท LINE ตอบพนักงานได้",
        el("div", {}, button("เพิ่มหัวข้อแรก", { cls: "primary", ico: "plus", onclick: addSection }))
      );
      listEl.replaceChildren(e);
      updateStats();
      return;
    }
    const dl = el("datalist", { id: "cats" });
    dl.append(...[...new Set(sections.map((s) => s.category).filter(Boolean))].map((c) => el("option", { value: c })));
    listEl.replaceChildren(dl, ...sections.map(card));
    applyFilter();
    updateStats();
  }

  async function save(btn) {
    btn.disabled = true;
    try {
      const data = await api("/api/admin/rules", { method: "PUT", body: { sections } });
      sections = data.sections;
      updatedAt = data.updatedAt;
      setDirty(false);
      renderList();
      toast("บันทึกเรียบร้อย บอท LINE ใช้ข้อมูลใหม่ทันที");
    } catch (ex) {
      if (ex.status === 401) return showLogin(true);
      toast(ex.message);
    } finally {
      btn.disabled = false;
    }
  }

  function stat(label, small = false) {
    const v = el("div", { className: "v" + (small ? " sm" : "") });
    return { node: el("div", { className: "stat" }, el("div", { className: "k", textContent: label }), v), value: v };
  }

  function showEditor() {
    const logout = button("ออกจากระบบ", { cls: "ghost", ico: "logout" });
    logout.onclick = async () => {
      if (dirty && !confirm("มีการแก้ไขที่ยังไม่บันทึก ต้องการออกจากระบบหรือไม่?")) return;
      setDirty(false);
      await api("/api/admin/logout", { method: "POST" });
      statEls = statusEl = listEl = null;
      showLogin(true);
    };
    topActions.replaceChildren(logout);

    const sCount = stat("จำนวนหัวข้อ");
    const sCats = stat("จำนวนหมวดหมู่");
    const sUpd = stat("บันทึกล่าสุด", true);
    statEls = { count: sCount.value, cats: sCats.value, updated: sUpd.value };

    statusEl = el("span", { className: "status", textContent: "บันทึกแล้ว" });
    const saveBtn = button("บันทึก", { cls: "primary", ico: "save" });
    saveBtn.onclick = () => save(saveBtn);

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
        el("p", { textContent: "ข้อมูลทั้งหมดที่นี่คือสิ่งที่บอท LINE ใช้ตอบพนักงาน บันทึกแล้วมีผลทันที ไม่ต้อง deploy ใหม่" }),
        el("div", { className: "stats" }, sCount.node, sCats.node, sUpd.node)
      ),
      el(
        "div",
        { className: "toolbar" },
        search,
        el("div", { className: "actions" }, statusEl, button("เพิ่มหัวข้อ", { ico: "plus", onclick: addSection }), saveBtn)
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
    setDirty(false);
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
