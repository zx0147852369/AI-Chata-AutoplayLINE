(() => {
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");

  let sections = [];
  let dirty = false;
  let persistent = true;
  let statusEl = null;

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2200);
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
  }

  window.addEventListener("beforeunload", (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- Login ----------
  function showLogin(enabled) {
    const err = el("div", { className: "error", role: "alert" });
    const pw = el("input", { className: "input", type: "password", autocomplete: "current-password", required: true });
    const btn = el("button", { className: "btn primary", type: "submit", textContent: "เข้าสู่ระบบ" });
    btn.style.width = "100%";
    pw.disabled = btn.disabled = !enabled;
    if (!enabled) err.textContent = "ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ใน Railway Variables";

    const form = el(
      "form",
      { className: "login" },
      el("h1", { textContent: "เข้าสู่ระบบผู้ดูแล" }),
      el("p", { textContent: "สำหรับฝ่าย HR เพื่อแก้ไขกฎเกณฑ์ที่แสดงบนเว็บและใช้ตอบใน LINE" }),
      el("label", { className: "field" }, "รหัสผ่าน", pw),
      err,
      btn
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = "";
      btn.disabled = true;
      try {
        await api("/api/admin/login", { method: "POST", body: { password: pw.value } });
        await start();
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
      }
    };
    app.replaceChildren(form);
    pw.focus();
  }

  // ---------- Editor ----------
  function newSection() {
    return { id: crypto.randomUUID(), category: "", title: "", body: "" };
  }

  function categoryList() {
    const dl = el("datalist", { id: "cats" });
    dl.append(...[...new Set(sections.map((s) => s.category).filter(Boolean))].map((c) => el("option", { value: c })));
    return dl;
  }

  function card(s, i) {
    const category = el("input", { className: "input", value: s.category, placeholder: "เช่น การลา", maxLength: 80 });
    category.setAttribute("list", "cats");
    const title = el("input", { className: "input", value: s.title, placeholder: "หัวข้อ เช่น สิทธิ์การลาพักร้อน", maxLength: 200 });
    const body = el("textarea", { className: "textarea", value: s.body, placeholder: "รายละเอียด", maxLength: 20000 });

    for (const [node, key] of [[category, "category"], [title, "title"], [body, "body"]]) {
      node.addEventListener("input", () => { s[key] = node.value; setDirty(true); });
    }

    const up = el("button", { className: "btn small", type: "button", textContent: "เลื่อนขึ้น", disabled: i === 0 });
    const down = el("button", { className: "btn small", type: "button", textContent: "เลื่อนลง", disabled: i === sections.length - 1 });
    const del = el("button", { className: "btn small danger", type: "button", textContent: "ลบหัวข้อ" });
    up.onclick = () => move(i, -1);
    down.onclick = () => move(i, 1);
    del.onclick = () => {
      if (!confirm("ลบหัวข้อนี้ใช่หรือไม่?")) return;
      sections.splice(i, 1);
      setDirty(true);
      renderList();
    };

    return el(
      "article",
      { className: "card" },
      el(
        "div",
        { className: "row" },
        el("label", { className: "field" }, "หมวดหมู่", category),
        el("label", { className: "field" }, "หัวข้อ", title)
      ),
      el("label", { className: "field" }, "รายละเอียด", body),
      el("div", { className: "hint", textContent: "ขึ้นบรรทัดใหม่เพื่อแยกย่อหน้า ขึ้นต้นบรรทัดด้วย - เพื่อทำเป็นรายการ" }),
      el("div", { className: "tools" }, up, down, el("span", { className: "spacer" }), del)
    );
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    [sections[i], sections[j]] = [sections[j], sections[i]];
    setDirty(true);
    renderList();
  }

  let listEl = null;
  function renderList() {
    if (!sections.length) {
      listEl.replaceChildren(
        el("div", { className: "empty" }, el("strong", { textContent: "ยังไม่มีหัวข้อ" }), "กด เพิ่มหัวข้อ เพื่อเริ่มใส่กฎเกณฑ์ของบริษัท")
      );
      return;
    }
    listEl.replaceChildren(categoryList(), ...sections.map(card));
  }

  async function save(btn) {
    btn.disabled = true;
    try {
      const data = await api("/api/admin/rules", { method: "PUT", body: { sections } });
      sections = data.sections;
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

  function showEditor() {
    statusEl = el("span", { className: "status", textContent: "บันทึกแล้ว" });
    const add = el("button", { className: "btn", type: "button", textContent: "เพิ่มหัวข้อ" });
    const saveBtn = el("button", { className: "btn primary", type: "button", textContent: "บันทึก" });
    const out = el("button", { className: "btn", type: "button", textContent: "ออกจากระบบ" });

    add.onclick = () => {
      sections.unshift(newSection());
      setDirty(true);
      renderList();
      listEl.querySelector("input.input")?.focus();
    };
    saveBtn.onclick = () => save(saveBtn);
    out.onclick = async () => {
      if (dirty && !confirm("มีการแก้ไขที่ยังไม่บันทึก ต้องการออกจากระบบหรือไม่?")) return;
      setDirty(false);
      await api("/api/admin/logout", { method: "POST" });
      showLogin(true);
    };

    listEl = el("div", { className: "editor" });
    const wrap = el("div", { className: "wrap" });
    wrap.append(
      el("div", { className: "toolbar" }, statusEl, el("div", { className: "actions" }, add, saveBtn, out))
    );
    if (!persistent) {
      wrap.append(
        el("div", {
          className: "notice",
          textContent:
            "ยังไม่ได้ตั้งค่าที่เก็บข้อมูลถาวร (Railway Volume) ข้อมูลที่บันทึกอาจหายเมื่อระบบ deploy ใหม่ ดูวิธีตั้งค่าใน README",
        })
      );
    }
    wrap.append(listEl);
    app.replaceChildren(wrap);
    renderList();
  }

  async function start() {
    const st = await api("/api/admin/status");
    persistent = st.persistent;
    if (!st.loggedIn) return showLogin(st.enabled);
    const data = await api("/api/admin/rules");
    sections = data.sections || [];
    showEditor();
  }

  start().catch((ex) => {
    app.replaceChildren(el("div", { className: "login" }, el("h1", { textContent: "เชื่อมต่อไม่ได้" }), el("p", { textContent: ex.message })));
  });
})();
