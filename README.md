# HR LINE Chatbot (Gemini)

Webhook สำหรับ LINE Messaging API ตอบคำถามพนักงานเรื่องกฎเกณฑ์บริษัท โดยอ่านข้อมูลจากไฟล์ในโฟลเดอร์ `knowledge/` แล้วให้ Gemini สรุปคำตอบ
ถ้าไม่มีข้อมูลที่เกี่ยวข้อง จะตอบว่า "ยังไม่มีข้อมูลนี้ค่ะ"

## ใส่ข้อมูลกฎบริษัท

แก้ [knowledge/hr-rules.md](knowledge/hr-rules.md) หรือเพิ่มไฟล์ `.md` / `.txt` ใหม่ในโฟลเดอร์ `knowledge/` แล้ว push ขึ้น GitHub
Railway จะ deploy ใหม่เอง (ข้อมูลถูกโหลดตอนเซิร์ฟเวอร์เริ่มทำงาน)

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
