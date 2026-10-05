const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Railway sets RAILWAY_VOLUME_MOUNT_PATH automatically when a volume is attached
const VOLUME_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DATA_DIR = VOLUME_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "rules.json");

const LIMITS = { sections: 200, title: 200, category: 80, body: 20000, images: 4 };

// Images live next to the data (on the volume). LINE only accepts JPEG/PNG.
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const IMAGE_RE = /^[0-9a-f-]{36}\.(jpg|png)$/;
const imagePath = (file) => path.join(UPLOAD_DIR, file);

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
    // older files have no images field
    state = { ...parsed, sections: parsed.sections.map((s) => ({ ...s, images: Array.isArray(s.images) ? s.images : [] })) };
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

function detectImageType(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

function saveImage(buf) {
  const ext = detectImageType(buf);
  if (!ext) throw new Error("รองรับเฉพาะไฟล์รูป JPEG หรือ PNG");
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(imagePath(file), buf);
  return file;
}

const referenced = () => new Set(state.sections.flatMap((s) => s.images));

function deleteImageFile(file) {
  if (!IMAGE_RE.test(file)) return;
  try { fs.unlinkSync(imagePath(file)); } catch {}
}

// Used when a dialog is cancelled: only removes files no topic points to
function discardUploaded(file) {
  if (IMAGE_RE.test(file) && !referenced().has(file)) deleteImageFile(file);
}

// Remove uploaded files that no topic uses (abandoned dialogs), once they are an hour old
function sweepOrphans() {
  try {
    const keep = referenced();
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (!IMAGE_RE.test(f) || keep.has(f)) continue;
      if (Date.now() - fs.statSync(imagePath(f)).mtimeMs > 60 * 60 * 1000) deleteImageFile(f);
    }
  } catch {}
}
sweepOrphans();
setInterval(sweepOrphans, 60 * 60 * 1000).unref();

function cleanOne(s, id) {
  const images = [...new Set(Array.isArray(s?.images) ? s.images : [])]
    .filter((f) => typeof f === "string" && IMAGE_RE.test(f) && fs.existsSync(imagePath(f)))
    .slice(0, LIMITS.images);
  const item = {
    id,
    category: String(s?.category || "").trim().slice(0, LIMITS.category) || "ทั่วไป",
    title: String(s?.title || "").trim().slice(0, LIMITS.title),
    body: String(s?.body || "").trim().slice(0, LIMITS.body),
    images,
  };
  if (!item.title && !item.body) throw new Error("กรุณากรอกหัวข้อหรือรายละเอียดอย่างน้อยหนึ่งอย่าง");
  return item;
}

function persist(sections) {
  const next = { updatedAt: new Date().toISOString(), sections };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
  state = next;
  return state;
}

// Each topic is saved on its own: add (new id, goes on top) or update (existing id)
function upsert(input) {
  const existing = typeof input?.id === "string" ? state.sections.findIndex((s) => s.id === input.id) : -1;
  if (existing === -1 && state.sections.length >= LIMITS.sections) throw new Error("จำนวนหัวข้อเต็มแล้ว");
  const item = cleanOne(input, existing === -1 ? crypto.randomUUID() : state.sections[existing].id);
  const sections = [...state.sections];
  const dropped = existing === -1 ? [] : state.sections[existing].images.filter((f) => !item.images.includes(f));
  if (existing === -1) sections.unshift(item);
  else sections[existing] = item;
  const result = persist(sections);
  dropped.forEach(deleteImageFile); // images the admin removed from this topic
  return result;
}

function remove(id) {
  const target = state.sections.find((s) => s.id === id);
  if (!target) throw new Error("ไม่พบหัวข้อนี้");
  const result = persist(state.sections.filter((s) => s.id !== id));
  target.images.forEach(deleteImageFile);
  return result;
}

function move(id, delta) {
  const i = state.sections.findIndex((s) => s.id === id);
  const j = i + (delta < 0 ? -1 : 1);
  if (i === -1) throw new Error("ไม่พบหัวข้อนี้");
  if (j < 0 || j >= state.sections.length) return state;
  const sections = [...state.sections];
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return persist(sections);
}

// Plain-text rendering used as the chatbot's knowledge. Topics are numbered so the
// model can say which ones it used (their images are then sent along with the answer).
function toKnowledge(maxChars) {
  const text = state.sections
    .map((s, i) => `## #${i + 1} [${s.category}] ${s.title}${s.images.length ? " (มีรูปประกอบ)" : ""}\n${s.body}`)
    .join("\n\n")
    .slice(0, maxChars);
  return { text, topics: state.sections, hasImages: state.sections.some((s) => s.images.length) };
}

// Small admin-chosen settings (e.g. which AI mode to use), kept on the volume next to the data
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) || {};
} catch {
  // none saved yet
}

function getSettings() {
  return settings;
}

function setSetting(key, value) {
  const next = { ...settings, [key]: value };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
  settings = next;
  return settings;
}

// Non-sensitive storage status for /health and the admin notice
function info() {
  return { persistent: Boolean(VOLUME_DIR) && writable, writable, loadedFromDisk, sections: state.sections.length };
}

module.exports = { get, upsert, remove, move, toKnowledge, info, saveImage, discardUploaded, UPLOAD_DIR, getSettings, setSetting };
