const crypto = require("crypto");
const path = require("path");
const express = require("express");
const store = require("./store");

const {
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  GEMINI_API_KEY,
  ADMIN_PASSWORD,
  GEMINI_MODEL = "gemini-2.5-flash",
  PORT = 3000,
} = process.env;

// Don't exit on missing config: keep the server up so Railway's health check
// passes and /health can report what is missing.
const missingEnv = Object.entries({
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  GEMINI_API_KEY,
  ADMIN_PASSWORD,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missingEnv.length) console.error(`Missing env vars: ${missingEnv.join(", ")}`);

const NOT_FOUND_REPLY = "ยังไม่มีข้อมูลนี้ค่ะ";
const MAX_CONTEXT_CHARS = 300000;

const SYSTEM_PROMPT = `คุณคือพนักงานตำแหน่ง HR ของบริษัท มีหน้าที่ในการตอบคำถามเกี่ยวกับกฏต่างๆของบริษัท
- ใช้ข้อมูลที่ให้มาเพื่อตอบคำถามของผู้ใช้เท่านั้น
- สรุปคำตอบให้กระชับ เข้าใจง่าย และเป็นภาษาพูดที่เป็นธรรมชาติ
- หากข้อมูลที่ให้มาไม่เกี่ยวข้องกับคำถาม ให้ตอบว่า "${NOT_FOUND_REPLY}"
- ห้ามคิดคำตอบขึ้นมาเองหรือใช้ความรู้ภายนอกที่ไม่อยู่ในข้อมูลที่ให้มา`;

// ---------- Gemini ----------

async function askGemini(question, knowledge) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `ข้อมูลของบริษัท:\n"""\n${knowledge}\n"""\n\nคำถามจากพนักงาน: ${question}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const answer = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join("")
    .trim();
  return answer || NOT_FOUND_REPLY;
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

async function reply(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, 5000) }],
    }),
  });
  if (!res.ok) console.error("LINE reply failed:", res.status, await res.text());
}

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  try {
    const knowledge = store.toKnowledge(MAX_CONTEXT_CHARS);
    if (!knowledge) return reply(event.replyToken, NOT_FOUND_REPLY);
    const answer = await askGemini(event.message.text, knowledge);
    await reply(event.replyToken, answer);
  } catch (err) {
    console.error("handleEvent error:", err);
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
  if (!ADMIN_PASSWORD) return false;
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

app.get("/health", (_req, res) => res.json({ ok: true, missingEnv }));

// LINE webhook (needs the raw body for signature verification)
app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN || !GEMINI_API_KEY) {
    return res.status(503).send("Server not configured");
  }
  if (!verifySignature(req.body, req.get("x-line-signature"))) {
    return res.status(401).send("Invalid signature");
  }
  res.sendStatus(200); // ack fast; process asynchronously
  let events = [];
  try {
    events = JSON.parse(req.body.toString("utf8")).events || [];
  } catch {
    return;
  }
  events.forEach((e) => handleEvent(e));
});

const json = express.json({ limit: "2mb" });

// Public content
app.get("/api/rules", (_req, res) => {
  res.set("Cache-Control", "no-cache");
  res.json(store.get());
});

// Admin API
app.get("/api/admin/status", (req, res) =>
  res.json({
    enabled: Boolean(ADMIN_PASSWORD),
    loggedIn: isAdmin(req),
    persistent: store.persistent,
  })
);

app.post("/api/admin/login", json, (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "ยังไม่ได้ตั้งรหัสผ่านผู้ดูแล (ADMIN_PASSWORD)" });
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

app.put("/api/admin/rules", requireAdmin, json, (req, res) => {
  try {
    res.json(store.save(req.body?.sections));
  } catch (err) {
    console.error("save failed:", err);
    res.status(400).json({ error: err.message || "บันทึกไม่สำเร็จ" });
  }
});

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
