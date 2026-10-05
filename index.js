const crypto = require("crypto");
const path = require("path");
const express = require("express");
const store = require("./store");

const {
  ADMIN_PASSWORD,
  GEMINI_MODEL = "gemini-2.5-flash",
  // Optional OpenAI-compatible provider (takes priority over Gemini when set)
  LLM_BASE_URL, // e.g. https://ai.thirx.com/v1
  LLM_MODEL = "qwen3.8-27b",
  PUBLIC_BASE_URL, // optional: override the https origin used for image links sent to LINE
  PORT = 3000,
} = process.env;

// Keys and tokens never contain whitespace, but copy/paste often adds a space or line break
// in the middle. Strip it so a slightly dirty paste still works (the status page also warns).
const strip = (v) => (v ? v.replace(/\s+/g, "") : v);
const LINE_CHANNEL_SECRET = strip(process.env.LINE_CHANNEL_SECRET);
const LINE_CHANNEL_ACCESS_TOKEN = strip(process.env.LINE_CHANNEL_ACCESS_TOKEN);
const GEMINI_API_KEY = strip(process.env.GEMINI_API_KEY);
const LLM_API_KEY = strip(process.env.LLM_API_KEY);

const MIN_ADMIN_PASSWORD = 8;
const adminEnabled = Boolean(ADMIN_PASSWORD && ADMIN_PASSWORD.length >= MIN_ADMIN_PASSWORD);
const adminReason = !ADMIN_PASSWORD
  ? "ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ใน Railway Variables"
  : !adminEnabled
    ? `ADMIN_PASSWORD สั้นเกินไป กรุณาตั้งอย่างน้อย ${MIN_ADMIN_PASSWORD} ตัวอักษร`
    : "";

const hasLLM = Boolean(LLM_BASE_URL && LLM_API_KEY); // OpenAI-compatible gateway
const hasGemini = Boolean(GEMINI_API_KEY);
const llmConfigured = hasLLM || hasGemini;

// The admin's choice (saved on the volume) wins when that provider is configured;
// otherwise fall back: LLM first, then Gemini
function activeProvider() {
  const saved = store.getSettings().aiProvider;
  if (saved === "gemini" && hasGemini) return "gemini";
  if (saved === "llm" && hasLLM) return "llm";
  return hasLLM ? "llm" : hasGemini ? "gemini" : "none";
}

// Don't exit on missing config: keep the server up so Railway's health check
// passes and /health can report what is missing.
const missingEnv = Object.entries({
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (adminReason) missingEnv.push(adminReason);
if (!llmConfigured) missingEnv.push("LLM_BASE_URL+LLM_API_KEY (or GEMINI_API_KEY)");
if (missingEnv.length) console.error(`Missing env vars: ${missingEnv.join(", ")}`);
console.log(`AI mode: ${activeProvider()} (llm configured=${hasLLM}, gemini configured=${hasGemini})`);

const NOT_FOUND_REPLY = "ยังไม่มีข้อมูลนี้ค่ะ";
const MAX_CONTEXT_CHARS = 300000;

const SYSTEM_PROMPT = `คุณคือเจ้าหน้าที่ฝ่ายบริการลูกค้าของเว็บเกมออนไลน์ มีหน้าที่ตอบคำถามเกี่ยวกับเกม โปรโมชั่น และเงื่อนไขต่างๆ
- ใช้ข้อมูลที่ให้มาเพื่อตอบคำถามของผู้ใช้เท่านั้น
- สรุปคำตอบให้กระชับ เข้าใจง่าย และเป็นภาษาพูดที่เป็นธรรมชาติ
- เมื่อตอบเรื่องโปรโมชั่น ให้บอกเงื่อนไขสำคัญตามข้อมูลให้ครบ เช่น ยอดเครดิต ยอดเทิร์นที่ต้องทำ ยอดถอนสูงสุด ระยะเวลา และข้อจำกัด ห้ามตัดเงื่อนไขออกหรือแต่งตัวเลขเอง
- ห้ามรับประกันผลแพ้ชนะหรือการได้กำไร
- หากข้อมูลที่ให้มาไม่เกี่ยวข้องกับคำถาม ให้ตอบว่า "${NOT_FOUND_REPLY}"
- ห้ามคิดคำตอบขึ้นมาเองหรือใช้ความรู้ภายนอกที่ไม่อยู่ในข้อมูลที่ให้มา`;

// Extra rule appended only when at least one topic has images, so replies stay identical otherwise
const IMAGE_RULE = `
- แต่ละหัวข้อมีเลขกำกับ เช่น #3 ท้ายคำตอบให้ขึ้นบรรทัดใหม่แล้วใส่ [[ใช้หัวข้อ: เลขหัวข้อที่ใช้ตอบ คั่นด้วยจุลภาค]] เช่น [[ใช้หัวข้อ: 1,3]] ถ้าไม่ได้ใช้หัวข้อใดเลยให้ใส่ [[ใช้หัวข้อ: -]]`;
const systemPrompt = (hasImages) => SYSTEM_PROMPT + (hasImages ? IMAGE_RULE : "");

// ---------- LLM (one call path shared by the LINE bot and the admin "AI write" helper) ----------

async function completeGemini(system, user, { temperature, timeoutMs }) {
  const res = await fetch(
    `${process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com"}/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
}

// OpenAI-compatible /chat/completions (works with most LLM gateways)
async function completeOpenAI(system, user, { temperature, timeoutMs }) {
  const res = await fetch(`${LLM_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "") // some reasoning models inline their thoughts
    .trim();
}

const complete = (system, user, opts) => {
  const p = activeProvider();
  if (p === "none") throw new Error("ยังไม่ได้ตั้งค่า LLM");
  return (p === "gemini" ? completeGemini : completeOpenAI)(system, user, { temperature: 0.2, timeoutMs: 25000, ...opts });
};

// Employee question -> answer from the company knowledge
async function askLLM(question, knowledge, system) {
  const answer = await complete(system, `ข้อมูลของเว็บ:\n"""\n${knowledge}\n"""\n\nคำถามจากลูกค้า: ${question}`);
  return answer || NOT_FOUND_REPLY;
}

// ---------- Admin "AI write": draft a topic's text from the admin's notes ----------

const DRAFT_PROMPT = `คุณเป็นผู้ช่วยร่างข้อความข้อมูลเกมและโปรโมชั่นของเว็บเกมออนไลน์เป็นภาษาไทย เพื่อให้ผู้ดูแลตรวจทานก่อนนำไปใช้ตอบลูกค้า
- เขียนจากข้อมูลที่ผู้ใช้ให้เท่านั้น ห้ามแต่งตัวเลข ยอดเครดิต ยอดเทิร์น ยอดถอน ระยะเวลา เงื่อนไข หรือเกมที่ร่วมรายการที่ผู้ใช้ไม่ได้ระบุ
- หากข้อมูลที่จำเป็นขาดไป ให้ใส่ตัวแทนในรูปแบบ [ระบุ: ...] เพื่อให้ผู้ดูแลกรอกเอง
- ถ้าเป็นโปรโมชั่น ให้เรียงเงื่อนไขให้ครบเท่าที่มีข้อมูล เช่น ยอดเครดิตที่ได้รับ ยอดเทิร์นที่ต้องทำ ยอดถอนสูงสุด ระยะเวลา เกมที่ร่วมรายการ และข้อจำกัด
- ห้ามรับประกันผลแพ้ชนะหรือการได้กำไร และห้ามใช้ถ้อยคำโฆษณาเกินจริง
- ใช้ภาษาที่ชัดเจน สุภาพ กระชับ แบ่งย่อหน้าตามความเหมาะสม และใช้ "- " นำหน้าบรรทัดสำหรับรายการ
- ตอบเฉพาะเนื้อหาที่นำไปใช้ได้เลย ไม่ต้องมีคำอธิบายเพิ่มหรือหัวข้อซ้ำ ห้ามใช้ markdown (เช่น ** หรือ #) และห้ามใช้อีโมจิ`;

function cleanDraft(text) {
  return text
    .replace(/^```[a-z]*\n?|```$/gim, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .trim();
}

async function draftTopic({ instruction, category, title, current }) {
  const parts = [];
  if (category) parts.push(`หมวดหมู่: ${category}`);
  if (title) parts.push(`หัวข้อ: ${title}`);
  if (current) parts.push(`เนื้อหาเดิม (ใช้เป็นฐานและปรับปรุงตามคำสั่ง):\n"""\n${current}\n"""`);
  parts.push(`ข้อมูล/คำสั่งจากผู้ดูแล:\n"""\n${instruction}\n"""`);
  const out = cleanDraft(await complete(DRAFT_PROMPT, parts.join("\n\n"), { temperature: 0.4, timeoutMs: 45000 }));
  if (!out) throw new Error("AI ไม่ได้ส่งข้อความกลับมา ลองใหม่อีกครั้ง");
  return out.slice(0, 20000);
}

// Split "[[ใช้หัวข้อ: 1,3]]" off the answer and collect those topics' images
const USED_TAG = /\[\[\s*ใช้หัวข้อ\s*:([^\]]*)\]\]/g;
function splitAnswer(raw, topics) {
  const used = new Set();
  for (const m of raw.matchAll(USED_TAG)) (m[1].match(/\d+/g) || []).forEach((n) => used.add(Number(n)));
  const text = raw.replace(USED_TAG, "").trim();
  const files = [...used].sort((a, b) => a - b).flatMap((n) => topics[n - 1]?.images || []);
  return { text, files: [...new Set(files)] };
}

// ---------- LINE ----------

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const LINE_API = process.env.LINE_API_BASE || "https://api.line.me";
const MAX_REPLY_IMAGES = 4; // LINE allows 5 messages per reply: 1 text + 4 images

// What happened since the server started, shown on the admin "LINE status" page
// so a silent bot can be diagnosed without reading Railway logs (kept in memory)
const serverStartedAt = Date.now();
const lineStats = { received: 0, lastReceivedAt: null, badSignature: 0, lastBadSignatureAt: null, lastReply: null, lastAiError: null };
const scrubSecrets = (s) =>
  [LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LLM_API_KEY, GEMINI_API_KEY, ADMIN_PASSWORD]
    .filter((k) => k && k.length >= 8) // real secrets are long; skip short values that would mangle ordinary words
    .reduce((t, k) => t.split(k).join("***"), String(s).replace(/\s+/g, " "))
    .slice(0, 300);

async function reply(replyToken, text, imageUrls = []) {
  const messages = [{ type: "text", text: text.slice(0, 5000) }];
  for (const url of imageUrls.slice(0, MAX_REPLY_IMAGES)) {
    messages.push({ type: "image", originalContentUrl: url, previewImageUrl: url });
  }
  let res;
  try {
    res = await fetch(`${LINE_API}/v2/bot/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    lineStats.lastReply = { at: Date.now(), ok: false, status: 0, detail: scrubSecrets(err.message) };
    throw err;
  }
  const body = res.ok ? "" : await res.text();
  lineStats.lastReply = { at: Date.now(), ok: res.ok, status: res.status, detail: scrubSecrets(body) };
  if (!res.ok) console.error("LINE reply failed:", res.status, body);
}

async function handleEvent(event, baseUrl) {
  if (event.type !== "message" || event.message.type !== "text") return;
  try {
    const k = store.toKnowledge(MAX_CONTEXT_CHARS);
    if (!k.text) return reply(event.replyToken, NOT_FOUND_REPLY);
    const raw = await askLLM(event.message.text, k.text, systemPrompt(k.hasImages));
    const { text, files } = splitAnswer(raw, k.topics);
    const images = text.includes(NOT_FOUND_REPLY) ? [] : files.map((f) => `${baseUrl}/uploads/${f}`);
    await reply(event.replyToken, text || NOT_FOUND_REPLY, images);
  } catch (err) {
    console.error("handleEvent error:", err);
    lineStats.lastAiError = { at: Date.now(), message: scrubSecrets(err.message) };
    await reply(event.replyToken, "ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ");
  }
}

// ---------- Admin auth (signed cookie) ----------

const SESSION_MS = 12 * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update(value).digest("hex");
}

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : "";
}

function isAdmin(req) {
  if (!adminEnabled) return false;
  const [exp, sig] = readCookie(req, "hr_session").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  next();
}

const attempts = new Map(); // ip -> { count, resetAt }
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) return false;
  return a.count >= 10;
}
function recordFailure(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else a.count += 1;
}

// ---------- App ----------

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.get("/health", (_req, res) => res.json({ ok: true, provider: activeProvider(), missingEnv, storage: store.info() }));

// LINE webhook (needs the raw body for signature verification)
app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN || !llmConfigured) {
    return res.status(503).send("Server not configured");
  }
  if (!verifySignature(req.body, req.get("x-line-signature"))) {
    lineStats.badSignature += 1;
    lineStats.lastBadSignatureAt = Date.now();
    return res.status(401).send("Invalid signature");
  }
  lineStats.received += 1;
  lineStats.lastReceivedAt = Date.now();
  res.sendStatus(200); // ack fast; process asynchronously
  let events = [];
  try {
    events = JSON.parse(req.body.toString("utf8")).events || [];
  } catch {
    return;
  }
  const baseUrl = (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  // A failed reply must never become an unhandled rejection (that would crash the process)
  events.forEach((e) => handleEvent(e, baseUrl).catch((err) => console.error("reply failed after error:", err.message)));
});

const json = express.json({ limit: "2mb" });

// Admin API (rules are not publicly readable; employees ask through LINE)
app.get("/api/admin/rules", requireAdmin, (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(store.get());
});

app.get("/api/admin/status", (req, res) =>
  res.json({
    enabled: adminEnabled,
    reason: adminReason,
    loggedIn: isAdmin(req),
    persistent: store.info().persistent,
  })
);

app.post("/api/admin/login", json, (req, res) => {
  if (!adminEnabled) return res.status(503).json({ error: adminReason });
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: "ลองหลายครั้งเกินไป กรุณารอ 15 นาที" });
  if (!safeEqual(req.body?.password ?? "", ADMIN_PASSWORD)) {
    recordFailure(req.ip);
    return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  }
  const exp = String(Date.now() + SESSION_MS);
  res.cookie("hr_session", `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: SESSION_MS,
    path: "/",
  });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.clearCookie("hr_session", { path: "/" });
  res.json({ ok: true });
});

// Topics are saved one at a time (add/update, delete, reorder)
const respond = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    console.error("rules update failed:", err.message);
    res.status(400).json({ error: err.message || "บันทึกไม่สำเร็จ" });
  }
};

// Images: the browser shrinks them to JPEG first; the server checks the real file type
app.post("/api/admin/image", requireAdmin, express.raw({ type: ["image/jpeg", "image/png"], limit: "3mb" }), (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error("ไม่พบไฟล์รูป");
    const file = store.saveImage(req.body);
    res.json({ file });
  } catch (err) {
    res.status(400).json({ error: err.message || "อัปโหลดไม่สำเร็จ" });
  }
});
app.delete("/api/admin/image/:file", requireAdmin, (req, res) => {
  store.discardUploaded(req.params.file);
  res.json({ ok: true });
});

// LINE connection status: lets the admin see why the bot is silent
app.get("/api/admin/line", requireAdmin, (req, res) => {
  const base = (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  res.json({
    webhookUrl: `${base}/webhook`,
    secretSet: Boolean(LINE_CHANNEL_SECRET),
    tokenSet: Boolean(LINE_CHANNEL_ACCESS_TOKEN),
    // Shape checks only (the values themselves are never sent): a Channel secret is 32 hex characters,
    // a long-lived Channel access token is a long base64-like string
    secretFormatOk: /^[0-9a-f]{32}$/i.test((LINE_CHANNEL_SECRET || "").trim()),
    tokenFormatOk: (LINE_CHANNEL_ACCESS_TOKEN || "").trim().length >= 100,
    secretHasSpaces: /\s/.test(process.env.LINE_CHANNEL_SECRET || ""),
    tokenHasSpaces: /\s/.test(process.env.LINE_CHANNEL_ACCESS_TOKEN || ""),
    topics: store.get().sections.length,
    startedAt: serverStartedAt,
    stats: lineStats,
  });
});

// Asks LINE who this token belongs to: proves the Channel access token is valid
app.post("/api/admin/line/test-token", requireAdmin, async (_req, res) => {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return res.status(503).json({ error: "ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN" });
  try {
    const r = await fetch(`${LINE_API}/v2/bot/info`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    if (!r.ok) {
      return res.status(502).json({ error: "LINE ปฏิเสธ Channel access token", detail: scrubSecrets(`HTTP ${r.status}: ${text}`) });
    }
    const info = JSON.parse(text);
    res.json({ ok: true, displayName: info.displayName || "", basicId: info.basicId || "" });
  } catch (err) {
    res.status(502).json({ error: "ติดต่อ LINE ไม่ได้", detail: scrubSecrets(err.message) });
  }
});

// AI mode (Gemini or LLM): which provider the bot and the AI writer use. Admin only.
const aiInfo = () => ({
  active: activeProvider(),
  available: { llm: hasLLM, gemini: hasGemini },
  models: { llm: LLM_MODEL, gemini: GEMINI_MODEL },
});

// Calls that spend LLM quota are capped per IP so a stolen session cannot burn it
const aiUse = new Map(); // ip -> { count, resetAt }
const AI_LIMIT_PER_HOUR = 30;
function aiBudgetLeft(ip) {
  const u = aiUse.get(ip);
  return !u || u.resetAt <= Date.now() || u.count < AI_LIMIT_PER_HOUR;
}
function aiSpend(ip) {
  const now = Date.now();
  const u = aiUse.get(ip);
  if (!u || u.resetAt <= now) aiUse.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
  else u.count += 1;
}

app.get("/api/admin/ai", requireAdmin, (_req, res) => res.json(aiInfo()));

app.post("/api/admin/ai", requireAdmin, json, (req, res) => {
  const p = req.body?.provider;
  if (p !== "llm" && p !== "gemini") return res.status(400).json({ error: "โหมดไม่ถูกต้อง" });
  if ((p === "llm" && !hasLLM) || (p === "gemini" && !hasGemini)) {
    return res.status(400).json({ error: p === "llm" ? "ยังไม่ได้ตั้ง LLM_BASE_URL และ LLM_API_KEY ใน Railway Variables" : "ยังไม่ได้ตั้ง GEMINI_API_KEY ใน Railway Variables" });
  }
  try {
    store.setSetting("aiProvider", p);
    res.json(aiInfo());
  } catch (err) {
    console.error("save ai mode failed:", err.message);
    res.status(500).json({ error: "บันทึกโหมด AI ไม่สำเร็จ" });
  }
});

// Quick check that the selected mode answers (key, URL and model name are all valid)
app.post("/api/admin/ai/test", requireAdmin, async (req, res) => {
  if (!llmConfigured) return res.status(503).json({ error: "ยังไม่ได้ตั้งค่า LLM" });
  if (!aiBudgetLeft(req.ip)) return res.status(429).json({ error: "ใช้ AI บ่อยเกินไป กรุณารอสักครู่" });
  aiSpend(req.ip);
  const started = Date.now();
  try {
    const reply = await complete("ตอบสั้นๆ เป็นภาษาไทย", "ตอบว่า พร้อมใช้งาน", { timeoutMs: 40000 });
    res.json({ ok: true, ms: Date.now() - started, reply: reply.slice(0, 80) });
  } catch (err) {
    console.error("ai test failed:", err.message);
    // The admin sees the real reason (HTTP status / provider message / timeout), with keys removed
    const reason =
      err.name === "TimeoutError" ? "ไม่ตอบกลับภายใน 40 วินาที (timeout)" : `${err.message}${err.cause?.code ? ` [${err.cause.code}]` : ""}`;
    const detail = scrubSecrets(reason);
    res.status(502).json({ error: "เชื่อมต่อ AI ไม่สำเร็จ", detail });
  }
});

// AI draft: admin only
app.post("/api/admin/generate", requireAdmin, json, async (req, res) => {
  if (!llmConfigured) return res.status(503).json({ error: "ยังไม่ได้ตั้งค่า LLM (LLM_BASE_URL + LLM_API_KEY หรือ GEMINI_API_KEY)" });
  if (!aiBudgetLeft(req.ip)) return res.status(429).json({ error: "ใช้ AI ช่วยเขียนบ่อยเกินไป กรุณารอสักครู่" });
  const instruction = String(req.body?.instruction || "").trim().slice(0, 4000);
  if (!instruction) return res.status(400).json({ error: "กรุณาบอก AI ว่าต้องการให้เขียนเรื่องอะไร" });
  aiSpend(req.ip);
  try {
    const text = await draftTopic({
      instruction,
      category: String(req.body?.category || "").trim().slice(0, 80),
      title: String(req.body?.title || "").trim().slice(0, 200),
      current: req.body?.useCurrent ? String(req.body?.current || "").trim().slice(0, 20000) : "",
    });
    res.json({ text });
  } catch (err) {
    console.error("generate failed:", err.message);
    res.status(502).json({ error: err.message.startsWith("AI ") ? err.message : "เรียก AI ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  }
});

app.post("/api/admin/section", requireAdmin, json, (req, res) => respond(res, () => store.upsert(req.body)));
app.delete("/api/admin/section/:id", requireAdmin, (req, res) => respond(res, () => store.remove(req.params.id)));
app.post("/api/admin/section/:id/move", requireAdmin, json, (req, res) =>
  respond(res, () => store.move(req.params.id, Number(req.body?.delta) || 0))
);

// Unguessable file names; LINE fetches these when the bot replies with a picture
app.use(
  "/uploads",
  express.static(store.UPLOAD_DIR, {
    index: false,
    maxAge: "30d",
    immutable: true,
    setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
  })
);

app.get("/", (_req, res) => res.redirect("/admin"));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const tooBig = err.type === "entity.too.large";
  res.status(tooBig ? 413 : err.status || 500).json({ error: tooBig ? "ไฟล์ใหญ่เกินไป" : "เกิดข้อผิดพลาด" });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
