const fs = require("fs");
const path = require("path");

// Railway sets RAILWAY_VOLUME_MOUNT_PATH automatically when a volume is attached
const VOLUME_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DATA_DIR = VOLUME_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "rules.json");

const LIMITS = { sections: 200, title: 200, category: 80, body: 20000 };

let state = { updatedAt: null, sections: [] };
let loadedFromDisk = false;
let writable = false;

// Can we actually write into the data dir? (catches volume permission problems at boot)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const probe = path.join(DATA_DIR, ".write-test");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  writable = true;
} catch (err) {
  console.error(`Data dir ${DATA_DIR} is NOT writable:`, err.message);
}

try {
  const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (Array.isArray(parsed.sections)) {
    state = parsed;
    loadedFromDisk = true;
  }
} catch (err) {
  if (err.code !== "ENOENT") {
    // Never silently discard a file we could not read: keep a copy for recovery
    console.error(`Could not read ${FILE}:`, err.message);
    try { fs.copyFileSync(FILE, `${FILE}.unreadable-${Date.now()}`); } catch {}
  }
}

console.log(
  `Data file: ${FILE} | volume=${Boolean(VOLUME_DIR)} writable=${writable} loadedFromDisk=${loadedFromDisk} sections=${state.sections.length}`
);

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

// Non-sensitive storage status for /health and the admin notice
function info() {
  return { persistent: Boolean(VOLUME_DIR) && writable, writable, loadedFromDisk, sections: state.sections.length };
}

module.exports = { get, save, toKnowledge, info };
