const crypto = require("crypto");
const express = require("express");

const {
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  GEMINI_API_KEY,
  DATA_SOURCE_URLS, // comma-separated list of web pages / published docs
  GEMINI_MODEL = "gemini-2.5-flash",
  CACHE_TTL_MINUTES = "30",
  PORT = 3000,
} = process.env;

for (const [k, v] of Object.entries({
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  GEMINI_API_KEY,
  DATA_SOURCE_URLS,
})) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

const NOT_FOUND_REPLY = "ยังไม่มีข้อมูลนี้ค่ะ";
const MAX_CONTEXT_CHARS = 300000;

const SYSTEM_PROMPT = `คุณคือพนักงานตำแหน่ง HR ของบริษัท มีหน้าที่ในการตอบคำถามเกี่ยวกับกฏต่างๆของบริษัท
- ใช้ข้อมูลที่ให้มาเพื่อตอบคำถามของผู้ใช้เท่านั้น
- สรุปคำตอบให้กระชับ เข้าใจง่าย และเป็นภาษาพูดที่เป็นธรรมชาติ
- หากข้อมูลที่ให้มาไม่เกี่ยวข้องกับคำถาม ให้ตอบว่า "${NOT_FOUND_REPLY}"
- ห้ามคิดคำตอบขึ้นมาเองหรือใช้ความรู้ภายนอกที่ไม่อยู่ในข้อมูลที่ให้มา`;

// ---------- Data source (fetched from the web, cached) ----------

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

let cache = { text: "", at: 0 };

async function loadKnowledge() {
  const ttl = Number(CACHE_TTL_MINUTES) * 60 * 1000;
  if (cache.text && Date.now() - cache.at < ttl) return cache.text;

  const urls = DATA_SOURCE_URLS.split(",").map((u) => u.trim()).filter(Boolean);
  const parts = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        const type = res.headers.get("content-type") || "";
        const text = type.includes("html") ? htmlToText(body) : body;
        return `### แหล่งข้อมูล: ${url}\n${text}`;
      } catch (err) {
        console.error(`Failed to fetch ${url}:`, err.message);
        return "";
      }
    })
  );

  const text = parts.filter(Boolean).join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  if (text) cache = { text, at: Date.now() };
  // If refresh failed, fall back to stale cache
  return text || cache.text;
}

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
    const knowledge = await loadKnowledge();
    if (!knowledge) return reply(event.replyToken, NOT_FOUND_REPLY);
    const answer = await askGemini(event.message.text, knowledge);
    await reply(event.replyToken, answer);
  } catch (err) {
    console.error("handleEvent error:", err);
    await reply(event.replyToken, "ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ");
  }
}

const app = express();

app.get("/", (_req, res) => res.send("HR LINE chatbot is running"));

app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
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

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
