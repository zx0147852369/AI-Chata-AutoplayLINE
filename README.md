# HR LINE Chatbot (Gemini) + หน้า Admin

บอท LINE ตอบคำถามพนักงานเรื่องกฎเกณฑ์บริษัท โดย HR แก้เนื้อหาผ่านหน้า Admin (ไม่มีหน้าเว็บสำหรับพนักงาน พนักงานถามผ่าน LINE)

- `/admin` หน้าสำหรับ HR เข้าสู่ระบบด้วยรหัสผ่านเพื่อเพิ่ม/แก้ไข/ลบ/เรียงลำดับหัวข้อ (`/` จะ redirect มาที่นี่)
- `/webhook` Webhook ของ LINE Messaging API บอทอ่านข้อมูลที่บันทึกในหน้า Admin โดยตรง บันทึกแล้วมีผลทันที
  ถ้าไม่พบข้อมูลที่เกี่ยวข้อง จะตอบว่า "ยังไม่มีข้อมูลนี้ค่ะ"
- `/health` ตรวจสถานะและรายการ env ที่ยังขาด

## Deploy บน Railway

1. Push โปรเจกต์ขึ้น GitHub แล้ว Railway → New Project → Deploy from GitHub repo
2. ตั้ง Variables (ดู `.env.example`):
   - `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` จาก LINE Developers Console
   - LLM อย่างใดอย่างหนึ่ง:
     - API แบบ OpenAI-compatible: `LLM_BASE_URL` (เช่น `https://ai.thirx.com/v1`), `LLM_API_KEY`, `LLM_MODEL` (ถ้าตั้ง จะใช้ตัวนี้ก่อน)
     - หรือ Gemini: `GEMINI_API_KEY` จาก Google AI Studio
   - `ADMIN_PASSWORD` รหัสผ่านเข้าหน้า `/admin`
   - `DATA_DIR=/data`
3. **เพิ่ม Volume** (ที่เก็บข้อมูลถาวร): ที่ service กด Add Volume (หรือคลิกขวาบนพื้นที่ canvas → Volume) แล้วตั้ง Mount path เป็น `/data`
   ถ้าไม่มี Volume ข้อมูลที่ HR บันทึกจะหายทุกครั้งที่ deploy ใหม่
4. Settings → Networking → Generate Domain
5. LINE Developers → Messaging API → Webhook URL = `https://<domain>/webhook` → Verify แล้วเปิด "Use webhook"
   (ปิด Auto-reply messages ใน LINE Official Account Manager ด้วย)

## รูปแบบเนื้อหา

ในช่องรายละเอียด ขึ้นบรรทัดใหม่เพื่อแยกย่อหน้า และขึ้นต้นบรรทัดด้วย `- ` เพื่อทำเป็นรายการ

## รันในเครื่อง

```bash
npm install
ADMIN_PASSWORD=xxxx npm start
```

เปิด http://localhost:3000/admin (ข้อมูลเก็บที่ `./data/rules.json`)
