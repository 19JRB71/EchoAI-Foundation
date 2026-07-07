/*
 * EchoAI Website Chatbot Widget — self-contained, zero-dependency.
 *
 * Paste this onto any website:
 *   <script src="https://YOUR-ECHOAI-DOMAIN/chatbot-widget.js"
 *           data-brand-id="YOUR-BRAND-ID" defer></script>
 *
 * It renders a chat bubble in the bottom-right corner. The API base is derived
 * from the script's own src, so it works on WordPress, Squarespace, Wix, custom
 * HTML — anything. No external CSS/JS is loaded.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();

  var brandId = script && script.getAttribute("data-brand-id");
  if (!brandId) {
    console.error("[EchoAI] chatbot-widget.js: missing data-brand-id attribute");
    return;
  }

  // Derive the API origin from where this script was loaded.
  var apiBase = script.getAttribute("data-api-base");
  if (!apiBase) {
    try {
      apiBase = new URL(script.src).origin;
    } catch (e) {
      apiBase = "";
    }
  }
  apiBase = (apiBase || "").replace(/\/$/, "");

  var STORAGE_KEY = "echoai_chat_session_" + brandId;

  function getSessionId() {
    var id;
    try {
      id = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      id = null;
    }
    if (!id) {
      id =
        "s_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 10);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch (e) {
        /* private mode — session lives in memory for this page load */
      }
    }
    return id;
  }

  var sessionId = getSessionId();
  var config = {
    brandName: "Chat",
    greeting: "Hi! How can I help you today?",
    accentColor: "#f59e0b",
    avatarStyle: "initials",
  };
  var open = false;
  var greeted = false;
  var sending = false;

  // -- DOM construction ------------------------------------------------------
  var root = document.createElement("div");
  root.setAttribute("id", "echoai-chatbot-root");
  root.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:2147483000;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

  function contrastColor(hex) {
    var c = (hex || "#f59e0b").replace("#", "");
    if (c.length === 3) {
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    var r = parseInt(c.substr(0, 2), 16);
    var g = parseInt(c.substr(2, 2), 16);
    var b = parseInt(c.substr(4, 2), 16);
    var yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? "#111827" : "#ffffff";
  }

  function initials(name) {
    var parts = (name || "").trim().split(/\s+/).slice(0, 2);
    var s = parts.map(function (p) { return p.charAt(0); }).join("");
    return (s || "AI").toUpperCase();
  }

  function avatarMarkup() {
    if (config.avatarStyle === "robot") return "🤖";
    if (config.avatarStyle === "circle") return "●";
    return initials(config.brandName);
  }

  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
  }

  // Chat bubble (closed state)
  var bubble = document.createElement("button");
  bubble.setAttribute("aria-label", "Open chat");
  bubble.style.cssText =
    "width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;" +
    "box-shadow:0 6px 20px rgba(0,0,0,0.25);display:flex;align-items:center;" +
    "justify-content:center;transition:transform .15s ease;";
  bubble.innerHTML =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  bubble.onmouseenter = function () { bubble.style.transform = "scale(1.05)"; };
  bubble.onmouseleave = function () { bubble.style.transform = "scale(1)"; };

  // Chat panel (open state)
  var panel = document.createElement("div");
  panel.style.cssText =
    "display:none;flex-direction:column;width:360px;max-width:calc(100vw - 40px);" +
    "height:520px;max-height:calc(100vh - 120px);background:#ffffff;border-radius:16px;" +
    "overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.28);";

  var header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;gap:10px;padding:14px 16px;color:#fff;";

  var headerAvatar = document.createElement("div");
  headerAvatar.style.cssText =
    "width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.25);" +
    "display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;";

  var headerTitle = document.createElement("div");
  headerTitle.style.cssText = "flex:1;font-weight:600;font-size:15px;line-height:1.2;";

  var closeBtn = document.createElement("button");
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.innerHTML = "&times;";
  closeBtn.style.cssText =
    "background:none;border:none;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:0 4px;";
  closeBtn.onclick = toggle;

  header.appendChild(headerAvatar);
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);

  var messagesEl = document.createElement("div");
  messagesEl.style.cssText =
    "flex:1;overflow-y:auto;padding:16px;background:#f8fafc;display:flex;" +
    "flex-direction:column;gap:10px;";

  var form = document.createElement("form");
  form.style.cssText =
    "display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#fff;";

  var input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type your message…";
  input.autocomplete = "off";
  input.style.cssText =
    "flex:1;border:1px solid #d1d5db;border-radius:999px;padding:10px 14px;" +
    "font-size:14px;outline:none;color:#111827;";

  var sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  sendBtn.style.cssText =
    "border:none;border-radius:999px;padding:0 16px;font-size:14px;font-weight:600;" +
    "cursor:pointer;";

  var footer = document.createElement("div");
  footer.style.cssText =
    "text-align:center;font-size:11px;color:#9ca3af;padding:6px 0 10px;background:#fff;";
  footer.innerHTML = "Powered by EchoAI";

  form.appendChild(input);
  form.appendChild(sendBtn);
  panel.appendChild(header);
  panel.appendChild(messagesEl);
  panel.appendChild(form);
  panel.appendChild(footer);

  root.appendChild(panel);
  root.appendChild(bubble);

  function applyTheme() {
    var accent = config.accentColor || "#f59e0b";
    var fg = contrastColor(accent);
    bubble.style.background = accent;
    bubble.style.color = fg;
    header.style.background = accent;
    headerAvatar.style.color = fg;
    headerAvatar.textContent = avatarMarkup();
    headerTitle.textContent = config.brandName;
    sendBtn.style.background = accent;
    sendBtn.style.color = fg;
  }

  function addMessage(role, text) {
    var wrap = document.createElement("div");
    var isUser = role === "user";
    wrap.style.cssText =
      "max-width:80%;padding:10px 13px;border-radius:14px;font-size:14px;" +
      "line-height:1.4;word-wrap:break-word;white-space:pre-wrap;" +
      (isUser
        ? "align-self:flex-end;background:" +
          (config.accentColor || "#f59e0b") +
          ";color:" +
          contrastColor(config.accentColor) +
          ";border-bottom-right-radius:4px;"
        : "align-self:flex-start;background:#fff;color:#111827;border:1px solid #e5e7eb;border-bottom-left-radius:4px;");
    wrap.innerHTML = esc(text);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return wrap;
  }

  function showTyping() {
    var t = document.createElement("div");
    t.setAttribute("data-typing", "1");
    t.style.cssText =
      "align-self:flex-start;background:#fff;color:#9ca3af;border:1px solid #e5e7eb;" +
      "padding:10px 13px;border-radius:14px;font-size:14px;";
    t.textContent = "…";
    messagesEl.appendChild(t);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return t;
  }

  function toggle() {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    bubble.style.display = open ? "none" : "flex";
    if (open) {
      if (!greeted) {
        addMessage("assistant", config.greeting);
        greeted = true;
      }
      input.focus();
    }
  }
  bubble.onclick = toggle;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || sending) return;
    input.value = "";
    addMessage("user", text);
    sending = true;
    sendBtn.disabled = true;
    var typing = showTyping();

    fetch(apiBase + "/api/chatbot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, brandId: brandId, message: text }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        if (res.ok && res.data && res.data.reply) {
          addMessage("assistant", res.data.reply);
        } else {
          addMessage(
            "assistant",
            (res.data && res.data.error) ||
              "Sorry, something went wrong. Please try again.",
          );
        }
      })
      .catch(function () {
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        addMessage("assistant", "Sorry, I couldn't reach the server. Please try again.");
      })
      .finally(function () {
        sending = false;
        sendBtn.disabled = false;
        input.focus();
      });
  });

  // -- Boot: fetch config, then mount ---------------------------------------
  function mount() {
    applyTheme();
    document.body.appendChild(root);
  }

  fetch(apiBase + "/api/chatbot/config/" + encodeURIComponent(brandId))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (data) {
        config.brandName = data.brandName || config.brandName;
        config.greeting = data.greeting || config.greeting;
        config.accentColor = data.accentColor || config.accentColor;
        config.avatarStyle = data.avatarStyle || config.avatarStyle;
      }
    })
    .catch(function () { /* keep defaults */ })
    .finally(function () {
      if (document.body) {
        mount();
      } else {
        document.addEventListener("DOMContentLoaded", mount);
      }
    });
})();
