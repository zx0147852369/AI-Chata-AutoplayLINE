const fs = require("fs");
const path = require("path");

// Railway sets RAILWAY_VOLUME_MOUNT_PATH automatically when a volume is attached
const VOLUME_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DATA_DIR = VOLUME_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "rules.json");

const LIMITS = { sections: 200, title: 200, category: 80, body: 20000 };

let state = { updatedAt: null, sections: [] };

try {
  state = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch {
  // first run: start empty
}

function get() {
  return state;
}

function clean(input) {
  if (!Array.isArray(input) || input.length > LIMITS.sections) {
    throw new Error("รูปแบบข้อมูลไม่ถูกต้อง");
  }
  return input.map((s) => ({
    id: typeof s.id === "string" && s.id ? s.id.slice(0, 64) : require("crypto").randomUUID(),
    category: String(s.category || "ทั่วไป").trim().slice(0, LIMITS.category) || "ทั่วไป",
    title: String(s.title || "").trim().slice(0, LIMITS.title),
    body: String(s.body || "").trim().slice(0, LIMITS.body),
  })).filter((s) => s.title || s.body);
}

function save(sections) {
  const next = { updatedAt: new Date().toISOString(), sections: clean(sections) };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
  state = next;
  return state;
}

// Plain-text rendering used as the chatbot's knowledge
function toKnowledge(maxChars) {
  return state.sections
    .map((s) => `## [${s.category}] ${s.title}\n${s.body}`)
    .join("\n\n")
    .slice(0, maxChars);
}

module.exports = { get, save, toKnowledge, persistent: Boolean(VOLUME_DIR) };
