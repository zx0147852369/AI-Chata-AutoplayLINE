# HR LINE Chatbot (Gemini)

Webhook สำหรับ LINE Messaging API ตอบคำถามพนักงานเรื่องกฎเกณฑ์บริษัท โดยดึงข้อมูลจากเว็บ แล้วให้ Gemini สรุปคำตอบ
ถ้าไม่มีข้อมูลที่เกี่ยวข้อง จะตอบว่า "ยังไม่มีข้อมูลนี้ค่ะ"

## Deploy บน Railway

1. Push โปรเจกต์ขึ้น GitHub
2. Railway → New Project → Deploy from GitHub repo
3. ตั้ง Variables (ดู `.env.example`):
   - `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` (LINE Developers Console)
   - `GEMINI_API_KEY` (Google AI Studio)
   - `DATA_SOURCE_URLS` — URL ของหน้าเว็บกฎบริษัท (หลายอันคั่นด้วย `,`)
4. Settings → Networking → Generate Domain
5. LINE Developers → Messaging API → Webhook URL = `https://<domain>/webhook` → กด Verify แล้วเปิด "Use webhook"
   (ปิด Auto-reply messages ใน LINE Official Account Manager ด้วย)

## หมายเหตุ

- เนื้อหาเว็บถูก cache ตาม `CACHE_TTL_MINUTES` (ค่าเริ่มต้น 30 นาที)
- หน้าเว็บต้องเปิดดูได้โดยไม่ต้องล็อกอิน และเนื้อหาควรอยู่ใน HTML (ไม่ใช่โหลดด้วย JavaScript ภายหลัง)
- ทดสอบในเครื่อง: `npm install && npm start` (ตั้ง env ก่อน)
