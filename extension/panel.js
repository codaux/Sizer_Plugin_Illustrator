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
    filenameFormat: document.getElementById("filename-format"),
    runAction: document.getElementById("run-action"),
    scanBtn: document.getElementById("scan-btn"),
    selectAllBtn: document.getElementById("select-all-btn"),
    selectGreenBtn: document.getElementById("select-green-btn"),
    selectRedBtn: document.getElementById("select-red-btn"),
    selectPendingBtn: document.getElementById("select-pending-btn"),
    selectReviewBtn: document.getElementById("select-review-btn"),
    clearSelectionBtn: document.getElementById("clear-selection-btn"),
    clearBtn: document.getElementById("clear-btn"),
    processBtn: document.getElementById("process-btn"),
    exportBtn: document.getElementById("export-btn"),
    summaryChips: document.getElementById("summary-chips"),
    statusText: document.getElementById("status-text"),
    selectionText: document.getElementById("selection-text"),
    rowsBody: document.getElementById("rows-body"),
    logOutput: document.getElementById("log-output"),
    copyLogBtn: document.getElementById("copy-log-btn"),
    clearLogBtn: document.getElementById("clear-log-btn")
  };

  var state = {
    rows: [],
    selected: {},
    busy: false,
    lastRun: null,
    financials: null,
    logs: []
  };

  var PREFS_KEY = "sizerIllustratorPrefs.v1";

  var STATUS_META = {
    QUEUED: { detail: "Ready for measurement and export." },
    OK: { detail: "Within tolerance after sizing." },
    CHECK: { detail: "Sized, but review the size delta." },
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

  function isRedStatus(status) {
    return status === "NOT OK" || isBlockedStatus(status);
  }

  function timeLabel() {
    var d = new Date();
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function addLog(level, message, row, file) {
    state.logs.push({
      time: timeLabel(),
      level: level || "info",
      row: row || "",
      file: file || "",
      message: String(message || "")
    });
    while (state.logs.length > 250) state.logs.shift();
    renderLog();
  }

  function formatLogLine(entry) {
    var parts = [entry.time || "--:--:--", (entry.level || "info").toUpperCase()];
    if (entry.row) parts.push("Row " + entry.row);
    if (entry.file) parts.push(entry.file);
    parts.push(entry.message || "");
    return parts.join(" | ");
  }

  function renderLog() {
    if (!els.logOutput) return;
    els.logOutput.value = state.logs.map(formatLogLine).join("\n");
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
  }

  function applyHostSnapshot(data) {
    state.rows = data.rows || [];
    state.lastRun = data.lastRun || null;
    state.financials = data.financials || null;
    if (data.logs) state.logs = data.logs;
  }

  function applyHostError(error) {
    if (error && error.hostData && error.hostData.logs) {
      state.logs = error.hostData.logs;
      renderLog();
    }
    addLog("error", error && error.message ? error.message : "Unknown error.");
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
          var hostError = new Error(parsed.error || "Unknown host error.");
          hostError.hostData = parsed.data || null;
          reject(hostError);
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
      filenameFormat: els.filenameFormat.value,
      runWeMustAction: els.runAction.checked
    };
  }

  function autoResizeEmail() {
    var minHeight = 30;
    var maxHeight = 30;
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
        if (prefs.settings.filenameFormat) els.filenameFormat.value = prefs.settings.filenameFormat;
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
      els.selectAllBtn,
      els.selectGreenBtn,
      els.selectRedBtn,
      els.selectPendingBtn,
      els.selectReviewBtn,
      els.clearSelectionBtn,
      els.clearBtn,
      els.processBtn,
      els.exportBtn,
      els.browseFolder,
      els.pasteFolder,
      els.pasteEmail,
      els.resizeMode,
      els.printTypeMode,
      els.filenameFormat,
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
    els.processBtn.textContent = selectedCount > 0 ? "Size " + selectedCount : "Size Selected";
    els.exportBtn.textContent = selectedCount > 0 ? "Export " + selectedCount : "Export Selected";
  }

  function formatMoney(amount, currency) {
    if (typeof amount !== "number" || isNaN(amount)) return "";
    var sign = amount < 0 ? "-" : "";
    var abs = Math.abs(amount).toFixed(2);
    if (currency === "$" || currency === "€" || currency === "£") return sign + currency + abs;
    return sign + (currency || "$") + " " + abs;
  }

  function updateFinancialText() {
    return;
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
      els.exportBtn.disabled = !hasRows || selectedCount === 0;
      els.selectAllBtn.disabled = !hasRows;
      els.selectGreenBtn.disabled = !hasRows;
      els.selectRedBtn.disabled = !hasRows;
      els.selectPendingBtn.disabled = !hasRows;
      els.selectReviewBtn.disabled = !hasRows;
      els.clearSelectionBtn.disabled = !hasRows || selectedCount === 0;
      els.clearBtn.disabled = !hasRows && !els.folderPath.value && !els.emailText.value;
    }
  }

  function hasMatchIssue(row) {
    return row && row.matchType && row.matchType !== "exact";
  }

  function renderMatchIssueNote(row) {
    if (!hasMatchIssue(row)) return "";

    if (row.matchType === "suggestion" && row.suggested) {
      return "Maybe: " + row.suggested;
    }
    if (row.matchType === "missing") {
      return row.suggested ? "Missing, maybe: " + row.suggested : "Missing match";
    }
    return row.match || "Name match issue";
  }

  function renderSizeStack(widthValue, heightValue, deltaValue) {
    var hasWidth = widthValue !== "" && widthValue !== null && typeof widthValue !== "undefined";
    var hasHeight = heightValue !== "" && heightValue !== null && typeof heightValue !== "undefined";
    return [
      '<div class="size-stack mono">',
      '<div><span>W</span><strong>' + escapeHtml(hasWidth ? widthValue : "—") + "</strong></div>",
      '<div><span>H</span><strong>' + escapeHtml(hasHeight ? heightValue : "—") + "</strong></div>",
      deltaValue ? '<div class="size-delta"><span>Δ</span><strong>' + escapeHtml(deltaValue) + "</strong></div>" : "",
      "</div>"
    ].join("");
  }

  function renderStatusCell(row) {
    var key = row.status || "";
    var statusClass = key.toLowerCase().replace(/\s+/g, "-");
    var detail = row.statusNote || ((STATUS_META[key] && STATUS_META[key].detail) || "");
    return [
      '<div class="cell-stack">',
      '<span class="status-pill status-' + statusClass + '"' + (detail ? ' title="' + escapeHtml(detail) + '"' : "") + ">" + escapeHtml(key) + "</span>",
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
      els.rowsBody.innerHTML = '<tr class="empty-row"><td colspan="8">Scan a folder and email to build the list.</td></tr>';
      updateSelectionText();
      updateFinancialText();
      return;
    }

    var html = state.rows.map(function (row, visibleIndex) {
      var checked = rowCheckboxChecked(row.index) ? "checked" : "";
      var disabled = row.isSelectable ? "" : "disabled";
      var rowClass = ["data-row", row.rowClass || "", "status-" + row.status.toLowerCase().replace(/\s+/g, "-")].join(" ").trim();
      var title = row.sourcePath ? ' title="' + escapeHtml(row.sourcePath) + '"' : "";
      var matchIssueNote = renderMatchIssueNote(row);
      var fileLinkClass = hasMatchIssue(row) ? "file-link match-problem" : "file-link";

      return [
        '<tr class="' + rowClass + '" data-index="' + row.index + '">',
        '<td class="col-select"><input class="row-check" type="checkbox" data-index="' + row.index + '" ' + checked + " " + disabled + " /></td>",
        "<td>" + (visibleIndex + 1) + "</td>",
        "<td>" + escapeHtml(row.printType || "—") + "</td>",
        '<td class="file-cell"' + title + '><button class="' + fileLinkClass + '" type="button" data-open-index="' + row.index + '">' + escapeHtml(row.file) + "</button>" +
          (matchIssueNote ? ' <span class="match-inline-note">(' + escapeHtml(matchIssueNote) + ")</span>" : "") +
          (row.note ? '<div class="subtle-text">' + escapeHtml(row.note) + "</div>" : "") +
          "</td>",
        '<td class="mono">' + escapeHtml(row.qty) + "</td>",
        "<td>" + renderSizeStack(row.orderW, row.orderH, "") + "</td>",
        "<td>" + renderSizeStack(row.outputW, row.outputH, row.delta || "") + "</td>",
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
    renderLog();
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

  async function pasteIntoFieldFallbackCopy(field) {
    var text = field ? field.value : "";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setStatus("Log copied.", false);
        return;
      }
    } catch (error) {}

    if (field) {
      field.focus();
      field.select();
    }
    setStatus("Clipboard API unavailable here. Press Ctrl+C while the log is selected.", true);
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
    addLog("info", "Scan started.");
    try {
      var data = await callHost("sizerScan", {
        folderPath: els.folderPath.value,
        emailText: els.emailText.value,
        settings: readSettings()
      });

      applyHostSnapshot(data);
      applyDefaultSelection();
      renderAll();
      persistPrefs();
      setStatus(data.message || "Scan completed.", false);
    } catch (error) {
      applyHostError(error);
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function sizeSelected() {
    var indexes = getSelectedIndexes();
    if (!indexes.length) {
      setStatus("Select at least one row first.", true);
      return;
    }

    setBusy(true, "Sizing selected rows...");
    addLog("info", "Size started for " + indexes.length + " selected row(s).");
    try {
      var data = await callHost("sizerSizeSelected", {
        selectedIndexes: indexes,
        settings: readSettings()
      });

      applyHostSnapshot(data);
      renderAll();
      persistPrefs();
      setStatus(data.message || "Selected rows sized.", false);
    } catch (error) {
      applyHostError(error);
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function exportSelected() {
    var indexes = getSelectedIndexes();
    if (!indexes.length) {
      setStatus("Select at least one row first.", true);
      return;
    }

    setBusy(true, "Exporting selected rows...");
    addLog("info", "Export started for " + indexes.length + " selected row(s).");
    try {
      var data = await callHost("sizerExportSelected", {
        selectedIndexes: indexes,
        settings: readSettings()
      });

      applyHostSnapshot(data);
      renderAll();
      persistPrefs();
      setStatus(data.message || "Selected rows exported.", false);
    } catch (error) {
      applyHostError(error);
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function openRow(index) {
    setBusy(true, "Opening row file...");
    try {
      await callHost("sizerActivateRow", { index: index });
      setStatus("Row file activated in Illustrator.", false);
    } catch (error) {
      applyHostError(error);
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
    state.logs = [];
    els.folderPath.value = "";
    els.emailText.value = "";
    autoResizeEmail();
    clearPrefs();
    renderAll();
    setStatus("Cleared.", false);
    setBusy(false);
  }

  function selectRowsByPredicate(predicate) {
    var next = {};
    state.rows.forEach(function (row) {
      if (row.isSelectable && predicate(row)) {
        next[row.index] = true;
      }
    });
    state.selected = next;
    renderRows();
  }

  function selectRowsByStatus(statuses) {
    selectRowsByPredicate(function (row) {
      return statuses.indexOf(row.status) >= 0;
    });
  }

  function clearSelection() {
    state.selected = {};
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
    els.processBtn.addEventListener("click", sizeSelected);
    els.exportBtn.addEventListener("click", exportSelected);
    els.clearBtn.addEventListener("click", clearPanel);

    els.selectAllBtn.addEventListener("click", function () {
      selectRowsByPredicate(function () { return true; });
      setStatus("All selectable rows selected.", false);
    });

    els.selectGreenBtn.addEventListener("click", function () {
      selectRowsByStatus(["OK"]);
      setStatus("Green rows selected.", false);
    });

    els.selectRedBtn.addEventListener("click", function () {
      selectRowsByPredicate(function (row) { return isRedStatus(row.status); });
      setStatus("Red rows selected.", false);
    });

    els.selectPendingBtn.addEventListener("click", function () {
      selectRowsByStatus(["QUEUED"]);
      setStatus("Pending rows selected.", false);
    });

    els.selectReviewBtn.addEventListener("click", function () {
      selectRowsByStatus(["CHECK", "NOT OK"]);
      setStatus("Review rows selected.", false);
    });

    els.clearSelectionBtn.addEventListener("click", function () {
      clearSelection();
      setStatus("Selection cleared.", false);
    });

    els.copyLogBtn.addEventListener("click", function () {
      pasteIntoFieldFallbackCopy(els.logOutput);
    });

    els.clearLogBtn.addEventListener("click", async function () {
      try {
        await callHost("sizerClearLog");
      } catch (error) {}
      state.logs = [];
      renderLog();
      setStatus("Log cleared.", false);
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
      els.filenameFormat,
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
