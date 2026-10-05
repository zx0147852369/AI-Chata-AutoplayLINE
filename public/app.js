(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const filters = $("filters");
  const meta = $("meta");
  const input = $("q");

  let sections = [];
  let active = "ทั้งหมด";

  const norm = (s) => s.toLowerCase();

  // Append text to node, wrapping query matches in <mark> (DOM-only, no innerHTML)
  function addText(node, text, q) {
    if (!q) return node.append(text);
    const lower = norm(text);
    let i = 0;
    for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, i)) {
      node.append(text.slice(i, at));
      const m = document.createElement("mark");
      m.textContent = text.slice(at, at + q.length);
      node.append(m);
      i = at + q.length;
    }
    node.append(text.slice(i));
  }

  // Lines starting with "- " become bullet lists; other lines become paragraphs
  function renderBody(body, q) {
    const box = document.createElement("div");
    box.className = "body";
    let ul = null;
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line) { ul = null; continue; }
      const bullet = /^[-*•]\s+/.test(line);
      if (bullet) {
        if (!ul) { ul = document.createElement("ul"); box.append(ul); }
        const li = document.createElement("li");
        addText(li, line.replace(/^[-*•]\s+/, ""), q);
        ul.append(li);
      } else {
        ul = null;
        const p = document.createElement("p");
        addText(p, line, q);
        box.append(p);
      }
    }
    return box;
  }

  function renderFilters() {
    const cats = ["ทั้งหมด", ...new Set(sections.map((s) => s.category))];
    if (cats.length <= 2) { filters.replaceChildren(); return; }
    filters.replaceChildren(
      ...cats.map((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = c;
        b.setAttribute("aria-pressed", String(c === active));
        b.onclick = () => { active = c; renderFilters(); render(); };
        return b;
      })
    );
  }

  function render() {
    const q = norm(input.value.trim());
    const list = sections.filter(
      (s) =>
        (active === "ทั้งหมด" || s.category === active) &&
        (!q || norm(`${s.title}\n${s.body}\n${s.category}`).includes(q))
    );

    if (!list.length) {
      const d = document.createElement("div");
      d.className = "empty";
      const t = document.createElement("strong");
      t.textContent = sections.length ? "ไม่พบหัวข้อที่ค้นหา" : "ยังไม่มีข้อมูล";
      d.append(t, sections.length ? "ลองเปลี่ยนคำค้นหาหรือเลือกหมวดหมู่อื่น" : "ผู้ดูแลระบบสามารถเพิ่มข้อมูลได้จากหน้าสำหรับผู้ดูแล");
      grid.replaceChildren(d);
      meta.textContent = "";
      return;
    }

    grid.replaceChildren(
      ...list.map((s) => {
        const card = document.createElement("article");
        card.className = "card";
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = s.category;
        const h = document.createElement("h2");
        addText(h, s.title, q);
        card.append(tag, h, renderBody(s.body, q));
        return card;
      })
    );
    meta.textContent = `แสดง ${list.length} จาก ${sections.length} หัวข้อ`;
  }

  async function load() {
    try {
      const res = await fetch("/api/rules", { cache: "no-cache" });
      const data = await res.json();
      sections = data.sections || [];
      if (data.updatedAt) {
        $("footer").textContent =
          "HR Handbook - อัปเดตล่าสุด " +
          new Date(data.updatedAt).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
      }
    } catch {
      sections = [];
    }
    renderFilters();
    render();
  }

  input.addEventListener("input", render);
  load();
})();
