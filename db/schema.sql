-- Artwork schema · PostgreSQL 18
-- รันซ้ำได้: ลบทุกตารางก่อนสร้างใหม่ (ปกติรันผ่าน npm run demo:reset ซึ่งรันไฟล์นี้ + seed.sql + คัดลอกรูป)

DROP TABLE IF EXISTS comments, artwork_likes, downloads, files, artwork_tags, tags, artworks, subscriptions,
  logs, users, acl, permissions, resources, roles, session CASCADE;

-- Role / Resource / Permission / ACL
-- โครงเดียวกับใบงาน ACL: Subject × Object × Access Right
--   Subject = Role (ผู้ใช้ได้สิทธิ์ผ่าน Role ของตัวเอง) · Object = resources · Access Right = permissions
--   acl หนึ่งแถว = Role หนึ่งได้ Permission หนึ่ง · ไม่มีแถว = ไม่ได้ (default deny)

CREATE TABLE roles (
  role_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          varchar(30)  NOT NULL UNIQUE,
  description   varchar(200) NOT NULL DEFAULT '',
  is_system     boolean      NOT NULL DEFAULT false,
  -- Admin: ผ่านทุกสิทธิ์และจัดการศูนย์ควบคุม (เทียบ ADMIN_USER_ID + requireAdmin ในใบงาน) ไม่ต้องมีแถวใน acl
  is_super_user boolean      NOT NULL DEFAULT false,
  -- Guest: Role ของผู้ที่ยังไม่ login (ใช้ตรวจสิทธิ์ตอนไม่มี session) กำหนดให้ผู้ใช้ไม่ได้
  is_guest      boolean      NOT NULL DEFAULT false,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT roles_name_length CHECK (char_length(name) BETWEEN 2 AND 30),
  CONSTRAINT roles_guest_not_super_user CHECK (NOT (is_guest AND is_super_user))
);
-- Guest มีได้เพียงแถวเดียว
CREATE UNIQUE INDEX roles_single_guest ON roles (is_guest) WHERE is_guest;

-- ทรัพยากรที่ป้องกัน (Object ใน Access Matrix · หน้า ACL จัดกลุ่มแถวตาม Resource) เช่น artwork, comment, log
CREATE TABLE resources (
  resource_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_name varchar(20)  NOT NULL UNIQUE,
  description   varchar(200) NOT NULL DEFAULT '',
  CONSTRAINT resources_name_format CHECK (resource_name ~ '^[a-z][a-zA-Z]{1,19}$')
);

-- การกระทำต่อทรัพยากร · ชื่อเต็มแสดงเป็น resource.action เช่น artwork.read (ตามตัวอย่าง equipment.read ในโจทย์)
-- ลบทรัพยากรที่ยังมี Permission อ้างอิงไม่ได้ (RESTRICT)
CREATE TABLE permissions (
  permission_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id   bigint       NOT NULL REFERENCES resources (resource_id) ON DELETE RESTRICT,
  action        varchar(20)  NOT NULL,
  description   varchar(200) NOT NULL DEFAULT '',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT permissions_action_format CHECK (action ~ '^[a-z][a-zA-Z]{1,19}$'),
  UNIQUE (resource_id, action)
);

-- ACL: หนึ่งแถว = หนึ่งสิทธิ์ (ช่องที่ติ๊กใน Access Matrix) · ห้ามซ้ำด้วย UNIQUE
-- ลบ Permission ที่ยังมีแถวใน acl ไม่ได้ (RESTRICT: ถอนสิทธิ์ก่อน) · ลบ Role แล้วแถวของ Role นั้นหายตาม (CASCADE)
CREATE TABLE acl (
  acl_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id       bigint      NOT NULL REFERENCES roles (role_id) ON DELETE CASCADE,
  permission_id bigint      NOT NULL REFERENCES permissions (permission_id) ON DELETE RESTRICT,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

-- Users

CREATE TABLE users (
  user_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         varchar(254) NOT NULL UNIQUE,
  -- ใช้ login แทนอีเมลได้ และใช้ค้นตอนเพิ่มสมาชิกเข้า Role
  username      varchar(20)  NOT NULL UNIQUE,
  password_hash varchar(100) NOT NULL,
  display_name  varchar(40)  NOT NULL,
  bio           text         NOT NULL DEFAULT '',
  role_id       bigint       NOT NULL REFERENCES roles (role_id) ON DELETE RESTRICT,
  is_active     boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 2 AND 40),
  CONSTRAINT users_bio_length CHECK (char_length(bio) <= 300)
);
CREATE INDEX users_role_id_idx ON users (role_id);

-- Subscription workflow

CREATE TABLE subscriptions (
  subscription_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         bigint      NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  status          varchar(10) NOT NULL DEFAULT 'pending',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by     bigint      REFERENCES users (user_id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  review_note     text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  CONSTRAINT subscriptions_status_values CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT subscriptions_review_note_length CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  CONSTRAINT subscriptions_approved_has_period
    CHECK (status <> 'approved' OR (starts_at IS NOT NULL AND ends_at > starts_at)),
  CONSTRAINT subscriptions_rejected_has_note CHECK (status <> 'rejected' OR review_note IS NOT NULL)
);
-- มีคำขอ pending ได้ครั้งละ 1 รายการต่อผู้ใช้
CREATE UNIQUE INDEX subscriptions_one_pending_per_user ON subscriptions (user_id) WHERE status = 'pending';
CREATE INDEX subscriptions_user_id_idx ON subscriptions (user_id);

-- Artworks

CREATE TABLE artworks (
  artwork_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id   bigint       NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
  title       varchar(100) NOT NULL,
  description text         NOT NULL DEFAULT '',
  -- free = ผู้ที่ login แล้วดาวน์โหลดได้ · subscriber = ต้องมีสิทธิ์ file.read (สมาชิก)
  visibility  varchar(10)  NOT NULL DEFAULT 'subscriber',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT artworks_visibility_values CHECK (visibility IN ('free', 'subscriber')),
  CONSTRAINT artworks_title_length CHECK (char_length(title) >= 1),
  CONSTRAINT artworks_description_length CHECK (char_length(description) <= 2000)
);
CREATE INDEX artworks_artist_id_idx ON artworks (artist_id);
CREATE INDEX artworks_created_at_idx ON artworks (created_at DESC);

CREATE TABLE tags (
  tag_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name   varchar(30) NOT NULL UNIQUE,
  CONSTRAINT tags_name_format CHECK (char_length(name) >= 1 AND name = lower(name))
);

CREATE TABLE artwork_tags (
  artwork_id bigint NOT NULL REFERENCES artworks (artwork_id) ON DELETE CASCADE,
  tag_id     bigint NOT NULL REFERENCES tags (tag_id) ON DELETE CASCADE,
  PRIMARY KEY (artwork_id, tag_id)
);
CREATE INDEX artwork_tags_tag_id_idx ON artwork_tags (tag_id);

-- Files (metadata; ตัวไฟล์อยู่ใน UPLOAD_DIR)

CREATE TABLE files (
  file_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            varchar(20)  NOT NULL,
  original_name   varchar(255) NOT NULL,
  storage_key     uuid         NOT NULL UNIQUE,
  mime_type       varchar(100) NOT NULL,
  size_bytes      bigint       NOT NULL,
  uploaded_by     bigint       REFERENCES users (user_id) ON DELETE SET NULL,
  uploaded_at     timestamptz  NOT NULL DEFAULT now(),
  artwork_id      bigint       REFERENCES artworks (artwork_id) ON DELETE CASCADE,
  subscription_id bigint       REFERENCES subscriptions (subscription_id) ON DELETE CASCADE,
  user_id         bigint       REFERENCES users (user_id) ON DELETE CASCADE,
  -- รูปที่ศิลปินเลือกเป็นปก (ไม่เลือก = รูปแรกตามชื่อไฟล์)
  is_cover        boolean      NOT NULL DEFAULT false,
  CONSTRAINT files_kind_values CHECK (kind IN ('image', 'thumbnail', 'payment_slip', 'avatar')),
  CONSTRAINT files_size_positive CHECK (size_bytes > 0),
  -- ไฟล์หนึ่งแถวผูกกับเจ้าของได้อย่างเดียว และต้องตรงกับชนิด
  CONSTRAINT files_single_owner CHECK (num_nonnulls(artwork_id, subscription_id, user_id) = 1),
  CONSTRAINT files_kind_matches_owner CHECK (
    (kind IN ('image', 'thumbnail') AND artwork_id IS NOT NULL)
    OR (kind = 'payment_slip' AND subscription_id IS NOT NULL)
    OR (kind = 'avatar' AND user_id IS NOT NULL)
  ),
  CONSTRAINT files_cover_is_image CHECK (NOT is_cover OR kind = 'image')
);
-- งานหนึ่งมีได้หลายรูป (kind = image, ไม่เกิน 10 ไฟล์ / 100 MB ตรวจที่ Server) แต่ปกและ thumbnail มีได้อันเดียว
CREATE INDEX files_artwork_id_idx ON files (artwork_id, kind);
CREATE UNIQUE INDEX files_one_cover_per_artwork ON files (artwork_id) WHERE is_cover;
CREATE UNIQUE INDEX files_one_thumbnail_per_artwork ON files (artwork_id) WHERE kind = 'thumbnail';
CREATE UNIQUE INDEX files_one_avatar_per_user ON files (user_id) WHERE kind = 'avatar';
CREATE INDEX files_subscription_id_idx ON files (subscription_id);

-- ประวัติดาวน์โหลด = แหล่งข้อมูลของหน้า "คลัง" (ดาวน์โหลดทีละงาน: ทุกรูปของงานในครั้งเดียว)
CREATE TABLE downloads (
  download_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint      NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  artwork_id    bigint      NOT NULL REFERENCES artworks (artwork_id) ON DELETE CASCADE,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX downloads_user_id_idx ON downloads (user_id, downloaded_at DESC);
CREATE INDEX downloads_artwork_id_idx ON downloads (artwork_id);

-- ความคิดเห็นและการกดถูกใจ

CREATE TABLE comments (
  comment_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artwork_id  bigint       NOT NULL REFERENCES artworks (artwork_id) ON DELETE CASCADE,
  user_id     bigint       NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  body        varchar(500) NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT comments_body_length CHECK (char_length(btrim(body)) >= 1)
);
CREATE INDEX comments_artwork_id_idx ON comments (artwork_id, created_at);

-- PK คู่ = ผู้ใช้หนึ่งคนกดถูกใจงานหนึ่งได้ครั้งเดียว
CREATE TABLE artwork_likes (
  artwork_id  bigint      NOT NULL REFERENCES artworks (artwork_id) ON DELETE CASCADE,
  user_id     bigint      NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artwork_id, user_id)
);

-- Audit log (Event Viewer)

CREATE TABLE logs (
  log_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  logged_at     timestamptz  NOT NULL DEFAULT now(),
  level         varchar(12)  NOT NULL,
  source        varchar(20)  NOT NULL,
  category      varchar(30)  NOT NULL,
  actor_user_id bigint       REFERENCES users (user_id) ON DELETE SET NULL,
  actor_label   varchar(300),
  resource_type varchar(30),
  resource_id   varchar(64),
  result        varchar(10)  NOT NULL,
  description   text         NOT NULL DEFAULT '',
  ip_address    varchar(45),
  CONSTRAINT logs_level_values CHECK (level IN ('Information', 'Warning', 'Error')),
  CONSTRAINT logs_result_values CHECK (result IN ('success', 'failure', 'denied'))
);
CREATE INDEX logs_logged_at_idx ON logs (logged_at DESC);
CREATE INDEX logs_level_idx ON logs (level);
CREATE INDEX logs_source_idx ON logs (source);
CREATE INDEX logs_category_idx ON logs (category);
CREATE INDEX logs_actor_user_id_idx ON logs (actor_user_id);

-- Session (จัดการโดย connect-pg-simple, ไม่ผูก FK)

CREATE TABLE session (
  sid    varchar      NOT NULL PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);
