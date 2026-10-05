# HR LINE Chatbot (Gemini)

Webhook สำหรับ LINE Messaging API ตอบคำถามพนักงานเรื่องกฎเกณฑ์บริษัท โดยดึงข้อมูลจากเว็บแล้วให้ Gemini สรุปคำตอบ
ถ้าไม่มีข้อมูลที่เกี่ยวข้อง จะตอบว่า "ยังไม่มีข้อมูลนี้ค่ะ"

## ใส่ข้อมูลกฎบริษัท

เก็บกฎบริษัทไว้บนเว็บ แล้วใส่ URL ใน Railway Variables เป็น `DATA_SOURCE_URLS` (หลายอันคั่นด้วย `,`)
แก้เนื้อหาบนเว็บได้ตลอดโดยไม่ต้อง push โค้ด บอทจะดึงข้อมูลใหม่ทุก `CACHE_TTL_MINUTES` นาที (ค่าเริ่มต้น 5)
ถ้ายังไม่ได้ตั้ง `DATA_SOURCE_URLS` บอทจะตอบว่า "ยังไม่มีข้อมูลนี้ค่ะ"

- หน้าเว็บต้องเปิดดูได้โดยไม่ต้องล็อกอิน และเนื้อหาควรอยู่ใน HTML (ไม่ใช่โหลดด้วย JavaScript ภายหลัง)
- Google Docs: File → Share → Publish to web แล้วใช้ลิงก์ที่ได้

## Deploy บน Railway

1. Push โปรเจกต์ขึ้น GitHub
2. Railway → New Project → Deploy from GitHub repo
3. ตั้ง Variables (ดู `.env.example`):
   - `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` (LINE Developers Console)
   - `GEMINI_API_KEY` (Google AI Studio)
4. Settings → Networking → Generate Domain
5. LINE Developers → Messaging API → Webhook URL = `https://<domain>/webhook` → กด Verify แล้วเปิด "Use webhook"
   (ปิด Auto-reply messages ใน LINE Official Account Manager ด้วย)

ทดสอบในเครื่อง: `npm install && npm start` (ตั้ง env ก่อน)
