# Artwork (Node 24 + Express): ใช้คู่กับ docker-compose.yml ที่มี PostgreSQL 18
FROM node:24-alpine

WORKDIR /app

# ติดตั้งเฉพาะ dependency ที่ใช้รันจริง (sharp มี binary สำเร็จรูปสำหรับ Alpine)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY db ./db
COPY scripts ./scripts

# uploads เป็น volume: สร้างไว้ให้ผู้ใช้ node เป็นเจ้าของก่อน (volume ใหม่จะได้สิทธิ์ตามโฟลเดอร์นี้)
RUN mkdir -p /app/uploads/files /app/uploads/tmp && chown -R node:node /app/uploads
USER node

EXPOSE 3000

# ทุกครั้งที่เริ่ม: ฐานว่างจะถูกตั้งต้นให้ (มี SeedData = ข้อมูลสาธิต · ไม่มี = schema พื้นฐาน + Admin) · ฐานที่มีข้อมูลแล้วไม่ถูกแตะ
CMD ["sh", "-c", "node scripts/db-init.mjs && exec node src/server.js"]
