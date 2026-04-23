(function () {
  "use strict";

  var els = {
    folderPath: document.getElementById("folder-path"),
    emailText: document.getElementById("email-text"),
    browseFolder: document.getElementById("browse-folder"),
    pasteFolder: document.getElementById("paste-folder"),
    pasteEmail: document.getElementById("paste-email"),
    resizeMode: document.getElementById("resize-mode"),
    printTypeMode: document.getElementById("print-type-mode"),
    runAction: document.getElementById("run-action"),
    scanBtn: document.getElementById("scan-btn"),
    selectPendingBtn: document.getElementById("select-pending-btn"),
    selectSafeBtn: document.getElementById("select-safe-btn"),
    selectReviewBtn: document.getElementById("select-review-btn"),
    clearBtn: document.getElementById("clear-btn"),
    processBtn: document.getElementById("process-btn"),
    summaryChips: document.getElementById("summary-chips"),
    statusText: document.getElementById("status-text"),
    selectionText: document.getElementById("selection-text"),
    financialText: document.getElementById("financial-text"),
    rowsBody: document.getElementById("rows-body")
  };

  var state = {
    rows: [],
    selected: {},
    busy: false,
    lastRun: null,
    financials: null
  };

  var PREFS_KEY = "sizerIllustratorPrefs.v1";

  var STATUS_META = {
    QUEUED: { detail: "Ready for measurement and export." },
    OK: { detail: "Within tolerance and exported." },
    CHECK: { detail: "Exported, but review the size delta." },
    "NOT OK": { detail: "Measured, but held back from export." },
    MISSING_FILE: { detail: "No matching source file was found." },
    BAD_WIDTH_HEIGHT: { detail: "Order dimensions could not be parsed." },
    UNLOCK_FAIL: { detail: "Locked content prevented processing." },
    ACTION_FAIL: { detail: "The WeMust action failed or was unavailable." },
    NO_ARTWORK: { detail: "No visible top-level artwork was found." },
    BAD_BOUNDS: { detail: "Artwork bounds were invalid." },
    RESIZE_FAIL: { detail: "Resize failed on one or more items." },
    FIT_ARTBOARD_FAIL: { detail: "Artboard fit did not complete." },
    PROCESS_ERROR: { detail: "Unexpected processing error." }
  };

  var MATCH_META = {
    exact: { label: "Exact" },
    normalized: { label: "Normalized" },
    canonical: { label: "Canonical" },
    ultraLoose: { label: "Loose" },
    suggestion: { label: "Maybe" },
    missing: { label: "Missing" }
  };

  function hasCepBridge() {
    return typeof window.__adobe_cep__ !== "undefined";
  }

  function escapeForEval(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  function setStatus(message, isError) {
    els.statusText.textContent = message;
    els.statusText.className = isError ? "status-text error" : "status-text";
  }

  function isSafeStatus(status) {
    return status === "OK" || status === "CHECK";
  }

  function isReviewStatus(status) {
    return status === "CHECK" || status === "NOT OK";
  }

  function isBlockedStatus(status) {
    return status !== "QUEUED" && !isSafeStatus(status) && status !== "NOT OK";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function callHost(functionName, payload) {
    return new Promise(function (resolve, reject) {
      if (!hasCepBridge()) {
        reject(new Error("CEP bridge not found."));
        return;
      }

      var script = functionName + "()";
      if (typeof payload !== "undefined") {
        var json = JSON.stringify(payload);
        script = functionName + "('" + escapeForEval(json) + "')";
      }

      window.__adobe_cep__.evalScript(script, function (raw) {
        var parsed;
        try {
          parsed = JSON.parse(raw || "{}");
        } catch (error) {
          reject(new Error("Host returned invalid JSON."));
          return;
        }

        if (!parsed.ok) {
          reject(new Error(parsed.error || "Unknown host error."));
          return;
        }

        resolve(parsed.data || {});
      });
    });
  }

  function readSettings() {
    return {
      resizeMode: els.resizeMode.value,
      printTypeMode: els.printTypeMode.value,
      runWeMustAction: els.runAction.checked
    };
  }

  function autoResizeEmail() {
    var minHeight = 52;
    var maxHeight = 110;
    els.emailText.style.height = minHeight + "px";
    els.emailText.style.height = Math.min(Math.max(els.emailText.scrollHeight, minHeight), maxHeight) + "px";
  }

  function persistPrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({
        folderPath: els.folderPath.value,
        emailText: els.emailText.value,
        settings: readSettings()
      }));
    } catch (error) {}
  }

  function loadPrefs() {
    try {
      var raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (prefs.folderPath) els.folderPath.value = prefs.folderPath;
      if (prefs.emailText) els.emailText.value = prefs.emailText;
      if (prefs.settings) {
        if (prefs.settings.resizeMode) els.resizeMode.value = prefs.settings.resizeMode;
        if (prefs.settings.printTypeMode) els.printTypeMode.value = prefs.settings.printTypeMode;
        els.runAction.checked = !!prefs.settings.runWeMustAction;
      }
    } catch (error) {}
  }

  function clearPrefs() {
    try {
      window.localStorage.removeItem(PREFS_KEY);
    } catch (error) {}
  }

  function setBusy(isBusy, message) {
    state.busy = isBusy;
    [
      els.scanBtn,
      els.selectPendingBtn,
      els.selectSafeBtn,
      els.selectReviewBtn,
      els.clearBtn,
      els.processBtn,
      els.browseFolder,
      els.pasteFolder,
      els.pasteEmail,
      els.resizeMode,
      els.printTypeMode,
      els.runAction,
      els.folderPath,
      els.emailText
    ].forEach(function (el) {
      el.disabled = isBusy;
    });

    if (message) {
      setStatus(message, false);
    }

    syncActionAvailability();
  }

  function countSelected() {
    return Object.keys(state.selected).filter(function (key) {
      return !!state.selected[key];
    }).length;
  }

  function updateSelectionText() {
    if (!state.rows.length) {
      els.selectionText.textContent = "No rows loaded.";
      updateProcessButtonLabel(0);
      return;
    }

    var selectedCount = countSelected();
    var queuedCount = state.rows.filter(function (row) { return row.status === "QUEUED"; }).length;
    var reviewCount = state.rows.filter(function (row) { return isReviewStatus(row.status); }).length;
    els.selectionText.textContent = selectedCount + " selected | " + queuedCount + " pending | " + reviewCount + " review";
    updateProcessButtonLabel(selectedCount);
  }

  function updateProcessButtonLabel(selectedCount) {
    els.processBtn.textContent = selectedCount > 0 ? "Process " + selectedCount : "Process Selected";
  }

  function formatMoney(amount, currency) {
    if (typeof amount !== "number" || isNaN(amount)) return "";
    var sign = amount < 0 ? "-" : "";
    var abs = Math.abs(amount).toFixed(2);
    if (currency === "$" || currency === "€" || currency === "£") return sign + currency + abs;
    return sign + (currency || "$") + " " + abs;
  }

  function updateFinancialText() {
    var f = state.financials;
    if (!f) {
      els.financialText.textContent = "";
      return;
    }

    var parts = [];
    if (!isNaN(f.subtotal)) parts.push("Subtotal " + formatMoney(f.subtotal, f.currency));
    if (!isNaN(f.shipping)) parts.push("Shipping " + formatMoney(f.shipping, f.currency));
    if (!isNaN(f.tax)) parts.push("HST " + formatMoney(f.tax, f.currency));
    if (!isNaN(f.total)) parts.push("Total " + formatMoney(f.total, f.currency));
    els.financialText.textContent = parts.join(" | ");
  }

  function renderSummary() {
    els.summaryChips.innerHTML = "";

    if (!state.rows.length) {
      return;
    }

    var summary = {
      items: state.rows.length,
      ok: state.rows.filter(function (row) { return row.status === "OK"; }).length,
      check: state.rows.filter(function (row) { return row.status === "CHECK"; }).length,
      hold: state.rows.filter(function (row) { return row.status === "NOT OK"; }).length,
      blocked: state.rows.filter(function (row) { return isBlockedStatus(row.status); }).length,
      pending: state.rows.filter(function (row) { return row.status === "QUEUED"; }).length,
      exported: state.rows.filter(function (row) { return !!row.outputFsPath; }).length
    };

    var chips = [
      { label: "Items", value: summary.items },
      { label: "Pending", value: summary.pending },
      { label: "OK", value: summary.ok },
      { label: "Check", value: summary.check },
      { label: "Hold", value: summary.hold },
      { label: "Blocked", value: summary.blocked },
      { label: "Exported", value: summary.exported }
    ];

    if (state.lastRun) {
      chips.push({ label: "Last Exported", value: state.lastRun.exported || 0 });
      chips.push({ label: "Last Skipped", value: state.lastRun.skipped || 0 });
    }

    chips.forEach(function (chip) {
      var node = document.createElement("div");
      node.className = "chip";
      node.innerHTML = "<span>" + chip.label + "</span><strong>" + chip.value + "</strong>";
      els.summaryChips.appendChild(node);
    });
  }

  function rowCheckboxChecked(index) {
    return !!state.selected[index];
  }

  function syncActionAvailability() {
    var hasRows = state.rows.length > 0;
    var selectedCount = countSelected();

    if (!state.busy) {
      els.processBtn.disabled = !hasRows || selectedCount === 0;
      els.selectPendingBtn.disabled = !hasRows;
      els.selectSafeBtn.disabled = !hasRows;
      els.selectReviewBtn.disabled = !hasRows;
      els.clearBtn.disabled = !hasRows && !els.folderPath.value && !els.emailText.value;
    }
  }

  function renderMatchCell(row) {
    var key = row.matchType || "missing";
    var meta = MATCH_META[key] || { label: key };
    return [
      '<div class="cell-stack">',
      '<span class="match-pill match-' + escapeHtml(key.toLowerCase()) + '">' + escapeHtml(meta.label) + "</span>",
      '<div class="subtle-text">' + escapeHtml(row.match || "") + "</div>",
      "</div>"
    ].join("");
  }

  function renderStatusCell(row) {
    var key = row.status || "";
    var statusClass = key.toLowerCase().replace(/\s+/g, "-");
    var detail = row.statusNote || ((STATUS_META[key] && STATUS_META[key].detail) || "");
    return [
      '<div class="cell-stack">',
      '<span class="status-pill status-' + statusClass + '">' + escapeHtml(key) + "</span>",
      (detail ? '<div class="subtle-text">' + escapeHtml(detail) + "</div>" : ""),
      "</div>"
    ].join("");
  }

  function applyDefaultSelection() {
    state.selected = {};
    state.rows.forEach(function (row) {
      if (row.status === "QUEUED") {
        state.selected[row.index] = true;
      }
    });
  }

  function renderRows() {
    if (!state.rows.length) {
      els.rowsBody.innerHTML = '<tr class="empty-row"><td colspan="9">Scan a folder and email to build the list.</td></tr>';
      updateSelectionText();
      updateFinancialText();
      return;
    }

    var html = state.rows.map(function (row, visibleIndex) {
      var checked = rowCheckboxChecked(row.index) ? "checked" : "";
      var disabled = row.isSelectable ? "" : "disabled";
      var rowClass = ["data-row", row.rowClass || "", "status-" + row.status.toLowerCase().replace(/\s+/g, "-")].join(" ").trim();
      var title = row.sourcePath ? ' title="' + escapeHtml(row.sourcePath) + '"' : "";

      return [
        '<tr class="' + rowClass + '" data-index="' + row.index + '">',
        '<td class="col-select"><input class="row-check" type="checkbox" data-index="' + row.index + '" ' + checked + " " + disabled + " /></td>",
        "<td>" + (visibleIndex + 1) + "</td>",
        '<td class="file-cell"' + title + '><button class="file-link" type="button" data-open-index="' + row.index + '">' + escapeHtml(row.file) + "</button>" +
          (row.note ? '<div class="subtle-text">' + escapeHtml(row.note) + "</div>" : "") +
          (row.outputFsPath ? '<div class="subtle-text mono">' + escapeHtml(row.outputFsPath) + "</div>" : "") +
          "</td>",
        '<td class="mono">' + escapeHtml(row.qty) + "</td>",
        '<td class="mono">' + escapeHtml(row.orderSize || "") + "</td>",
        '<td class="mono">' + escapeHtml(row.outputSize || "—") + (row.delta ? '<div class="subtle-text">' + escapeHtml(row.delta) + "</div>" : "") + "</td>",
        "<td>" + renderMatchCell(row) + "</td>",
        "<td>" + escapeHtml(row.printType || "—") + "</td>",
        "<td>" + renderStatusCell(row) + "</td>",
        "</tr>"
      ].join("");
    }).join("");

    els.rowsBody.innerHTML = html;
    updateSelectionText();
    updateFinancialText();
    syncActionAvailability();
  }

  function renderAll() {
    renderSummary();
    renderRows();
  }

  async function pasteIntoField(field) {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        field.value = await navigator.clipboard.readText();
        if (field === els.emailText) autoResizeEmail();
        persistPrefs();
        syncActionAvailability();
        setStatus("Clipboard pasted.", false);
        return;
      }
    } catch (error) {}

    field.focus();
    field.select();
    setStatus("Clipboard API unavailable here. Use Ctrl+V in the focused field.", true);
  }

  async function browseForFolder() {
    setBusy(true, "Waiting for folder selection...");
    try {
      var data = await callHost("sizerPickFolder");
      if (data && data.path) {
        els.folderPath.value = data.path;
        persistPrefs();
        syncActionAvailability();
        setStatus("Folder selected.", false);
      } else {
        setStatus("Folder selection cancelled.", false);
      }
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  function getSelectedIndexes() {
    return Object.keys(state.selected)
      .filter(function (key) { return !!state.selected[key]; })
      .map(function (key) { return parseInt(key, 10); })
      .filter(function (value) { return !isNaN(value); });
  }

  async function runScan() {
    setBusy(true, "Scanning email and folder...");
    try {
      var data = await callHost("sizerScan", {
        folderPath: els.folderPath.value,
        emailText: els.emailText.value,
        settings: readSettings()
      });

      state.rows = data.rows || [];
      state.lastRun = data.lastRun || null;
      state.financials = data.financials || null;
      applyDefaultSelection();
      renderAll();
      persistPrefs();
      setStatus(data.message || "Scan completed.", false);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function processSelected() {
    var indexes = getSelectedIndexes();
    if (!indexes.length) {
      setStatus("Select at least one row first.", true);
      return;
    }

    setBusy(true, "Processing selected rows...");
    try {
      var data = await callHost("sizerProcessSelected", {
        selectedIndexes: indexes,
        settings: readSettings()
      });

      state.rows = data.rows || [];
      state.lastRun = data.lastRun || null;
      state.financials = data.financials || null;
      renderAll();
      persistPrefs();
      setStatus(data.message || "Selected rows processed.", false);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function openRow(index) {
    setBusy(true, "Opening source file...");
    try {
      await callHost("sizerActivateRow", { index: index });
      setStatus("Source file activated in Illustrator.", false);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function clearPanel() {
    setBusy(true, "Clearing panel...");
    try {
      await callHost("sizerClearState");
    } catch (error) {}

    state.rows = [];
    state.selected = {};
    state.lastRun = null;
    state.financials = null;
    els.folderPath.value = "";
    els.emailText.value = "";
    autoResizeEmail();
    clearPrefs();
    renderAll();
    setStatus("Cleared.", false);
    setBusy(false);
  }

  function selectRowsByStatus(statuses) {
    var next = {};
    state.rows.forEach(function (row) {
      if (statuses.indexOf(row.status) >= 0 && row.isSelectable) {
        next[row.index] = true;
      }
    });
    state.selected = next;
    renderRows();
  }

  function bindEvents() {
    els.browseFolder.addEventListener("click", browseForFolder);

    els.pasteFolder.addEventListener("click", function () {
      pasteIntoField(els.folderPath);
    });

    els.pasteEmail.addEventListener("click", function () {
      pasteIntoField(els.emailText);
    });

    els.scanBtn.addEventListener("click", runScan);
    els.processBtn.addEventListener("click", processSelected);
    els.clearBtn.addEventListener("click", clearPanel);

    els.selectPendingBtn.addEventListener("click", function () {
      selectRowsByStatus(["QUEUED"]);
      setStatus("Pending rows selected.", false);
    });

    els.selectSafeBtn.addEventListener("click", function () {
      selectRowsByStatus(["OK", "CHECK"]);
      setStatus("Safe rows selected.", false);
    });

    els.selectReviewBtn.addEventListener("click", function () {
      selectRowsByStatus(["CHECK", "NOT OK"]);
      setStatus("Review rows selected.", false);
    });

    els.rowsBody.addEventListener("change", function (event) {
      var checkbox = event.target.closest(".row-check");
      if (!checkbox) return;
      state.selected[checkbox.getAttribute("data-index")] = checkbox.checked;
      updateSelectionText();
      syncActionAvailability();
    });

    els.rowsBody.addEventListener("click", function (event) {
      var fileButton = event.target.closest("[data-open-index]");
      if (!fileButton) return;
      openRow(parseInt(fileButton.getAttribute("data-open-index"), 10));
    });

    [
      els.folderPath,
      els.emailText,
      els.resizeMode,
      els.printTypeMode,
      els.runAction
    ].forEach(function (el) {
      el.addEventListener("input", function () {
        if (el === els.emailText) autoResizeEmail();
        persistPrefs();
        syncActionAvailability();
      });
      el.addEventListener("change", function () {
        persistPrefs();
        syncActionAvailability();
      });
    });
  }

  async function init() {
    loadPrefs();
    bindEvents();
    autoResizeEmail();
    renderAll();
    syncActionAvailability();

    try {
      await callHost("sizerPing");
      setStatus("Ready.", false);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  init();
})();
