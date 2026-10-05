# HR Handbook + LINE Chatbot (Gemini)

เว็บไซต์คู่มือพนักงานและบอท LINE ใน service เดียวกัน

- `/` หน้าเว็บสาธารณะ พนักงานค้นหา/กรองกฎเกณฑ์บริษัทได้
- `/admin` หน้าสำหรับ HR เข้าสู่ระบบด้วยรหัสผ่านเพื่อเพิ่ม/แก้ไข/ลบ/เรียงลำดับหัวข้อ
- `/webhook` Webhook ของ LINE Messaging API บอทอ่านข้อมูลชุดเดียวกับหน้าเว็บโดยตรง บันทึกแล้วมีผลทันที
  ถ้าไม่พบข้อมูลที่เกี่ยวข้อง จะตอบว่า "ยังไม่มีข้อมูลนี้ค่ะ"
- `/health` ตรวจสถานะและรายการ env ที่ยังขาด

## Deploy บน Railway

1. Push โปรเจกต์ขึ้น GitHub แล้ว Railway → New Project → Deploy from GitHub repo
2. ตั้ง Variables (ดู `.env.example`):
   - `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` จาก LINE Developers Console
   - `GEMINI_API_KEY` จาก Google AI Studio
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

เปิด http://localhost:3000 (ข้อมูลเก็บที่ `./data/rules.json`)
