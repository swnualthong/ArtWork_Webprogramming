# Artwork

เว็บแกลเลอรีงานอาร์ตแบบสมาชิกรายเดือน Node.js 24 + Express 5 + EJS + PostgreSQL 18

## Quick Setup ด้วย Docker (แนะนำ)

ต้องมีแค่ Docker Desktop

```bash
docker compose up -d --build
```

เปิด http://localhost:3000 ครั้งแรกฐานข้อมูลจะถูกตั้งต้นเอง (`scripts/db-init.mjs`) ตามสิ่งที่มีในเครื่อง

ข้อมูลอยู่ใน volume ปิดเปิดใหม่ไม่หาย และฐานที่มีข้อมูลแล้วจะไม่ถูกตั้งต้นซ้ำ

```bash
docker compose up -d --build                 # หลังแก้โค้ด สร้าง image ใหม่ (ข้อมูลเดิมยังอยู่)
docker compose exec app npm run demo:reset   # ล้างกลับเป็นข้อมูลสาธิต (ต้องมี SeedData)
docker compose down                          # ปิด (ใส่ -v ถ้าจะลบข้อมูลทั้งหมด)
```

ตั้งค่าได้ใน `.env` ข้าง `docker-compose.yml`: `APP_PORT`, `DB_PASSWORD`, `SESSION_SECRET`, `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD`, `SEED_DATA_PATH` ค่าเริ่มต้นใช้สำหรับพัฒนาและสาธิตเท่านั้น

## รันเอง (Node 24 + PostgreSQL 18 ที่มีอยู่แล้ว)

```bash
cp .env.example .env     # ใส่ DATABASE_URL, SESSION_SECRET และ ADMIN_* (ใช้เมื่อไม่มี SeedData)
npm install
npm run db:init          # ตั้งต้นฐานว่าง: มี ../SeedData = ข้อมูลสาธิต · ไม่มี = schema พื้นฐาน + Admin
npm start              # http://localhost:3000 รีสตาร์ตเองเมื่อแก้โค้ด
```

- `npm run db:init -- --base` บังคับใช้ schema พื้นฐานแม้มี SeedData
- `npm run demo:reset` ล้างข้อมูลและไฟล์ที่อัปโหลดเดิมทั้งหมด แล้วโหลดข้อมูลสาธิตใหม่ ต้องมี SeedData และไม่ทำงานเมื่อ `NODE_ENV=production`

## บัญชีทดสอบ (ข้อมูลสาธิต)

login ได้ทั้ง username และอีเมล

| Username | รหัสผ่าน | Role |
|---|---|---|
| administrator | `passwordAdmin` | Admin |
| bestart, catsausage, technicalart | `passwordArtist` | Artist |
| bankkb | `passwordMember` | Subscriber |
| stang | `passwordMember` | สมาชิกหมดอายุ (login แล้วกลับเป็น Member) |
| tubfah | `passwordMember` | Member มีคำขอสมาชิกรออนุมัติ |
| minviii, nooyimm, fuku | `passwordMember` | Member |

## โครงสร้าง

```
src/        โค้ดเซิร์ฟเวอร์ (routes → controllers → services) และหน้าเว็บ EJS
public/     CSS, JS และรูปประกอบ
db/         schema.sql (ตาราง) และ seed.sql (ข้อมูลสาธิต · ส่วน 0 = ข้อมูลพื้นฐานที่ db:init ใช้)
scripts/    db-init.mjs (ตั้งต้นฐานว่าง) · demo-reset.mjs (ล้างกลับเป็นข้อมูลสาธิต)
```

ศูนย์ควบคุม `/admin` สำหรับ Admin: ผู้ใช้ และ ACL (Access Matrix Role × Permission)
