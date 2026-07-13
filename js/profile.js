import {
  supabase, requireAuth, getMyProfile, uploadToBucket,
  timeAgo, escapeHtml, toast, avatarOrFallback,
} from "./supabaseClient.js";

let me = null;
let viewed = null;
let isOwn = false;

init();

async function init() {
  const session = await requireAuth();
  if (!session) return;
  me = await getMyProfile();
  if (!me) return;

  document.getElementById("myAvatarTop").src = avatarOrFallback(me.avatar_url, me.display_name);

  const params = new URLSearchParams(location.search);
  const viewedId = params.get("id") || me.id;
  isOwn = viewedId === me.id;

  const { data, error } = await supabase.from("profiles").select("*").eq("id", viewedId).single();
  if (error || !data) { toast("ไม่พบผู้ใช้นี้"); return; }
  viewed = data;

  renderHeader();
  bindTabs();
  loadPosts();

  if (isOwn) {
    document.getElementById("settingsTabBtn").style.display = "inline-block";
    bindOwnControls();
    document.getElementById("editName").value = me.display_name || "";
    document.getElementById("editBio").value = me.bio || "";
  } else {
    await renderFriendAction();
  }

  // ถ้ามี #hash เช่น profile.html#friends ให้เปิดแท็บนั้นทันที
  const hash = location.hash.replace("#", "");
  if (hash) {
    const tabBtn = document.querySelector(`.profile-tab[data-tab="${hash}"]`);
    if (tabBtn) tabBtn.click();
  }
}

function renderHeader() {
  document.getElementById("coverImg").style.backgroundImage = viewed.cover_url ? `url(${viewed.cover_url})` : "";
  document.getElementById("avatarImg").src = avatarOrFallback(viewed.avatar_url, viewed.display_name);
  document.getElementById("profileName").textContent = viewed.display_name;
  document.getElementById("profilePid").textContent = "@" + viewed.profile_id;
  document.getElementById("profileBio").textContent = viewed.bio || (isOwn ? "ยังไม่ได้เขียนคำอธิบายตัวเอง — ไปที่แท็บตั้งค่าเพื่อเพิ่มได้เลย" : "");

  document.getElementById("changeCoverBtn").style.display = isOwn ? "inline-flex" : "none";
  document.getElementById("changeAvatarBtn").style.display = isOwn ? "flex" : "none";
}

// ------------------------------------------------------------
// TABS
// ------------------------------------------------------------
function bindTabs() {
  document.querySelectorAll(".profile-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".profile-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p => {
        p.style.display = p.dataset.panel === tab ? "block" : "none";
      });
      if (tab === "friends") loadFriends();
      if (tab === "stickers") loadStickers();
    });
  });
}

// ------------------------------------------------------------
// POSTS TAB
// ------------------------------------------------------------
async function loadPosts() {
  const { data: posts } = await supabase
    .from("posts")
    .select("*")
    .eq("author_id", viewed.id)
    .order("created_at", { ascending: false });

  const container = document.getElementById("ownPosts");
  if (!posts || posts.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="big">📝</div>ยังไม่มีโพสต์</div>`;
    return;
  }
  container.innerHTML = posts.map(p => `
    <div class="post sticker-card">
      <div class="post-head">
        <img class="avatar avatar-md" src="${avatarOrFallback(viewed.avatar_url, viewed.display_name)}" />
        <div class="who">
          <span class="name">${escapeHtml(viewed.display_name)}</span>
          <span class="time">${timeAgo(p.created_at)}</span>
        </div>
      </div>
      ${p.content ? `<div class="post-content">${escapeHtml(p.content)}</div>` : ""}
      ${p.media_url ? `<div class="post-media">${
          p.media_type === "video" ? `<video src="${p.media_url}" controls></video>` : `<img src="${p.media_url}" />`
        }</div>` : ""}
    </div>
  `).join("");
}

// ------------------------------------------------------------
// FRIENDS TAB
// ------------------------------------------------------------
async function loadFriends() {
  const grid = document.getElementById("friendsGrid");
  const { data: rows } = await supabase
    .from("friendships")
    .select("*, a:requester_id(id,display_name,avatar_url,profile_id), b:addressee_id(id,display_name,avatar_url,profile_id)")
    .eq("status", "accepted")
    .or(`requester_id.eq.${viewed.id},addressee_id.eq.${viewed.id}`);

  const friends = (rows || []).map(r => (r.a.id === viewed.id ? r.b : r.a));
  if (friends.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">ยังไม่มีเพื่อน</div>`;
    return;
  }
  grid.innerHTML = friends.map(f => `
    <div class="people-card sticker-card">
      <img class="avatar avatar-lg" src="${avatarOrFallback(f.avatar_url, f.display_name)}" />
      <div class="name">${escapeHtml(f.display_name)}</div>
      <div class="pid mono">@${escapeHtml(f.profile_id)}</div>
      <a class="pill-btn ghost" href="profile.html?id=${f.id}" style="display:block;">ดูโปรไฟล์</a>
    </div>
  `).join("");
}

// ------------------------------------------------------------
// STICKERS TAB
// ------------------------------------------------------------
async function loadStickers() {
  document.querySelector('[data-panel="stickers"] .rail-card').style.display = isOwn ? "block" : "none";

  const { data: stickers } = await supabase.from("stickers").select("*").eq("owner_id", viewed.id);
  const grid = document.getElementById("stickerGrid");
  if (!stickers || stickers.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">ยังไม่มีสติ๊กเกอร์</div>`;
    return;
  }
  grid.innerHTML = stickers.map(s => `
    <div class="people-card sticker-card">
      <img src="${s.image_url}" style="width:80px;height:80px;border-radius:10px;object-fit:cover;" />
      <div class="name">${escapeHtml(s.name || "ไม่มีชื่อ")}</div>
      ${isOwn ? `<button class="pill-btn ghost del-sticker-btn" data-id="${s.id}" style="width:100%;">ลบ</button>` : ""}
    </div>
  `).join("");

  grid.querySelectorAll(".del-sticker-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await supabase.from("stickers").delete().eq("id", btn.dataset.id);
      loadStickers();
    });
  });
}

// ------------------------------------------------------------
// FRIEND ACTION BUTTON (viewing someone else)
// ------------------------------------------------------------
async function renderFriendAction() {
  const container = document.getElementById("actionButtons");
  container.innerHTML = `<a class="pill-btn" href="chat.html?with=${viewed.id}">💬 ส่งข้อความ</a>`;

  const { data: existing } = await supabase
    .from("friendships")
    .select("*")
    .or(`and(requester_id.eq.${me.id},addressee_id.eq.${viewed.id}),and(requester_id.eq.${viewed.id},addressee_id.eq.${me.id})`)
    .maybeSingle();

  const btn = document.createElement("button");
  btn.className = "pill-btn ghost";

  if (!existing) {
    btn.textContent = "➕ เพิ่มเพื่อน";
    btn.addEventListener("click", async () => {
      const { error } = await supabase.from("friendships").insert({ requester_id: me.id, addressee_id: viewed.id, status: "pending" });
      if (!error) { btn.textContent = "⏳ ส่งคำขอแล้ว"; btn.disabled = true; }
    });
  } else if (existing.status === "accepted") {
    btn.textContent = "✅ เพื่อนกันแล้ว";
    btn.disabled = true;
  } else if (existing.status === "pending" && existing.requester_id === me.id) {
    btn.textContent = "⏳ ส่งคำขอแล้ว";
    btn.disabled = true;
  } else if (existing.status === "pending" && existing.addressee_id === me.id) {
    btn.textContent = "✔️ ยอมรับคำขอเพื่อน";
    btn.addEventListener("click", async () => {
      await supabase.from("friendships").update({ status: "accepted" }).eq("id", existing.id);
      btn.textContent = "✅ เพื่อนกันแล้ว"; btn.disabled = true;
    });
  } else {
    btn.textContent = "➕ เพิ่มเพื่อน";
  }
  container.appendChild(btn);
}

// ------------------------------------------------------------
// OWN-PROFILE CONTROLS: avatar/cover upload, edit, password, sticker create
// ------------------------------------------------------------
function bindOwnControls() {
  document.getElementById("changeAvatarBtn").addEventListener("click", () => document.getElementById("avatarInput").click());
  document.getElementById("avatarInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = await uploadToBucket("avatars", file, me.id);
    await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
    viewed.avatar_url = url;
    document.getElementById("avatarImg").src = url;
    document.getElementById("myAvatarTop").src = url;
    toast("อัปเดตรูปโปรไฟล์แล้ว");
  });

  document.getElementById("changeCoverBtn").addEventListener("click", () => document.getElementById("coverInput").click());
  document.getElementById("coverInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = await uploadToBucket("covers", file, me.id);
    await supabase.from("profiles").update({ cover_url: url }).eq("id", me.id);
    document.getElementById("coverImg").style.backgroundImage = `url(${url})`;
    toast("อัปเดตปกโปรไฟล์แล้ว");
  });

  document.getElementById("saveProfileBtn").addEventListener("click", async () => {
    const display_name = document.getElementById("editName").value.trim();
    const bio = document.getElementById("editBio").value.trim();
    const msg = document.getElementById("profileSaveMsg");
    if (!display_name) { msg.textContent = "กรุณาใส่ชื่อที่แสดง"; return; }
    const { error } = await supabase.from("profiles").update({ display_name, bio }).eq("id", me.id);
    msg.textContent = error ? "บันทึกไม่สำเร็จ: " + error.message : "บันทึกแล้ว!";
    if (!error) {
      document.getElementById("profileName").textContent = display_name;
      document.getElementById("profileBio").textContent = bio;
    }
  });

  document.getElementById("changePasswordBtn").addEventListener("click", async () => {
    const p1 = document.getElementById("newPassword").value;
    const p2 = document.getElementById("confirmPassword").value;
    const msg = document.getElementById("passwordMsg");
    if (p1.length < 6) { msg.textContent = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"; return; }
    if (p1 !== p2) { msg.textContent = "รหัสผ่านไม่ตรงกัน"; return; }
    const { error } = await supabase.auth.updateUser({ password: p1 });
    msg.textContent = error ? "เปลี่ยนรหัสผ่านไม่สำเร็จ: " + error.message : "เปลี่ยนรหัสผ่านสำเร็จแล้ว!";
    if (!error) { document.getElementById("newPassword").value = ""; document.getElementById("confirmPassword").value = ""; }
  });

  document.getElementById("createStickerBtn").addEventListener("click", async () => {
    const file = document.getElementById("stickerFileInput").files[0];
    const name = document.getElementById("stickerName").value.trim();
    if (!file) { toast("เลือกรูปภาพก่อนนะ"); return; }
    try {
      const url = await uploadToBucket("stickers", file, me.id);
      await supabase.from("stickers").insert({ owner_id: me.id, image_url: url, name });
      document.getElementById("stickerName").value = "";
      document.getElementById("stickerFileInput").value = "";
      toast("สร้างสติ๊กเกอร์แล้ว!");
      loadStickers();
    } catch (err) {
      toast("สร้างสติ๊กเกอร์ไม่สำเร็จ: " + err.message);
    }
  });
}
