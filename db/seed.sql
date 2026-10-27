-- seed.sql: ข้อมูลสาธิตพร้อมรูปจาก SeedData/
--
-- วิธีที่ง่ายที่สุด (ใน artistProject/):  npm run demo:reset
--   ล้างฐานจาก DATABASE_URL + ล้าง uploads/ แล้วรัน schema.sql + ไฟล์นี้ และคัดลอกรูปจาก ../SeedData ให้ครบในคำสั่งเดียว
--
-- ลำดับการรันเอง (ถ้าไม่ใช้ npm run demo:reset)
--   1) คัดลอกรูปจาก ../SeedData เข้า uploads/files (PowerShell, รันซ้ำได้):
--
--        New-Item -ItemType Directory -Force uploads\files | Out-Null
--        Select-String -Path db\seed.sql -Pattern "^\s+\('([0-9a-f-]{36})', '([^']+)'" | ForEach-Object {
--          $m = $_.Matches[0].Groups
--          Copy-Item -LiteralPath (Join-Path '..\SeedData' $m[2].Value) -Destination "uploads\files\$($m[1].Value)" -Force
--        }
--
--   2) docker exec -i artPostgreSQL18 psql -U swnpostgre -d artist < db/schema.sql
--   3) docker exec -i artPostgreSQL18 psql -U swnpostgre -d artist < db/seed.sql
--      (pgAdmin: เปิดไฟล์นี้ใน Query Tool แล้ว Execute ทั้งไฟล์ครั้งเดียว)
--
--   ห้ามลบ uploads/ หลังขั้นที่ 1 · DB มีข้อมูลอยู่แล้วไฟล์นี้จะหยุดทันที → รัน schema.sql ก่อน
--
-- บัญชี (login ด้วย username หรืออีเมลก็ได้)
--   administrator  passwordAdmin   Admin (Super User)
--   bestart, catsausage, technicalart          passwordArtist  Artist
--   bankkb   passwordMember  Subscriber ใช้งานอยู่ (slip01)
--   stang    passwordMember  เคยเป็นสมาชิก หมดอายุแล้ว (slip02) → login แล้วถูกลดเป็น Member + Log Expire, คลังเบลองานสมาชิก
--   minviii  passwordMember  Member
--   tubfah   passwordMember  Member ส่งสลิปรออนุมัติ (slip03) → อยู่ในคิวคำขอสมาชิก
--   nooyimm  passwordMember  Member เคยถูกปฏิเสธ เพราะแนบไฟล์ที่ไม่ใช่สลิป (slip04)
--   fuku     passwordMember  Member
--
-- ปรับข้อมูล: แก้ VALUES ในแต่ละส่วน · "กี่วันก่อน" นับจากเวลาที่รัน จึงรันวันไหนวันที่ก็สัมพันธ์กันเสมอ
-- เปลี่ยนรูปใน SeedData: ขนาดไฟล์ (size_bytes) ในส่วน 4 ต้องตรงกับไฟล์จริง ไม่งั้นรูปโหลดไม่ขึ้น
--   ดูขนาดด้วย (Get-Item ..\SeedData\<path>).Length · เพิ่มไฟล์ใหม่ใช้ uuid จาก [guid]::NewGuid()
-- ภาพการ์ด (thumbnail) ใช้รูปปกขนาดเต็ม · ระบบจริงย่อเป็น webp ตอนอัปโหลดผ่านเว็บ

BEGIN;

-- กันรันซ้อนบนฐานที่มีข้อมูลอยู่แล้ว
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles) THEN
    RAISE EXCEPTION 'DB มีข้อมูลอยู่แล้ว: รัน db/schema.sql ก่อน แล้วค่อยรัน seed.sql';
  END IF;
END $$;

-- ส่วน 0: Role, Resource, Permission, ACL
-- npm run db:init ใช้ส่วนนี้ (ถึงก่อนหัวข้อ "ส่วน 1") เป็น schema พื้นฐานเมื่อไม่มี SeedData ห้ามเปลี่ยนชื่อหัวข้อสองบรรทัดนี้
INSERT INTO roles (name, description, is_system, is_super_user, is_guest) VALUES
  ('Guest',      'ผู้ที่ยังไม่ login',          true, false, true),
  ('Member',     'Registration user',          true, false, false),
  ('Subscriber', 'Subscription package user',  true, false, false),
  ('Artist',     'employee role',              true, false, false),
  ('Admin',      'Super user',                 true, true,  false);

-- ทรัพยากรที่ป้องกัน (Object ใน Access Matrix · หน้า ACL จัดกลุ่มแถวตาม Resource)
INSERT INTO resources (resource_name, description) VALUES
  ('artwork',      'งานศิลปะ'),
  ('file',         'ไฟล์งานสำหรับดาวน์โหลด'),
  ('comment',      'ความคิดเห็นใต้งาน'),
  ('subscription', 'คำขอสมัครสมาชิกและสลิป'),
  ('library',      'คลังงานที่ดาวน์โหลดแล้ว'),
  ('profile',      'โปรไฟล์และบัญชีของตน'),
  ('log',          'บันทึกการใช้งาน');

-- Permission ทั้ง 17 ตัวที่ Code ตรวจอยู่จริง (src/config/permissionCatalog.js) แสดงเป็น resource.action
INSERT INTO permissions (resource_id, action, description)
SELECT r.resource_id, p.action, p.description
FROM (VALUES
  ( 1, 'artwork',      'read',     'ดูงาน ค้นหา และหน้าโปรไฟล์ศิลปิน'),
  ( 2, 'artwork',      'create',   'ลงงานใหม่พร้อมรูป'),
  ( 3, 'artwork',      'update',   'แก้ไขงานและรูปของตน (OWN-1)'),
  ( 4, 'artwork',      'delete',   'ลบงานของตน (OWN-1)'),
  ( 5, 'artwork',      'like',     'กดถูกใจงาน (หลังดาวน์โหลด)'),
  ( 6, 'file',         'download', 'ดาวน์โหลดและดูภาพชัดของงานสมาชิก (งานฟรีแค่ login)'),
  ( 7, 'comment',      'create',   'แสดงความคิดเห็น'),
  ( 8, 'comment',      'delete',   'ลบความคิดเห็นของตน (OWN-5)'),
  ( 9, 'comment',      'moderate', 'ลบความคิดเห็นของทุกคน'),
  (10, 'subscription', 'read',     'ดูสถานะและคำขอสมาชิกของตน (OWN-2)'),
  (11, 'subscription', 'create',   'ส่งคำขอสมัครสมาชิกพร้อมสลิป'),
  (12, 'subscription', 'review',   'ดูคิวคำขอสมาชิกและสลิปของทุกคน'),
  (13, 'subscription', 'approve',  'อนุมัติ/ปฏิเสธคำขอสมาชิก'),
  (14, 'library',      'read',     'ดูคลังงานที่ดาวน์โหลดของตน (OWN-3)'),
  (15, 'profile',      'read',     'ดูโปรไฟล์และข้อมูลบัญชีของตน (OWN-4)'),
  (16, 'profile',      'update',   'แก้โปรไฟล์ รหัสผ่าน และรูปโปรไฟล์ของตน (OWN-4)'),
  (17, 'log',          'read',     'ดูและกรอง Log')
) AS p (sort_order, resource_name, action, description)
JOIN resources r ON r.resource_name = p.resource_name
ORDER BY p.sort_order;

-- ACL เริ่มต้น (แปลงจาก Access Matrix): หนึ่งช่องที่มีสิทธิ์ = หนึ่งแถว
-- แต่ละ Role ได้เฉพาะแถวของตัวเอง (ไม่มีการสืบทอด) · Admin ผ่านทุกสิทธิ์จึงไม่ต้องมีแถว
-- comment.moderate, subscription.review/approve, log.read ยังไม่ให้ Role ใด (ไว้สาธิตการมอบสิทธิ์ผ่านหน้า ACL)
INSERT INTO acl (role_id, permission_id)
SELECT ro.role_id, p.permission_id
FROM (VALUES
  ( 1, 'Guest',      'artwork', 'read'),
  ( 2, 'Member',     'artwork', 'read'),
  ( 3, 'Member',     'artwork', 'like'),
  ( 4, 'Member',     'comment', 'create'),
  ( 5, 'Member',     'comment', 'delete'),
  ( 6, 'Member',     'subscription', 'read'),
  ( 7, 'Member',     'subscription', 'create'),
  ( 8, 'Member',     'library', 'read'),
  ( 9, 'Member',     'profile', 'read'),
  (10, 'Member',     'profile', 'update'),
  (11, 'Subscriber', 'artwork', 'read'),
  (12, 'Subscriber', 'artwork', 'like'),
  (13, 'Subscriber', 'file', 'download'),
  (14, 'Subscriber', 'comment', 'create'),
  (15, 'Subscriber', 'comment', 'delete'),
  (16, 'Subscriber', 'subscription', 'read'),
  (17, 'Subscriber', 'subscription', 'create'),
  (18, 'Subscriber', 'library', 'read'),
  (19, 'Subscriber', 'profile', 'read'),
  (20, 'Subscriber', 'profile', 'update'),
  (21, 'Artist',     'artwork', 'read'),
  (22, 'Artist',     'artwork', 'create'),
  (23, 'Artist',     'artwork', 'update'),
  (24, 'Artist',     'artwork', 'delete'),
  (25, 'Artist',     'artwork', 'like'),
  (26, 'Artist',     'file', 'download'),
  (27, 'Artist',     'comment', 'create'),
  (28, 'Artist',     'comment', 'delete'),
  (29, 'Artist',     'library', 'read'),
  (30, 'Artist',     'profile', 'read'),
  (31, 'Artist',     'profile', 'update')
) AS grant_row (sort_order, role_name, resource_name, action)
JOIN roles ro ON ro.name = grant_row.role_name
JOIN resources re ON re.resource_name = grant_row.resource_name
JOIN permissions p ON p.resource_id = re.resource_id AND p.action = grant_row.action
ORDER BY grant_row.sort_order;

-- แท็กพื้นฐาน
-- แสดงเป็นแท็กแนะนำตอนลงงาน แท็กใหม่ที่ผู้ใช้พิมพ์เองจะถูกเพิ่มเข้าตารางนี้และแนะนำให้คนอื่นต่อ (เรียงตามจำนวนงานที่ใช้)
INSERT INTO tags (name) VALUES
  ('illustration'), ('digital'), ('painting'), ('watercolor'), ('character'), ('anime'),
  ('landscape'), ('portrait'), ('pixel'), ('3d'), ('logo'), ('vector'), ('concept'), ('sketch');
INSERT INTO tags (name) VALUES ('game'), ('meme'), ('cat'), ('sticker'), ('ai'), ('car') ON CONFLICT (name) DO NOTHING;

-- ส่วน 1: บัญชี
-- รหัสผ่านเก็บเป็น bcrypt hash cost 12: passwordAdmin / passwordArtist / passwordMember
INSERT INTO users (email, username, password_hash, display_name, bio, role_id, created_at, updated_at)
SELECT a.email, a.username, a.password_hash, a.display_name, a.bio, r.role_id,
       now() - a.days_ago * interval '1 day', now() - a.days_ago * interval '1 day'
FROM (VALUES
  ('admin@artmail.com', 'administrator', '$2b$12$Z8kd777dRAazQBDRTR8S6eh0qH.6HvwmaulEmTSYlS956k2eAmI8K', 'Sorrawit Nualthong', 'hello I am administrator!', 'Admin', 200),
  ('artist_ts@artmail.com', 'bestart', '$2b$12$/ZIBJNqAsN6wTlvv/mOSj.GgNDTQZkRt6TfDi0bvOYa9XCmcpxs4y', 'Thanawat Sathimanee', 'Anime & Game art', 'Artist', 160),
  ('artist_cs@artmail.com', 'catsausage', '$2b$12$/ZIBJNqAsN6wTlvv/mOSj.GgNDTQZkRt6TfDi0bvOYa9XCmcpxs4y', 'Cat Sausage Studio', 'Follow me: https://www.youtube.com/channel/UCyMip3BlR8kLb3Yu2DZTiSw', 'Artist', 140),
  ('artist_tb@artmail.com', 'technicalart', '$2b$12$/ZIBJNqAsN6wTlvv/mOSj.GgNDTQZkRt6TfDi0bvOYa9XCmcpxs4y', 'TechnicalBoy Artlab', 'free art no license', 'Artist', 100),
  ('krittanai@gmail.com', 'bankkb', '$2b$12$aTDuUZ4cRB87x4RCVKq1OelH8.DhFdyoDpmYn1lR2GT1wZkM4U9WW', 'krittanaiKB', '3rd years Engineer student at KMITL', 'Subscriber', 90),
  ('stang123@gmail.com', 'stang', '$2b$12$aTDuUZ4cRB87x4RCVKq1OelH8.DhFdyoDpmYn1lR2GT1wZkM4U9WW', 'StangFin', 'no bio', 'Subscriber', 85),
  ('barbatos@gmail.com', 'minviii', '$2b$12$aTDuUZ4cRB87x4RCVKq1OelH8.DhFdyoDpmYn1lR2GT1wZkM4U9WW', 'BarbatosVIII', 'not thing here', 'Member', 60),
  ('tub@gmail.com', 'tubfah', '$2b$12$aTDuUZ4cRB87x4RCVKq1OelH8.DhFdyoDpmYn1lR2GT1wZkM4U9WW', 'TubHH', 'nobio', 'Member', 20),
  ('mameow@gmail.com', 'nooyimm', '$2b$12$aTDuUZ4cRB87x4RCVKq1OelH8.DhFdyoDpmYn1lR2GT1wZkM4U9WW', 'มะเมี๊ยวซ์..', 'Thank you for teaching me that the most valuable person in my life is myself.', 'Member', 45),
  ('vyvy@gmail.com', 'fuku', '$2b$12$aTDuUZ4cRB87x4RCVKq1OelH8.DhFdyoDpmYn1lR2GT1wZkM4U9WW', 'ฟุกุซ์ | จะถูกหวย', 'no bio', 'Member', 10)
) AS a (email, username, password_hash, display_name, bio, role_name, days_ago)
JOIN roles r ON r.name = a.role_name;

-- ส่วน 2: คำขอสมาชิก
-- bankkb ใช้งานอยู่ · stang หมดอายุ (Role ยังเป็น Subscriber จนกว่าจะ login) · tubfah รออนุมัติ · nooyimm ถูกปฏิเสธ
INSERT INTO subscriptions (user_id, status, requested_at, reviewed_by, reviewed_at, review_note, starts_at, ends_at)
SELECT u.user_id, v.status,
       now() - v.requested_days_ago * interval '1 day',
       CASE WHEN v.status = 'pending' THEN NULL ELSE admin.user_id END,
       CASE WHEN v.status = 'pending' THEN NULL ELSE now() - v.reviewed_days_ago * interval '1 day' END,
       v.note,
       CASE WHEN v.status = 'approved' THEN now() - v.reviewed_days_ago * interval '1 day' END,
       CASE WHEN v.status = 'approved' THEN now() - (v.reviewed_days_ago - 30) * interval '1 day' END
FROM (VALUES
  -- username,  สถานะ,      ส่งกี่วันก่อน, ตรวจกี่วันก่อน, เหตุผล (rejected)
  ('bankkb',  'approved',  12.4, 11.9, NULL),
  ('stang',   'approved',  76.2, 75.8, NULL),
  ('tubfah',  'pending',    0.9, NULL, NULL),
  ('nooyimm', 'rejected',   6.3,  5.7, 'ไฟล์ที่แนบไม่ใช่สลิปการโอนเงิน กรุณาส่งสลิปใหม่')
) AS v (username, status, requested_days_ago, reviewed_days_ago, note)
JOIN users u ON u.username = v.username
CROSS JOIN (SELECT user_id FROM users WHERE username = 'administrator') AS admin;

-- ส่วน 3: งาน
-- demo_key = โฟลเดอร์รูปใน SeedData · ชื่องานของศิลปินคนเดียวกันห้ามซ้ำ
CREATE TEMP TABLE demo_artwork (
  demo_key text PRIMARY KEY, artist text, title text, description text, visibility text, tags text, days_ago numeric
) ON COMMIT DROP;

INSERT INTO demo_artwork VALUES
  ('best/1st (free)', 'bestart', 'Moonlight Maiden', 'หญิงสาวใต้แสงจันทร์ เรนเดอร์สไตล์เกม 3D', 'free', 'character portrait 3d game', 150.4),
  ('best/2nd (free)', 'bestart', 'Swordsman in Black', 'จอมยุทธ์ชุดดำ ฝึกจัดแสงโทนขาวดำ', 'free', 'character portrait 3d', 120.6),
  ('best/3rd (paid)', 'bestart', 'Young Master', 'คุณชายตระกูลใหญ่ ภาพครึ่งตัว', 'subscriber', 'character portrait game', 70.2),
  ('best/4th (paid)', 'bestart', 'Silver Princess', 'องค์หญิงชุดเงิน ลงรายละเอียดเครื่องประดับ', 'subscriber', 'character portrait anime', 25.5),
  ('cat/1st (paid)', 'catsausage', 'Frost Prince — 3 Poses', 'ตัวละครเรืองแสงฟ้า 3 มุม ขนาด 2560×1440', 'subscriber', 'character 3d game', 135.3),
  ('cat/2nd (paid)', 'catsausage', 'HSHM Scenery Pack', 'ฉากเมืองจีนโบราณ 10 ภาพ ใช้ทำพื้นหลังได้', 'subscriber', 'landscape concept game', 100.7),
  ('cat/3rd (paid)', 'catsausage', 'Pink Neko Idol', 'ไอดอลหูแมวโทนชมพู 4 ภาพ', 'subscriber', 'character anime 3d', 65.1),
  ('cat/4th (paid)', 'catsausage', 'AI Nature Wallpaper', 'ภาพธรรมชาติจาก AI 4 ภาพ แนวตั้งสำหรับมือถือ', 'subscriber', 'landscape ai digital', 30.8),
  ('cat/5th (paid)', 'catsausage', 'Night Drive FH6', 'รถสปอร์ตกลางเมืองยามค่ำ จากเกม Forza Horizon 6', 'subscriber', 'car game digital', 4.3),
  ('ping/1st (free)', 'technicalart', 'Cat in Bra (8 สี)', 'มีมแมวใส่บรา 8 สี เอาไปใช้ได้เลย', 'free', 'meme cat', 95.5),
  ('ping/2nd (free)', 'technicalart', 'Cat Sticker Pack', 'สติกเกอร์แมว 10 ท่า ไม่สงวนลิขสิทธิ์', 'free', 'sticker cat meme', 15.2);

INSERT INTO artworks (artist_id, title, description, visibility, created_at, updated_at)
SELECT u.user_id, d.title, d.description, d.visibility, now() - d.days_ago * interval '1 day', now() - d.days_ago * interval '1 day'
FROM demo_artwork d JOIN users u ON u.username = d.artist
ORDER BY d.days_ago DESC;

CREATE TEMP TABLE demo_map ON COMMIT DROP AS
SELECT d.demo_key, a.artwork_id, a.artist_id, a.created_at, a.title
FROM demo_artwork d
JOIN users u ON u.username = d.artist
JOIN artworks a ON a.artist_id = u.user_id AND a.title = d.title;

INSERT INTO tags (name)
SELECT DISTINCT lower(tag) FROM demo_artwork, regexp_split_to_table(trim(tags), '\s+') AS tag WHERE tag <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO artwork_tags (artwork_id, tag_id)
SELECT DISTINCT m.artwork_id, t.tag_id
FROM demo_artwork d
JOIN demo_map m ON m.demo_key = d.demo_key
CROSS JOIN regexp_split_to_table(trim(d.tags), '\s+') AS tag
JOIN tags t ON t.name = lower(tag);

-- ส่วน 4: ไฟล์ (รูปงาน / ภาพการ์ด / รูปโปรไฟล์ / สลิป)
-- คอลัมน์ 2 คอลัมน์แรกใช้กับคำสั่งคัดลอกไฟล์ที่หัวไฟล์ (storage_key = ชื่อไฟล์ใน uploads/files, source = path ใน SeedData)
-- kind: image = รูปงาน, thumbnail = ภาพการ์ด (คัดลอกจากปก), avatar = รูปโปรไฟล์, slip = สลิปของคำขอล่าสุด
CREATE TEMP TABLE demo_file (
  storage_key uuid, source text, kind text, owner text, file_name text, mime_type text, size_bytes bigint, is_cover boolean
) ON COMMIT DROP;

INSERT INTO demo_file VALUES
  ('b67e792a-ee3d-4697-9420-41c8df78bcf5', 'best/1st (free)/Girl1.jpg', 'image', 'best/1st (free)', 'Girl1.jpg', 'image/jpeg', 198496, true),
  ('7a15954e-01cd-4e30-a721-25052170cde3', 'best/1st (free)/Girl1.jpg', 'thumbnail', 'best/1st (free)', 'Girl1.jpg', 'image/jpeg', 198496, false),
  ('3b2c4863-baa0-4649-9864-cf978bd1f653', 'best/2nd (free)/Male2.jpg', 'image', 'best/2nd (free)', 'Male2.jpg', 'image/jpeg', 58434, true),
  ('c84521a4-b420-42ae-9b9b-130cac5ca294', 'best/2nd (free)/Male2.jpg', 'thumbnail', 'best/2nd (free)', 'Male2.jpg', 'image/jpeg', 58434, false),
  ('bbcfdafb-125d-4721-9736-a87c60ac51cc', 'best/3rd (paid)/Male1.jpg', 'image', 'best/3rd (paid)', 'Male1.jpg', 'image/jpeg', 45453, true),
  ('c699479b-5db0-4d0d-8959-72a0e33cd59d', 'best/3rd (paid)/Male1.jpg', 'thumbnail', 'best/3rd (paid)', 'Male1.jpg', 'image/jpeg', 45453, false),
  ('50d3c14c-da20-4ca1-b303-600c1ff601b7', 'best/4th (paid)/Girl2.jpg', 'image', 'best/4th (paid)', 'Girl2.jpg', 'image/jpeg', 90168, true),
  ('ec4f246f-dd2c-4e2b-a2d1-3cecd06a82e8', 'best/4th (paid)/Girl2.jpg', 'thumbnail', 'best/4th (paid)', 'Girl2.jpg', 'image/jpeg', 90168, false),
  ('c8f70a39-cbe7-4aa9-9155-061ddb243269', 'cat/1st (paid)/male1.png', 'image', 'cat/1st (paid)', 'male1.png', 'image/png', 4150137, true),
  ('5eef6654-acab-4d06-a6c7-444d838a708b', 'cat/1st (paid)/male2.png', 'image', 'cat/1st (paid)', 'male2.png', 'image/png', 4004524, false),
  ('37c9dc82-79e0-456f-9c78-3b53c6359889', 'cat/1st (paid)/male3.png', 'image', 'cat/1st (paid)', 'male3.png', 'image/png', 3547748, false),
  ('2392dcdb-4e77-49d1-9f9c-bd8d32cf66fe', 'cat/1st (paid)/male1.png', 'thumbnail', 'cat/1st (paid)', 'male1.png', 'image/png', 4150137, false),
  ('a9050c73-76ca-483c-982a-546eb33c9560', 'cat/2nd (paid)/HSHM_Portrait (1).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (1).jpg', 'image/jpeg', 1219664, true),
  ('01328572-6fa9-47f0-97d9-e35ea034656a', 'cat/2nd (paid)/HSHM_Portrait (2).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (2).jpg', 'image/jpeg', 1699968, false),
  ('a59d17ef-9442-4d54-a9b1-5d9c229a4320', 'cat/2nd (paid)/HSHM_Portrait (3).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (3).jpg', 'image/jpeg', 1721446, false),
  ('297a9415-8e03-48cc-9cbb-005cad8c5abd', 'cat/2nd (paid)/HSHM_Portrait (4).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (4).jpg', 'image/jpeg', 1912806, false),
  ('54695b3e-4934-440a-9be5-18c0499290aa', 'cat/2nd (paid)/HSHM_Portrait (5).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (5).jpg', 'image/jpeg', 1798337, false),
  ('53ed2e77-60c6-4cc9-a3d8-09384ee4bd4a', 'cat/2nd (paid)/HSHM_Portrait (6).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (6).jpg', 'image/jpeg', 1559549, false),
  ('e501072a-a962-41ce-8fcc-08074f838447', 'cat/2nd (paid)/HSHM_Portrait (7).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (7).jpg', 'image/jpeg', 1179987, false),
  ('1f03e400-7c09-4f20-9e2a-5a95296f17bd', 'cat/2nd (paid)/HSHM_Portrait (8).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (8).jpg', 'image/jpeg', 1680310, false),
  ('f0f91ecb-8661-4cfa-8416-0e2a28532901', 'cat/2nd (paid)/HSHM_Portrait (9).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (9).jpg', 'image/jpeg', 1001620, false),
  ('0b7f986f-d596-498c-a25b-f3bc1d201387', 'cat/2nd (paid)/HSHM_Portrait (10).jpg', 'image', 'cat/2nd (paid)', 'HSHM_Portrait (10).jpg', 'image/jpeg', 1795374, false),
  ('99786880-2586-4123-8f45-6fe2b2486eb0', 'cat/2nd (paid)/HSHM_Portrait (1).jpg', 'thumbnail', 'cat/2nd (paid)', 'HSHM_Portrait (1).jpg', 'image/jpeg', 1219664, false),
  ('f7ef3328-660b-44f9-a6b6-b45e91300158', 'cat/3rd (paid)/girl (1).jpg', 'image', 'cat/3rd (paid)', 'girl (1).jpg', 'image/jpeg', 144388, true),
  ('7a9c8959-ac80-44ae-88de-3b86952d28ec', 'cat/3rd (paid)/girl (2).jpg', 'image', 'cat/3rd (paid)', 'girl (2).jpg', 'image/jpeg', 160417, false),
  ('aca0fe74-4ea1-46ed-872b-65d0b5c49d9f', 'cat/3rd (paid)/girl (3).jpg', 'image', 'cat/3rd (paid)', 'girl (3).jpg', 'image/jpeg', 1710745, false),
  ('03bde99a-68b1-44de-899b-cd8b3582fb15', 'cat/3rd (paid)/girl (4).jpg', 'image', 'cat/3rd (paid)', 'girl (4).jpg', 'image/jpeg', 1610281, false),
  ('5660eea8-a4f4-4375-918c-fcaa91631204', 'cat/3rd (paid)/girl (1).jpg', 'thumbnail', 'cat/3rd (paid)', 'girl (1).jpg', 'image/jpeg', 144388, false),
  ('ce3ebe26-5026-4fb1-aee1-3b2b3b8fb80a', 'cat/4th (paid)/AI_Nature (1).jpg', 'image', 'cat/4th (paid)', 'AI_Nature (1).jpg', 'image/jpeg', 222439, true),
  ('6473a11a-55bf-401f-9ce6-383e36160c12', 'cat/4th (paid)/AI_Nature (2).jpg', 'image', 'cat/4th (paid)', 'AI_Nature (2).jpg', 'image/jpeg', 294798, false),
  ('cfe75b8e-2d84-4cc9-879b-d07506b7ef49', 'cat/4th (paid)/AI_Nature (3).jpg', 'image', 'cat/4th (paid)', 'AI_Nature (3).jpg', 'image/jpeg', 253458, false),
  ('4cf1bc95-d4b2-4aa5-b23a-3dc2cf85dc4d', 'cat/4th (paid)/AI_Nature (4).jpg', 'image', 'cat/4th (paid)', 'AI_Nature (4).jpg', 'image/jpeg', 278652, false),
  ('9452aa74-aa71-4fb8-aef1-eb543d084199', 'cat/4th (paid)/AI_Nature (1).jpg', 'thumbnail', 'cat/4th (paid)', 'AI_Nature (1).jpg', 'image/jpeg', 222439, false),
  ('76c6a08a-14bf-4337-b80b-1b5ae3dce02b', 'cat/5th (paid)/FH6.jpg', 'image', 'cat/5th (paid)', 'FH6.jpg', 'image/jpeg', 132999, true),
  ('ea30cc45-6735-4c2e-959d-00da3bf62878', 'cat/5th (paid)/FH6.jpg', 'thumbnail', 'cat/5th (paid)', 'FH6.jpg', 'image/jpeg', 132999, false),
  ('170366d5-651c-4aee-97ca-5ffcefca07b1', 'ping/1st (free)/cat1.jpg', 'image', 'ping/1st (free)', 'cat1.jpg', 'image/jpeg', 117600, true),
  ('77d932a9-ef5e-490a-9326-2ec2997d97c2', 'ping/1st (free)/cat2.jpg', 'image', 'ping/1st (free)', 'cat2.jpg', 'image/jpeg', 121723, false),
  ('15b635c5-3f3c-4afb-beae-a83c013dc023', 'ping/1st (free)/cat3.jpg', 'image', 'ping/1st (free)', 'cat3.jpg', 'image/jpeg', 5659, false),
  ('782a5276-f6d3-43cf-9087-413e26f6909c', 'ping/1st (free)/cat4.jpg', 'image', 'ping/1st (free)', 'cat4.jpg', 'image/jpeg', 112525, false),
  ('b83b4839-877c-43f5-abfa-7674c7762a3b', 'ping/1st (free)/cat5.jpg', 'image', 'ping/1st (free)', 'cat5.jpg', 'image/jpeg', 113590, false),
  ('5d4f3c0b-5356-4398-b33f-23eec4f90d02', 'ping/1st (free)/cat6.jpg', 'image', 'ping/1st (free)', 'cat6.jpg', 'image/jpeg', 121814, false),
  ('99d50d66-bd74-45aa-85ab-5a2073ed198c', 'ping/1st (free)/cat7.jpg', 'image', 'ping/1st (free)', 'cat7.jpg', 'image/jpeg', 107949, false),
  ('9548e011-f84b-495f-9df7-1996dd543e4f', 'ping/1st (free)/cat8.jpg', 'image', 'ping/1st (free)', 'cat8.jpg', 'image/jpeg', 99137, false),
  ('ceb070a9-7ac1-464b-81e0-3e543553224f', 'ping/1st (free)/cat1.jpg', 'thumbnail', 'ping/1st (free)', 'cat1.jpg', 'image/jpeg', 117600, false),
  ('ee85e41c-090e-4a4d-99a5-6d3cb0f3d4d4', 'ping/2nd (free)/Meme (10).jpg', 'image', 'ping/2nd (free)', 'Meme (10).jpg', 'image/jpeg', 78535, true),
  ('fde3d8f0-91c3-419e-b05b-4df67d2e9d04', 'ping/2nd (free)/Meme (11).jpg', 'image', 'ping/2nd (free)', 'Meme (11).jpg', 'image/jpeg', 97813, false),
  ('15c2a7b3-74b1-464c-8815-4b884f90e335', 'ping/2nd (free)/Meme (12).jpg', 'image', 'ping/2nd (free)', 'Meme (12).jpg', 'image/jpeg', 82626, false),
  ('d634967b-2c39-41e1-b945-af71df80ff43', 'ping/2nd (free)/Meme (13).jpg', 'image', 'ping/2nd (free)', 'Meme (13).jpg', 'image/jpeg', 41433, false),
  ('3726d798-9052-48f8-91d8-d8a1b6eefd03', 'ping/2nd (free)/Meme (14).jpg', 'image', 'ping/2nd (free)', 'Meme (14).jpg', 'image/jpeg', 43423, false),
  ('7105bc2e-c75d-4cff-aebf-79c41eac4dfa', 'ping/2nd (free)/Meme (15).jpg', 'image', 'ping/2nd (free)', 'Meme (15).jpg', 'image/jpeg', 66217, false),
  ('2e26be34-74df-4323-ac82-0e67bda33e63', 'ping/2nd (free)/Meme (16).jpg', 'image', 'ping/2nd (free)', 'Meme (16).jpg', 'image/jpeg', 56865, false),
  ('b94600a4-a6ba-4675-8de1-cb48266e6098', 'ping/2nd (free)/Meme (17).jpg', 'image', 'ping/2nd (free)', 'Meme (17).jpg', 'image/jpeg', 61494, false),
  ('9af958be-3781-4d1f-bdc9-9b9e6d7bec92', 'ping/2nd (free)/Meme (18).jpg', 'image', 'ping/2nd (free)', 'Meme (18).jpg', 'image/jpeg', 73162, false),
  ('4ad170a3-82ff-433d-badc-c42daff7ef3a', 'ping/2nd (free)/Meme (19).jpg', 'image', 'ping/2nd (free)', 'Meme (19).jpg', 'image/jpeg', 110472, false),
  ('b70b7166-3af5-4dcb-a030-d9c06a2392f8', 'ping/2nd (free)/Meme (10).jpg', 'thumbnail', 'ping/2nd (free)', 'Meme (10).jpg', 'image/jpeg', 78535, false),
  ('1cab48ed-cd53-4b0c-b231-95dc05a4ab0f', 'bestart.jpg', 'avatar', 'bestart', 'bestart.jpg', 'image/jpeg', 75177, false),
  ('24b2f5e5-a7b7-4c45-9e57-5ebb9c60cc80', 'catsausage.jpg', 'avatar', 'catsausage', 'catsausage.jpg', 'image/jpeg', 14870, false),
  ('e21d1003-066c-4414-98c6-536999ef08df', 'technicalart.jpg', 'avatar', 'technicalart', 'technicalart.jpg', 'image/jpeg', 98674, false),
  ('05b9e5f1-0dc7-4ff4-ac7a-7250b71ac712', 'barbatos.jpg', 'avatar', 'minviii', 'barbatos.jpg', 'image/jpeg', 112523, false),
  ('554bafd6-cb6e-453a-8902-edefc7522a49', 'nooyimm.jpeg', 'avatar', 'nooyimm', 'nooyimm.jpeg', 'image/jpeg', 189146, false),
  ('2911b188-f61a-4c14-842c-07cc0865c789', 'fuku.jpg', 'avatar', 'fuku', 'fuku.jpg', 'image/jpeg', 32600, false),
  ('6a519b0a-4dcb-4351-b0cc-20e29573dd7d', 'slip01.jpg', 'slip', 'bankkb', 'slip01.jpg', 'image/jpeg', 52953, false),
  ('6a84d2c7-df0d-473f-8ab5-35c935540797', 'slip02.jpg', 'slip', 'stang', 'slip02.jpg', 'image/jpeg', 52402, false),
  ('7e4e3405-ba52-4e97-9523-66606bc48b3e', 'slip03.jpg', 'slip', 'tubfah', 'slip03.jpg', 'image/jpeg', 53595, false),
  ('ccfb51b8-4c91-4886-bbc1-ae75c48ef465', 'slip04.png', 'slip', 'nooyimm', 'slip04.png', 'image/png', 1706755, false);

INSERT INTO files (kind, original_name, storage_key, mime_type, size_bytes, uploaded_by, uploaded_at, artwork_id, is_cover)
SELECT f.kind, CASE WHEN f.kind = 'thumbnail' THEN 'thumbnail-' || f.file_name ELSE f.file_name END,
       f.storage_key, f.mime_type, f.size_bytes, m.artist_id, m.created_at, m.artwork_id, f.is_cover
FROM demo_file f JOIN demo_map m ON m.demo_key = f.owner
WHERE f.kind IN ('image', 'thumbnail');

INSERT INTO files (kind, original_name, storage_key, mime_type, size_bytes, uploaded_by, uploaded_at, user_id)
SELECT 'avatar', f.file_name, f.storage_key, f.mime_type, f.size_bytes, u.user_id, u.created_at + interval '2 hours', u.user_id
FROM demo_file f JOIN users u ON u.username = f.owner
WHERE f.kind = 'avatar';

INSERT INTO files (kind, original_name, storage_key, mime_type, size_bytes, uploaded_by, uploaded_at, subscription_id)
SELECT 'payment_slip', f.file_name, f.storage_key, f.mime_type, f.size_bytes, u.user_id, latest.requested_at, latest.subscription_id
FROM demo_file f
JOIN users u ON u.username = f.owner
CROSS JOIN LATERAL (
  SELECT subscription_id, requested_at FROM subscriptions WHERE user_id = u.user_id ORDER BY requested_at DESC LIMIT 1
) AS latest
WHERE f.kind = 'slip';

-- ส่วน 5: ดาวน์โหลด (= คลัง + ยอดดาวน์โหลด)
-- งานสมาชิกโหลดได้เฉพาะช่วงที่เป็นสมาชิก: bankkb ตั้งแต่ ~12 วันก่อน · stang ช่วง 76–46 วันก่อน · Artist โหลดได้ตลอด
-- แถวที่วันโหลดอยู่ก่อนวันลงงานถูกข้ามอัตโนมัติ
INSERT INTO downloads (user_id, artwork_id, downloaded_at)
SELECT u.user_id, m.artwork_id, now() - v.days_ago * interval '1 day'
FROM (VALUES
  ('bankkb',       'best/1st (free)', 80.2), ('bankkb', 'ping/1st (free)', 40.6), ('bankkb', 'ping/2nd (free)', 12.9),
  ('bankkb',       'best/4th (paid)', 10.4), ('bankkb', 'cat/2nd (paid)',   9.1), ('bankkb', 'cat/3rd (paid)',   7.7),
  ('bankkb',       'cat/1st (paid)',   5.2), ('bankkb', 'cat/5th (paid)',   3.6), ('bankkb', 'best/3rd (paid)',  2.3),
  ('stang',        'best/2nd (free)', 80.5), ('stang',  'cat/2nd (paid)',  74.3), ('stang',  'ping/1st (free)', 70.1),
  ('stang',        'best/3rd (paid)', 68.4), ('stang',  'cat/3rd (paid)',  60.2), ('stang',  'cat/1st (paid)',  50.8),
  ('minviii',      'best/1st (free)', 55.3), ('minviii', 'best/2nd (free)', 50.6), ('minviii', 'ping/1st (free)', 30.2),
  ('minviii',      'ping/2nd (free)', 14.1),
  ('nooyimm',      'ping/1st (free)', 40.4), ('nooyimm', 'ping/2nd (free)', 13.5), ('nooyimm', 'best/2nd (free)', 7.2),
  ('fuku',         'ping/2nd (free)',  8.3), ('fuku',    'best/1st (free)',  6.1), ('fuku',    'best/2nd (free)', 2.4),
  ('tubfah',       'ping/2nd (free)',  3.2),
  ('bestart',      'cat/2nd (paid)',  90.3), ('bestart', 'cat/4th (paid)',  20.5),
  ('catsausage',   'best/3rd (paid)', 60.7), ('catsausage', 'best/4th (paid)', 20.1),
  ('technicalart', 'best/1st (free)', 90.6), ('technicalart', 'cat/1st (paid)', 85.4)
) AS v (username, demo_key, days_ago)
JOIN users u ON u.username = v.username
JOIN demo_map m ON m.demo_key = v.demo_key
WHERE now() - v.days_ago * interval '1 day' >= m.created_at;

-- ส่วน 6: ถูกใจ (ต้องเคยดาวน์โหลดงานนั้นก่อน แถวที่ไม่เคยโหลดถูกข้าม)
INSERT INTO artwork_likes (artwork_id, user_id, created_at)
SELECT m.artwork_id, u.user_id, first_download.at + interval '40 minutes'
FROM (VALUES
  ('bankkb', 'cat/5th (paid)'), ('bankkb', 'cat/2nd (paid)'), ('bankkb', 'cat/3rd (paid)'), ('bankkb', 'best/4th (paid)'),
  ('bankkb', 'ping/2nd (free)'), ('bankkb', 'best/1st (free)'),
  ('stang', 'cat/2nd (paid)'), ('stang', 'best/3rd (paid)'), ('stang', 'ping/1st (free)'), ('stang', 'cat/3rd (paid)'),
  ('minviii', 'best/1st (free)'), ('minviii', 'ping/1st (free)'), ('minviii', 'ping/2nd (free)'),
  ('nooyimm', 'ping/1st (free)'), ('nooyimm', 'ping/2nd (free)'), ('nooyimm', 'best/2nd (free)'),
  ('fuku', 'ping/2nd (free)'), ('fuku', 'best/1st (free)'),
  ('tubfah', 'ping/2nd (free)'),
  ('bestart', 'cat/2nd (paid)'), ('catsausage', 'best/4th (paid)'), ('technicalart', 'best/1st (free)'), ('technicalart', 'cat/1st (paid)')
) AS v (username, demo_key)
JOIN users u ON u.username = v.username
JOIN demo_map m ON m.demo_key = v.demo_key
CROSS JOIN LATERAL (
  SELECT min(d.downloaded_at) AS at FROM downloads d WHERE d.user_id = u.user_id AND d.artwork_id = m.artwork_id
) AS first_download
WHERE first_download.at IS NOT NULL;

-- ส่วน 7: คอมเมนต์
INSERT INTO comments (artwork_id, user_id, body, created_at)
SELECT m.artwork_id, u.user_id, v.body, now() - v.days_ago * interval '1 day'
FROM (VALUES
  ('minviii',      'best/1st (free)', 'ติดตามผลงานนะคับบ เซฟ', 54.9),
  ('bankkb',       'best/1st (free)', 'ภาพสวยมากครับ', 54.9),
  ('bestart',      'best/1st (free)', 'เอาไปทำวอลเปเปอร์ได้เลยครับ', 54.9),
  ('fuku',         'best/1st (free)', 'ขอบคุณค่ะ ขอเอาไปทำวอลเปเปอร์นะคะ', 5.9),
  ('stang',        'best/2nd (free)', 'ชุดดำเท่มากกกก', 79.8),
  ('nooyimm',      'best/2nd (free)', 'ผู้ชายในฝัน', 6.8),
  ('bankkb',       'best/4th (paid)', 'คุ้มค่าสมาชิกแล้วงานนี้', 9.8),
  ('technicalart', 'cat/1st (paid)',  'แสงฟ้าเรืองแสงทำยังไงครับ', 84.9),
  ('catsausage',   'cat/1st (paid)',  'ใช้ rim light สีฟ้า แล้วเติม bloom ตอน post ครับ', 84.2),
  ('bestart',      'cat/2nd (paid)',  'ฉากสวยเหมือนอยู่ในเกมจริง', 89.7),
  ('bankkb',       'cat/2nd (paid)',  'โหลดครบ 10 ภาพ เอาไปทำ background ได้หมดเลย', 8.7),
  ('stang',        'cat/3rd (paid)',  'สีชมพูน่ารักมาก', 59.6),
  ('bestart',      'cat/4th (paid)',  'ชอบภาพที่ 2 สุด', 19.9),
  ('bankkb',       'cat/5th (paid)',  'FH6 มาแล้ววว', 3.1),
  ('tubfah',       'cat/5th (paid)',  'อยากได้ภาพนี้มาก รออนุมัติแล้วจะมาโหลด+++', 0.8),
  ('minviii',      'ping/1st (free)', '555555 แมวใส่บรา', 29.7),
  ('nooyimm',      'ping/1st (free)', '7 วัน 7 สีเลย 555555555555555555', 39.8),
  ('technicalart', 'ping/1st (free)', 'เอาไปใช้ได้ฟรีเลยครับ ไม่ต้องให้เครดิต', 39.2),
  ('fuku',         'ping/2nd (free)', 'สติกเกอร์น่ารักมาก ขอเอาไปใช้ใน LINE นะคะ', 7.9),
  ('tubfah',       'ping/2nd (free)', 'ตัวที่ 3 เหมือนผมตอนตื่นสาย 555', 2.9)
) AS v (username, demo_key, body, days_ago)
JOIN users u ON u.username = v.username
JOIN demo_map m ON m.demo_key = v.demo_key
WHERE now() - v.days_ago * interval '1 day' >= m.created_at;

-- ส่วน 8: Log ย้อนหลัง (สร้างจากข้อมูลด้านบน ให้หน้า Logs มีประวัติ)
-- actor_label ใช้รูปแบบเดียวกับระบบ: "email (Role)" · Log ใหม่จะต่อท้ายเมื่อใช้งานจริง
CREATE TEMP TABLE demo_ip ON COMMIT DROP AS
SELECT user_id, '10.0.' || (user_id % 5) || '.' || (20 + user_id) AS ip FROM users;

INSERT INTO logs (logged_at, level, source, category, actor_user_id, actor_label, resource_type, resource_id, result, description, ip_address)
-- สมัครบัญชี
SELECT u.created_at, 'Information', 'Auth', 'Register', u.user_id, u.email || ' (Member)', 'user', u.user_id::text, 'success',
       'สมัครบัญชีใหม่ ' || u.email, ip.ip
FROM users u JOIN roles r ON r.role_id = u.role_id JOIN demo_ip ip ON ip.user_id = u.user_id
WHERE r.name IN ('Member', 'Subscriber')
UNION ALL
-- login วันละครั้งในวันที่มีการใช้งาน
SELECT activity.at - interval '5 minutes', 'Information', 'Auth', 'Login', u.user_id, u.email || ' (' || r.name || ')', 'user', u.user_id::text, 'success',
       'เข้าสู่ระบบ', ip.ip
FROM (
  SELECT DISTINCT ON (user_id, date_trunc('day', at)) user_id, at FROM (
    SELECT user_id, downloaded_at AS at FROM downloads
    UNION ALL SELECT user_id, created_at FROM comments
    UNION ALL SELECT artist_id, created_at FROM artworks
    UNION ALL SELECT user_id, requested_at FROM subscriptions
  ) AS raw ORDER BY user_id, date_trunc('day', at), at
) AS activity
JOIN users u ON u.user_id = activity.user_id JOIN roles r ON r.role_id = u.role_id JOIN demo_ip ip ON ip.user_id = u.user_id
UNION ALL
-- ลงงาน + อัปโหลดรูป
SELECT a.created_at, 'Information', 'Artwork', 'Create', a.artist_id, u.email || ' (Artist)', 'artwork', a.artwork_id::text, 'success',
       'สร้างงาน #' || a.artwork_id || ' "' || a.title || '"', ip.ip
FROM artworks a JOIN users u ON u.user_id = a.artist_id JOIN demo_ip ip ON ip.user_id = u.user_id
UNION ALL
SELECT a.created_at, 'Information', 'File', 'Upload', a.artist_id, u.email || ' (Artist)', 'artwork', a.artwork_id::text, 'success',
       'อัปโหลด ' || count(f.file_id) || ' รูป: ' || string_agg('"' || f.original_name || '"', ', ' ORDER BY f.original_name), ip.ip
FROM artworks a JOIN users u ON u.user_id = a.artist_id JOIN demo_ip ip ON ip.user_id = u.user_id
JOIN files f ON f.artwork_id = a.artwork_id AND f.kind = 'image'
GROUP BY a.artwork_id, a.created_at, a.artist_id, u.email, a.title, ip.ip
UNION ALL
-- ดาวน์โหลด
SELECT d.downloaded_at, 'Information', 'File', 'Download', d.user_id, u.email || ' (' || r.name || ')', 'artwork', d.artwork_id::text, 'success',
       'ดาวน์โหลดงาน #' || d.artwork_id || ' (' || (SELECT count(*) FROM files f WHERE f.artwork_id = d.artwork_id AND f.kind = 'image') || ' ไฟล์)', ip.ip
FROM downloads d JOIN users u ON u.user_id = d.user_id JOIN roles r ON r.role_id = u.role_id JOIN demo_ip ip ON ip.user_id = u.user_id
UNION ALL
-- รูปโปรไฟล์
SELECT f.uploaded_at, 'Information', 'Profile', 'AvatarChange', u.user_id, u.email || ' (' || r.name || ')', 'user', u.user_id::text, 'success',
       'เปลี่ยนรูปโปรไฟล์', ip.ip
FROM files f JOIN users u ON u.user_id = f.user_id JOIN roles r ON r.role_id = u.role_id JOIN demo_ip ip ON ip.user_id = u.user_id
WHERE f.kind = 'avatar'
UNION ALL
-- คำขอสมาชิก: ส่ง → อนุมัติ/ปฏิเสธ
SELECT s.requested_at, 'Information', 'Subscription', 'Submit', s.user_id, u.email || ' (Member)', 'subscription', s.subscription_id::text, 'success',
       'ส่งคำขอสมัครสมาชิก #' || s.subscription_id, ip.ip
FROM subscriptions s JOIN users u ON u.user_id = s.user_id JOIN demo_ip ip ON ip.user_id = u.user_id
UNION ALL
SELECT s.reviewed_at, 'Information', 'Subscription', CASE s.status WHEN 'approved' THEN 'Approve' ELSE 'Reject' END,
       admin.user_id, admin.email || ' (Admin)', 'subscription', s.subscription_id::text, 'success',
       CASE s.status
         WHEN 'approved' THEN 'อนุมัติคำขอ #' || s.subscription_id || ' ของ ' || u.email || ' ใช้งานได้ถึง ' || to_char(s.ends_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') || ' (Member → Subscriber)'
         ELSE 'ปฏิเสธคำขอ #' || s.subscription_id || ' ของ ' || u.email || ': ' || s.review_note
       END, admin_ip.ip
FROM subscriptions s JOIN users u ON u.user_id = s.user_id
CROSS JOIN (SELECT user_id, email FROM users WHERE username = 'administrator') AS admin
JOIN demo_ip admin_ip ON admin_ip.user_id = admin.user_id
WHERE s.status <> 'pending'
UNION ALL
-- เหตุการณ์ที่ถูกปฏิเสธ (ให้หน้า Logs มี Warning)
SELECT now() - v.days_ago * interval '1 day', 'Warning', v.source, v.category, u.user_id,
       CASE WHEN u.user_id IS NULL THEN 'Guest' ELSE u.email || ' (' || r.name || ')' END,
       v.resource_type, NULL, v.result, v.description, v.ip
FROM (VALUES
  (NULL,      33.4, 'Access', 'Denied', 'artwork',      'denied',  'GET /app/artworks/download ถูกปฏิเสธ (401) ต้อง login', '10.0.9.80'),
  ('minviii', 31.2, 'Access', 'Denied', 'artwork',      'denied',  'GET /app/artworks/download ถูกปฏิเสธ (403) ต้องการ file.download', NULL),
  ('fuku',     9.6, 'Auth',   'Login',  'user',         'failure', 'เข้าสู่ระบบไม่สำเร็จ: รหัสผ่านไม่ถูกต้อง', NULL),
  ('nooyimm',  6.3, 'File',   'Upload', 'subscription', 'success', 'อัปโหลดสลิป "slip04.png" (image/png)', NULL)
) AS v (username, days_ago, source, category, resource_type, result, description, ip)
LEFT JOIN users u ON u.username = v.username
LEFT JOIN roles r ON r.role_id = u.role_id;

-- ตรวจผล
SELECT d.demo_key AS "งานที่ไม่มีรูป" FROM demo_artwork d JOIN demo_map m USING (demo_key)
WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.artwork_id = m.artwork_id AND f.kind = 'image');

SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM artworks) AS artworks,
       (SELECT count(*) FROM files WHERE kind = 'image') AS images, (SELECT count(*) FROM files WHERE kind = 'avatar') AS avatars,
       (SELECT count(*) FROM files WHERE kind = 'payment_slip') AS slips, (SELECT count(*) FROM downloads) AS downloads,
       (SELECT count(*) FROM artwork_likes) AS likes, (SELECT count(*) FROM comments) AS comments, (SELECT count(*) FROM logs) AS logs;

COMMIT;
