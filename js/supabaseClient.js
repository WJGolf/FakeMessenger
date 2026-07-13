// ============================================================
//  ตั้งค่าการเชื่อมต่อ Supabase ตรงนี้ที่เดียว
//  หาได้จาก Supabase Dashboard > Project Settings > API
// ============================================================
export const SUPABASE_URL = "https://faszsxmfnzvsfkasaaoc.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_lwcXDGJrZkz1JcfGCE52Uw_0zWs4RUO";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// ผู้ใช้ปัจจุบัน + โปรไฟล์
// ------------------------------------------------------------
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

export async function getMyProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

// ------------------------------------------------------------
// อัปโหลดไฟล์ขึ้น storage bucket แล้วคืน public URL
// path จะถูกเก็บใต้โฟลเดอร์ uid ของผู้ใช้เอง (ตาม RLS policy)
// ------------------------------------------------------------
export async function uploadToBucket(bucket, file, uid) {
  const ext = file.name.split(".").pop();
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export function fileKind(file) {
  if (!file) return null;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "other";
}

// ------------------------------------------------------------
// เวลาแบบอ่านง่าย (ภาษาไทย)
// ------------------------------------------------------------
export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

export function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toast(msg, onClick) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  if (onClick) {
    el.style.cursor = "pointer";
    el.addEventListener("click", onClick);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ------------------------------------------------------------
// รองรับสมัคร/ล็อกอินด้วยเบอร์โทร หรือ username (profile_id)
//
// Supabase Auth (แบบไม่เปิด SMS provider) ผูกบัญชีกับ "อีเมล" เท่านั้น
// เวลาผู้ใช้เลือกสมัครด้วยเบอร์โทร เราจะสร้าง "อีเมลปลอม" ภายในระบบ
// จากเบอร์ที่ normalize แล้ว (เช่น 0812345678 -> p66812345678@phone.kosen.local)
// แล้วใช้อีเมลปลอมนั้นสมัคร/ล็อกอินกับ Supabase ตามปกติ โดยเก็บเบอร์จริง
// ไว้ในคอลัมน์ profiles.phone เพื่อโชว์/ค้นหา ผู้ใช้จะไม่เห็นอีเมลปลอมนี้เลย
// ------------------------------------------------------------

// ทำให้เบอร์อยู่ในรูปแบบเดียวกันเสมอ ไม่ว่าจะพิมพ์ 08x, +668x หรือ 668x
export function normalizePhone(raw = "") {
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) digits = "66" + digits.slice(1);
  return digits;
}

export function phoneToEmail(rawPhone) {
  return `p${normalizePhone(rawPhone)}@phone.kosen.local`;
}

export function isEmailLike(str = "") {
  return str.includes("@");
}

export function isPhoneLike(str = "") {
  const digits = str.replace(/[^\d]/g, "");
  return digits.length >= 9 && digits.length === str.replace(/[+\s-]/g, "").length;
}

// รับ "อีเมล / เบอร์โทร / username (profile_id)" แล้วคืนอีเมลจริงที่ใช้ล็อกอินกับ Supabase
export async function resolveLoginEmail(identifier) {
  const trimmed = identifier.trim();
  if (isEmailLike(trimmed)) return trimmed;
  if (isPhoneLike(trimmed)) return phoneToEmail(trimmed);

  // ไม่ใช่อีเมลและไม่ใช่เบอร์ -> ถือว่าเป็น username (profile_id) หาอีเมลจริงจาก DB
  const { data, error } = await supabase.rpc("get_login_email", { p_identifier: trimmed });
  if (error || !data) return null;
  return data;
}

export function initials(name = "") {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

// avatar เริ่มต้นถ้าผู้ใช้ยังไม่อัปโหลดรูป (สร้างเป็น data URI วงกลมตัวอักษรแรก)
export function avatarOrFallback(url, name) {
  if (url) return url;
  const letter = initials(name);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>
    <rect width='100%' height='100%' rx='48' fill='#6C7BFF'/>
    <text x='50%' y='58%' font-family='Kanit,sans-serif' font-size='42' fill='white'
      text-anchor='middle'>${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ------------------------------------------------------------
// แจ้งเตือนข้อความใหม่แบบเรียลไทม์ — ใช้ได้ทุกหน้า (home / profile / chat)
// เรียกครั้งเดียวตอนหน้าโหลดเสร็จ (หลังรู้ me.id แล้ว) จะคอยฟังข้อความใหม่
// ทุกบทสนทนาของฉัน แล้วเรียก onIncoming(message) เมื่อมีข้อความใหม่จากคนอื่น
// ------------------------------------------------------------
export async function watchIncomingMessages(myId, onIncoming) {
  const { data: convos } = await supabase
    .from("conversations")
    .select("id")
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);
  const myConvoIds = new Set((convos || []).map(c => c.id));

  const channel = supabase
    .channel(`incoming-messages-${myId}`)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages",
    }, async (payload) => {
      const msg = payload.new;
      if (msg.sender_id === myId) return;

      if (!myConvoIds.has(msg.conversation_id)) {
        // อาจเป็นบทสนทนาที่เพิ่งสร้างใหม่ (คนอื่นทักมาเป็นคนแรก) เช็คสดจาก DB อีกที
        const { data: c } = await supabase
          .from("conversations")
          .select("id")
          .eq("id", msg.conversation_id)
          .or(`user_a.eq.${myId},user_b.eq.${myId}`)
          .maybeSingle();
        if (!c) return;
        myConvoIds.add(msg.conversation_id);
      }
      onIncoming(msg);
    })
    .subscribe();

  return channel;
}

// แสดง toast แจ้งเตือนข้อความใหม่ พร้อมคลิกเพื่อไปเปิดแชทกับคนนั้นได้ทันที
export async function notifyNewMessage(msg) {
  const { data: sender } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", msg.sender_id)
    .single();
  const senderName = sender?.display_name || "เพื่อน";

  let preview = msg.content || "ส่งข้อความถึงคุณ";
  if (msg.media_type === "sticker") preview = "ส่งสติ๊กเกอร์ถึงคุณ";
  else if (msg.media_type === "image") preview = "ส่งรูปภาพถึงคุณ";
  else if (msg.media_type === "video") preview = "ส่งวิดีโอถึงคุณ";

  toast(`💬 ${senderName}: ${preview}`, () => {
    window.location.href = `chat.html?with=${msg.sender_id}`;
  });
}
