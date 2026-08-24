(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const runtime = window.TW_STORE_CONFIG || {};
  const API_URL = runtime.apiBaseUrl || "https://tw-store-application.up.railway.app";
  const REQUEST_TIMEOUT_MS = Number(runtime.requestTimeoutMs) || 15_000;
  const WHATSAPP_URL = "https://wa.me/5512983087742";
  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");
  const featureState = { profile: null, profileLoaded: false, adminInjected: false };

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  }

  function saveSession(value) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function icon(name) {
    const paths = {
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      ticket: '<path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4Z"/><path d="M9 8h6M9 12h4"/>',
      whatsapp: '<path d="M20.5 11.6a8.5 8.5 0 0 1-12.5 7.5L3 20.5l1.4-4.8A8.5 8.5 0 1 1 20.5 11.6Z"/><path d="M8.2 7.8c.3-.6.7-.6 1-.2l1 1.8c.2.4.1.7-.2 1l-.6.7c.7 1.4 1.8 2.5 3.3 3.2l.7-.8c.3-.3.6-.4 1-.2l1.8.9c.5.2.6.6.4 1.1-.4 1.1-1.4 1.7-2.5 1.6-3.8-.4-7-3.3-7.7-7-.2-.8.1-1.5.8-2.1Z"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
      camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"/><circle cx="12" cy="13" r="3"/>',
      chevron: '<path d="m9 18 6-6-6-6"/>',
      back: '<path d="m15 18-6-6 6-6"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      send: '<path d="m3 11 18-8-8 18-2-8Z"/><path d="m11 13 4-4"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      support: '<path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 13h3v6H5a1 1 0 0 1-1-1ZM20 13h-3v6h2a1 1 0 0 0 1-1Z"/><path d="M17 19c0 1-1.5 2-3 2h-2"/>',
    };
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.user) + "</svg>";
  }

  function toast(message, error) {
    if (!toastRegion) return;
    toastRegion.innerHTML = '<div class="toast ' + (error ? "error" : "") + '">' + escapeHtml(message) + "</div>";
    setTimeout(function () { toastRegion.innerHTML = ""; }, 3800);
  }

  async function api(path, options) {
    const opts = options || {};
    const current = session();
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API_URL + path, {
        method: opts.method || "GET",
        headers: {
          Accept: "application/json",
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
          ...(!opts.public && current && current.token ? { Authorization: "Bearer " + current.token } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!response.ok) {
        const err = new Error(data.error || "Não foi possível concluir a solicitação.");
        err.status = response.status;
        throw err;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("O servidor demorou demais para responder.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function initials(value) {
    return String(value || "T").trim().charAt(0).toUpperCase() || "T";
  }

  function topbar(title) {
    const current = session() || {};
    const photo = featureState.profile && featureState.profile.profilePhoto;
    const avatarStyle = photo ? ' style="background-image:url(\'' + String(photo).replace(/'/g, "%27") + '\');background-size:cover;background-position:center;color:transparent"' : "";
    return '<header class="topbar"><div><div class="eyebrow">' + escapeHtml(title || "Configurações") + '</div><div class="brand-name">Tw Store</div></div><div class="avatar"' + avatarStyle + '>' + escapeHtml(initials(current.member || current.username)) + "</div></header>";
  }

  function bottomNav(active) {
    const items = [
      ["home", "Início", "⌂"], ["new-order", "Pedido", "+"], ["orders", "Histórico", "▤"], ["wallet", "Carteira", "▣"], ["settings", "Ajustes", "⚙"]
    ];
    return '<nav class="bottom-nav" aria-label="Navegação principal">' + items.map(function (item) {
      return '<button type="button" class="nav-item ' + (active === item[0] ? "active" : "") + '" data-nav="' + item[0] + '"><span class="feature-nav-glyph">' + item[2] + "</span><span>" + item[1] + "</span></button>";
    }).join("") + "</nav>";
  }

  function memberShell(content, title) {
    return '<div class="app-shell"><main class="page feature-page">' + topbar(title) + content + "</main>" + bottomNav("settings") + "</div>";
  }

  function backHeader(title, subtitle, action) {
    return '<section class="feature-back-heading"><button type="button" class="feature-back-button" data-feature-action="' + escapeHtml(action || "settings-home") + '">' + icon("back") + '</button><div><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(subtitle || "") + "</p></div></section>";
  }

  async function loadProfile(force) {
    const current = session();
    if (!current || current.role !== "member") return null;
    if (featureState.profileLoaded && !force) return featureState.profile;
    try {
      featureState.profile = await api("/api/account");
      featureState.profileLoaded = true;
      applyAvatars();
      return featureState.profile;
    } catch {
      return null;
    }
  }

  function applyAvatars() {
    const photo = featureState.profile && featureState.profile.profilePhoto;
    if (!photo) return;
    document.querySelectorAll(".avatar").forEach(function (node) {
      node.style.backgroundImage = "url('" + String(photo).replace(/'/g, "%27") + "')";
      node.style.backgroundSize = "cover";
      node.style.backgroundPosition = "center";
      node.style.color = "transparent";
    });
  }

  function renderSettingsHub() {
    const current = session();
    if (!current || current.role !== "member") return;
    app.innerHTML = memberShell(
      '<section class="page-heading feature-heading"><h1>Ajustes</h1><p class="subtitle">Gerencie sua conta e fale com o suporte.</p></section>' +
      '<section class="feature-menu">' +
        '<button class="feature-option" type="button" data-feature-action="account"><span class="feature-option-icon">' + icon("user") + '</span><span class="feature-option-copy"><strong>Conta</strong><small>Foto de perfil, senha e acesso da conta</small></span><span class="feature-option-arrow">' + icon("chevron") + "</span></button>" +
        '<button class="feature-option" type="button" data-feature-action="tickets"><span class="feature-option-icon">' + icon("ticket") + '</span><span class="feature-option-copy"><strong>Ticket</strong><small>Crie um atendimento e converse com o suporte</small></span><span class="feature-option-arrow">' + icon("chevron") + "</span></button>" +
        '<button class="feature-option feature-option-whatsapp" type="button" data-feature-action="whatsapp"><span class="feature-option-icon">' + icon("whatsapp") + '</span><span class="feature-option-copy"><strong>WhatsApp</strong><small>Fale diretamente com o responsável pelo aplicativo</small></span><span class="feature-option-arrow">' + icon("chevron") + "</span></button>" +
      "</section>",
      "Configurações"
    );
    window.scrollTo(0, 0);
    loadProfile().then(applyAvatars);
  }

  async function renderAccount() {
    const current = session();
    if (!current || current.role !== "member") return;
    app.innerHTML = memberShell(backHeader("Conta", "Gerencie seus dados e segurança.") + '<div class="card feature-loading">Carregando sua conta…</div>', "Conta");
    const profile = await loadProfile(true);
    if (!profile) {
      app.innerHTML = memberShell(backHeader("Conta", "Gerencie seus dados e segurança.") + '<div class="card feature-error">Não foi possível carregar os dados da conta.</div>', "Conta");
      return;
    }
    const photo = profile.profilePhoto;
    app.innerHTML = memberShell(
      backHeader("Conta", "Gerencie seus dados e segurança.") +
      '<section class="card feature-profile-card"><div class="feature-photo-wrap"><div class="feature-photo" data-feature-photo ' + (photo ? 'style="background-image:url(\'' + String(photo).replace(/'/g, "%27") + '\')"' : "") + '>' + (photo ? "" : escapeHtml(initials(profile.name || profile.username))) + '</div><button type="button" class="feature-camera" data-feature-action="choose-photo" aria-label="Alterar foto">' + icon("camera") + '</button><input type="file" accept="image/*" data-feature-photo-input hidden /></div><div class="feature-profile-copy"><strong>' + escapeHtml(profile.name) + '</strong><span>@' + escapeHtml(profile.username) + "</span></div></section>" +
      '<section class="card feature-section-card"><div class="feature-section-title">' + icon("lock") + '<div><h2>Alterar senha</h2><p>Use sua senha atual para definir uma nova.</p></div></div><form class="form-stack" data-feature-form="password"><label class="field"><span class="field-label">Senha atual</span><input class="field-control" name="currentPassword" type="password" autocomplete="current-password" required /></label><label class="field"><span class="field-label">Nova senha</span><input class="field-control" name="newPassword" type="password" minlength="6" autocomplete="new-password" required /></label><label class="field"><span class="field-label">Confirmar nova senha</span><input class="field-control" name="confirmPassword" type="password" minlength="6" autocomplete="new-password" required /></label><button class="button button-primary" type="submit">Salvar nova senha</button></form></section>' +
      '<button type="button" class="button button-danger feature-logout" data-feature-action="logout">' + icon("logout") + " Desconectar da conta</button>",
      "Conta"
    );
    applyAvatars();
  }

  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Não foi possível ler a imagem.")); };
      reader.onload = function () {
        const image = new Image();
        image.onerror = function () { reject(new Error("A imagem selecionada é inválida.")); };
        image.onload = function () {
          const size = 256;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / image.width, size / image.height);
          const w = image.width * scale;
          const h = image.height * scale;
          ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
          let quality = 0.78;
          let output = canvas.toDataURL("image/jpeg", quality);
          while (output.length > 90000 && quality > 0.35) {
            quality -= 0.08;
            output = canvas.toDataURL("image/jpeg", quality);
          }
          if (output.length > 95000) return reject(new Error("A foto ficou muito grande. Escolha outra imagem."));
          resolve(output);
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function ticketStatus(status) {
    const map = { open: "Aguardando suporte", answered: "Respondido", closed: "Encerrado" };
    return map[String(status || "open")] || status;
  }

  function ticketStatusClass(status) {
    return "feature-status-" + String(status || "open").replace(/[^a-z]/g, "");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  async function renderTickets() {
    app.innerHTML = memberShell(backHeader("Tickets", "Converse com o suporte pelo aplicativo.") + '<div class="feature-ticket-actions"><button class="button button-primary" type="button" data-feature-action="new-ticket">' + icon("plus") + ' Criar ticket</button></div><div class="card feature-loading">Carregando tickets…</div>', "Suporte");
    try {
      const tickets = await api("/api/tickets");
      app.innerHTML = memberShell(
        backHeader("Tickets", "Converse com o suporte pelo aplicativo.") +
        '<div class="feature-ticket-actions"><button class="button button-primary" type="button" data-feature-action="new-ticket">' + icon("plus") + " Criar ticket</button></div>" +
        (tickets.length ? '<div class="feature-ticket-list">' + tickets.map(function (ticket) {
          return '<button type="button" class="card feature-ticket-card" data-feature-action="ticket-detail" data-ticket-id="' + escapeHtml(ticket.id) + '"><div class="feature-ticket-head"><strong>' + escapeHtml(ticket.subject) + '</strong><span class="feature-status ' + ticketStatusClass(ticket.status) + '">' + escapeHtml(ticketStatus(ticket.status)) + '</span></div><p>' + escapeHtml(ticket.lastMessage || "Sem mensagens") + '</p><div class="feature-ticket-meta"><span>#' + escapeHtml(String(ticket.id).slice(0, 8)) + '</span><span>' + escapeHtml(formatDate(ticket.lastMessageAt || ticket.updatedAt)) + "</span></div></button>";
        }).join("") + "</div>" : '<div class="card empty-state"><div class="empty-icon">' + icon("ticket") + '</div><h3>Nenhum ticket ainda</h3><p>Crie um atendimento sempre que precisar de ajuda.</p></div>'),
        "Suporte"
      );
      applyAvatars();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderNewTicket() {
    app.innerHTML = memberShell(
      backHeader("Novo ticket", "Explique o que aconteceu para o suporte.", "tickets") +
      '<section class="card feature-section-card"><form class="form-stack" data-feature-form="new-ticket"><label class="field"><span class="field-label">Assunto</span><input class="field-control" name="subject" minlength="3" maxlength="120" placeholder="Ex.: Dúvida sobre meu pedido" required /></label><label class="field"><span class="field-label">Mensagem</span><textarea class="field-control feature-textarea" name="message" minlength="2" maxlength="4000" placeholder="Descreva sua dúvida com detalhes…" required></textarea></label><button class="button button-primary" type="submit">' + icon("send") + " Enviar ticket</button></form></section>",
      "Novo ticket"
    );
    applyAvatars();
  }

  async function renderTicketDetail(ticketId, adminMode) {
    const baseTitle = adminMode ? "Atendimento" : "Ticket";
    const backAction = adminMode ? "admin-tickets" : "tickets";
    app.innerHTML = adminMode
      ? adminShell('<div class="feature-loading card">Carregando atendimento…</div>')
      : memberShell(backHeader(baseTitle, "Carregando conversa…", backAction) + '<div class="feature-loading card">Carregando conversa…</div>', "Suporte");
    try {
      const ticket = await api((adminMode ? "/admin/tickets/" : "/api/tickets/") + encodeURIComponent(ticketId));
      const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
      const body =
        backHeader(ticket.subject, (adminMode ? "Cliente @" + ticket.username + " • " : "") + ticketStatus(ticket.status), backAction) +
        '<section class="feature-thread">' + messages.map(function (message) {
          const mine = adminMode ? message.senderRole === "admin" : message.senderRole === "member";
          return '<article class="feature-message ' + (mine ? "mine" : "theirs") + '"><div class="feature-message-label">' + escapeHtml(message.senderRole === "admin" ? "Suporte" : "@" + message.senderUsername) + '</div><p>' + escapeHtml(message.message) + '</p><time>' + escapeHtml(formatDate(message.createdAt)) + "</time></article>";
        }).join("") + "</section>" +
        (ticket.status !== "closed"
          ? '<section class="card feature-reply-card"><form class="feature-reply-form" data-feature-form="' + (adminMode ? "admin-reply" : "ticket-reply") + '" data-ticket-id="' + escapeHtml(ticket.id) + '"><textarea class="field-control" name="message" maxlength="4000" placeholder="Digite sua resposta…" required></textarea><button class="feature-send-button" type="submit" aria-label="Enviar">' + icon("send") + "</button></form></section>"
          : '<div class="feature-closed-note">Este ticket está encerrado.</div>') +
        '<div class="feature-ticket-footer">' + (adminMode
          ? (ticket.status === "closed" ? '<button class="button button-secondary" data-feature-action="admin-ticket-status" data-ticket-id="' + escapeHtml(ticket.id) + '" data-status="open">Reabrir ticket</button>' : '<button class="button button-danger" data-feature-action="admin-ticket-status" data-ticket-id="' + escapeHtml(ticket.id) + '" data-status="closed">Encerrar ticket</button>')
          : (ticket.status !== "closed" ? '<button class="button button-secondary" data-feature-action="close-ticket" data-ticket-id="' + escapeHtml(ticket.id) + '">' + icon("close") + " Encerrar ticket</button>" : "")) + "</div>";
      if (adminMode) app.innerHTML = adminShell(body);
      else app.innerHTML = memberShell(body, "Suporte");
      if (!adminMode) applyAvatars();
      window.scrollTo(0, document.body.scrollHeight);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function adminShell(content) {
    return '<div class="app-shell no-nav"><main class="page feature-page">' + topbar("Administração • Suporte") + content + '<button class="button button-secondary feature-admin-return" type="button" data-feature-action="admin-return">Voltar ao painel administrativo</button></main></div>';
  }

  async function renderAdminTickets() {
    app.innerHTML = adminShell(backHeader("Tickets de suporte", "Atendimentos enviados pelos clientes.", "admin-return") + '<div class="card feature-loading">Carregando tickets…</div>');
    try {
      const tickets = await api("/admin/tickets");
      app.innerHTML = adminShell(
        backHeader("Tickets de suporte", "Atendimentos enviados pelos clientes.", "admin-return") +
        (tickets.length ? '<div class="feature-ticket-list">' + tickets.map(function (ticket) {
          return '<button type="button" class="card feature-ticket-card" data-feature-action="admin-ticket-detail" data-ticket-id="' + escapeHtml(ticket.id) + '"><div class="feature-ticket-head"><strong>' + escapeHtml(ticket.subject) + '</strong><span class="feature-status ' + ticketStatusClass(ticket.status) + '">' + escapeHtml(ticketStatus(ticket.status)) + '</span></div><p>' + escapeHtml(ticket.lastMessage || "Sem mensagens") + '</p><div class="feature-ticket-meta"><span>@' + escapeHtml(ticket.username) + '</span><span>' + escapeHtml(formatDate(ticket.lastMessageAt || ticket.updatedAt)) + "</span></div></button>";
        }).join("") + "</div>" : '<div class="card empty-state"><h3>Nenhum ticket aberto</h3><p>Os atendimentos criados pelos clientes aparecerão aqui.</p></div>')
      );
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function injectAdminSupport() {
    const current = session();
    if (!current || current.role !== "admin") return;
    if (document.querySelector("[data-feature-admin-support]")) return;
    const heading = Array.from(document.querySelectorAll("h1")).find(function (node) { return /painel administrativo/i.test(node.textContent || ""); });
    if (!heading) return;
    const metrics = document.querySelector(".metrics");
    if (!metrics) return;
    const section = document.createElement("section");
    section.className = "card feature-admin-support-card";
    section.setAttribute("data-feature-admin-support", "true");
    section.innerHTML = '<div class="feature-admin-support-copy"><span class="feature-option-icon">' + icon("support") + '</span><div><h2>Tickets de suporte</h2><p>Leia e responda os atendimentos enviados pelos clientes.</p></div></div><button class="button button-primary" type="button" data-feature-action="admin-tickets">Abrir atendimentos</button>';
    metrics.insertAdjacentElement("afterend", section);
    try {
      const tickets = await api("/admin/tickets");
      const open = tickets.filter(function (item) { return item.status === "open"; }).length;
      if (open) {
        const h2 = section.querySelector("h2");
        h2.innerHTML = "Tickets de suporte <span class=\"feature-admin-badge\">" + open + "</span>";
      }
    } catch { /* não bloqueia o painel */ }
  }

  function hideAdminSelector() {
    document.querySelectorAll('[data-action="admin-login-screen"]').forEach(function (button) {
      const wrapper = button.closest(".auth-switch") || button;
      wrapper.style.display = "none";
    });
  }

  document.addEventListener("submit", async function (event) {
    const featureForm = event.target.closest("[data-feature-form]");
    if (!featureForm) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const type = featureForm.dataset.featureForm;
    const values = Object.fromEntries(new FormData(featureForm).entries());
    const submit = featureForm.querySelector('button[type="submit"]');
    const original = submit ? submit.innerHTML : "";
    if (submit) { submit.disabled = true; submit.textContent = "Aguarde…"; }
    try {
      if (type === "password") {
        if (String(values.newPassword || "").length < 6) throw new Error("A nova senha precisa ter pelo menos 6 caracteres.");
        if (values.newPassword !== values.confirmPassword) throw new Error("As novas senhas não coincidem.");
        const result = await api("/api/account/password", { method: "POST", body: { currentPassword: values.currentPassword, newPassword: values.newPassword } });
        saveSession({ ...(session() || {}), ...result });
        toast("Senha alterada com sucesso.");
        featureForm.reset();
      } else if (type === "new-ticket") {
        const ticket = await api("/api/tickets", { method: "POST", body: { subject: values.subject, message: values.message } });
        toast("Ticket criado com sucesso.");
        await renderTicketDetail(ticket.id, false);
      } else if (type === "ticket-reply") {
        const id = featureForm.dataset.ticketId;
        await api("/api/tickets/" + encodeURIComponent(id) + "/messages", { method: "POST", body: { message: values.message } });
        await renderTicketDetail(id, false);
      } else if (type === "admin-reply") {
        const id = featureForm.dataset.ticketId;
        await api("/admin/tickets/" + encodeURIComponent(id) + "/messages", { method: "POST", body: { message: values.message } });
        await renderTicketDetail(id, true);
      }
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (submit && document.body.contains(submit)) { submit.disabled = false; submit.innerHTML = original; }
    }
  }, true);

  document.addEventListener("click", async function (event) {
    const settingsNav = event.target.closest('[data-nav="settings"]');
    if (settingsNav && session() && session().role === "member") {
      event.preventDefault();
      event.stopImmediatePropagation();
      renderSettingsHub();
      return;
    }

    const button = event.target.closest("[data-feature-action]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = button.dataset.featureAction;
    const ticketId = button.dataset.ticketId;
    try {
      if (action === "settings-home") return renderSettingsHub();
      if (action === "account") return renderAccount();
      if (action === "tickets") return renderTickets();
      if (action === "new-ticket") return renderNewTicket();
      if (action === "ticket-detail") return renderTicketDetail(ticketId, false);
      if (action === "admin-tickets") return renderAdminTickets();
      if (action === "admin-ticket-detail") return renderTicketDetail(ticketId, true);
      if (action === "admin-return") return window.location.reload();
      if (action === "whatsapp") { window.location.href = WHATSAPP_URL; return; }
      if (action === "logout") {
        localStorage.removeItem(SESSION_KEY);
        window.location.reload();
        return;
      }
      if (action === "choose-photo") {
        const input = document.querySelector("[data-feature-photo-input]");
        if (input) input.click();
        return;
      }
      if (action === "close-ticket") {
        if (!window.confirm("Deseja encerrar este ticket?")) return;
        await api("/api/tickets/" + encodeURIComponent(ticketId) + "/close", { method: "PATCH" });
        toast("Ticket encerrado.");
        return renderTicketDetail(ticketId, false);
      }
      if (action === "admin-ticket-status") {
        await api("/admin/tickets/" + encodeURIComponent(ticketId) + "/status", { method: "PATCH", body: { status: button.dataset.status } });
        toast(button.dataset.status === "closed" ? "Ticket encerrado." : "Ticket reaberto.");
        return renderTicketDetail(ticketId, true);
      }
    } catch (error) {
      toast(error.message, true);
    }
  }, true);

  document.addEventListener("change", async function (event) {
    const input = event.target.closest("[data-feature-photo-input]");
    if (!input || !input.files || !input.files[0]) return;
    try {
      const dataUrl = await compressPhoto(input.files[0]);
      const result = await api("/api/account/profile-photo", { method: "PATCH", body: { photoDataUrl: dataUrl } });
      featureState.profile = { ...(featureState.profile || {}), profilePhoto: result.profilePhoto || dataUrl };
      featureState.profileLoaded = true;
      toast("Foto de perfil atualizada.");
      await renderAccount();
    } catch (error) {
      toast(error.message, true);
    }
  }, true);

  function syncFeatures() {
    hideAdminSelector();
    applyAvatars();
    injectAdminSupport();
  }

  function scheduleFeatures() {
    if (typeof runtime.schedule === "function") return runtime.schedule("features-v3", syncFeatures);
    setTimeout(syncFeatures, 16);
  }

  const observer = new MutationObserver(scheduleFeatures);
  if (app) observer.observe(app, { childList: true, subtree: true });

  syncFeatures();
  const current = session();
  if (current && current.role === "member") loadProfile();
})();
