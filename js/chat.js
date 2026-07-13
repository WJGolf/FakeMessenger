import {
  supabase, requireAuth, getMyProfile, uploadToBucket, fileKind,
  timeAgo, escapeHtml, toast, avatarOrFallback,
  watchIncomingMessages, notifyNewMessage,
} from "./supabaseClient.js";

let me = null;
let activeConversationId = null;
let activeOtherProfile = null;
let realtimeChannel = null;

init();

async function init() {
  const session = await requireAuth();
  if (!session) return;
  me = await getMyProfile();
  if (!me) return;

  document.getElementById("myAvatarTop").src = avatarOrFallback(me.avatar_url, me.display_name);

  bindComposerControls();
  await loadConversations();
  watchIncomingMessages(me.id, (msg) => {
    if (msg.conversation_id === activeConversationId) return; // มองเห็นในเธรดที่เปิดอยู่แล้ว
    notifyNewMessage(msg);
    loadConversations();
  });

  // ถ้าเปิดมาจากปุ่ม "ส่งข้อความ" ในหน้าโปรไฟล์ ?with=<uid>
  const params = new URLSearchParams(location.search);
  const withId = params.get("with");
  if (withId) {
    const convoId = await findOrCreateConversation(withId);
    if (convoId) openConversation(convoId);
  }
}

// ------------------------------------------------------------
// CONVERSATION LIST
// ------------------------------------------------------------
async function loadConversations() {
  const { data: convos, error } = await supabase
    .from("conversations")
    .select("*, a:user_a(id,display_name,avatar_url,profile_id), b:user_b(id,display_name,avatar_url,profile_id)")
    .or(`user_a.eq.${me.id},user_b.eq.${me.id}`)
    .order("created_at", { ascending: false });

  if (error) { console.error(error); return; }

  const container = document.getElementById("convItems");
  if (!convos || convos.length === 0) {
    container.innerHTML = `<div class="empty-state">ยังไม่มีบทสนทนา ลองแอดเพื่อนแล้วเริ่มทักได้เลย</div>`;
    return;
  }

  const rows = await Promise.all(convos.map(async (c) => {
    const other = c.user_a === me.id ? c.b : c.a;
    const { data: lastMsgArr } = await supabase
      .from("messages")
      .select("content, media_type, created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const last = lastMsgArr?.[0];
    const preview = last
      ? (last.media_type ? `ส่ง${mediaLabel(last.media_type)}` : last.content)
      : "เริ่มบทสนทนา";
    return { id: c.id, other, preview };
  }));

  container.innerHTML = rows.map(r => `
    <div class="conv-item" data-id="${r.id}" data-other='${escapeHtml(JSON.stringify(r.other))}'>
      <img class="avatar avatar-md" src="${avatarOrFallback(r.other?.avatar_url, r.other?.display_name)}" />
      <div class="meta">
        <div class="name">${escapeHtml(r.other?.display_name || "ผู้ใช้")}</div>
        <div class="preview">${escapeHtml(r.preview)}</div>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".conv-item").forEach(item => {
    item.addEventListener("click", () => {
      const other = JSON.parse(item.dataset.other.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      openConversation(item.dataset.id, other);
    });
  });
}

function mediaLabel(type) {
  if (type === "image") return "รูปภาพ";
  if (type === "video") return "วิดีโอ";
  if (type === "sticker") return "สติ๊กเกอร์";
  return "ไฟล์";
}

async function findOrCreateConversation(otherId) {
  const [a, b] = [me.id, otherId].sort();
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_a", a)
    .eq("user_b", b)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_a: a, user_b: b })
    .select("id")
    .single();
  if (error) { toast("เริ่มบทสนทนาไม่สำเร็จ"); return null; }
  await loadConversations();
  return created.id;
}

// ------------------------------------------------------------
// ACTIVE THREAD
// ------------------------------------------------------------
async function openConversation(conversationId, otherProfile) {
  activeConversationId = conversationId;

  if (!otherProfile) {
    const { data: c } = await supabase
      .from("conversations")
      .select("*, a:user_a(id,display_name,avatar_url,profile_id), b:user_b(id,display_name,avatar_url,profile_id)")
      .eq("id", conversationId)
      .single();
    otherProfile = c.user_a === me.id ? c.b : c.a;
  }
  activeOtherProfile = otherProfile;

  document.getElementById("threadEmpty").style.display = "none";
  document.getElementById("threadActive").style.display = "flex";
  document.getElementById("threadAvatar").src = avatarOrFallback(otherProfile.avatar_url, otherProfile.display_name);
  document.getElementById("threadName").textContent = otherProfile.display_name;
  document.getElementById("threadPid").textContent = "@" + (otherProfile.profile_id || "");

  document.getElementById("chatShell").classList.add("thread-open");

  document.querySelectorAll(".conv-item").forEach(el => el.classList.toggle("active", el.dataset.id === conversationId));

  await loadMessages();
  subscribeRealtime();
  await loadStickerTray();
}

async function loadMessages() {
  const body = document.getElementById("threadBody");
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", activeConversationId)
    .order("created_at", { ascending: true });

  if (error) { console.error(error); return; }
  body.innerHTML = (msgs || []).map(renderMessage).join("");
  body.scrollTop = body.scrollHeight;
}

function renderMessage(m) {
  const mine = m.sender_id === me.id;
  let inner;
  if (m.media_type === "sticker") {
    inner = `<div class="bubble sticker"><img src="${m.media_url}" /></div>`;
  } else if (m.media_type === "image") {
    inner = `<div class="bubble"><img src="${m.media_url}" />${m.content ? `<div>${escapeHtml(m.content)}</div>` : ""}</div>`;
  } else if (m.media_type === "video") {
    inner = `<div class="bubble"><video src="${m.media_url}" controls></video>${m.content ? `<div>${escapeHtml(m.content)}</div>` : ""}</div>`;
  } else {
    inner = `<div class="bubble">${escapeHtml(m.content)}</div>`;
  }
  return `<div class="msg-row ${mine ? "mine" : ""}">${inner}</div>`;
}

function subscribeRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel(`messages-${activeConversationId}`)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages",
      filter: `conversation_id=eq.${activeConversationId}`,
    }, (payload) => {
      const body = document.getElementById("threadBody");
      body.insertAdjacentHTML("beforeend", renderMessage(payload.new));
      body.scrollTop = body.scrollHeight;
      loadConversations();
    })
    .subscribe();
}

// ------------------------------------------------------------
// SEND MESSAGE (text / media / sticker)
// ------------------------------------------------------------
function bindComposerControls() {
  document.getElementById("backToListBtn").addEventListener("click", () => {
    document.getElementById("chatShell").classList.remove("thread-open");
  });
  // visibility of the back button is handled purely by CSS (@media max-width:780px)
  // so it stays correct across resizes/orientation changes (e.g. iPad split view)

  document.getElementById("sendBtn").addEventListener("click", sendTextMessage);
  document.getElementById("textInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendTextMessage();
  });

  document.getElementById("mediaInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !activeConversationId) return;
    e.target.value = "";
    try {
      const media_type = fileKind(file);
      const media_url = await uploadToBucket("chat", file, me.id);
      await supabase.from("messages").insert({
        conversation_id: activeConversationId, sender_id: me.id, media_url, media_type,
      });
    } catch (err) {
      toast("ส่งไฟล์ไม่สำเร็จ: " + err.message);
    }
  });

  document.getElementById("stickerBtn").addEventListener("click", () => {
    const tray = document.getElementById("stickerTray");
    tray.style.display = tray.style.display === "none" ? "grid" : "none";
  });
}

async function sendTextMessage() {
  const input = document.getElementById("textInput");
  const text = input.value.trim();
  if (!text || !activeConversationId) return;
  input.value = "";
  const { error } = await supabase.from("messages").insert({
    conversation_id: activeConversationId, sender_id: me.id, content: text,
  });
  if (error) toast("ส่งข้อความไม่สำเร็จ");
}

async function loadStickerTray() {
  const tray = document.getElementById("stickerTray");
  const { data: mine } = await supabase.from("stickers").select("*").eq("owner_id", me.id);
  tray.innerHTML = (mine || []).map(s => `<img src="${s.image_url}" data-url="${s.image_url}" title="${escapeHtml(s.name || "")}" />`).join("")
    || `<div style="grid-column:1/-1;font-size:12px;color:var(--ink-soft);text-align:center;">ยังไม่มีสติ๊กเกอร์ ไปสร้างที่หน้าโปรไฟล์ได้เลย</div>`;

  tray.querySelectorAll("img").forEach(img => {
    img.addEventListener("click", async () => {
      tray.style.display = "none";
      await supabase.from("messages").insert({
        conversation_id: activeConversationId, sender_id: me.id,
        media_url: img.dataset.url, media_type: "sticker",
      });
    });
  });
}
