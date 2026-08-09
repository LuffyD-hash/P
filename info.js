(() => {
  "use strict";

  const TABLE_SUBJECTS = "info_subjects";
  const TABLE_ENTRIES = "info_entries";
  const ACTIVE_SUBJECT_KEY = "painel_active_info_topic";
  const REALTIME_CHANNEL = "painel_info_v1";
  const SUBJECT_NAME_LIMIT = 120;
  const ENTRY_TITLE_LIMIT = 160;
  const ENTRY_CONTENT_LIMIT = 20000;
  const REALTIME_DELAY = 350;

  const REQUIRED_ELEMENT_IDS = [
    "infoTopicForm", "infoTopicNameInput", "infoTopicSearchInput", "infoTopicList",
    "infoTopicCount", "infoTopicEmpty", "noInfoTopicView", "infoTopicView",
    "focusInfoTopicButton", "activeInfoTopicName", "infoTopicPath", "infoEntryCount",
    "infoEntryCountLabel", "addInfoChildButton", "renameInfoTopicButton",
    "deleteInfoTopicButton", "refreshInfoButton", "infoEntryForm", "infoEntryTitleInput",
    "infoEntryContentInput", "addInfoEntryButton", "infoEntrySearchInput",
    "infoEntriesList", "infoEntriesEmpty", "infoEntriesEmptyTitle", "infoEntriesEmptyText"
  ];

  let runtime = null;
  let elements = null;
  let handlersBound = false;
  let visible = false;
  let activated = false;
  let activationPromise = null;
  let subjects = [];
  let entries = [];
  let renderedEntrySearch = "";
  let activeSubjectId = readStoredSubjectId();
  let subjectsLoaded = false;
  let entriesLoaded = false;
  let subjectRequestId = 0;
  let entryRequestId = 0;
  let lifecycleRevision = 0;
  let pendingMutations = 0;
  let realtimeSubscription = null;
  let realtimeTimer = null;
  let realtimeReloadPending = false;
  let realtimeSubjectsPending = false;

  function readStoredSubjectId() {
    try {
      return window.localStorage.getItem(ACTIVE_SUBJECT_KEY) || "";
    } catch (_error) {
      return "";
    }
  }

  function persistActiveSubject() {
    try {
      if (activeSubjectId) window.localStorage.setItem(ACTIVE_SUBJECT_KEY, activeSubjectId);
      else window.localStorage.removeItem(ACTIVE_SUBJECT_KEY);
    } catch (_error) {
      // A ausência de localStorage não impede o uso da página.
    }
  }

  function safeTrim(value, maxLength) {
    return String(value ?? "").trim().slice(0, maxLength);
  }

  function normalizeForSearch(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  }

  function normalizeContent(value) {
    return String(value ?? "").slice(0, ENTRY_CONTENT_LIMIT);
  }

  function getActiveSubject() {
    return subjects.find((subject) => subject.id === activeSubjectId) || null;
  }

  function getSubject(subjectId) {
    return subjects.find((subject) => subject.id === subjectId) || null;
  }

  function notify(message, isError = false) {
    if (typeof runtime?.showToast === "function") runtime.showToast(message, isError);
  }

  function sync(state, label) {
    if (typeof runtime?.setSync === "function") runtime.setSync(state, label);
  }

  function errorMessage(error) {
    if (typeof runtime?.readableError === "function") return runtime.readableError(error);
    return String(error?.message || error || "Erro inesperado.");
  }

  function setButtonBusy(button, busy, label = "Salvando…") {
    if (!button) return;
    if (busy) {
      if (!button.dataset.infoOriginalText) button.dataset.infoOriginalText = button.textContent;
      button.textContent = label;
      button.disabled = true;
      return;
    }
    button.textContent = button.dataset.infoOriginalText || button.textContent;
    delete button.dataset.infoOriginalText;
    button.disabled = false;
  }

  function unwrapRpcResult(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data && typeof data === "object" ? data : null;
  }

  async function callRpc(name, parameters) {
    const { data, error } = await runtime.client.rpc(name, parameters);
    if (error) throw error;
    return data;
  }

  function resolveElements() {
    const resolved = {};
    const missing = [];
    for (const id of REQUIRED_ELEMENT_IDS) {
      const element = document.getElementById(id);
      if (!element) missing.push(id);
      else resolved[id] = element;
    }
    if (missing.length) {
      throw new Error("Elementos ausentes na página Info: " + missing.join(", "));
    }
    resolved.infoWorkspace = document.getElementById("infoWorkspace");
    return resolved;
  }

  function configure(options) {
    if (!options?.client || typeof options.client.from !== "function" || typeof options.client.rpc !== "function") {
      throw new Error("PainelInfo.configure precisa receber um cliente Supabase válido.");
    }

    const clientChanged = Boolean(runtime?.client && runtime.client !== options.client);
    if (clientChanged) reset();
    runtime = {
      client: options.client,
      user: options.user || null,
      showToast: options.showToast,
      readableError: options.readableError,
      setSync: options.setSync
    };
    elements = elements || resolveElements();
    bindHandlers();
    renderSubjects();
    renderActiveSubject();
    renderEntries();
    return window.PainelInfo;
  }

  function setVisible(nextVisible) {
    const nextState = Boolean(nextVisible);
    if (nextState === visible) {
      if (nextState) runPendingRealtimeWhenReady();
      return;
    }
    visible = nextState;
    if (elements?.infoWorkspace) elements.infoWorkspace.hidden = !visible;
    if (!visible) {
      window.clearTimeout(realtimeTimer);
      realtimeTimer = null;
      return;
    }
    renderSubjects();
    renderActiveSubject();
    renderEntries();
    runPendingRealtimeWhenReady();
  }

  async function activate() {
    if (!runtime || !elements) throw new Error("Configure PainelInfo antes de ativá-lo.");
    visible = true;
    if (elements.infoWorkspace) elements.infoWorkspace.hidden = false;
    startRealtime();

    if (activationPromise) return activationPromise;
    const revision = lifecycleRevision;
    const pendingActivation = (async () => {
      if (!subjectsLoaded) {
        sync("loading", "Carregando informações");
        await loadSubjects({ loadEntries: true });
      } else if (realtimeReloadPending) {
        const refreshed = await flushRealtime();
        if (!refreshed) return false;
      } else if (!entriesLoaded) {
        sync("loading", "Carregando informações");
        await loadEntries();
      } else {
        renderSubjects();
        renderActiveSubject();
        if (!hasPendingChanges()) renderEntries();
      }
      if (revision === lifecycleRevision) {
        activated = true;
        const clean = !hasPendingChanges();
        if (clean) sync("online", "Sincronizado");
        return clean;
      }
      return false;
    })().catch((error) => {
      if (revision === lifecycleRevision) sync("error", "Erro de conexão");
      throw error;
    }).finally(() => {
      if (activationPromise === pendingActivation) activationPromise = null;
    });
    activationPromise = pendingActivation;
    return pendingActivation;
  }

  function reset() {
    lifecycleRevision += 1;
    subjectRequestId += 1;
    entryRequestId += 1;
    activationPromise = null;
    activated = false;
    subjectsLoaded = false;
    entriesLoaded = false;
    pendingMutations = 0;
    subjects = [];
    entries = [];
    activeSubjectId = readStoredSubjectId();
    stopRealtime();

    if (!elements) return;
    elements.infoTopicForm.reset();
    elements.infoEntryForm.reset();
    elements.infoTopicSearchInput.value = "";
    elements.infoEntrySearchInput.value = "";
    renderSubjects();
    renderActiveSubject();
    renderEntries();
  }

  function hasDirtyEntryRows() {
    return Boolean(elements?.infoEntriesList.querySelector(".info-entry-row.is-dirty"));
  }

  function hasEntryDraftValues() {
    if (!elements) return false;
    return Boolean(
      safeTrim(elements.infoEntryTitleInput.value, ENTRY_TITLE_LIMIT)
      || elements.infoEntryContentInput.value
    );
  }

  function hasDraftValues() {
    if (!elements) return false;
    return Boolean(
      safeTrim(elements.infoTopicNameInput.value, SUBJECT_NAME_LIMIT)
      || hasEntryDraftValues()
    );
  }

  function blockRootSubjectCreation() {
    if (pendingMutations === 0 && !hasDirtyEntryRows() && !hasEntryDraftValues()) return false;
    if (pendingMutations > 0) {
      sync("loading", "Finalizando alteração");
      notify("Aguarde a alteração atual terminar de salvar.", true);
    } else {
      notify("Salve ou limpe a informação atual antes de criar outro assunto.", true);
    }
    return true;
  }

  function hasPendingChanges() {
    return pendingMutations > 0 || hasDirtyEntryRows() || hasDraftValues();
  }

  function blockConcurrentMutation() {
    if (pendingMutations === 0) return false;
    sync("loading", "Finalizando alteração");
    notify("Aguarde a alteração atual terminar de salvar.", true);
    return true;
  }

  function blockNavigation() {
    if (!hasPendingChanges()) return false;
    if (pendingMutations > 0) {
      sync("loading", "Finalizando alteração");
      notify("Aguarde a alteração terminar de salvar.", true);
    } else {
      notify("Salve ou descarte as informações preenchidas antes de continuar.", true);
    }
    return true;
  }

  function beginMutation(label = "Salvando") {
    pendingMutations += 1;
    sync("loading", label);
  }

  function endMutation(revision, failed = false) {
    if (revision !== lifecycleRevision) return;
    pendingMutations = Math.max(0, pendingMutations - 1);
    if (!failed && pendingMutations === 0 && !hasDirtyEntryRows()) sync("online", "Sincronizado");
    runPendingRealtimeWhenReady();
  }

  async function loadSubjects({ loadEntries: shouldLoadEntries = false } = {}) {
    const activeElement = document.activeElement;
    const focusedRow = activeElement && elements?.infoTopicList.contains(activeElement)
      ? activeElement.closest(".info-topic-row")
      : null;
    const focusedSubjectId = focusedRow?.dataset.subjectId || "";
    const requestId = ++subjectRequestId;
    const revision = lifecycleRevision;
    const { data, error } = await runtime.client.from(TABLE_SUBJECTS)
      .select("id,parent_id,name,position,created_at,updated_at")
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (requestId !== subjectRequestId || revision !== lifecycleRevision) return false;
    if (error) throw error;

    const previousActiveSubjectId = activeSubjectId;
    subjects = data || [];
    subjectsLoaded = true;
    if (!subjects.some((subject) => subject.id === activeSubjectId)) {
      activeSubjectId = subjects.find((subject) => !subject.parent_id)?.id || subjects[0]?.id || "";
      persistActiveSubject();
    }
    if (activeSubjectId !== previousActiveSubjectId) {
      entriesLoaded = false;
      entryRequestId += 1;
      entries = [];
      elements.infoEntryForm.reset();
      elements.infoEntrySearchInput.value = "";
      renderEntries();
    }
    renderSubjects();
    if (focusedSubjectId) {
      focusSubjectInList(getSubject(focusedSubjectId) ? focusedSubjectId : activeSubjectId);
    }
    renderActiveSubject();
    if (shouldLoadEntries) await loadEntries();
    return true;
  }

  async function loadEntries() {
    entriesLoaded = false;
    const requestId = ++entryRequestId;
    const revision = lifecycleRevision;
    const subjectAtRequest = activeSubjectId;
    if (!subjectAtRequest) {
      entries = [];
      renderEntries();
      entriesLoaded = true;
      return true;
    }

    const { data, error } = await runtime.client.from(TABLE_ENTRIES)
      .select("id,subject_id,title,content,position,created_at,updated_at")
      .eq("subject_id", subjectAtRequest)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (requestId !== entryRequestId || revision !== lifecycleRevision || subjectAtRequest !== activeSubjectId) {
      return false;
    }
    if (error) throw error;
    if (hasDirtyEntryRows()) {
      scheduleRealtime(false);
      return false;
    }
    entries = data || [];
    renderEntries();
    entriesLoaded = true;
    return true;
  }

  function rootSubjects() {
    const ids = new Set(subjects.map((subject) => subject.id));
    return subjects.filter((subject) => !subject.parent_id || !ids.has(subject.parent_id));
  }

  function childrenOf(parentId) {
    return subjects.filter((subject) => subject.parent_id === parentId);
  }

  function subjectMatches(subject, query) {
    return normalizeForSearch(subject.name).includes(query);
  }

  function renderSubjects() {
    if (!elements) return;
    const query = normalizeForSearch(elements.infoTopicSearchInput.value);
    const renderedIds = new Set();
    elements.infoTopicList.replaceChildren();
    elements.infoTopicCount.textContent = String(subjects.length);

    for (const parent of rootSubjects()) {
      const children = childrenOf(parent.id);
      const parentMatches = !query || subjectMatches(parent, query);
      const matchingChildren = query && !parentMatches
        ? children.filter((child) => subjectMatches(child, query))
        : children;
      if (!parentMatches && !matchingChildren.length) continue;

      const group = document.createElement("div");
      group.className = "info-topic-group";
      group.append(createSubjectRow(parent, false));
      renderedIds.add(parent.id);

      if (matchingChildren.length) {
        const childList = document.createElement("div");
        childList.className = "info-child-list";
        for (const child of matchingChildren) {
          childList.append(createSubjectRow(child, true));
          renderedIds.add(child.id);
        }
        group.append(childList);
      }
      elements.infoTopicList.append(group);
    }

    // Dados inesperados nunca ficam invisíveis, mesmo se uma migration antiga
    // tiver permitido mais de um nível.
    for (const subject of subjects) {
      if (renderedIds.has(subject.id)) continue;
      if (query && !subjectMatches(subject, query)) continue;
      elements.infoTopicList.append(createSubjectRow(subject, Boolean(subject.parent_id)));
      renderedIds.add(subject.id);
    }

    const noResults = elements.infoTopicList.childElementCount === 0;
    elements.infoTopicEmpty.hidden = !noResults;
  }

  function focusSubjectInList(subjectId) {
    if (!subjectId || !elements) return;
    const row = [...elements.infoTopicList.querySelectorAll(".info-topic-row")]
      .find((candidate) => candidate.dataset.subjectId === subjectId);
    row?.querySelector(".info-topic-select")?.focus({ preventScroll: true });
  }

  function createSubjectRow(subject, isChild) {
    const row = document.createElement("div");
    row.className = "subject-row info-topic-row";
    if (isChild) row.classList.add("is-child");
    if (subject.id === activeSubjectId) row.classList.add("is-active");
    row.dataset.subjectId = subject.id;

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "subject-select info-topic-select";
    selectButton.textContent = subject.name || "Sem nome";
    selectButton.title = subject.name || "Assunto sem nome";
    selectButton.setAttribute("aria-pressed", String(subject.id === activeSubjectId));
    selectButton.addEventListener("click", () => void selectSubject(subject.id));

    const actions = document.createElement("div");
    actions.className = "info-topic-actions";
    if (!subject.parent_id) {
      const addChildButton = document.createElement("button");
      addChildButton.type = "button";
      addChildButton.className = "subject-menu-button info-topic-action";
      addChildButton.textContent = "+";
      addChildButton.title = "Adicionar assunto filho em " + subject.name;
      addChildButton.setAttribute("aria-label", addChildButton.title);
      addChildButton.addEventListener("click", () => void createChildSubject(subject, addChildButton));
      actions.append(addChildButton);
    }

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "subject-menu-button info-topic-action";
    renameButton.textContent = "···";
    renameButton.title = "Renomear " + subject.name;
    renameButton.setAttribute("aria-label", renameButton.title);
    renameButton.addEventListener("click", () => void renameSubject(subject, renameButton));
    actions.append(renameButton);
    row.append(selectButton, actions);
    return row;
  }

  function renderActiveSubject() {
    if (!elements) return;
    const subject = getActiveSubject();
    elements.noInfoTopicView.hidden = Boolean(subject);
    elements.infoTopicView.hidden = !subject;
    if (!subject) return;

    const parent = subject.parent_id ? getSubject(subject.parent_id) : null;
    elements.activeInfoTopicName.textContent = subject.name || "Sem nome";
    elements.infoTopicPath.textContent = parent
      ? (parent.name || "Assunto") + " › " + (subject.name || "Sem nome")
      : "Assunto principal";
    elements.addInfoChildButton.disabled = Boolean(subject.parent_id);
    elements.addInfoChildButton.hidden = Boolean(subject.parent_id);
  }

  function renderEntries() {
    if (!elements) return;
    const query = normalizeForSearch(elements.infoEntrySearchInput.value);
    renderedEntrySearch = elements.infoEntrySearchInput.value;
    const filtered = query ? entries.filter((entry) => {
      return (normalizeForSearch(entry.title) + " " + normalizeForSearch(entry.content)).includes(query);
    }) : entries;

    elements.infoEntryCount.textContent = String(entries.length);
    elements.infoEntryCountLabel.textContent = entries.length === 1 ? "informação" : "informações";
    elements.infoEntriesList.replaceChildren();
    for (const entry of filtered) elements.infoEntriesList.append(createEntryRow(entry));

    const empty = filtered.length === 0;
    elements.infoEntriesEmpty.hidden = !empty;
    if (query && entries.length && empty) {
      elements.infoEntriesEmptyTitle.textContent = "Nenhuma informação encontrada";
      elements.infoEntriesEmptyText.textContent = "Tente pesquisar outro título ou conteúdo.";
    } else {
      elements.infoEntriesEmptyTitle.textContent = "Nenhuma informação neste assunto";
      elements.infoEntriesEmptyText.textContent = "Use o formulário acima para adicionar a primeira.";
    }
  }

  function createEntryRow(entry) {
    const row = document.createElement("div");
    row.className = "item-row info-entry-row";
    row.dataset.entryId = entry.id;

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "item-field info-entry-title";
    titleInput.maxLength = ENTRY_TITLE_LIMIT;
    titleInput.value = entry.title || "";
    titleInput.setAttribute("aria-label", "Título da informação " + (entry.title || "sem título"));

    const contentInput = document.createElement("textarea");
    contentInput.className = "item-field info-entry-content";
    contentInput.maxLength = ENTRY_CONTENT_LIMIT;
    contentInput.rows = 2;
    contentInput.value = entry.content || "";
    contentInput.setAttribute("aria-label", "Conteúdo da informação " + (entry.title || "sem título"));

    const actions = document.createElement("div");
    actions.className = "item-actions info-entry-actions";
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
      const dirty = titleInput.value !== (entry.title || "") || contentInput.value !== (entry.content || "");
      row.classList.toggle("is-dirty", dirty);
      saveButton.disabled = !dirty;
      if (!dirty) runPendingRealtimeWhenReady();
    };
    titleInput.addEventListener("input", updateDirtyState);
    contentInput.addEventListener("input", updateDirtyState);
    const shortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !saveButton.disabled) {
        event.preventDefault();
        saveButton.click();
      }
      if (event.key === "Escape") {
        titleInput.value = entry.title || "";
        contentInput.value = entry.content || "";
        updateDirtyState();
      }
    };
    titleInput.addEventListener("keydown", shortcut);
    contentInput.addEventListener("keydown", shortcut);
    saveButton.addEventListener("click", () => void updateEntry(entry, row, titleInput, contentInput, saveButton));
    deleteButton.addEventListener("click", () => void deleteEntry(entry, row, deleteButton));

    actions.append(saveButton, deleteButton);
    row.append(titleInput, contentInput, actions);
    return row;
  }

  async function selectSubject(subjectId) {
    if (subjectId === activeSubjectId) return;
    if (blockNavigation()) return;
    activeSubjectId = subjectId;
    entriesLoaded = false;
    persistActiveSubject();
    entries = [];
    entryRequestId += 1;
    elements.infoEntrySearchInput.value = "";
    elements.infoEntryForm.reset();
    renderSubjects();
    focusSubjectInList(activeSubjectId);
    renderActiveSubject();
    renderEntries();
    sync("loading", "Carregando informações");
    try {
      await loadEntries();
      sync("online", "Sincronizado");
    } catch (error) {
      sync("error", "Erro de conexão");
      notify(errorMessage(error), true);
    }
  }

  async function createRootSubject(event) {
    event.preventDefault();
    if (blockRootSubjectCreation()) return;
    const name = safeTrim(elements.infoTopicNameInput.value, SUBJECT_NAME_LIMIT);
    if (!name) return;
    const button = elements.infoTopicForm.querySelector("button[type='submit']");
    const revision = lifecycleRevision;
    const idsBefore = new Set(subjects.map((subject) => subject.id));
    setButtonBusy(button, true, "…");
    beginMutation("Salvando assunto");
    let failed = false;
    try {
      const data = await callRpc("create_info_subject", { p_name: name, p_parent_id: null });
      if (revision !== lifecycleRevision) return;
      const createdId = unwrapRpcResult(data)?.id || "";
      elements.infoTopicForm.reset();
      await loadSubjects();
      if (revision !== lifecycleRevision) return;
      activeSubjectId = createdId || subjects.find((subject) => !idsBefore.has(subject.id))?.id || activeSubjectId;
      entriesLoaded = false;
      persistActiveSubject();
      entries = [];
      elements.infoEntryForm.reset();
      elements.infoEntrySearchInput.value = "";
      renderSubjects();
      renderActiveSubject();
      renderEntries();
      await loadEntries();
      notify("Assunto “" + name + "” criado.");
      elements.infoEntryTitleInput.focus();
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        sync("error", "Erro ao salvar");
        notify(errorMessage(error), true);
      }
    } finally {
      setButtonBusy(button, false);
      endMutation(revision, failed);
    }
  }

  async function createChildSubject(parent = getActiveSubject(), button = elements.addInfoChildButton) {
    if (!parent || parent.parent_id) return;
    if (blockNavigation()) return;
    const answer = window.prompt("Nome do assunto filho de “" + parent.name + "”:", "");
    if (answer === null) return;
    const name = safeTrim(answer, SUBJECT_NAME_LIMIT);
    if (!name) return;

    const revision = lifecycleRevision;
    const idsBefore = new Set(subjects.map((subject) => subject.id));
    setButtonBusy(button, true, "…");
    beginMutation("Salvando assunto filho");
    let failed = false;
    try {
      const data = await callRpc("create_info_subject", { p_name: name, p_parent_id: parent.id });
      if (revision !== lifecycleRevision) return;
      const createdId = unwrapRpcResult(data)?.id || "";
      await loadSubjects();
      if (revision !== lifecycleRevision) return;
      activeSubjectId = createdId || subjects.find((subject) => !idsBefore.has(subject.id))?.id || activeSubjectId;
      entriesLoaded = false;
      persistActiveSubject();
      entries = [];
      elements.infoEntryForm.reset();
      elements.infoEntrySearchInput.value = "";
      renderSubjects();
      renderActiveSubject();
      renderEntries();
      await loadEntries();
      notify("Assunto filho “" + name + "” criado.");
      elements.infoEntryTitleInput.focus();
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        sync("error", "Erro ao salvar");
        notify(errorMessage(error), true);
      }
    } finally {
      setButtonBusy(button, false);
      endMutation(revision, failed);
    }
  }

  async function renameSubject(subject = getActiveSubject(), button = elements.renameInfoTopicButton) {
    if (!subject || blockNavigation()) return;
    const answer = window.prompt("Novo nome do assunto:", subject.name || "");
    if (answer === null) return;
    const name = safeTrim(answer, SUBJECT_NAME_LIMIT);
    if (!name || name === subject.name) return;

    const revision = lifecycleRevision;
    setButtonBusy(button, true, "…");
    beginMutation("Renomeando assunto");
    let failed = false;
    try {
      await callRpc("rename_info_subject", { p_subject_id: subject.id, p_name: name });
      if (revision !== lifecycleRevision) return;
      await loadSubjects();
      notify("Assunto renomeado.");
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        sync("error", "Erro ao salvar");
        notify(errorMessage(error), true);
      }
    } finally {
      setButtonBusy(button, false);
      endMutation(revision, failed);
    }
  }

  async function deleteSubject() {
    const subject = getActiveSubject();
    if (!subject || blockNavigation()) return;
    const childCount = childrenOf(subject.id).length;
    let warning = "Excluir o assunto “" + subject.name + "” e todas as informações dele?";
    if (childCount) {
      warning = "Excluir o assunto “" + subject.name + "”, seus " + childCount + " assunto" +
        (childCount === 1 ? " filho" : "s filhos") + " e todas as informações?";
    }
    if (!window.confirm(warning)) return;

    const revision = lifecycleRevision;
    setButtonBusy(elements.deleteInfoTopicButton, true, "Excluindo…");
    beginMutation("Excluindo assunto");
    let failed = false;
    try {
      const data = await callRpc("delete_info_subject", { p_subject_id: subject.id });
      if (revision !== lifecycleRevision) return;
      activeSubjectId = "";
      entriesLoaded = false;
      persistActiveSubject();
      entries = [];
      elements.infoEntryForm.reset();
      elements.infoEntrySearchInput.value = "";
      renderSubjects();
      renderActiveSubject();
      renderEntries();
      await loadSubjects({ loadEntries: true });
      if (activeSubjectId) focusSubjectInList(activeSubjectId);
      else elements.infoTopicNameInput.focus();
      const result = unwrapRpcResult(data);
      const deletedSubjects = Number(result?.subjects_deleted) || 0;
      const deletedEntries = Number(result?.entries_deleted) || 0;
      notify(deletedSubjects || deletedEntries
        ? deletedSubjects + " assunto(s) e " + deletedEntries + " informação(ões) excluídos."
        : "Assunto excluído.");
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        sync("error", "Erro ao excluir");
        notify(errorMessage(error), true);
      }
    } finally {
      setButtonBusy(elements.deleteInfoTopicButton, false);
      endMutation(revision, failed);
    }
  }

  async function createEntry(event) {
    event.preventDefault();
    if (blockConcurrentMutation()) return;
    const subject = getActiveSubject();
    if (!subject) return;
    if (hasDirtyEntryRows()) {
      notify("Salve as informações editadas antes de adicionar outra.", true);
      return;
    }
    const title = safeTrim(elements.infoEntryTitleInput.value, ENTRY_TITLE_LIMIT);
    const content = normalizeContent(elements.infoEntryContentInput.value);
    if (!title) {
      notify("Preencha o título da informação.", true);
      return;
    }

    const revision = lifecycleRevision;
    const subjectAtRequest = subject.id;
    setButtonBusy(elements.addInfoEntryButton, true, "Adicionando…");
    beginMutation("Salvando informação");
    let failed = false;
    try {
      await callRpc("create_info_entry", {
        p_subject_id: subjectAtRequest,
        p_title: title,
        p_content: content
      });
      if (revision !== lifecycleRevision || subjectAtRequest !== activeSubjectId) return;
      elements.infoEntryForm.reset();
      await loadEntries();
      notify("Informação “" + title + "” adicionada.");
      elements.infoEntryTitleInput.focus();
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        sync("error", "Erro ao salvar");
        notify(errorMessage(error), true);
      }
    } finally {
      setButtonBusy(elements.addInfoEntryButton, false);
      endMutation(revision, failed);
    }
  }

  async function updateEntry(entry, row, titleInput, contentInput, button) {
    if (blockConcurrentMutation()) return;
    const title = safeTrim(titleInput.value, ENTRY_TITLE_LIMIT);
    const content = normalizeContent(contentInput.value);
    if (!title) {
      notify("O título da informação não pode ficar vazio.", true);
      return;
    }

    const revision = lifecycleRevision;
    const subjectAtRequest = activeSubjectId;
    entryRequestId += 1;
    row.classList.add("is-saving");
    titleInput.disabled = true;
    contentInput.disabled = true;
    setButtonBusy(button, true, "Salvando…");
    beginMutation("Salvando informação");
    let failed = false;
    try {
      await callRpc("update_info_entry", {
        p_entry_id: entry.id,
        p_title: title,
        p_content: content
      });
      if (revision !== lifecycleRevision || subjectAtRequest !== activeSubjectId) return;
      entry.title = title;
      entry.content = content;
      titleInput.value = title;
      contentInput.value = content;
      row.classList.remove("is-dirty");
      notify("Informação atualizada.");
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        sync("error", "Erro ao salvar");
        notify(errorMessage(error), true);
      }
    } finally {
      row.classList.remove("is-saving");
      titleInput.disabled = false;
      contentInput.disabled = false;
      setButtonBusy(button, false);
      button.disabled = !row.classList.contains("is-dirty");
      endMutation(revision, failed);
    }
  }

  function hasOtherDirtyEntry(row) {
    return [...elements.infoEntriesList.querySelectorAll(".info-entry-row.is-dirty")]
      .some((candidate) => candidate !== row);
  }

  async function deleteEntry(entry, row, button) {
    if (blockConcurrentMutation()) return;
    if (hasOtherDirtyEntry(row)) {
      notify("Salve as outras informações editadas antes de excluir esta.", true);
      return;
    }
    if (!window.confirm("Excluir a informação “" + entry.title + "”?")) return;

    const revision = lifecycleRevision;
    const subjectAtRequest = activeSubjectId;
    entryRequestId += 1;
    setButtonBusy(button, true, "Excluindo…");
    beginMutation("Excluindo informação");
    let failed = false;
    try {
      await callRpc("delete_info_entry", { p_entry_id: entry.id });
      if (revision !== lifecycleRevision || subjectAtRequest !== activeSubjectId) return;
      entries = entries.filter((candidate) => candidate.id !== entry.id);
      renderEntries();
      notify("Informação excluída.");
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        sync("error", "Erro ao excluir");
        notify(errorMessage(error), true);
      }
    } finally {
      setButtonBusy(button, false);
      endMutation(revision, failed);
    }
  }

  async function refreshInfo() {
    if (blockNavigation()) return;
    const revision = lifecycleRevision;
    realtimeReloadPending = false;
    realtimeSubjectsPending = false;
    setButtonBusy(elements.refreshInfoButton, true, "Atualizando…");
    sync("loading", "Atualizando informações");
    let failed = false;
    try {
      await loadSubjects({ loadEntries: true });
      if (revision !== lifecycleRevision) return;
      if (!realtimeReloadPending) sync("online", "Sincronizado");
      notify("Informações atualizadas.");
    } catch (error) {
      failed = true;
      if (revision === lifecycleRevision) {
        realtimeReloadPending = true;
        realtimeSubjectsPending = true;
        sync("error", "Erro de conexão");
        notify(errorMessage(error), true);
      }
    } finally {
      setButtonBusy(elements.refreshInfoButton, false);
      if (!failed && revision === lifecycleRevision) runPendingRealtimeWhenReady();
    }
  }

  function scheduleRealtime(includeSubjects) {
    realtimeReloadPending = true;
    realtimeSubjectsPending = realtimeSubjectsPending || Boolean(includeSubjects);
    if (!visible) return;
    window.clearTimeout(realtimeTimer);
    realtimeTimer = window.setTimeout(() => void flushRealtime(), REALTIME_DELAY);
  }

  async function flushRealtime() {
    realtimeTimer = null;
    if (!realtimeReloadPending || !visible || !runtime) return;
    if (hasPendingChanges()) {
      sync("loading", "Alterações pendentes");
      return;
    }

    const includeSubjects = realtimeSubjectsPending;
    realtimeReloadPending = false;
    realtimeSubjectsPending = false;
    let failed = false;
    try {
      if (includeSubjects) await loadSubjects({ loadEntries: true });
      else await loadEntries();
      sync("online", "Sincronizado");
    } catch (error) {
      failed = true;
      realtimeReloadPending = true;
      realtimeSubjectsPending = realtimeSubjectsPending || includeSubjects;
      sync("error", "Erro de conexão");
      notify(errorMessage(error), true);
    }
    if (!failed && realtimeReloadPending) runPendingRealtimeWhenReady();
    return !failed;
  }

  function runPendingRealtimeWhenReady() {
    if (!realtimeReloadPending || !visible || hasPendingChanges()) return;
    window.clearTimeout(realtimeTimer);
    realtimeTimer = window.setTimeout(() => void flushRealtime(), 0);
  }

  function startRealtime() {
    if (!runtime || realtimeSubscription) return;
    realtimeSubscription = runtime.client.channel(REALTIME_CHANNEL)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_SUBJECTS }, () => {
        scheduleRealtime(true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_ENTRIES }, (payload) => {
        const subjectId = payload.new?.subject_id || payload.old?.subject_id || "";
        if (!subjectId || subjectId === activeSubjectId) scheduleRealtime(false);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !hasPendingChanges()) {
          if (realtimeReloadPending) runPendingRealtimeWhenReady();
          else sync("online", "Sincronizado");
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          sync("error", "Realtime indisponível");
        }
      });
  }

  function stopRealtime() {
    window.clearTimeout(realtimeTimer);
    realtimeTimer = null;
    realtimeReloadPending = false;
    realtimeSubjectsPending = false;
    if (runtime?.client && realtimeSubscription) runtime.client.removeChannel(realtimeSubscription);
    realtimeSubscription = null;
  }

  function handleDraftInput() {
    runPendingRealtimeWhenReady();
  }

  function handleEntrySearchInput() {
    if (pendingMutations > 0 || hasDirtyEntryRows()) {
      elements.infoEntrySearchInput.value = renderedEntrySearch;
      notify("Salve a informação editada antes de pesquisar.", true);
      return;
    }
    renderEntries();
  }

  function handleBeforeUnload(event) {
    if (!hasPendingChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function bindHandlers() {
    if (handlersBound) return;
    handlersBound = true;
    elements.infoTopicForm.addEventListener("submit", (event) => void createRootSubject(event));
    elements.infoTopicNameInput.addEventListener("input", handleDraftInput);
    elements.infoTopicSearchInput.addEventListener("input", renderSubjects);
    elements.focusInfoTopicButton.addEventListener("click", () => elements.infoTopicNameInput.focus());
    elements.addInfoChildButton.addEventListener("click", () => void createChildSubject());
    elements.renameInfoTopicButton.addEventListener("click", () => void renameSubject());
    elements.deleteInfoTopicButton.addEventListener("click", () => void deleteSubject());
    elements.refreshInfoButton.addEventListener("click", () => void refreshInfo());
    elements.infoEntryForm.addEventListener("submit", (event) => void createEntry(event));
    elements.infoEntryTitleInput.addEventListener("input", handleDraftInput);
    elements.infoEntryContentInput.addEventListener("input", handleDraftInput);
    elements.infoEntrySearchInput.addEventListener("input", handleEntrySearchInput);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  window.PainelInfo = Object.freeze({
    configure,
    setVisible,
    activate,
    reset,
    blockNavigation,
    hasPendingChanges,
    stopRealtime
  });
})();
