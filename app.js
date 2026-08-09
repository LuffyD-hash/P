(() => {
  "use strict";

  const TABLE_SUBJECTS = "subjects";
  const TABLE_ITEMS = "items";
  const TABLE_TXT_SOURCES = "txt_sources";
  const TABLE_TXT_ROWS = "txt_rows";
  const TABLE_TXT_STATES = "txt_row_states";
  const ACTIVE_SUBJECT_KEY = "painel_active_subject";
  const ACTIVE_TXT_SOURCE_KEY = "painel_active_txt_source";
  const ACTIVE_WORKSPACE_KEY = "painel_active_workspace";
  const REALTIME_CHANNEL = "painel_compartilhado_v2";
  const TXT_PAGE_SIZE = 50;
  const TXT_MAX_COLUMNS = 24;
  const $ = (id) => document.getElementById(id);

  const elements = {
    bootView: $("bootView"), setupView: $("setupView"), setupError: $("setupError"),
    loginView: $("loginView"), loginForm: $("loginForm"), emailInput: $("emailInput"),
    passwordInput: $("passwordInput"), loginButton: $("loginButton"), loginMessage: $("loginMessage"),
    appView: $("appView"), homeLink: $("homeLink"), userEmail: $("userEmail"), logoutButton: $("logoutButton"),
    syncBadge: $("syncBadge"), syncText: $("syncText"), pricesTab: $("pricesTab"), txtTab: $("txtTab"),
    infoTab: $("infoTab"), pricesWorkspace: $("pricesWorkspace"),
    txtWorkspace: $("txtWorkspace"), infoWorkspace: $("infoWorkspace"),
    subjectForm: $("subjectForm"), subjectNameInput: $("subjectNameInput"),
    subjectSearchInput: $("subjectSearchInput"), subjectList: $("subjectList"),
    subjectEmpty: $("subjectEmpty"), subjectCount: $("subjectCount"),
    noSubjectView: $("noSubjectView"), subjectView: $("subjectView"),
    focusSubjectButton: $("focusSubjectButton"), activeSubjectName: $("activeSubjectName"),
    renameSubjectButton: $("renameSubjectButton"), deleteSubjectButton: $("deleteSubjectButton"),
    itemCount: $("itemCount"), itemCountLabel: $("itemCountLabel"), itemForm: $("itemForm"),
    itemNameInput: $("itemNameInput"), itemValueInput: $("itemValueInput"),
    addItemButton: $("addItemButton"), itemSearchInput: $("itemSearchInput"),
    itemsList: $("itemsList"), itemsEmpty: $("itemsEmpty"), itemsEmptyTitle: $("itemsEmptyTitle"),
    itemsEmptyText: $("itemsEmptyText"), refreshButton: $("refreshButton"), exportButton: $("exportButton"),
    txtSourceCount: $("txtSourceCount"), txtSourceList: $("txtSourceList"),
    txtSourceEmpty: $("txtSourceEmpty"), noTxtSourceView: $("noTxtSourceView"),
    txtSourceView: $("txtSourceView"), activeTxtSourceName: $("activeTxtSourceName"),
    txtSourceMeta: $("txtSourceMeta"), txtStatusBadge: $("txtStatusBadge"),
    txtRowCount: $("txtRowCount"), manageTxtColumnsButton: $("manageTxtColumnsButton"),
    refreshTxtButton: $("refreshTxtButton"), txtTableHead: $("txtTableHead"),
    txtTableBody: $("txtTableBody"), txtRowsEmpty: $("txtRowsEmpty"),
    txtRowsEmptyTitle: $("txtRowsEmptyTitle"), txtRowsEmptyText: $("txtRowsEmptyText"),
    txtSearchInput: $("txtSearchInput"), clearTxtSearchButton: $("clearTxtSearchButton"),
    txtSearchStatus: $("txtSearchStatus"), txtRowCountLabel: $("txtRowCountLabel"),
    txtPrevPageButton: $("txtPrevPageButton"), txtNextPageButton: $("txtNextPageButton"),
    txtPageLabel: $("txtPageLabel"), txtColumnsModal: $("txtColumnsModal"),
    txtColumnsModalTitle: $("txtColumnsModalTitle"), txtColumnsList: $("txtColumnsList"),
    txtColumnForm: $("txtColumnForm"), txtColumnNameInput: $("txtColumnNameInput"),
    txtColumnTypeInput: $("txtColumnTypeInput"), saveTxtColumnsButton: $("saveTxtColumnsButton"),
    closeTxtColumnsButton: $("closeTxtColumnsButton"), cancelTxtColumnsButton: $("cancelTxtColumnsButton"),
    toastRegion: $("toastRegion")
  };

  let client = null;
  let currentUser = null;
  let signedInUserId = "";
  let subjects = [];
  let items = [];
  let activeSubjectId = localStorage.getItem(ACTIVE_SUBJECT_KEY) || "";
  let itemsRequestId = 0;
  const storedWorkspace = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  let activeWorkspace = ["prices", "txt", "info"].includes(storedWorkspace) ? storedWorkspace : "prices";
  let txtSources = [];
  let txtRows = [];
  let txtStates = new Map();
  let activeTxtSourceId = localStorage.getItem(ACTIVE_TXT_SOURCE_KEY) || "";
  let txtSourcesLoaded = false;
  let txtPage = 0;
  let txtTotalRows = 0;
  let txtRequestId = 0;
  let txtColumnDraft = [];
  let txtColumnSourceId = "";
  let txtColumnExpectedColumns = [];
  let txtColumnsSaving = false;
  let draggedTxtColumnId = "";
  let txtEditRevision = 0;
  let txtSearchTerm = "";
  let txtSearchTimer = null;
  let txtSearchPending = false;
  let txtRowsLoaded = false;
  let txtTableResizeFrame = null;
  let txtMeasureCanvas = null;
  const txtSaveQueues = new Map();
  let realtimeSubscription = null;
  let priceRealtimeTimer = null;
  let txtRealtimeTimer = null;
  let txtReloadPending = false;
  let txtSourcesReloadPending = false;

  function showOnly(view) {
    elements.bootView.hidden = view !== "boot";
    elements.setupView.hidden = view !== "setup";
    elements.loginView.hidden = view !== "login";
    elements.appView.hidden = view !== "app";
  }

  function setSync(state, text) {
    elements.syncBadge.dataset.state = state;
    elements.syncText.textContent = text;
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = "toast" + (isError ? " is-error" : "");
    toast.textContent = message;
    elements.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), isError ? 6500 : 3800);
  }

  function readableError(error) {
    const message = String(error?.message || error || "Erro inesperado.");
    const lower = message.toLocaleLowerCase("pt-BR");
    if (lower.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
    if (lower.includes("email not confirmed")) return "Confirme o e-mail antes de entrar.";
    if (lower.includes("duplicate key") || error?.code === "23505") return "Já existe um registro com esse nome ou identificador.";
    if (error?.code === "40001" || lower.includes("txt columns changed")) {
      return "As colunas foram alteradas em outro painel. Feche o editor, atualize e tente novamente.";
    }
    if (lower.includes("set_txt_source_columns")) {
      return "Execute a migration 202608050004_txt_column_rpc.sql no Supabase para salvar e ordenar colunas.";
    }
    if (lower.includes("search_active_txt_rows")) {
      return "Execute a migration 202608050005_txt_search.sql no Supabase para pesquisar logins e senhas.";
    }
    if (lower.includes("txt_row_states") || lower.includes("set_txt_row_state_value") || (lower.includes("row_key") && lower.includes("does not exist"))) {
      return "Execute a migration 202608040003_txt_editing.sql no Supabase antes de usar a tela Contas TXT.";
    }
    const missingInfoSchema = (lower.includes("schema cache") || lower.includes("does not exist")) &&
      (lower.includes("info_subjects") || lower.includes("info_entries") || lower.includes("_info_subject") ||
        lower.includes("_info_entry"));
    if (missingInfoSchema) {
      return "Execute a migration 202608080006_info_workspace.sql no Supabase antes de usar a página Info.";
    }
    if (lower.includes("row-level security") || lower.includes("permission denied")) {
      return "A operação foi bloqueada pelas permissões do Supabase. Verifique se todas as migrations necessárias foram executadas.";
    }
    if (lower.includes("failed to fetch") || lower.includes("network")) return "Não foi possível acessar o Supabase. Verifique sua conexão.";
    return message;
  }

  function normalizeForSearch(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR").trim();
  }

  function safeTrim(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function nextPosition(records) {
    return records.reduce((max, record) => Math.max(max, Number(record.position) || 0), 0) + 10;
  }

  function setButtonBusy(button, busy, busyLabel = "Salvando…") {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
      return;
    }
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    delete button.dataset.originalText;
  }

  function decodeJwtRole(key) {
    try {
      const part = String(key).split(".")[1];
      if (!part) return "";
      const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      return JSON.parse(atob(padded)).role || "";
    } catch (_error) {
      return "";
    }
  }

  function validateConfiguration() {
    const config = window.PAINEL_SUPABASE_CONFIG || {};
    const url = String(config.url || "").trim().replace(/\/+$/, "");
    const publishableKey = String(config.publishableKey || config.anonKey || "").trim();
    if (!url || !publishableKey) return { error: "A URL ou a chave pública ainda não foi preenchida em supabase-config.js." };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("invalid protocol");
    } catch (_error) {
      return { error: "A URL do Supabase precisa ser um endereço HTTPS válido." };
    }
    if (publishableKey.startsWith("sb_secret_") || decodeJwtRole(publishableKey) === "service_role") {
      return { error: "Foi detectada uma chave secreta. Substitua-a pela chave pública sb_publishable_… imediatamente." };
    }
    if (!window.supabase?.createClient) return { error: "A biblioteca do Supabase não foi carregada. Verifique a conexão e recarregue a página." };
    if (!window.PainelInfo || typeof window.PainelInfo.configure !== "function" ||
        typeof window.PainelInfo.activate !== "function") {
      return { error: "O arquivo info.js não foi carregado. Envie esse arquivo ao GitHub junto com index.html e app.js." };
    }
    return { url, publishableKey };
  }

  function renderWorkspace() {
    const txtActive = activeWorkspace === "txt";
    const workspaces = {
      prices: { tab: elements.pricesTab, panel: elements.pricesWorkspace },
      txt: { tab: elements.txtTab, panel: elements.txtWorkspace },
      info: { tab: elements.infoTab, panel: elements.infoWorkspace }
    };

    for (const [name, workspace] of Object.entries(workspaces)) {
      const isActive = activeWorkspace === name;
      workspace.panel.hidden = !isActive;
      workspace.tab.classList.toggle("is-active", isActive);
      workspace.tab.setAttribute("aria-selected", String(isActive));
      workspace.tab.tabIndex = isActive ? 0 : -1;
    }

    window.PainelInfo?.setVisible(activeWorkspace === "info");
    if (txtActive) scheduleTxtTableFit();
  }

  async function switchWorkspace(nextWorkspace) {
    if (nextWorkspace === activeWorkspace) return;
    if (activeWorkspace === "txt" && nextWorkspace !== "txt" && blockTxtNavigationWhileSaving()) return;
    if (activeWorkspace === "info" && nextWorkspace !== "info" && window.PainelInfo?.blockNavigation()) return;

    activeWorkspace = ["prices", "txt", "info"].includes(nextWorkspace) ? nextWorkspace : "prices";
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspace);
    renderWorkspace();

    if (activeWorkspace === "info") {
      setSync("loading", "Carregando informações");
      try {
        const infoReady = await window.PainelInfo.activate();
        if (infoReady !== false) setSync("online", "Sincronizado");
      } catch (error) {
        setSync("error", "Erro de conexão");
        showToast(readableError(error), true);
      }
      return;
    }

    if (activeWorkspace !== "txt") return;
    if (txtSearchPending) {
      window.clearTimeout(txtSearchTimer);
      txtSearchTimer = null;
    }
    if (!txtSourcesLoaded) {
      setSync("loading", "Carregando contas");
      try {
        await loadTxtSources({ loadRows: true });
        txtReloadPending = false;
        txtSourcesReloadPending = false;
        setSync("online", "Sincronizado");
      } catch (error) {
        setSync("error", "Erro de conexão");
        showToast(readableError(error), true);
      } finally {
        runPendingTxtSearchWhenReady();
      }
      return;
    }

    if (txtReloadPending) await flushTxtRealtime();
    runPendingTxtSearchWhenReady();
  }

  async function initialize() {
    const config = validateConfiguration();
    if (config.error) {
      elements.setupError.textContent = config.error;
      showOnly("setup");
      return;
    }
    elements.txtColumnTypeInput.value = "check";
    renderWorkspace();
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 5 } }
    });
    client.auth.onAuthStateChange((_event, session) => window.setTimeout(() => applySession(session), 0));
    const { data, error } = await client.auth.getSession();
    if (error) {
      elements.loginMessage.textContent = readableError(error);
      showOnly("login");
      return;
    }
    await applySession(data.session);
  }

  async function applySession(session) {
    const user = session?.user || null;
    if (!user) {
      stopRealtime();
      closeTxtColumnsModal(true);
      currentUser = null;
      signedInUserId = "";
      subjects = [];
      items = [];
      txtSources = [];
      txtRows = [];
      txtStates = new Map();
      txtSourcesLoaded = false;
      resetTxtSearch();
      window.PainelInfo?.reset();
      elements.passwordInput.value = "";
      elements.loginMessage.textContent = "";
      setButtonBusy(elements.logoutButton, false);
      showOnly("login");
      return;
    }
    currentUser = user;
    setButtonBusy(elements.logoutButton, false);
    elements.userEmail.textContent = user.email || "Usuário autenticado";
    if (signedInUserId === user.id && !elements.appView.hidden) return;
    signedInUserId = user.id;
    window.PainelInfo?.configure({
      client,
      user,
      showToast,
      readableError,
      setSync
    });
    showOnly("app");
    renderWorkspace();
    setSync("loading", "Sincronizando");
    try {
      await loadSubjects({ loadActiveItems: true });
      if (activeWorkspace === "txt") await loadTxtSources({ loadRows: true });
      let infoReady = true;
      if (activeWorkspace === "info") infoReady = await window.PainelInfo.activate();
      startRealtime();
      if (infoReady !== false) setSync("online", "Sincronizado");
    } catch (error) {
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
    }
  }

  function getActiveSubject() {
    return subjects.find((subject) => subject.id === activeSubjectId) || null;
  }

  async function loadSubjects({ loadActiveItems = false } = {}) {
    const { data, error } = await client.from(TABLE_SUBJECTS)
      .select("id,name,position,created_at,updated_at")
      .order("position", { ascending: true }).order("name", { ascending: true });
    if (error) throw error;
    subjects = data || [];
    if (!subjects.some((subject) => subject.id === activeSubjectId)) {
      activeSubjectId = subjects[0]?.id || "";
      persistActiveSubject();
    }
    renderSubjects();
    renderActiveSubject();
    if (loadActiveItems || !activeSubjectId) await loadItems();
  }

  async function loadItems() {
    const requestId = ++itemsRequestId;
    if (!activeSubjectId) {
      items = [];
      renderItems();
      return;
    }
    const subjectAtRequest = activeSubjectId;
    const { data, error } = await client.from(TABLE_ITEMS)
      .select("id,subject_id,name,value,position,created_at,updated_at")
      .eq("subject_id", subjectAtRequest).order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (requestId !== itemsRequestId || subjectAtRequest !== activeSubjectId) return;
    if (error) throw error;
    items = data || [];
    renderItems();
  }

  function persistActiveSubject() {
    if (activeSubjectId) localStorage.setItem(ACTIVE_SUBJECT_KEY, activeSubjectId);
    else localStorage.removeItem(ACTIVE_SUBJECT_KEY);
  }

  function renderSubjects() {
    const query = normalizeForSearch(elements.subjectSearchInput.value);
    const filtered = query ? subjects.filter((subject) => normalizeForSearch(subject.name).includes(query)) : subjects;
    elements.subjectList.replaceChildren();
    elements.subjectCount.textContent = String(subjects.length);
    elements.subjectEmpty.hidden = subjects.length > 0 || Boolean(query);
    for (const subject of filtered) {
      const row = document.createElement("div");
      row.className = "subject-row" + (subject.id === activeSubjectId ? " is-active" : "");
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "subject-select";
      selectButton.textContent = subject.name;
      selectButton.title = subject.name;
      selectButton.setAttribute("aria-pressed", String(subject.id === activeSubjectId));
      selectButton.addEventListener("click", () => selectSubject(subject.id));
      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.className = "subject-menu-button";
      renameButton.textContent = "···";
      renameButton.title = "Renomear " + subject.name;
      renameButton.setAttribute("aria-label", "Renomear assunto " + subject.name);
      renameButton.addEventListener("click", () => renameSubject(subject));
      row.append(selectButton, renameButton);
      elements.subjectList.append(row);
    }
  }

  function renderActiveSubject() {
    const subject = getActiveSubject();
    elements.noSubjectView.hidden = Boolean(subject);
    elements.subjectView.hidden = !subject;
    if (subject) elements.activeSubjectName.textContent = subject.name;
  }

  function renderItems() {
    const query = normalizeForSearch(elements.itemSearchInput.value);
    const filtered = query ? items.filter((item) => {
      return (normalizeForSearch(item.name) + " " + normalizeForSearch(item.value)).includes(query);
    }) : items;
    elements.itemCount.textContent = String(items.length);
    elements.itemCountLabel.textContent = items.length === 1 ? "item" : "itens";
    elements.itemsList.replaceChildren();
    for (const item of filtered) elements.itemsList.append(createItemRow(item));
    const isEmpty = filtered.length === 0;
    elements.itemsEmpty.hidden = !isEmpty;
    if (query && items.length > 0 && isEmpty) {
      elements.itemsEmptyTitle.textContent = "Nenhum resultado encontrado";
      elements.itemsEmptyText.textContent = "Tente buscar por outro nome ou valor.";
    } else {
      elements.itemsEmptyTitle.textContent = "Nenhum item neste assunto";
      elements.itemsEmptyText.textContent = "Use o formulário acima para adicionar o primeiro.";
    }
  }

  function createItemRow(item) {
    const row = document.createElement("div");
    row.className = "item-row";
    row.dataset.id = item.id;
    const nameInput = document.createElement("input");
    nameInput.className = "item-field";
    nameInput.type = "text";
    nameInput.maxLength = 160;
    nameInput.value = item.name || "";
    nameInput.setAttribute("aria-label", "Nome do item " + (item.name || "sem nome"));
    const valueInput = document.createElement("input");
    valueInput.className = "item-field item-value-field";
    valueInput.type = "text";
    valueInput.maxLength = 160;
    valueInput.value = item.value || "";
    valueInput.setAttribute("aria-label", "Valor do item " + (item.name || "sem nome"));
    const actions = document.createElement("div");
    actions.className = "item-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "row-button row-button-save";
    saveButton.textContent = "Salvar";
    saveButton.disabled = true;
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "row-button row-button-delete";
    deleteButton.textContent = "Excluir";
    const updateDirtyState = () => {
      const dirty = nameInput.value !== item.name || valueInput.value !== item.value;
      row.classList.toggle("is-dirty", dirty);
      saveButton.disabled = !dirty;
    };
    nameInput.addEventListener("input", updateDirtyState);
    valueInput.addEventListener("input", updateDirtyState);
    const shortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !saveButton.disabled) saveButton.click();
    };
    nameInput.addEventListener("keydown", shortcut);
    valueInput.addEventListener("keydown", shortcut);
    saveButton.addEventListener("click", () => saveItem(item, row, nameInput, valueInput, saveButton));
    deleteButton.addEventListener("click", () => deleteItem(item, deleteButton));
    actions.append(saveButton, deleteButton);
    row.append(nameInput, valueInput, actions);
    return row;
  }

  async function selectSubject(subjectId) {
    if (subjectId === activeSubjectId) return;
    activeSubjectId = subjectId;
    persistActiveSubject();
    elements.itemSearchInput.value = "";
    items = [];
    renderSubjects();
    renderActiveSubject();
    renderItems();
    setSync("loading", "Carregando");
    try {
      await loadItems();
      setSync("online", "Sincronizado");
    } catch (error) {
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
    }
  }

  async function createSubject(event) {
    event.preventDefault();
    const name = safeTrim(elements.subjectNameInput.value, 80);
    if (!name) return;
    const button = elements.subjectForm.querySelector("button");
    setButtonBusy(button, true, "…");
    setSync("loading", "Salvando");
    try {
      const { data, error } = await client.from(TABLE_SUBJECTS)
        .insert({ name, position: nextPosition(subjects) })
        .select("id,name,position,created_at,updated_at").single();
      if (error) throw error;
      elements.subjectNameInput.value = "";
      activeSubjectId = data.id;
      persistActiveSubject();
      await loadSubjects({ loadActiveItems: true });
      setSync("online", "Sincronizado");
      showToast("Assunto “" + data.name + "” criado.");
      elements.itemNameInput.focus();
    } catch (error) {
      setSync("error", "Erro ao salvar");
      showToast(readableError(error), true);
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function renameSubject(subject = getActiveSubject()) {
    if (!subject) return;
    const answer = window.prompt("Novo nome do assunto:", subject.name);
    if (answer === null) return;
    const name = safeTrim(answer, 80);
    if (!name || name === subject.name) return;
    setSync("loading", "Salvando");
    try {
      const { error } = await client.from(TABLE_SUBJECTS).update({ name }).eq("id", subject.id);
      if (error) throw error;
      await loadSubjects();
      setSync("online", "Sincronizado");
      showToast("Assunto renomeado.");
    } catch (error) {
      setSync("error", "Erro ao salvar");
      showToast(readableError(error), true);
    }
  }

  async function deleteSubject() {
    const subject = getActiveSubject();
    if (!subject) return;
    const warning = "Excluir o assunto “" + subject.name + "” e todos os " + items.length + " " +
      (items.length === 1 ? "item" : "itens") + " dele?";
    if (!window.confirm(warning)) return;
    setButtonBusy(elements.deleteSubjectButton, true, "Excluindo…");
    setSync("loading", "Excluindo");
    try {
      const { error } = await client.from(TABLE_SUBJECTS).delete().eq("id", subject.id);
      if (error) throw error;
      activeSubjectId = "";
      persistActiveSubject();
      await loadSubjects({ loadActiveItems: true });
      setSync("online", "Sincronizado");
      showToast("Assunto excluído.");
    } catch (error) {
      setSync("error", "Erro ao excluir");
      showToast(readableError(error), true);
    } finally {
      setButtonBusy(elements.deleteSubjectButton, false);
    }
  }

  async function createItem(event) {
    event.preventDefault();
    const subject = getActiveSubject();
    if (!subject) return;
    const name = safeTrim(elements.itemNameInput.value, 160);
    const value = safeTrim(elements.itemValueInput.value, 160);
    if (!name || !value) {
      showToast("Preencha o nome e o valor do item.", true);
      return;
    }
    setButtonBusy(elements.addItemButton, true, "Adicionando…");
    setSync("loading", "Salvando");
    try {
      const { error } = await client.from(TABLE_ITEMS).insert({
        subject_id: subject.id, name, value, position: nextPosition(items)
      });
      if (error) throw error;
      elements.itemForm.reset();
      await loadItems();
      setSync("online", "Sincronizado");
      showToast("Item “" + name + "” adicionado.");
      elements.itemNameInput.focus();
    } catch (error) {
      setSync("error", "Erro ao salvar");
      showToast(readableError(error), true);
    } finally {
      setButtonBusy(elements.addItemButton, false);
    }
  }

  async function saveItem(item, row, nameInput, valueInput, button) {
    const name = safeTrim(nameInput.value, 160);
    const value = safeTrim(valueInput.value, 160);
    if (!name || !value) {
      showToast("O nome e o valor não podem ficar vazios.", true);
      return;
    }
    row.classList.add("is-saving");
    setButtonBusy(button, true, "Salvando…");
    setSync("loading", "Salvando");
    try {
      const { error } = await client.from(TABLE_ITEMS)
        .update({ name, value, updated_by: currentUser.id })
        .eq("id", item.id).eq("subject_id", activeSubjectId);
      if (error) throw error;
      await loadItems();
      setSync("online", "Sincronizado");
      showToast("Item atualizado.");
    } catch (error) {
      setSync("error", "Erro ao salvar");
      showToast(readableError(error), true);
      row.classList.remove("is-saving");
      setButtonBusy(button, false);
    }
  }

  async function deleteItem(item, button) {
    if (!window.confirm("Excluir o item “" + item.name + "”?")) return;
    setButtonBusy(button, true, "Excluindo…");
    setSync("loading", "Excluindo");
    try {
      const { error } = await client.from(TABLE_ITEMS).delete()
        .eq("id", item.id).eq("subject_id", activeSubjectId);
      if (error) throw error;
      await loadItems();
      setSync("online", "Sincronizado");
      showToast("Item excluído.");
    } catch (error) {
      setSync("error", "Erro ao excluir");
      showToast(readableError(error), true);
      setButtonBusy(button, false);
    }
  }

  async function refreshPrices() {
    setButtonBusy(elements.refreshButton, true, "Atualizando…");
    setSync("loading", "Atualizando");
    try {
      await loadSubjects({ loadActiveItems: true });
      setSync("online", "Sincronizado");
      showToast("Dados atualizados.");
    } catch (error) {
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
    } finally {
      setButtonBusy(elements.refreshButton, false);
    }
  }

  async function fetchEveryRow(table, columns, orderColumn) {
    const pageSize = 1000;
    const records = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client.from(table).select(columns)
        .order(orderColumn, { ascending: true }).range(from, from + pageSize - 1);
      if (error) throw error;
      records.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return records;
  }

  async function exportData() {
    setButtonBusy(elements.exportButton, true, "Exportando…");
    try {
      const [allSubjects, allItems] = await Promise.all([
        fetchEveryRow(TABLE_SUBJECTS, "id,name,position,created_at,updated_at", "position"),
        fetchEveryRow(TABLE_ITEMS, "id,subject_id,name,value,position,created_at,updated_at", "position")
      ]);
      const payload = {
        version: 1, exportedAt: new Date().toISOString(),
        subjects: allSubjects.map((subject) => ({
          ...subject, items: allItems.filter((item) => item.subject_id === subject.id)
        }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "painel-itens-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Exportação concluída.");
    } catch (error) {
      showToast(readableError(error), true);
    } finally {
      setButtonBusy(elements.exportButton, false);
    }
  }

  function hasDirtyPriceRows() {
    return Boolean(elements.itemsList.querySelector(".item-row.is-dirty"));
  }

  function hasDirtyTxtRows() {
    return Boolean(elements.txtTableBody.querySelector("tr.is-dirty"));
  }

  function persistActiveTxtSource() {
    if (activeTxtSourceId) localStorage.setItem(ACTIVE_TXT_SOURCE_KEY, activeTxtSourceId);
    else localStorage.removeItem(ACTIVE_TXT_SOURCE_KEY);
  }

  function getActiveTxtSource() {
    return txtSources.find((source) => source.id === activeTxtSourceId) || null;
  }

  function stableColumnId(label, index, used) {
    const base = normalizeForSearch(label).replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "").slice(0, 48) || "column_" + (index + 1);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = base.slice(0, 44) + "_" + suffix++;
    return candidate;
  }

  function normalizeTxtColumns(rawColumns) {
    const source = Array.isArray(rawColumns) ? rawColumns.slice(0, TXT_MAX_COLUMNS) : [];
    const used = new Set();
    return source.map((entry, index) => {
      const item = isPlainObject(entry) ? entry : { label: String(entry || "") };
      const label = safeTrim(item.label || item.name || "Coluna " + (index + 1), 80) || "Coluna " + (index + 1);
      let id = safeTrim(item.id || item.key, 64);
      if (!id || used.has(id)) id = stableColumnId(label, index, used);
      used.add(id);
      const checkTypes = ["check", "checkbox", "boolean", "bool"];
      return { id, label, type: checkTypes.includes(String(item.type || "").toLowerCase()) ? "check" : "text", position: index };
    });
  }

  function txtStatusLabel(status) {
    return ({ empty: "Vazio", importing: "Importando", ready: "Pronto", error: "Erro" })[status] || "Aguardando";
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function txtEditingIsBusy() {
    return txtColumnsSaving || txtSaveQueues.size > 0 || hasDirtyTxtRows();
  }

  function updateTxtSearchUi(state = "idle") {
    const hasSource = Boolean(getActiveTxtSource());
    const searching = Boolean(txtSearchTerm);
    elements.txtSearchInput.disabled = !hasSource;
    elements.clearTxtSearchButton.hidden = !searching;
    if (!hasSource) {
      elements.txtSearchStatus.textContent = "Selecione uma tabela para pesquisar.";
    } else if (state === "loading") {
      elements.txtSearchStatus.textContent = "Pesquisando em todas as linhas…";
    } else if (state === "deferred") {
      elements.txtSearchStatus.textContent = "A pesquisa será feita assim que a edição terminar de salvar.";
    } else if (searching && txtRowsLoaded) {
      elements.txtSearchStatus.textContent = txtTotalRows === 1
        ? "1 resultado encontrado."
        : txtTotalRows + " resultados encontrados.";
    } else {
      elements.txtSearchStatus.textContent = "Pesquisa em todas as linhas importadas.";
    }
  }

  function setTxtPaginationPending() {
    elements.txtPrevPageButton.disabled = true;
    elements.txtNextPageButton.disabled = true;
    elements.txtPageLabel.textContent = txtSearchTerm ? "Pesquisando…" : "Carregando…";
  }

  function resetTxtSearch() {
    window.clearTimeout(txtSearchTimer);
    txtSearchTimer = null;
    txtSearchPending = false;
    txtSearchTerm = "";
    txtPage = 0;
    txtRowsLoaded = false;
    txtRequestId += 1;
    setTxtPaginationPending();
    if (elements.txtSearchInput) elements.txtSearchInput.value = "";
    updateTxtSearchUi();
  }

  function scheduleTxtSearchLoad(delay = 350) {
    txtSearchPending = true;
    window.clearTimeout(txtSearchTimer);
    txtSearchTimer = window.setTimeout(() => void flushTxtSearchLoad(), delay);
  }

  async function flushTxtSearchLoad() {
    txtSearchTimer = null;
    if (!txtSearchPending || activeWorkspace !== "txt" || !getActiveTxtSource()) return;
    if (txtEditingIsBusy()) {
      updateTxtSearchUi("deferred");
      setSync("loading", "Finalizando alteração");
      scheduleTxtSearchLoad(500);
      return;
    }
    txtSearchPending = false;
    updateTxtSearchUi("loading");
    setSync("loading", txtSearchTerm ? "Pesquisando contas" : "Carregando contas");
    try {
      await loadTxtRows();
      setSync("online", "Sincronizado");
    } catch (error) {
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
      updateTxtSearchUi();
    }
  }

  function runPendingTxtSearchWhenReady() {
    if (!txtSearchPending || txtEditingIsBusy()) return;
    scheduleTxtSearchLoad(0);
  }

  async function loadTxtSources({ loadRows = false } = {}) {
    const sourceBeforeLoad = activeTxtSourceId;
    const { data, error } = await client.from(TABLE_TXT_SOURCES)
      .select("id,source_key,name,file_name,position,status,active_import_id,row_count,columns,last_error,imported_at,updated_at")
      .order("position", { ascending: true }).order("name", { ascending: true });
    if (error) throw error;
    txtSources = (data || []).map((source) => ({ ...source, columns: normalizeTxtColumns(source.columns) }));
    txtSourcesLoaded = true;
    if (!txtSources.some((source) => source.id === activeTxtSourceId)) {
      activeTxtSourceId = txtSources[0]?.id || "";
      persistActiveTxtSource();
    }
    if (sourceBeforeLoad !== activeTxtSourceId) resetTxtSearch();
    renderTxtSources();
    renderActiveTxtSource();
    if (loadRows) await loadTxtRows();
  }

  async function loadTxtRows() {
    const source = getActiveTxtSource();
    const requestId = ++txtRequestId;
    const editRevisionAtRequest = txtEditRevision;
    const searchAtRequest = txtSearchTerm;
    if (!source) {
      txtRows = [];
      txtStates = new Map();
      txtTotalRows = 0;
      txtRowsLoaded = true;
      renderTxtTable();
      updateTxtSearchUi();
      return;
    }
    const sourceAtRequest = source.id;
    const from = txtPage * TXT_PAGE_SIZE;
    let rowsQuery;
    if (searchAtRequest) {
      rowsQuery = client.rpc("search_active_txt_rows", {
        p_source_id: sourceAtRequest,
        p_search: searchAtRequest
      }, { count: "exact" }).order("line_number", { ascending: true });
    } else {
      rowsQuery = client.from(TABLE_TXT_ROWS)
        .select("id,source_id,import_id,row_key,line_number,f1,f2,extra,created_at", { count: "exact" })
        .eq("source_id", sourceAtRequest).order("line_number", { ascending: true });
    }
    const { data, error, count } = await rowsQuery.range(from, from + TXT_PAGE_SIZE - 1);
    const requestIsCurrent = () => requestId === txtRequestId
      && sourceAtRequest === activeTxtSourceId
      && searchAtRequest === txtSearchTerm;
    if (!requestIsCurrent()) return;
    if (error) throw error;
    const nextTotalRows = Number.isFinite(Number(count)) ? Number(count) : 0;
    const totalPages = Math.ceil(nextTotalRows / TXT_PAGE_SIZE);
    if (txtPage >= totalPages && txtPage > 0) {
      txtPage = Math.max(0, totalPages - 1);
      await loadTxtRows();
      return;
    }

    const nextRows = data || [];
    const nextStates = new Map();
    const rowKeys = [...new Set(nextRows.map((row) => row.row_key).filter(Boolean))];
    if (rowKeys.length) {
      const { data: stateData, error: stateError } = await client.from(TABLE_TXT_STATES)
        .select("source_id,row_key,values,updated_at").eq("source_id", sourceAtRequest).in("row_key", rowKeys);
      if (!requestIsCurrent()) return;
      if (stateError) throw stateError;
      for (const state of stateData || []) {
        nextStates.set(state.row_key, { ...state, values: isPlainObject(state.values) ? state.values : {} });
      }
    }

    if (editRevisionAtRequest !== txtEditRevision || txtEditingIsBusy()) {
      if (searchAtRequest || txtSearchPending) {
        txtSearchPending = true;
        updateTxtSearchUi("deferred");
      }
      scheduleTxtRealtime(false);
      return;
    }
    if (!requestIsCurrent()) return;
    txtTotalRows = nextTotalRows;
    txtRows = nextRows;
    txtStates = nextStates;
    txtRowsLoaded = true;
    renderActiveTxtSource();
    renderTxtTable();
    updateTxtSearchUi();
  }

  function renderTxtSources() {
    elements.txtSourceList.replaceChildren();
    elements.txtSourceCount.textContent = String(txtSources.length);
    elements.txtSourceEmpty.hidden = txtSources.length > 0;
    for (const source of txtSources) {
      const row = document.createElement("div");
      row.className = "txt-source-row" + (source.id === activeTxtSourceId ? " is-active" : "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "txt-source-select";
      button.textContent = source.name || source.file_name || "Sem nome";
      button.title = source.file_name || source.name || "Tabela TXT";
      button.setAttribute("aria-pressed", String(source.id === activeTxtSourceId));
      button.addEventListener("click", () => selectTxtSource(source.id));
      const state = document.createElement("span");
      state.className = "txt-source-state";
      state.dataset.state = source.status || "empty";
      state.title = txtStatusLabel(source.status);
      state.setAttribute("aria-label", txtStatusLabel(source.status));
      row.append(button, state);
      elements.txtSourceList.append(row);
    }
  }

  function renderActiveTxtSource() {
    const source = getActiveTxtSource();
    elements.noTxtSourceView.hidden = Boolean(source);
    elements.txtSourceView.hidden = !source;
    elements.manageTxtColumnsButton.disabled = !source;
    if (!source) return;
    elements.activeTxtSourceName.textContent = source.name || source.file_name || "Tabela TXT";
    elements.txtStatusBadge.dataset.state = source.status || "empty";
    elements.txtStatusBadge.lastElementChild.textContent = txtStatusLabel(source.status);
    const meta = [];
    if (source.file_name) meta.push(source.file_name);
    const importedAt = formatDateTime(source.imported_at);
    if (importedAt) meta.push("importado em " + importedAt);
    if (source.status === "error" && source.last_error) meta.push("erro: " + safeTrim(source.last_error, 180));
    elements.txtSourceMeta.textContent = meta.length ? meta.join(" · ") : "Aguardando a primeira importação pelo painel local.";
    const displayedCount = txtRowsLoaded ? txtTotalRows : (Number(source.row_count) || 0);
    elements.txtRowCount.textContent = String(displayedCount);
    elements.txtRowCountLabel.textContent = txtSearchTerm
      ? (displayedCount === 1 ? "resultado encontrado" : "resultados encontrados")
      : "linhas disponíveis";
    updateTxtSearchUi();
    elements.txtColumnsModalTitle.textContent = "Colunas de " + (source.name || "Contas TXT");
  }

  async function selectTxtSource(sourceId) {
    if (sourceId === activeTxtSourceId) return;
    if (blockTxtNavigationWhileSaving()) return;
    resetTxtSearch();
    activeTxtSourceId = sourceId;
    txtRows = [];
    txtStates = new Map();
    txtTotalRows = 0;
    txtRowsLoaded = false;
    persistActiveTxtSource();
    renderTxtSources();
    renderActiveTxtSource();
    renderTxtTable();
    setSync("loading", "Carregando contas");
    try {
      await loadTxtRows();
      setSync("online", "Sincronizado");
    } catch (error) {
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
    }
  }

  function coerceTxtCheckValue(value) {
    return value === true || value === 1 || value === "1"
      || String(value).toLowerCase() === "true";
  }

  function importedTxtValues(row, columns) {
    const extra = isPlainObject(row.extra) ? row.extra : {};
    const values = isPlainObject(extra.values) ? { ...extra.values } : {};
    const texts = Array.isArray(extra.texts) ? extra.texts : [];
    const checks = Array.isArray(extra.checks) ? extra.checks : [];
    let textIndex = 0;
    let checkIndex = 0;
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(values, column.id)) {
        values[column.id] = column.type === "check" ? coerceTxtCheckValue(checks[checkIndex]) : String(texts[textIndex] ?? "");
      }
      if (column.type === "check") checkIndex += 1;
      else textIndex += 1;
    }
    return values;
  }

  function effectiveTxtValues(row, columns) {
    const state = txtStates.get(row.row_key);
    return { ...importedTxtValues(row, columns), ...(isPlainObject(state?.values) ? state.values : {}) };
  }

  function createHeaderCell(label, type = "text", columnId = "") {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    cell.dataset.columnType = type;
    if (columnId) cell.dataset.columnId = columnId;
    return cell;
  }

  function createCopyButton(value, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "txt-cell-button txt-copy-button";
    button.textContent = "C";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => copyText(value, label));
    return button;
  }

  function createAccountCell(row) {
    const cell = document.createElement("td");
    const wrapper = document.createElement("div");
    wrapper.className = "txt-account-field";
    const input = document.createElement("input");
    input.className = "txt-account-input";
    input.type = "text";
    input.readOnly = true;
    input.value = String(row.f1 || "");
    input.setAttribute("aria-label", "Login da linha " + row.line_number);
    wrapper.append(input, createCopyButton(input.value, "Copiar login"));
    cell.append(wrapper);
    return cell;
  }

  function createPasswordCell(row) {
    const cell = document.createElement("td");
    const wrapper = document.createElement("div");
    wrapper.className = "txt-password-field";
    const input = document.createElement("input");
    input.className = "txt-password-input";
    input.type = "password";
    input.readOnly = true;
    input.value = String(row.f2 || "");
    input.setAttribute("aria-label", "Senha da linha " + row.line_number);
    const actions = document.createElement("div");
    actions.className = "txt-sensitive-actions";
    const revealButton = document.createElement("button");
    revealButton.type = "button";
    revealButton.className = "txt-cell-button txt-reveal-button";
    revealButton.textContent = "V";
    revealButton.title = "Mostrar senha";
    revealButton.setAttribute("aria-label", "Mostrar senha");
    revealButton.addEventListener("click", () => {
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      revealButton.textContent = revealing ? "O" : "V";
      revealButton.title = revealing ? "Ocultar senha" : "Mostrar senha";
      revealButton.setAttribute("aria-label", revealButton.title);
    });
    actions.append(revealButton, createCopyButton(input.value, "Copiar senha"));
    wrapper.append(input, actions);
    cell.append(wrapper);
    return cell;
  }

  function measureTxtText(element, rawValue) {
    if (!element) return 0;
    txtMeasureCanvas ||= document.createElement("canvas");
    const context = txtMeasureCanvas.getContext("2d");
    if (!context) return element.scrollWidth || 0;
    const style = window.getComputedStyle(element);
    context.font = style.font || [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
    let value = String(rawValue ?? "");
    if (style.textTransform === "uppercase") value = value.toLocaleUpperCase("pt-BR");
    if (style.textTransform === "lowercase") value = value.toLocaleLowerCase("pt-BR");
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
    return context.measureText(value).width + Math.max(0, value.length - 1) * letterSpacing;
  }

  function txtInlineGap(element) {
    if (!element) return 0;
    const style = window.getComputedStyle(element);
    return Number.parseFloat(style.columnGap || style.gap) || 0;
  }

  function txtButtonsWidth(container) {
    if (!container) return 0;
    const buttons = [...container.querySelectorAll("button")];
    const buttonsWidth = buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0);
    return buttonsWidth + Math.max(0, buttons.length - 1) * txtInlineGap(container);
  }

  function fitTxtTableColumnsToContent() {
    txtTableResizeFrame = null;
    const table = elements.txtTableHead.closest("table");
    const headers = [...elements.txtTableHead.querySelectorAll("th")];
    if (!table || headers.length < 2 || !table.isConnected || table.getClientRects().length === 0) return;
    const accountInputs = [...elements.txtTableBody.querySelectorAll(".txt-account-input")];
    const passwordInputs = [...elements.txtTableBody.querySelectorAll(".txt-password-input")];
    const accountSample = accountInputs[0] || headers[0];
    const passwordSample = passwordInputs[0] || headers[1];
    const accountTextWidth = Math.ceil(Math.max(0, ...accountInputs.map((input) => measureTxtText(accountSample, input.value)))) + 5;
    const passwordTextWidth = Math.ceil(Math.max(0, ...passwordInputs.map((input) => measureTxtText(passwordSample, input.value)))) + 5;
    table.style.setProperty("--txt-account-input-width", accountTextWidth + "px");
    table.style.setProperty("--txt-password-input-width", passwordTextWidth + "px");

    const firstRow = elements.txtTableBody.querySelector("tr");
    const accountField = firstRow?.querySelector(".txt-account-field");
    const passwordField = firstRow?.querySelector(".txt-password-field");
    const accountButtons = txtButtonsWidth(accountField);
    const passwordButtons = txtButtonsWidth(passwordField?.querySelector(".txt-sensitive-actions"));
    const accountWidth = Math.ceil(Math.max(
      measureTxtText(headers[0], headers[0].textContent) + 5,
      accountTextWidth + accountButtons + (accountButtons ? txtInlineGap(accountField) : 0) + 5
    ));
    const passwordWidth = Math.ceil(Math.max(
      measureTxtText(headers[1], headers[1].textContent) + 5,
      passwordTextWidth + passwordButtons + (passwordButtons ? txtInlineGap(passwordField) : 0) + 5
    ));
    table.style.setProperty("--txt-account-column-width", accountWidth + "px");
    table.style.setProperty("--txt-password-column-width", passwordWidth + "px");

    for (const header of headers.filter((cell) => cell.dataset.columnType === "check")) {
      const columnId = header.dataset.columnId;
      const width = Math.ceil(Math.max(measureTxtText(header, header.textContent), 21) + 5);
      for (const cell of [header, ...elements.txtTableBody.querySelectorAll("td[data-column-id=\"" + CSS.escape(columnId) + "\"]")]) {
        cell.style.width = width + "px";
        cell.style.minWidth = width + "px";
        cell.style.maxWidth = width + "px";
      }
    }
  }

  function scheduleTxtTableFit() {
    if (txtTableResizeFrame !== null) window.cancelAnimationFrame(txtTableResizeFrame);
    txtTableResizeFrame = window.requestAnimationFrame(fitTxtTableColumnsToContent);
  }

  function createDynamicTxtCell(row, column, currentValue, tableRow) {
    const cell = document.createElement("td");
    cell.dataset.columnType = column.type;
    cell.dataset.columnId = column.id;
    if (column.type === "check") {
      cell.className = "txt-check-column";
      const label = document.createElement("label");
      label.className = "txt-check-label";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "txt-checkbox";
      input.checked = coerceTxtCheckValue(currentValue);
      input.disabled = !row.row_key;
      if (!row.row_key) input.title = "Esta linha precisa ser reimportada com row_key para permitir edição.";
      input.setAttribute("aria-label", column.label + " da linha " + row.line_number);
      if (row.row_key) {
        input.addEventListener("change", () => {
          txtEditRevision += 1;
          void saveTxtCell(row, column, input.checked, input, tableRow);
        });
      }
      label.append(input);
      cell.append(label);
      return cell;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = "txt-cell-input";
    input.maxLength = 240;
    input.value = typeof currentValue === "string" ? currentValue : String(currentValue ?? "");
    input.dataset.savedValue = input.value;
    input.disabled = !row.row_key;
    if (!row.row_key) input.title = "Esta linha precisa ser reimportada com row_key para permitir edição.";
    input.setAttribute("aria-label", column.label + " da linha " + row.line_number);
    if (!row.row_key) {
      cell.append(input);
      return cell;
    }
    let saveTimer = null;
    const commitTextValue = () => {
      window.clearTimeout(saveTimer);
      saveTimer = null;
      if (!input.classList.contains("is-dirty")) return;
      void saveTxtCell(row, column, input.value.slice(0, 240), input, tableRow);
    };
    input.addEventListener("input", () => {
      txtEditRevision += 1;
      input.classList.add("is-dirty");
      tableRow.classList.add("is-dirty");
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(commitTextValue, 700);
    });
    input.addEventListener("blur", commitTextValue);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") {
        window.clearTimeout(saveTimer);
        saveTimer = null;
        input.value = input.dataset.savedValue || "";
        input.classList.remove("is-dirty");
        if (!tableRow.querySelector(".is-dirty")) tableRow.classList.remove("is-dirty");
        input.blur();
      }
    });
    cell.append(input);
    return cell;
  }

  function renderTxtTable() {
    const source = getActiveTxtSource();
    const columns = normalizeTxtColumns(source?.columns);
    elements.txtTableHead.replaceChildren();
    elements.txtTableBody.replaceChildren();
    const headRow = document.createElement("tr");
    headRow.append(createHeaderCell("Login"), createHeaderCell("Senha"));
    for (const column of columns) headRow.append(createHeaderCell(column.label, column.type, column.id));
    elements.txtTableHead.append(headRow);
    for (const row of txtRows) {
      const tableRow = document.createElement("tr");
      tableRow.dataset.rowKey = row.row_key || "";
      const values = effectiveTxtValues(row, columns);
      tableRow.append(createAccountCell(row), createPasswordCell(row));
      for (const column of columns) tableRow.append(createDynamicTxtCell(row, column, values[column.id], tableRow));
      elements.txtTableBody.append(tableRow);
    }
    const hasRows = txtRows.length > 0;
    elements.txtRowsEmpty.hidden = hasRows;
    if (!hasRows && txtSearchTerm) {
      elements.txtRowsEmptyTitle.textContent = "Nenhum login ou senha encontrado";
      elements.txtRowsEmptyText.textContent = "Tente pesquisar outro texto ou limpe o campo de pesquisa.";
    } else {
      elements.txtRowsEmptyTitle.textContent = "Nenhuma linha nesta tabela";
      elements.txtRowsEmptyText.textContent = "O próximo envio feito pelo painel local aparecerá aqui.";
    }
    const totalPages = Math.ceil(txtTotalRows / TXT_PAGE_SIZE);
    elements.txtPageLabel.textContent = totalPages
      ? "Página " + (txtPage + 1) + " de " + totalPages
      : "Página 0 de 0";
    elements.txtPrevPageButton.disabled = totalPages === 0 || txtPage <= 0;
    elements.txtNextPageButton.disabled = totalPages === 0 || txtPage + 1 >= totalPages;
    scheduleTxtTableFit();
  }

  async function copyText(value, successLabel) {
    const text = String(value || "");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      showToast(successLabel + ".");
    } catch (_error) {
      showToast("Não foi possível copiar este valor.", true);
    }
  }

  async function saveTxtCell(row, column, value, control, tableRow) {
    if (!row.row_key) {
      showToast("Esta linha não possui row_key. Execute a terceira migration e importe novamente.", true);
      return;
    }

    const columns = normalizeTxtColumns(getActiveTxtSource()?.columns);
    const previousEffectiveValue = effectiveTxtValues(row, columns)[column.id];
    const existing = txtStates.get(row.row_key) || {
      source_id: row.source_id,
      row_key: row.row_key,
      values: {}
    };
    const existingValues = isPlainObject(existing.values) ? existing.values : {};
    const hadStoredValue = Object.prototype.hasOwnProperty.call(existingValues, column.id);
    const normalizedValue = column.type === "check"
      ? Boolean(value)
      : String(value ?? "").slice(0, 240);
    const nextValues = { ...existingValues, [column.id]: normalizedValue };

    txtStates.set(row.row_key, { ...existing, values: nextValues });
    tableRow.classList.add("is-saving", "is-dirty");
    control.classList.add("is-dirty");
    control.disabled = true;
    setSync("loading", "Salvando alteração");

    const rowQueuePrefix = row.source_id + ":" + row.row_key + ":";
    const queueKey = rowQueuePrefix + column.id;
    const previous = txtSaveQueues.get(queueKey) || Promise.resolve();
    let operation;
    let failed = false;
    let confirmedValue = normalizedValue;
    operation = previous.catch(() => undefined).then(async () => {
      const { data, error } = await client.rpc("set_txt_row_state_value", {
        p_source_id: row.source_id,
        p_row_key: row.row_key,
        p_column_id: column.id,
        p_value: normalizedValue
      });
      if (error) throw error;
      if (txtSaveQueues.get(queueKey) === operation && activeTxtSourceId === row.source_id) {
        const latest = txtStates.get(row.row_key) || existing;
        const latestValues = isPlainObject(latest.values) ? latest.values : {};
        const savedValue = isPlainObject(data)
          && Object.prototype.hasOwnProperty.call(data, column.id)
          ? data[column.id]
          : normalizedValue;
        confirmedValue = savedValue;
        txtStates.set(row.row_key, {
          ...latest,
          values: { ...latestValues, [column.id]: savedValue }
        });
      }
    });

    txtSaveQueues.set(queueKey, operation);
    try {
      await operation;
      if (txtSaveQueues.get(queueKey) === operation) {
        if (column.type === "text") control.dataset.savedValue = String(confirmedValue ?? "");
        control.classList.remove("is-dirty");
        if (!tableRow.querySelector(".is-dirty")) tableRow.classList.remove("is-dirty");
      }
    } catch (error) {
      failed = true;
      if (txtSaveQueues.get(queueKey) === operation && activeTxtSourceId === row.source_id) {
        const latest = txtStates.get(row.row_key) || existing;
        const rollbackValues = { ...(isPlainObject(latest.values) ? latest.values : {}) };
        if (hadStoredValue) rollbackValues[column.id] = existingValues[column.id];
        else delete rollbackValues[column.id];
        txtStates.set(row.row_key, { ...latest, values: rollbackValues });
        if (column.type === "check") control.checked = coerceTxtCheckValue(previousEffectiveValue);
        else control.value = String(previousEffectiveValue ?? "");
        control.classList.remove("is-dirty");
        if (!tableRow.querySelector(".is-dirty")) tableRow.classList.remove("is-dirty");
      }
      setSync("error", "Erro ao salvar");
      showToast(readableError(error), true);
    } finally {
      control.disabled = false;
      if (txtSaveQueues.get(queueKey) === operation) {
        txtSaveQueues.delete(queueKey);
        const rowStillSaving = [...txtSaveQueues.keys()]
          .some((key) => key.startsWith(rowQueuePrefix));
        if (!rowStillSaving) tableRow.classList.remove("is-saving");
        if (!failed && !txtSaveQueues.size && !hasDirtyTxtRows()) {
          setSync("online", "Sincronizado");
        }
        if (txtReloadPending && !txtSaveQueues.size) {
          scheduleTxtRealtime(txtSourcesReloadPending);
        }
        runPendingTxtSearchWhenReady();
      }
    }
  }

  function blockTxtNavigationWhileSaving() {
    if (txtColumnsSaving) {
      showToast("Aguarde o salvamento das colunas terminar.", true);
      return true;
    }
    if (!elements.txtColumnsModal.hidden) {
      showToast("Feche o editor de colunas antes de continuar.", true);
      return true;
    }
    if (!txtSaveQueues.size && !hasDirtyTxtRows()) return false;
    setSync("loading", "Finalizando alteração");
    showToast(txtSaveQueues.size
      ? "Aguarde a alteração terminar de salvar."
      : "Finalize a célula que está sendo editada antes de continuar.");
    return true;
  }

  async function refreshTxt() {
    if (blockTxtNavigationWhileSaving()) return;
    setButtonBusy(elements.refreshTxtButton, true, "Atualizando…");
    setSync("loading", "Atualizando contas");
    try {
      await loadTxtSources({ loadRows: true });
      txtReloadPending = false;
      txtSourcesReloadPending = false;
      setSync("online", "Sincronizado");
      showToast("Contas atualizadas.");
    } catch (error) {
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
    } finally {
      setButtonBusy(elements.refreshTxtButton, false);
    }
  }

  function openTxtColumnsModal() {
    if (blockTxtNavigationWhileSaving()) return;
    const source = getActiveTxtSource();
    if (!source) return;
    txtColumnSourceId = source.id;
    txtColumnExpectedColumns = normalizeTxtColumns(source.columns);
    txtColumnDraft = txtColumnExpectedColumns.map((column) => ({ ...column }));
    renderTxtColumnDraft();
    elements.txtColumnNameInput.value = "";
    elements.txtColumnTypeInput.value = "check";
    elements.txtColumnsModal.hidden = false;
    elements.appView.inert = true;
    document.body.classList.add("has-open-modal");
    window.setTimeout(() => elements.txtColumnNameInput.focus(), 0);
  }

  function closeTxtColumnsModal(force = false) {
    if (!elements.txtColumnsModal || (txtColumnsSaving && !force)) return;
    if (force && txtColumnsSaving) setTxtColumnsModalBusy(false);
    elements.txtColumnsModal.hidden = true;
    elements.appView.inert = false;
    document.body.classList.remove("has-open-modal");
    txtColumnDraft = [];
    txtColumnSourceId = "";
    txtColumnExpectedColumns = [];
    elements.txtColumnForm?.reset();
    if (elements.txtColumnTypeInput) elements.txtColumnTypeInput.value = "check";
    if (txtReloadPending) scheduleTxtRealtime(txtSourcesReloadPending);
  }

  function clearTxtColumnDropIndicators() {
    for (const row of elements.txtColumnsList.querySelectorAll(".txt-column-row")) {
      row.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
      delete row.dataset.dropPosition;
    }
  }

  function reorderTxtColumnById(sourceId, targetId, placeAfter) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const from = txtColumnDraft.findIndex((column) => column.id === sourceId);
    if (from < 0 || !txtColumnDraft.some((column) => column.id === targetId)) return;
    const [column] = txtColumnDraft.splice(from, 1);
    const target = txtColumnDraft.findIndex((entry) => entry.id === targetId);
    txtColumnDraft.splice(target + (placeAfter ? 1 : 0), 0, column);
    renderTxtColumnDraft();
  }

  function renderTxtColumnDraft() {
    elements.txtColumnsList.replaceChildren();
    if (!txtColumnDraft.length) {
      const empty = document.createElement("div");
      empty.className = "txt-columns-empty";
      empty.textContent = "Nenhuma coluna adicional. Login e senha continuam fixos na tabela.";
      elements.txtColumnsList.append(empty);
      return;
    }
    txtColumnDraft.forEach((column, index) => {
      const row = document.createElement("div");
      row.className = "txt-column-row";
      row.dataset.columnId = column.id;

      const drag = document.createElement("button");
      drag.type = "button";
      drag.className = "txt-column-drag";
      drag.textContent = "••";
      drag.draggable = true;
      drag.title = "Arraste para mudar a posição";
      drag.setAttribute("aria-label", "Arrastar coluna " + column.label);
      drag.addEventListener("dragstart", (event) => {
        draggedTxtColumnId = column.id;
        row.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", column.id);
        }
      });
      drag.addEventListener("dragend", () => {
        draggedTxtColumnId = "";
        clearTxtColumnDropIndicators();
      });

      row.addEventListener("dragover", (event) => {
        if (!draggedTxtColumnId || draggedTxtColumnId === column.id) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        clearTxtColumnDropIndicators();
        const placeAfter = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
        row.dataset.dropPosition = placeAfter ? "after" : "before";
        row.classList.add(placeAfter ? "is-drop-after" : "is-drop-before");
      });
      row.addEventListener("dragleave", (event) => {
        if (event.relatedTarget && row.contains(event.relatedTarget)) return;
        row.classList.remove("is-drop-before", "is-drop-after");
        delete row.dataset.dropPosition;
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceId = event.dataTransfer?.getData("text/plain") || draggedTxtColumnId;
        const placeAfter = row.dataset.dropPosition === "after";
        draggedTxtColumnId = "";
        clearTxtColumnDropIndicators();
        reorderTxtColumnById(sourceId, column.id, placeAfter);
      });

      const name = document.createElement("input");
      name.type = "text";
      name.className = "txt-column-name";
      name.maxLength = 80;
      name.value = column.label;
      name.setAttribute("aria-label", "Nome da coluna " + (index + 1));
      name.addEventListener("input", () => { txtColumnDraft[index].label = name.value.slice(0, 80); });
      const type = document.createElement("select");
      type.className = "txt-column-type";
      type.setAttribute("aria-label", "Tipo da coluna " + column.label);
      const checkOption = document.createElement("option");
      checkOption.value = "check";
      checkOption.textContent = "Checkbox";
      const textOption = document.createElement("option");
      textOption.value = "text";
      textOption.textContent = "Texto";
      type.append(checkOption, textOption);
      type.value = column.type;
      type.addEventListener("change", () => { txtColumnDraft[index].type = type.value === "check" ? "check" : "text"; });
      const controls = document.createElement("div");
      controls.className = "txt-column-controls";
      const up = document.createElement("button");
      up.type = "button";
      up.className = "txt-column-control";
      up.textContent = "↑";
      up.title = "Mover para a esquerda";
      up.setAttribute("aria-label", "Mover " + column.label + " para a esquerda");
      up.disabled = index === 0;
      up.addEventListener("click", () => moveTxtColumn(index, index - 1));
      const down = document.createElement("button");
      down.type = "button";
      down.className = "txt-column-control";
      down.textContent = "↓";
      down.title = "Mover para a direita";
      down.setAttribute("aria-label", "Mover " + column.label + " para a direita");
      down.disabled = index === txtColumnDraft.length - 1;
      down.addEventListener("click", () => moveTxtColumn(index, index + 1));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "txt-column-control is-delete";
      remove.textContent = "×";
      remove.title = "Remover " + column.label;
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => {
        txtColumnDraft.splice(index, 1);
        renderTxtColumnDraft();
      });
      controls.append(up, down, remove);
      row.append(drag, name, type, controls);
      elements.txtColumnsList.append(row);
    });
  }

  function moveTxtColumn(from, to) {
    if (to < 0 || to >= txtColumnDraft.length) return;
    const [column] = txtColumnDraft.splice(from, 1);
    txtColumnDraft.splice(to, 0, column);
    renderTxtColumnDraft();
  }

  function createColumnId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return "column_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function addTxtColumn(event) {
    event.preventDefault();
    const label = safeTrim(elements.txtColumnNameInput.value, 80);
    const type = elements.txtColumnTypeInput.value === "check" ? "check" : "text";
    if (!label) return;
    if (txtColumnDraft.length >= TXT_MAX_COLUMNS) {
      showToast("O limite é de " + TXT_MAX_COLUMNS + " colunas adicionais.", true);
      return;
    }
    if (txtColumnDraft.some((column) => normalizeForSearch(column.label) === normalizeForSearch(label))) {
      showToast("Já existe uma coluna com esse nome.", true);
      return;
    }
    txtColumnDraft.push({ id: createColumnId().slice(0, 64), label, type, position: txtColumnDraft.length });
    elements.txtColumnNameInput.value = "";
    elements.txtColumnTypeInput.value = "check";
    renderTxtColumnDraft();
    elements.txtColumnNameInput.focus();
  }

  function setTxtColumnsModalBusy(busy) {
    txtColumnsSaving = busy;
    elements.closeTxtColumnsButton.disabled = busy;
    elements.cancelTxtColumnsButton.disabled = busy;
    for (const control of elements.txtColumnForm.querySelectorAll("input, select, button")) {
      control.disabled = busy;
    }
    if (busy) {
      for (const control of elements.txtColumnsList.querySelectorAll("input, select, button")) {
        control.disabled = true;
      }
    } else if (!elements.txtColumnsModal.hidden) {
      renderTxtColumnDraft();
    }
  }

  async function saveTxtColumns() {
    const source = txtSources.find((entry) => entry.id === txtColumnSourceId) || null;
    if (!source || source.id !== activeTxtSourceId) {
      showToast("A tabela ativa mudou. Feche o editor de colunas e abra novamente.", true);
      return;
    }
    const cleaned = txtColumnDraft.map((column, index) => ({
      id: safeTrim(column.id, 64), label: safeTrim(column.label, 80),
      type: column.type === "check" ? "check" : "text", position: index
    }));
    if (cleaned.some((column) => !column.id || !column.label)) {
      showToast("Todas as colunas precisam ter um nome.", true);
      return;
    }
    const labels = cleaned.map((column) => normalizeForSearch(column.label));
    if (new Set(labels).size !== labels.length) {
      showToast("Os nomes das colunas não podem se repetir.", true);
      return;
    }
    setButtonBusy(elements.saveTxtColumnsButton, true, "Salvando…");
    setTxtColumnsModalBusy(true);
    setSync("loading", "Salvando colunas");
    try {
      const { data, error } = await client.rpc("set_txt_source_columns", {
        p_source_id: source.id,
        p_columns: cleaned,
        p_expected_columns: txtColumnExpectedColumns
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("O Supabase não confirmou as colunas salvas.");
      const savedColumns = normalizeTxtColumns(data);
      if (savedColumns.length !== cleaned.length) {
        throw new Error("O Supabase retornou uma estrutura de colunas incompleta.");
      }
      source.columns = savedColumns;
      txtColumnExpectedColumns = savedColumns.map((column) => ({ ...column }));
      setTxtColumnsModalBusy(false);
      closeTxtColumnsModal();
      renderTxtTable();
      setSync("online", "Sincronizado");
      showToast("Colunas atualizadas.");
    } catch (error) {
      setSync("error", "Erro ao salvar");
      showToast(readableError(error), true);
    } finally {
      setTxtColumnsModalBusy(false);
      setButtonBusy(elements.saveTxtColumnsButton, false);
      runPendingTxtSearchWhenReady();
    }
  }

  function schedulePriceRealtime(includeSubjects) {
    window.clearTimeout(priceRealtimeTimer);
    priceRealtimeTimer = window.setTimeout(async () => {
      if (hasDirtyPriceRows()) {
        setSync("loading", "Alterações pendentes");
        return;
      }
      try {
        if (includeSubjects) await loadSubjects({ loadActiveItems: true });
        else await loadItems();
        setSync("online", "Sincronizado");
      } catch (error) {
        setSync("error", "Erro de conexão");
        showToast(readableError(error), true);
      }
    }, 300);
  }

  function scheduleTxtRealtime(includeSources) {
    txtReloadPending = true;
    txtSourcesReloadPending = txtSourcesReloadPending || Boolean(includeSources);
    if (includeSources) txtSourcesLoaded = false;
    if (activeWorkspace !== "txt") return;
    window.clearTimeout(txtRealtimeTimer);
    txtRealtimeTimer = window.setTimeout(flushTxtRealtime, 350);
  }

  async function flushTxtRealtime() {
    txtRealtimeTimer = null;
    if (!txtReloadPending || activeWorkspace !== "txt") return;
    if (txtColumnsSaving || txtSaveQueues.size || hasDirtyTxtRows() || !elements.txtColumnsModal.hidden) {
      setSync("loading", "Alterações pendentes");
      txtRealtimeTimer = window.setTimeout(flushTxtRealtime, 500);
      return;
    }

    const includeSources = txtSourcesReloadPending;
    txtReloadPending = false;
    txtSourcesReloadPending = false;
    try {
      if (includeSources) await loadTxtSources({ loadRows: true });
      else await loadTxtRows();
      setSync("online", "Sincronizado");
    } catch (error) {
      txtReloadPending = true;
      txtSourcesReloadPending = txtSourcesReloadPending || includeSources;
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
    }
  }

  function startRealtime() {
    stopRealtime();
    realtimeSubscription = client.channel(REALTIME_CHANNEL)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_SUBJECTS }, () => schedulePriceRealtime(true))
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_ITEMS }, () => schedulePriceRealtime(false))
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_TXT_SOURCES }, () => scheduleTxtRealtime(true))
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_TXT_STATES }, (payload) => {
        const sourceId = payload.new?.source_id || payload.old?.source_id || "";
        if (!sourceId || sourceId === activeTxtSourceId) scheduleTxtRealtime(false);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setSync("online", "Sincronizado");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSync("error", "Realtime indisponível");
      });
  }

  function stopRealtime() {
    window.clearTimeout(priceRealtimeTimer);
    window.clearTimeout(txtRealtimeTimer);
    priceRealtimeTimer = null;
    txtRealtimeTimer = null;
    txtReloadPending = false;
    txtSourcesReloadPending = false;
    if (client && realtimeSubscription) client.removeChannel(realtimeSubscription);
    realtimeSubscription = null;
  }

  async function login(event) {
    event.preventDefault();
    const email = safeTrim(elements.emailInput.value, 320);
    const password = elements.passwordInput.value;
    if (!email || !password) {
      elements.loginMessage.textContent = "Preencha o e-mail e a senha.";
      return;
    }
    elements.loginMessage.textContent = "";
    setButtonBusy(elements.loginButton, true, "Entrando…");
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) {
      elements.loginMessage.textContent = readableError(error);
    } finally {
      setButtonBusy(elements.loginButton, false);
    }
  }

  async function logout() {
    if (blockTxtNavigationWhileSaving() || window.PainelInfo?.blockNavigation()) return;
    setButtonBusy(elements.logoutButton, true, "Saindo…");
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } catch (error) {
      showToast(readableError(error), true);
      setButtonBusy(elements.logoutButton, false);
    }
  }

  elements.loginForm.addEventListener("submit", login);
  elements.homeLink.addEventListener("click", (event) => {
    if (blockTxtNavigationWhileSaving() || window.PainelInfo?.blockNavigation()) event.preventDefault();
  });
  elements.logoutButton.addEventListener("click", logout);
  elements.pricesTab.addEventListener("click", () => void switchWorkspace("prices"));
  elements.txtTab.addEventListener("click", () => void switchWorkspace("txt"));
  elements.infoTab.addEventListener("click", () => void switchWorkspace("info"));
  const workspaceTabs = [elements.pricesTab, elements.txtTab, elements.infoTab];
  for (const [index, tab] of workspaceTabs.entries()) {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + workspaceTabs.length) % workspaceTabs.length;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % workspaceTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = workspaceTabs.length - 1;
      if (nextIndex !== index) {
        if (activeWorkspace === "txt" && blockTxtNavigationWhileSaving()) return;
        if (activeWorkspace === "info" && window.PainelInfo?.blockNavigation()) return;
      }
      workspaceTabs[nextIndex].focus();
      workspaceTabs[nextIndex].click();
    });
  }
  elements.subjectForm.addEventListener("submit", createSubject);
  elements.subjectSearchInput.addEventListener("input", renderSubjects);
  elements.itemForm.addEventListener("submit", createItem);
  elements.itemSearchInput.addEventListener("input", renderItems);
  elements.renameSubjectButton.addEventListener("click", () => renameSubject());
  elements.deleteSubjectButton.addEventListener("click", deleteSubject);
  elements.refreshButton.addEventListener("click", refreshPrices);
  elements.exportButton.addEventListener("click", exportData);
  elements.focusSubjectButton.addEventListener("click", () => elements.subjectNameInput.focus());
  elements.refreshTxtButton.addEventListener("click", refreshTxt);
  elements.manageTxtColumnsButton.addEventListener("click", openTxtColumnsModal);
  elements.txtSearchInput.addEventListener("input", () => {
    const rawSearch = String(elements.txtSearchInput.value || "").slice(0, 160);
    if (elements.txtSearchInput.value !== rawSearch) elements.txtSearchInput.value = rawSearch;
    txtSearchTerm = rawSearch.trim();
    txtPage = 0;
    txtRowsLoaded = false;
    txtRequestId += 1;
    setTxtPaginationPending();
    updateTxtSearchUi(txtSearchTerm ? "loading" : "idle");
    scheduleTxtSearchLoad(350);
  });
  elements.clearTxtSearchButton.addEventListener("click", () => {
    if (!txtSearchTerm && !elements.txtSearchInput.value) return;
    resetTxtSearch();
    scheduleTxtSearchLoad(0);
    elements.txtSearchInput.focus();
  });
  async function changeTxtPage(nextPage) {
    if (nextPage < 0 || nextPage * TXT_PAGE_SIZE >= txtTotalRows) return;
    if (blockTxtNavigationWhileSaving()) return;
    const previousPage = txtPage;
    txtPage = nextPage;
    setSync("loading", "Carregando contas");
    try {
      await loadTxtRows();
      setSync("online", "Sincronizado");
    } catch (error) {
      txtPage = previousPage;
      renderTxtTable();
      setSync("error", "Erro de conexão");
      showToast(readableError(error), true);
    }
  }

  elements.txtPrevPageButton.addEventListener("click", () => void changeTxtPage(txtPage - 1));
  elements.txtNextPageButton.addEventListener("click", () => void changeTxtPage(txtPage + 1));
  elements.txtColumnForm.addEventListener("submit", addTxtColumn);
  elements.saveTxtColumnsButton.addEventListener("click", saveTxtColumns);
  elements.closeTxtColumnsButton.addEventListener("click", () => closeTxtColumnsModal());
  elements.cancelTxtColumnsButton.addEventListener("click", () => closeTxtColumnsModal());
  elements.txtColumnsModal.addEventListener("click", (event) => {
    if (event.target === elements.txtColumnsModal) closeTxtColumnsModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.txtColumnsModal.hidden) closeTxtColumnsModal();
  });
  window.addEventListener("resize", scheduleTxtTableFit, { passive: true });
  window.addEventListener("beforeunload", (event) => {
    const infoPending = window.PainelInfo?.hasPendingChanges();
    if (infoPending) {
      event.preventDefault();
      event.returnValue = "";
      return;
    }
    if (!txtColumnsSaving && !txtSaveQueues.size && !hasDirtyTxtRows()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  initialize().catch((error) => {
    elements.setupError.textContent = readableError(error);
    showOnly("setup");
  });
})();
