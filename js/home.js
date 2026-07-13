import {
  supabase, requireAuth, getMyProfile, uploadToBucket, fileKind,
  timeAgo, escapeHtml, toast, avatarOrFallback,
  watchIncomingMessages, notifyNewMessage,
} from "./supabaseClient.js";

let me = null;
let pendingMediaFile = null;

init();

async function init() {
  const session = await requireAuth();
  if (!session) return;
  me = await getMyProfile();
  if (!me) return;

  document.getElementById("myAvatarTop").src = avatarOrFallback(me.avatar_url, me.display_name);
  document.getElementById("myAvatarComposer").src = avatarOrFallback(me.avatar_url, me.display_name);

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.href = "index.html";
  });

  bindComposer();
  bindSearch();
  bindFriendRequests();
  loadFeed();
  loadSuggestions();
  refreshRequestBadge();
  watchIncomingMessages(me.id, notifyNewMessage);
}

// ------------------------------------------------------------
// COMPOSER
// ------------------------------------------------------------
function bindComposer() {
  const input = document.getElementById("postMediaInput");
  const preview = document.getElementById("mediaPreview");

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    pendingMediaFile = file;
    const kind = fileKind(file);
    const url = URL.createObjectURL(file);
    preview.innerHTML = kind === "video"
      ? `<video src="${url}" controls></video>`
      : `<img src="${url}" />`;
  });

  document.getElementById("submitPostBtn").addEventListener("click", async () => {
    const btn = document.getElementById("submitPostBtn");
    const contentEl = document.getElementById("postContent");
    const content = contentEl.value.trim();
    if (!content && !pendingMediaFile) { toast("พิมพ์อะไรสักอย่างหรือแนบไฟล์ก่อนนะ"); return; }

    btn.disabled = true; btn.textContent = "กำลังโพสต์...";
    try {
      let media_url = null, media_type = null;
      if (pendingMediaFile) {
        media_type = fileKind(pendingMediaFile);
        media_url = await uploadToBucket("posts", pendingMediaFile, me.id);
      }
      const { error } = await supabase.from("posts").insert({
        author_id: me.id, content, media_url, media_type,
      });
      if (error) throw error;

      contentEl.value = "";
      document.getElementById("mediaPreview").innerHTML = "";
      pendingMediaFile = null;
      input.value = "";
      toast("โพสต์แล้ว!");
      loadFeed();
    } catch (err) {
      toast("โพสต์ไม่สำเร็จ: " + err.message);
    } finally {
      btn.disabled = false; btn.textContent = "โพสต์";
    }
  });
}

// ------------------------------------------------------------
// FEED
// ------------------------------------------------------------
async function loadFeed() {
  const list = document.getElementById("feedList");
  const empty = document.getElementById("feedEmpty");
  list.innerHTML = "";

  const { data: posts, error } = await supabase
    .from("posts")
    .select("*, profiles:author_id(id, display_name, avatar_url, profile_id)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { toast("โหลดฟีดไม่สำเร็จ"); return; }
  if (!posts || posts.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  for (const post of posts) {
    const el = await renderPost(post);
    list.appendChild(el);
  }
}

async function renderPost(post) {
  const author = post.profiles || {};
  const [{ count: likeCount }, { data: myLike }, { count: commentCount }] = await Promise.all([
    supabase.from("post_likes").select("*", { count: "exact", head: true }).eq("post_id", post.id),
    supabase.from("post_likes").select("post_id").eq("post_id", post.id).eq("user_id", me.id).maybeSingle(),
    supabase.from("post_comments").select("*", { count: "exact", head: true }).eq("post_id", post.id),
  ]);

  const wrap = document.createElement("div");
  wrap.className = "post sticker-card";
  wrap.innerHTML = `
    <div class="post-head">
      <img class="avatar avatar-md" src="${avatarOrFallback(author.avatar_url, author.display_name)}" />
      <div class="who">
        <span class="name">${escapeHtml(author.display_name || "ผู้ใช้")}</span>
        <span class="time">${timeAgo(post.created_at)}</span>
      </div>
    </div>
    ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ""}
    ${post.media_url ? `<div class="post-media">${
        post.media_type === "video"
          ? `<video src="${post.media_url}" controls></video>`
          : `<img src="${post.media_url}" />`
      }</div>` : ""}
    <div class="post-stats">
      <span>❤️ ${likeCount || 0} คนถูกใจ</span>
      <span>${commentCount || 0} คอมเมนต์</span>
    </div>
    <div class="post-actions">
      <button class="post-action-btn like-btn ${myLike ? "liked" : ""}">❤️ ถูกใจ</button>
      <button class="post-action-btn comment-toggle-btn">💬 คอมเมนต์</button>
    </div>
    <div class="comments-block" style="display:none;">
      <div class="comment-list"></div>
      <div class="comment-input-row">
        <img class="avatar avatar-sm" src="${avatarOrFallback(me.avatar_url, me.display_name)}" />
        <input type="text" placeholder="เขียนคอมเมนต์..." class="comment-input" />
        <button type="button" class="comment-send-btn" title="ส่งคอมเมนต์">ส่ง</button>
      </div>
    </div>
  `;

  const likeBtn = wrap.querySelector(".like-btn");
  likeBtn.addEventListener("click", async () => {
    if (likeBtn.classList.contains("liked")) {
      await supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", me.id);
      likeBtn.classList.remove("liked");
    } else {
      await supabase.from("post_likes").insert({ post_id: post.id, user_id: me.id });
      likeBtn.classList.add("liked");
    }
    const { count } = await supabase.from("post_likes").select("*", { count: "exact", head: true }).eq("post_id", post.id);
    wrap.querySelector(".post-stats span").textContent = `❤️ ${count || 0} คนถูกใจ`;
  });

  const commentsBlock = wrap.querySelector(".comments-block");
  const commentToggle = wrap.querySelector(".comment-toggle-btn");
  const commentList = wrap.querySelector(".comment-list");
  let commentsLoaded = false;

  commentToggle.addEventListener("click", async () => {
    commentsBlock.style.display = commentsBlock.style.display === "none" ? "block" : "none";
    if (!commentsLoaded && commentsBlock.style.display === "block") {
      commentsLoaded = true;
      await loadComments(post.id, commentList);
    }
  });

  const commentInput = wrap.querySelector(".comment-input");
  const commentSendBtn = wrap.querySelector(".comment-send-btn");

  async function submitComment() {
    const text = commentInput.value.trim();
    if (!text) return;
    commentInput.value = "";
    const { error } = await supabase.from("post_comments").insert({
      post_id: post.id, author_id: me.id, content: text,
    });
    if (error) { toast("คอมเมนต์ไม่สำเร็จ"); return; }
    await loadComments(post.id, commentList);
    const { count } = await supabase.from("post_comments").select("*", { count: "exact", head: true }).eq("post_id", post.id);
    wrap.querySelectorAll(".post-stats span")[1].textContent = `${count || 0} คอมเมนต์`;
  }

  commentInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    submitComment();
  });
  commentSendBtn.addEventListener("click", submitComment);

  return wrap;
}

async function loadComments(postId, container) {
  const { data: comments } = await supabase
    .from("post_comments")
    .select("*, profiles:author_id(display_name, avatar_url)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  container.innerHTML = (comments || []).map(c => `
    <div class="comment-row">
      <img class="avatar avatar-sm" src="${avatarOrFallback(c.profiles?.avatar_url, c.profiles?.display_name)}" />
      <div class="comment-bubble">
        <div class="name">${escapeHtml(c.profiles?.display_name || "ผู้ใช้")}</div>
        <div class="text">${escapeHtml(c.content)}</div>
      </div>
    </div>
  `).join("");
}

// ------------------------------------------------------------
// SEARCH (ชื่อ หรือ profile id)
// ------------------------------------------------------------
function bindSearch() {
  const input = document.getElementById("searchInput");
  const modal = document.getElementById("searchModal");
  document.getElementById("closeSearchModal").addEventListener("click", () => modal.style.display = "none");

  let debounce;
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    clearTimeout(debounce);
    await runSearch(input.value.trim());
  });
}

async function runSearch(term) {
  const modal = document.getElementById("searchModal");
  const results = document.getElementById("searchResults");
  if (!term) return;

  const { data: people } = await supabase
    .from("profiles")
    .select("*")
    .or(`display_name.ilike.%${term}%,profile_id.ilike.%${term}%`)
    .neq("id", me.id)
    .limit(24);

  results.innerHTML = (people || []).map(p => `
    <div class="people-card sticker-card">
      <img class="avatar avatar-lg" src="${avatarOrFallback(p.avatar_url, p.display_name)}" />
      <div class="name">${escapeHtml(p.display_name)}</div>
      <div class="pid mono">@${escapeHtml(p.profile_id)}</div>
      <a class="pill-btn ghost" href="profile.html?id=${p.id}" style="display:inline-block;margin-bottom:6px;">ดูโปรไฟล์</a>
      <button class="pill-btn add-friend-btn" data-id="${p.id}" style="width:100%;">เพิ่มเพื่อน</button>
    </div>
  `).join("") || `<div class="empty-state">ไม่พบผู้ใช้ที่ตรงกับ "${escapeHtml(term)}"</div>`;

  results.querySelectorAll(".add-friend-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.from("friendships").insert({
        requester_id: me.id, addressee_id: btn.dataset.id, status: "pending",
      });
      if (error) { toast("ส่งคำขอไม่สำเร็จ (อาจส่งไปแล้ว)"); return; }
      btn.textContent = "ส่งคำขอแล้ว";
      btn.disabled = true;
    });
  });

  modal.style.display = "flex";
}

// ------------------------------------------------------------
// FRIEND SUGGESTIONS (right rail)
// ------------------------------------------------------------
async function loadSuggestions() {
  const { data: people } = await supabase
    .from("profiles")
    .select("*")
    .neq("id", me.id)
    .limit(6);

  const list = document.getElementById("suggestList");
  list.innerHTML = (people || []).map(p => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
      <img class="avatar avatar-sm" src="${avatarOrFallback(p.avatar_url, p.display_name)}" />
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.display_name)}</div>
      </div>
      <button class="icon-btn quick-add-btn" data-id="${p.id}" title="เพิ่มเพื่อน">➕</button>
    </div>
  `).join("") || `<div style="color:var(--ink-soft);font-size:13px;">ยังไม่มีคนแนะนำตอนนี้</div>`;

  list.querySelectorAll(".quick-add-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.from("friendships").insert({
        requester_id: me.id, addressee_id: btn.dataset.id, status: "pending",
      });
      if (error) { toast("ส่งคำขอไม่สำเร็จ (อาจส่งไปแล้ว)"); return; }
      btn.textContent = "✅";
      btn.disabled = true;
    });
  });
}

// ------------------------------------------------------------
// FRIEND REQUESTS (incoming)
// ------------------------------------------------------------
function bindFriendRequests() {
  const modal = document.getElementById("reqModal");
  document.getElementById("friendReqBtn").addEventListener("click", async () => {
    await loadFriendRequests();
    modal.style.display = "flex";
  });
  document.getElementById("closeReqModal").addEventListener("click", () => modal.style.display = "none");
}

async function refreshRequestBadge() {
  const { count } = await supabase
    .from("friendships")
    .select("*", { count: "exact", head: true })
    .eq("addressee_id", me.id)
    .eq("status", "pending");

  const badge = document.getElementById("reqBadge");
  if (count && count > 0) {
    badge.style.display = "flex";
    badge.textContent = count;
  } else {
    badge.style.display = "none";
  }
}

async function loadFriendRequests() {
  const { data: reqs } = await supabase
    .from("friendships")
    .select("*, profiles:requester_id(id, display_name, avatar_url, profile_id)")
    .eq("addressee_id", me.id)
    .eq("status", "pending");

  const list = document.getElementById("reqList");
  list.innerHTML = (reqs || []).map(r => `
    <div class="friend-req-row">
      <img class="avatar avatar-sm" src="${avatarOrFallback(r.profiles?.avatar_url, r.profiles?.display_name)}" />
      <div class="meta">
        <div style="font-weight:600;">${escapeHtml(r.profiles?.display_name || "ผู้ใช้")}</div>
        <div class="pid mono" style="font-size:12px;color:var(--ink-soft);">@${escapeHtml(r.profiles?.profile_id || "")}</div>
      </div>
      <button class="pill-btn accept-btn" data-id="${r.id}">ยอมรับ</button>
      <button class="pill-btn ghost decline-btn" data-id="${r.id}">ปฏิเสธ</button>
    </div>
  `).join("") || `<div class="empty-state">ไม่มีคำขอเป็นเพื่อนตอนนี้</div>`;

  list.querySelectorAll(".accept-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await supabase.from("friendships").update({ status: "accepted" }).eq("id", btn.dataset.id);
      toast("เพิ่มเพื่อนแล้ว!");
      loadFriendRequests(); refreshRequestBadge();
    });
  });
  list.querySelectorAll(".decline-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await supabase.from("friendships").update({ status: "declined" }).eq("id", btn.dataset.id);
      loadFriendRequests(); refreshRequestBadge();
    });
  });
}