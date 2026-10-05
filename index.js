const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const {
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  GEMINI_API_KEY,
  GEMINI_MODEL = "gemini-2.5-flash",
  PORT = 3000,
} = process.env;

// Don't exit on missing config: keep the server up so Railway's health check
// passes and "/" can report what is missing.
const missingEnv = Object.entries({
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  GEMINI_API_KEY,
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

// ---------- Data source (local files in ./knowledge, loaded at startup) ----------

const KNOWLEDGE_DIR = path.join(__dirname, "knowledge");

function loadKnowledge() {
  try {
    return fs
      .readdirSync(KNOWLEDGE_DIR)
      .filter((f) => /\.(md|txt)$/i.test(f))
      .sort()
      .map((f) => `### ${f}\n${fs.readFileSync(path.join(KNOWLEDGE_DIR, f), "utf8")}`)
      .join("\n\n")
      .slice(0, MAX_CONTEXT_CHARS);
  } catch (err) {
    console.error("Failed to read knowledge dir:", err.message);
    return "";
  }
}

const knowledge = loadKnowledge();
if (!knowledge) console.error("No knowledge loaded: add .md/.txt files to ./knowledge");

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
    if (!knowledge) return reply(event.replyToken, NOT_FOUND_REPLY);
    const answer = await askGemini(event.message.text, knowledge);
    await reply(event.replyToken, answer);
  } catch (err) {
    console.error("handleEvent error:", err);
    await reply(event.replyToken, "ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ");
  }
}

const app = express();

app.get("/", (_req, res) =>
  res.send(
    missingEnv.length
      ? `HR LINE chatbot is up, but missing env vars: ${missingEnv.join(", ")}`
      : "HR LINE chatbot is running"
  )
);

app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  if (missingEnv.length) return res.status(503).send("Server not configured");
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

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
