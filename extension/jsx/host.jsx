#target illustrator

var ARTBOARD_PADDING_PT = 1;
var TARGET_PPI = 300;

var SIZER_HOST_STATE = {
    ready: false,
    inputFolderPath: "",
    emailText: "",
    inputFolder: null,
    items: [],
    rows: [],
    settings: null,
    financials: null,
    lastRun: null
};

function trimStr(s){ return String(s).replace(/^\s+|\s+$/g, ""); }
function round2(n){ return Math.round(n * 100) / 100; }
function roundMoney(n){ return Math.round((n + 0.0000001) * 100) / 100; }
function pad2(n){ return (n < 10 ? "0" : "") + n; }
function sleepMs(ms){ try { $.sleep(ms); } catch (e) {} }

function stabilizeIllustratorHost(waitMs){
    try { app.redraw(); } catch (eRedraw) {}
    sleepMs(waitMs || 40);
}

function makeTimestampTag(){
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "_" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function stripExt(name){
    var s = String(name);
    var i = s.lastIndexOf(".");
    return (i > 0) ? s.substring(0, i) : s;
}

function makeBaseWithQtyOption(qty, base, option){
    qty = parseInt(qty, 10);
    if (isNaN(qty) || qty < 1) qty = 1;
    if (option === "filenameQty") return base + "___" + qty;
    if (option === "qtyFilename") return qty + "___" + base;
    return base;
}

function decodeNumericEntitiesLoose(s){
    s = String(s);
    s = s.replace(/&#(\d+);?/g, function(_, num){
        var code = parseInt(num, 10);
        if (isNaN(code)) return _;
        try { return String.fromCharCode(code); } catch (e1) { return _; }
    });
    s = s.replace(/&#x([0-9a-fA-F]+);?/g, function(_, hex){
        var code = parseInt(hex, 16);
        if (isNaN(code)) return _;
        try { return String.fromCharCode(code); } catch (e2) { return _; }
    });
    return s;
}

function decodePercentEscapesLoose(s){
    s = String(s);
    return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, function(chunk){
        try { return decodeURIComponent(chunk); } catch (e) { return chunk; }
    });
}

function normalizeForMatch(s){
    s = trimStr(s);
    s = decodeNumericEntitiesLoose(s);
    s = decodePercentEscapesLoose(s);
    s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
    s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");
    s = trimStr(s).replace(/\s+/g, " ");
    return s;
}

function canonicalKey(s){
    s = normalizeForMatch(s).toLowerCase();
    s = s.replace(/[\s_\-]+/g, "-");
    s = s.replace(/\u00D7/g, "x");
    s = s.replace(/^-+/, "").replace(/-+$/, "");
    return s;
}

function ultraLooseKey(s){
    s = canonicalKey(s);
    s = s.replace(/[\-_ ]+/g, "");
    return s;
}

function commonPrefixLen(a, b){
    var m = Math.min(a.length, b.length);
    var i = 0;
    while (i < m && a.charAt(i) === b.charAt(i)) i++;
    return i;
}

function similarityScore(a, b){
    a = String(a);
    b = String(b);
    if (!a || !b) return 0;
    if (a === b) return 9999;
    return (commonPrefixLen(a, b) * 3) + ((a.indexOf(b) >= 0 || b.indexOf(a) >= 0) ? 10 : 0) - Math.abs(a.length - b.length);
}

function findFileMatchByEmailName(fileList, emailFileName){
    var emailRaw = String(emailFileName);
    var emailNorm = normalizeForMatch(emailRaw);
    var emailCanon = canonicalKey(emailRaw);
    var emailLoose = ultraLooseKey(emailRaw);
    var i, f, c, l;

    for (i = 0; i < fileList.length; i++){
        f = fileList[i];
        if (f.name === emailRaw) return { file: f, matchType: "exact", suggested: "" };
    }
    for (i = 0; i < fileList.length; i++){
        f = fileList[i];
        if (normalizeForMatch(f.name) === emailNorm) return { file: f, matchType: "normalized", suggested: "" };
    }
    for (i = 0; i < fileList.length; i++){
        f = fileList[i];
        c = canonicalKey(f.name);
        if (c === emailCanon) return { file: f, matchType: "canonical", suggested: "" };
    }
    for (i = 0; i < fileList.length; i++){
        f = fileList[i];
        l = ultraLooseKey(f.name);
        if (l === emailLoose) return { file: f, matchType: "ultraLoose", suggested: "" };
    }

    var bestFile = null;
    var bestScore = -999999;
    for (i = 0; i < fileList.length; i++){
        f = fileList[i];
        c = canonicalKey(f.name);
        l = ultraLooseKey(f.name);
        var sc = similarityScore(emailCanon, c) + similarityScore(emailLoose, l);
        if (sc > bestScore){
            bestScore = sc;
            bestFile = f;
        }
    }

    if (bestFile && bestScore >= 8) return { file: null, matchType: "suggestion", suggested: bestFile.name };
    return { file: null, matchType: "missing", suggested: "" };
}

function normalizeCurrencyLabel(token){
    token = trimStr(String(token || ""));
    if (!token) return "$";
    var upper = token.toUpperCase();
    if (upper === "$" || upper === "CAD") return "$";
    if (upper === "USD") return "USD";
    if (upper === "EUR" || token === "€") return "EUR";
    if (upper === "GBP" || token === "£") return "GBP";
    return token;
}

function parseMoneyNumber(text){
    var clean = String(text || "").replace(/,/g, "");
    var n = parseFloat(clean);
    return isNaN(n) ? NaN : roundMoney(n);
}

function parseMoneyToken(text){
    var src = String(text || "");
    var m = /(?:CAD|USD|EUR|GBP|\$|€|£)\s*([\d,]+(?:\.\d+)?)/i.exec(src);
    if (m){
        return { currency: normalizeCurrencyLabel(m[0].replace(/[\d,.\s]+/g, "")), amount: parseMoneyNumber(m[1]) };
    }
    m = /([\d,]+(?:\.\d+)?)\s*(CAD|USD|EUR|GBP|\$|€|£)/i.exec(src);
    if (m){
        return { currency: normalizeCurrencyLabel(m[2]), amount: parseMoneyNumber(m[1]) };
    }
    return { currency: "$", amount: NaN };
}

function extractQtyAndPrice(blockText){
    var lines = String(blockText || "").split(/\r?\n/);
    for (var i = lines.length - 1; i >= 0; i--){
        var line = trimStr(lines[i]);
        if (!line) continue;
        var m = /^(\d{1,4})\s+(CAD|USD|EUR|GBP|\$|€|£)\s*([\d,]+(?:\.\d+)?)$/i.exec(line);
        if (m) return { qty: parseInt(m[1], 10), price: parseMoneyNumber(m[3]), currency: normalizeCurrencyLabel(m[2]) };
        m = /^(\d{1,4})\s+([\d,]+(?:\.\d+)?)\s*(CAD|USD|EUR|GBP|\$|€|£)$/i.exec(line);
        if (m) return { qty: parseInt(m[1], 10), price: parseMoneyNumber(m[2]), currency: normalizeCurrencyLabel(m[3]) };
    }

    var qtyMatch = /(?:^|\s)(\d{1,4})\s*(?=(?:CAD|USD|EUR|GBP|\$|€|£)\s*[\d.,]+)/i.exec(String(blockText));
    var money = parseMoneyToken(blockText);
    var qty = (qtyMatch && qtyMatch[1]) ? parseInt(qtyMatch[1], 10) : 1;
    if (isNaN(qty) || qty < 1) qty = 1;
    return { qty: qty, price: money.amount, currency: money.currency };
}

function extractMoneyAfterLabel(text, label){
    var safe = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp(safe + "\\s*:?\\s*([^\\r\\n]*)", "i");
    var m = re.exec(String(text || ""));
    if (!m || !m[1]) return { currency: "$", amount: NaN };
    return parseMoneyToken(m[1]);
}

function parseEmailFinancials(text, items){
    var subtotal = extractMoneyAfterLabel(text, "Subtotal");
    var shipping = extractMoneyAfterLabel(text, "Shipping");
    var tax = extractMoneyAfterLabel(text, "HST");
    var total = extractMoneyAfterLabel(text, "Total");
    var taxRateMatch = /HST\s*\(([\d.]+)%\)/i.exec(String(text || ""));
    var subtotalSum = 0;
    var subtotalCount = 0;
    var currency = subtotal.currency || shipping.currency || tax.currency || total.currency || "$";
    var i;

    for (i = 0; i < items.length; i++){
        if (!isNaN(items[i].price)) {
            subtotalSum += items[i].price;
            subtotalCount++;
        }
        if (!currency && items[i].currency) currency = items[i].currency;
    }

    return {
        currency: currency || "$",
        subtotal: !isNaN(subtotal.amount) ? subtotal.amount : (subtotalCount ? roundMoney(subtotalSum) : NaN),
        shipping: shipping.amount,
        tax: tax.amount,
        total: total.amount,
        taxRate: taxRateMatch ? parseFloat(taxRateMatch[1]) : 13
    };
}

function formatResizeModeLabel(mode){
    if (mode === "respectWidth") return "Respect Width";
    if (mode === "respectHeight") return "Respect Height";
    if (mode === "stretch") return "Stretch";
    return String(mode || "");
}

function formatPrintTypeModeLabel(mode){
    if (mode === "folder") return "Folder";
    if (mode === "prefix") return "Prefix";
    if (mode === "none") return "None";
    return String(mode || "");
}

var PRINT_TYPE_RULES = [
    { type: "UV", re: /\b(?:UV\s*DTF|DTF\s*UV)\b/i },
    { type: "COOL", re: /\b(?:COOL\s*DTF|DTF\s*COOL)\b/i },
    { type: "HEAT", re: /\b(?:HEAT\s*DTF|DTF\s*HEAT)\b/i },
    { type: "Glitter", re: /\b(?:GLITTER\s*DTF|DTF\s*GLITTER)\b/i },
    { type: "Dyeblocker", re: /\b(?:DYE[\s-]*BLOCKER\s*DTF|DTF\s*DYE[\s-]*BLOCKER|DYEBLOCKER\s*DTF|DTF\s*DYEBLOCKER)\b/i }
];

function detectPrintType(text){
    var hay = String(text || "");
    for (var i = 0; i < PRINT_TYPE_RULES.length; i++){
        if (PRINT_TYPE_RULES[i].re.test(hay)) return PRINT_TYPE_RULES[i].type;
    }
    return "";
}

function lineStartAt(text, index){
    var i = Math.min(Math.max(0, index), String(text).length);
    while (i > 0 && text.charAt(i - 1) !== "\n") i--;
    return i;
}

function previousNonEmptyLine(text, beforeIndex){
    var end = Math.min(String(text).length, Math.max(0, beforeIndex));
    while (end > 0){
        var start = lineStartAt(text, end);
        var line = trimStr(text.substring(start, end).replace(/\r/g, ""));
        if (line) return { start: start, end: end, text: line };
        end = start > 0 ? start - 1 : 0;
    }
    return { start: 0, end: 0, text: "" };
}

function findSectionEnd(text, fromIndex){
    var m = /(?:^|\r?\n)(?:Subtotal:|Shipping:|Rush order:|GST\s*\(|HST\s*\(|PST\s*\(|QST\s*\(|Total:|Billing address|Shipping address)\b/i.exec(String(text).substring(fromIndex));
    return m ? (fromIndex + m.index) : String(text).length;
}

function extractItemDimension(blockText, labels){
    var block = String(blockText || "");
    for (var i = 0; i < labels.length; i++){
        var re = new RegExp(labels[i] + "\\s*:\\s*([\\d.]+)", "i");
        var m = re.exec(block);
        if (m && m[1]){
            var n = parseFloat(m[1]);
            if (!isNaN(n)) return n;
        }
    }
    return NaN;
}

function parseEmailItems(emailText){
    var text = String(emailText || "");
    var hits = [];
    var re = /Width:/gi;
    var m;
    while ((m = re.exec(text)) !== null) hits.push(m.index);
    if (!hits.length) return [];

    var markers = [];
    for (var i = 0; i < hits.length; i++){
        var widthIdx = hits[i];
        var widthLineStart = lineStartAt(text, widthIdx);
        var productLine = previousNonEmptyLine(text, widthLineStart - 1);
        if (!productLine.text) continue;
        markers.push({ itemStart: productLine.start, widthIndex: widthIdx, productLabel: productLine.text });
    }
    if (!markers.length) return [];

    var sectionEnd = findSectionEnd(text, markers[0].itemStart);
    var scopedMarkers = [];
    for (var mi = 0; mi < markers.length; mi++){
        if (markers[mi].itemStart >= sectionEnd) break;
        scopedMarkers.push(markers[mi]);
    }
    if (!scopedMarkers.length) return [];

    var items = [];
    var fRe = /Image file upload:\s*([^\r\n]+)/i;
    for (var j = 0; j < scopedMarkers.length; j++){
        var itemStart = scopedMarkers[j].itemStart;
        var itemEnd = (j + 1 < scopedMarkers.length) ? scopedMarkers[j + 1].itemStart : sectionEnd;
        var block = text.substring(itemStart, itemEnd);
        var fm = fRe.exec(block);
        if (!fm) continue;

        var widthIn = extractItemDimension(block, ["Width"]);
        var heightIn = extractItemDimension(block, ["Height", "Length"]);
        var fileName = trimStr(fm[1]);
        var qp = extractQtyAndPrice(block);
        if (isNaN(widthIn) || isNaN(heightIn) || !fileName) continue;

        items.push({
            qty: qp.qty,
            width: widthIn,
            height: heightIn,
            file: fileName,
            productLabel: scopedMarkers[j].productLabel,
            printType: detectPrintType(scopedMarkers[j].productLabel),
            note: extractNoteForBlock(block),
            price: qp.price,
            currency: qp.currency,
            matchInfo: null
        });
    }
    return items;
}

function extractNoteForBlock(blockText){
    var m = /Message:\s*([\s\S]*?)(?=(?:\r?\n){2,}\s*(?:\d{1,4}\s*(?=(?:CAD|USD|EUR|GBP|\$|€|£))|Subtotal:|Total:)|$)/i.exec(String(blockText));
    if (!m || !m[1]) return "";
    return trimStr(String(m[1]).replace(/\r?\n+/g, " "));
}

function getFilesInFolder(folderObj){
    return folderObj.getFiles(function(f){ return f instanceof File; });
}

function getRelativePath(fileObj, rootFolder){
    var full = String(fileObj.fsName);
    var root = String(rootFolder.fsName);
    if (full.indexOf(root) === 0){
        var rel = full.substring(root.length);
        if (rel.charAt(0) === "\\" || rel.charAt(0) === "/") rel = rel.substring(1);
        return rel.replace(/\\/g, "/");
    }
    return String(fileObj.name);
}

function layerHasLockedContent(layer){
    if (!layer) return false;
    try {
        if (layer.locked) return true;
    } catch (eLayer) {}

    try {
        var pageItems = layer.pageItems;
        for (var i = 0; i < pageItems.length; i++){
            try {
                if (pageItems[i].locked) return true;
            } catch (eItem) {}
        }
    } catch (ePageItems) {}

    try {
        var sublayers = layer.layers;
        for (var j = 0; j < sublayers.length; j++){
            if (layerHasLockedContent(sublayers[j])) return true;
        }
    } catch (eSublayers) {}

    return null;
}

function docHasLockedContent(doc){
    try {
        for (var i = 0; i < doc.layers.length; i++){
            if (layerHasLockedContent(doc.layers[i])) return true;
        }
    } catch (eLayers) {}

    try {
        for (var j = 0; j < doc.pageItems.length; j++){
            try {
                if (doc.pageItems[j].locked) return true;
            } catch (eDocItem) {}
        }
    } catch (eDocPageItems) {}

    return false;
}

function unlockLayerRecursive(layer){
    if (!layer) return;
    try { layer.locked = false; } catch (eLayer) {}
    try { layer.visible = true; } catch (eVisible) {}

    try {
        var sublayers = layer.layers;
        for (var i = 0; i < sublayers.length; i++){
            unlockLayerRecursive(sublayers[i]);
        }
    } catch (eSublayers) {}
}

function unlockAllArtwork(doc){
    if (!doc) return false;

    try { app.executeMenuCommand("unlockAll"); } catch (eMenu1) {}
    try { app.executeMenuCommand("showAll"); } catch (eShowAll1) {}
    try { app.redraw(); } catch (eRedraw1) {}

    try {
        for (var i = 0; i < doc.layers.length; i++){
            unlockLayerRecursive(doc.layers[i]);
        }
    } catch (eLayers) {}

    try {
        for (var j = 0; j < doc.pageItems.length; j++){
            try { doc.pageItems[j].locked = false; } catch (ePageItemLock) {}
            try { doc.pageItems[j].hidden = false; } catch (ePageItemHide) {}
        }
    } catch (eDocItems) {}

    try { app.executeMenuCommand("unlockAll"); } catch (eMenu2) {}
    try { app.executeMenuCommand("showAll"); } catch (eShowAll2) {}
    try { app.redraw(); } catch (eRedraw2) {}

    return !docHasLockedContent(doc);
}

function isProcessableArtworkItem(item){
    if (!item) return false;
    try {
        if (item.locked || item.hidden) return false;
    } catch (eState) {
        return false;
    }

    try {
        if (item.guides) return false;
    } catch (eGuides) {}

    try {
        if (item.clipping) return false;
    } catch (eClipping) {}

    return true;
}

function getItemBounds(item){
    var bb = null;
    try { bb = item.visibleBounds; } catch (eVisible) {}
    if (bb && bb.length >= 4 && isFinite(bb[0]) && isFinite(bb[1]) && isFinite(bb[2]) && isFinite(bb[3])) return bb;

    try { bb = item.geometricBounds; } catch (eGeo) {}
    if (bb && bb.length >= 4 && isFinite(bb[0]) && isFinite(bb[1]) && isFinite(bb[2]) && isFinite(bb[3])) return bb;

    try { bb = item.controlBounds; } catch (eCtrl) {}
    if (bb && bb.length >= 4 && isFinite(bb[0]) && isFinite(bb[1]) && isFinite(bb[2]) && isFinite(bb[3])) return bb;

    return null;
}

function itemHasUsableBounds(item){
    return !!getItemBounds(item);
}

function getTopLevelArtworkAncestor(item){
    if (!isProcessableArtworkItem(item)) return null;

    var current = item;
    var candidate = itemHasUsableBounds(item) ? item : null;
    var guard = 0;
    try {
        while (current && guard < 200){
            if (!isProcessableArtworkItem(current)) return candidate;
            if (itemHasUsableBounds(current)) candidate = current;
            if (!current.parent || current.parent.typename === "Layer" || current.parent.typename === "Document") return candidate;
            current = current.parent;
            guard++;
        }
    } catch (eParent) {}

    return candidate;
}

function getTopLevelArtworkItems(doc){
    var items = [];
    var top = null;
    var exists = false;
    try {
        for (var i = 0; i < doc.pageItems.length; i++){
            top = getTopLevelArtworkAncestor(doc.pageItems[i]);
            if (!top) continue;

            exists = false;
            for (var j = 0; j < items.length; j++){
                if (items[j] === top) {
                    exists = true;
                    break;
                }
            }
            if (!exists) items.push(top);
        }
    } catch (eDocItems) {}
    return items;
}

function getArtworkBounds(items){
    if (!items || items.length === 0) return null;

    var b = null;
    for (var i = 0; i < items.length; i++){
        var bb = getItemBounds(items[i]);
        if (!bb || bb.length < 4) continue;

        if (!b){
            b = [bb[0], bb[1], bb[2], bb[3]];
            continue;
        }
        if (bb[0] < b[0]) b[0] = bb[0];
        if (bb[1] > b[1]) b[1] = bb[1];
        if (bb[2] > b[2]) b[2] = bb[2];
        if (bb[3] < b[3]) b[3] = bb[3];
    }
    return b;
}

function getFallbackArtworkItems(doc){
    var items = [];
    try {
        for (var i = 0; i < doc.pageItems.length; i++){
            var item = doc.pageItems[i];
            if (!isProcessableArtworkItem(item)) continue;
            if (!itemHasUsableBounds(item)) continue;
            items.push(item);
        }
    } catch (eDocItems) {}
    return items;
}

function boundsSizePt(b){
    return { w: Math.abs(b[2] - b[0]), h: Math.abs(b[1] - b[3]) };
}

function boundsCenterPt(b){
    return { x: (b[0] + b[2]) / 2.0, y: (b[1] + b[3]) / 2.0 };
}

function scaleArtworkItems(items, sx, sy, artworkBounds){
    if (!items || items.length === 0) return { ok: false, scaled: 0, failed: 0 };

    var scaleX = sx / 100.0;
    var scaleY = sy / 100.0;
    var artworkCenter = artworkBounds ? boundsCenterPt(artworkBounds) : null;
    var scaled = 0;
    var failed = 0;
    for (var i = 0; i < items.length; i++){
        try {
            var beforeBounds = getItemBounds(items[i]);
            if (!beforeBounds || beforeBounds.length < 4) throw new Error("bounds unavailable");
            var beforeCenter = boundsCenterPt(beforeBounds);
            items[i].resize(
                sx, sy,
                true,
                true,
                true,
                true,
                sx,
                Transformation.CENTER
            );

            if (artworkCenter){
                var afterBounds = getItemBounds(items[i]);
                if (!afterBounds || afterBounds.length < 4) throw new Error("post-scale bounds unavailable");
                var afterCenter = boundsCenterPt(afterBounds);
                var desiredX = artworkCenter.x + ((beforeCenter.x - artworkCenter.x) * scaleX);
                var desiredY = artworkCenter.y + ((beforeCenter.y - artworkCenter.y) * scaleY);
                items[i].translate(desiredX - afterCenter.x, desiredY - afterCenter.y, true, true, true, true);
            }
            scaled++;
        } catch (eResize) {
            failed++;
        }
    }
    return { ok: scaled > 0 && failed === 0, scaled: scaled, failed: failed };
}

function fitArtboardToArtwork(doc, items, paddingPt){
    var b = getArtworkBounds(items);
    if (!b) return false;

    var p = paddingPt || 0;
    var left = b[0] - p;
    var top = b[1] + p;
    var right = b[2] + p;
    var bottom = b[3] - p;

    var idx = doc.artboards.getActiveArtboardIndex();
    doc.artboards[idx].artboardRect = [left, top, right, bottom];
    return true;
}

function ensureRGB(doc){
    if (!doc) return false;
    var beforeKnown = false;
    var beforeIsRgb = false;
    try {
        beforeIsRgb = (doc.documentColorSpace === DocumentColorSpace.RGB);
        beforeKnown = true;
    } catch (eRead1) {}
    if (beforeKnown && beforeIsRgb) return true;

    try { app.executeMenuCommand("doc-color-rgb"); } catch (eRgb) {}
    stabilizeIllustratorHost(80);

    var afterKnown = false;
    var afterIsRgb = false;
    try {
        afterIsRgb = (doc.documentColorSpace === DocumentColorSpace.RGB);
        afterKnown = true;
    } catch (eRead2) {}
    if (afterKnown) return afterIsRgb;
    return true;
}

function exportPNG_Resolution(doc, destFolder, prefix, ppi, transparent, artboardIndex1Based){
    var type = ExportForScreensType.SE_PNG24;
    var opt = new ExportForScreensOptionsPNG24();
    opt.transparency = !!transparent;
    opt.interlaced = false;
    opt.antiAliasing = AntiAliasingMethod.ARTOPTIMIZED;
    opt.scaleType = ExportForScreensScaleType.SCALEBYRESOLUTION;
    opt.scaleTypeValue = ppi;

    var item = new ExportForScreensItemToExport();
    item.document = false;
    item.artboards = String(artboardIndex1Based);

    doc.exportForScreens(destFolder, type, opt, item, prefix);
}

function renameLatestExport(destFolder, prefix, newName, extensionLower){
    var files = destFolder.getFiles(function(f){ return f instanceof File; });
    var best = null;
    var i;

    for (i = 0; i < files.length; i++){
        var n = files[i].name.toLowerCase();
        if (files[i].name.indexOf(prefix) === 0 &&
            n.lastIndexOf("." + extensionLower) === n.length - (extensionLower.length + 1)){
            if (!best || files[i].modified > best.modified) best = files[i];
        }
    }

    if (best){
        var target = new File(destFolder.fsName + "/" + newName);
        try { if (target.exists) target.remove(); } catch (eTarget) {}
        best.rename(newName);
    }
}

function ensureFolder(folderObj){
    if (folderObj.exists) return true;
    try { return folderObj.create(); } catch (e) {}
    return folderObj.exists;
}

function getOutputFolderByPrintType(exportRoot, printTypeMode, printType){
    if (printTypeMode !== "folder") return exportRoot;
    var bucket = printType ? printType : "Other";
    var destFolder = new Folder(exportRoot.fsName + "/" + bucket);
    ensureFolder(destFolder);
    return destFolder;
}

function formatSigned(n){
    var v = round2(n);
    return (v > 0 ? "+" : "") + v;
}

function formatSignedPercent(n){
    return formatSigned(n) + "%";
}

function formatSize(w, h){
    if (isNaN(w) || isNaN(h)) return "";
    return round2(w) + " x " + round2(h) + " in";
}

function percentDiff(actual, expected){
    if (!expected) return 0;
    return ((actual - expected) / expected) * 100;
}

function getSeverityByPercent(absPct){
    if (absPct > 10) return "not_ok";
    if (absPct >= 5) return "warn";
    return "ok";
}

function statusSortValue(status){
    if (status === "MISSING_FILE") return 10;
    if (status === "QUEUED") return 15;
    if (status === "NOT OK") return 30;
    if (status === "CHECK") return 40;
    if (status === "OK") return 50;
    return 20;
}

function visualSortValue(direction){
    if (direction === "grow") return 10;
    if (direction === "shrink") return 20;
    if (direction === "mixed") return 30;
    return 40;
}

function severityRank(severity){
    if (severity === "error") return 3;
    if (severity === "not_ok") return 2;
    if (severity === "warn") return 1;
    return 0;
}

function worstSeverity(a, b){
    return severityRank(a) >= severityRank(b) ? a : b;
}

function buildMeasuredVisualState(resizeMode, widthPct, heightPct){
    var severity = "ok";
    var direction = "neutral";
    var eps = 0.0001;
    var hasPos = false;
    var hasNeg = false;

    if (resizeMode === "respectWidth"){
        severity = getSeverityByPercent(Math.abs(heightPct));
        if (heightPct > eps) direction = "grow";
        else if (heightPct < -eps) direction = "shrink";
    } else if (resizeMode === "respectHeight"){
        severity = getSeverityByPercent(Math.abs(widthPct));
        if (widthPct > eps) direction = "grow";
        else if (widthPct < -eps) direction = "shrink";
    } else {
        severity = worstSeverity(getSeverityByPercent(Math.abs(widthPct)), getSeverityByPercent(Math.abs(heightPct)));
        hasPos = widthPct > eps || heightPct > eps;
        hasNeg = widthPct < -eps || heightPct < -eps;
        if (hasPos && hasNeg) direction = "mixed";
        else if (hasPos) direction = "grow";
        else if (hasNeg) direction = "shrink";
    }

    var rowClass = "";
    if (severity === "warn"){
        if (direction === "grow") rowClass = "row-grow-warn";
        else if (direction === "shrink") rowClass = "row-shrink-warn";
        else if (direction === "mixed") rowClass = "row-mixed-warn";
    } else if (severity === "not_ok"){
        if (direction === "grow") rowClass = "row-grow-not-ok";
        else if (direction === "shrink") rowClass = "row-shrink-not-ok";
        else if (direction === "mixed") rowClass = "row-mixed-not-ok";
    }

    var primaryPct = resizeMode === "respectWidth" ? heightPct : (resizeMode === "respectHeight" ? widthPct : Math.max(Math.abs(widthPct), Math.abs(heightPct)));
    if (resizeMode === "stretch"){
        primaryPct = hasPos && hasNeg ? Math.max(Math.abs(widthPct), Math.abs(heightPct)) : (hasPos ? Math.max(widthPct, heightPct) : Math.min(widthPct, heightPct));
    }

    return { severity: severity, direction: direction, rowClass: rowClass, comparePct: primaryPct, visualSort: visualSortValue(direction) };
}

function makeMatchSummary(orderFile, matchInfo){
    matchInfo = matchInfo || { file: null, matchType: "missing", suggested: "" };
    var label = "Missing";
    if (matchInfo.matchType === "exact") label = "Exact";
    else if (matchInfo.matchType === "normalized") label = "Normalized";
    else if (matchInfo.matchType === "canonical") label = "Canonical";
    else if (matchInfo.matchType === "ultraLoose") label = "Loose";

    if (matchInfo.file && matchInfo.file.name !== orderFile) return label + " -> " + matchInfo.file.name;
    if (!matchInfo.file && matchInfo.suggested) return label + " -> maybe: " + matchInfo.suggested;
    return label;
}

function makeMeasuredRow(emailFileName, qty, printType, note, price, currency, matchInfo, resizeMode, orderW, orderH, outW, outH, outputFsPath){
    var widthDiff = outW - orderW;
    var heightDiff = outH - orderH;
    var widthPct = percentDiff(outW, orderW);
    var heightPct = percentDiff(outH, orderH);
    var delta = "";
    var visual = buildMeasuredVisualState(resizeMode, widthPct, heightPct);

    if (resizeMode === "respectWidth"){
        delta = "H " + formatSigned(heightDiff) + " in (" + formatSignedPercent(heightPct) + ")";
    } else if (resizeMode === "respectHeight"){
        delta = "W " + formatSigned(widthDiff) + " in (" + formatSignedPercent(widthPct) + ")";
    } else {
        delta = "W " + formatSigned(widthDiff) + " in (" + formatSignedPercent(widthPct) + ") | H " + formatSigned(heightDiff) + " in (" + formatSignedPercent(heightPct) + ")";
    }

    return {
        file: emailFileName,
        qty: qty,
        printType: printType || "",
        note: note || "",
        price: isNaN(price) ? NaN : roundMoney(price),
        currency: normalizeCurrencyLabel(currency),
        match: makeMatchSummary(emailFileName, matchInfo),
        orderW: round2(orderW),
        orderH: round2(orderH),
        orderSize: formatSize(orderW, orderH),
        outputSize: formatSize(outW, outH),
        outputW: round2(outW),
        outputH: round2(outH),
        outputFsPath: outputFsPath || "",
        inspectSourcePath: "",
        statusNote: "",
        delta: delta,
        status: visual.severity === "not_ok" ? "NOT OK" : (visual.severity === "warn" ? "CHECK" : "OK"),
        rowClass: visual.rowClass,
        statusSort: statusSortValue(visual.severity === "not_ok" ? "NOT OK" : (visual.severity === "warn" ? "CHECK" : "OK")),
        visualSort: visual.visualSort,
        deltaSort: Math.abs(isNaN(visual.comparePct) ? 0 : visual.comparePct),
        printSort: (printType || "").toLowerCase()
    };
}

function makeStatusRow(emailFileName, qty, printType, note, price, currency, matchInfo, orderW, orderH, statusCode, statusNote){
    return {
        file: emailFileName,
        qty: qty,
        printType: printType || "",
        note: note || "",
        price: isNaN(price) ? NaN : roundMoney(price),
        currency: normalizeCurrencyLabel(currency),
        match: makeMatchSummary(emailFileName, matchInfo),
        orderW: round2(orderW),
        orderH: round2(orderH),
        orderSize: formatSize(orderW, orderH),
        outputSize: "",
        outputW: "",
        outputH: "",
        outputFsPath: "",
        inspectSourcePath: "",
        statusNote: statusNote || "",
        delta: "",
        status: statusCode,
        rowClass: "row-error",
        statusSort: statusSortValue(statusCode),
        visualSort: 90,
        deltaSort: 999999,
        printSort: (printType || "").toLowerCase()
    };
}

function makeQueuedRow(emailFileName, qty, printType, note, price, currency, matchInfo, orderW, orderH){
    return {
        file: emailFileName,
        qty: qty,
        printType: printType || "",
        note: note || "",
        price: isNaN(price) ? NaN : roundMoney(price),
        currency: normalizeCurrencyLabel(currency),
        match: makeMatchSummary(emailFileName, matchInfo),
        orderW: round2(orderW),
        orderH: round2(orderH),
        orderSize: formatSize(orderW, orderH),
        outputSize: "",
        outputW: "",
        outputH: "",
        outputFsPath: "",
        inspectSourcePath: "",
        delta: "",
        status: "QUEUED",
        rowClass: "row-pending",
        statusSort: statusSortValue("QUEUED"),
        visualSort: 80,
        deltaSort: -1,
        printSort: (printType || "").toLowerCase()
    };
}

function buildInitialReportRows(items){
    var rows = [];
    for (var i = 0; i < items.length; i++){
        var item = items[i];
        var matchInfo = item.matchInfo || { file: null, matchType: "missing", suggested: "" };
        if (isNaN(item.width) || isNaN(item.height)){
            rows.push(makeStatusRow(item.file, item.qty, item.printType, item.note, item.price, item.currency, matchInfo, item.width, item.height, "BAD_WIDTH_HEIGHT"));
        } else if (!matchInfo.file || !matchInfo.file.exists){
            rows.push(makeStatusRow(item.file, item.qty, item.printType, item.note, item.price, item.currency, matchInfo, item.width, item.height, "MISSING_FILE"));
        } else {
            rows.push(makeQueuedRow(item.file, item.qty, item.printType, item.note, item.price, item.currency, matchInfo, item.width, item.height));
        }
    }
    return rows;
}

function buildReportStats(reportRows){
    var stats = { exported: 0, check: 0, notOk: 0, errors: 0, queued: 0 };
    for (var i = 0; i < reportRows.length; i++){
        var row = reportRows[i];
        if (row.status === "OK") stats.exported++;
        else if (row.status === "CHECK") { stats.exported++; stats.check++; }
        else if (row.status === "NOT OK") { stats.exported++; stats.notOk++; }
        else if (row.status === "QUEUED") stats.queued++;
        else stats.errors++;
    }
    return stats;
}

function sizerParsePayload(jsonText){
    if (!jsonText) return {};
    try {
        if (typeof JSON !== "undefined" && JSON && JSON.parse) return JSON.parse(jsonText);
    } catch (e1) {}
    try { return eval("(" + jsonText + ")"); } catch (e2) {}
    return {};
}

function sizerQuoteString(text){
    var s = String(text == null ? "" : text);
    return '"' + s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
        .replace(/\f/g, "\\f")
        .replace(/\x08/g, "\\b") + '"';
}

function sizerStringifyValue(value, stack){
    var t = typeof value;
    var i;
    var parts;
    var key;

    if (value === null) return "null";
    if (t === "string") return sizerQuoteString(value);
    if (t === "number") return isFinite(value) ? String(value) : "null";
    if (t === "boolean") return value ? "true" : "false";
    if (t === "undefined" || t === "function") return "null";

    for (i = 0; i < stack.length; i++){
        if (stack[i] === value) return sizerQuoteString("[Circular]");
    }

    if (value instanceof Array){
        stack.push(value);
        parts = [];
        for (i = 0; i < value.length; i++){
            parts.push(sizerStringifyValue(value[i], stack));
        }
        stack.pop();
        return "[" + parts.join(",") + "]";
    }

    stack.push(value);
    parts = [];
    for (key in value){
        if (!value.hasOwnProperty(key)) continue;
        if (typeof value[key] === "undefined" || typeof value[key] === "function") continue;
        parts.push(sizerQuoteString(key) + ":" + sizerStringifyValue(value[key], stack));
    }
    stack.pop();
    return "{" + parts.join(",") + "}";
}

function sizerStringify(obj){
    try {
        if (typeof JSON !== "undefined" && JSON && JSON.stringify) return JSON.stringify(obj);
    } catch (e1) {}
    try {
        return sizerStringifyValue(obj, []);
    } catch (e2) {
        return '{"ok":false,"error":"JSON stringify failed."}';
    }
}

function sizerSuccess(data){
    return sizerStringify({ ok: true, data: data });
}

function sizerFailure(message){
    return sizerStringify({ ok: false, error: String(message || "Unknown error.") });
}

function sizerNormalizeSettings(raw){
    raw = raw || {};
    var resizeMode = raw.resizeMode === "respectHeight" ? "respectHeight" : (raw.resizeMode === "stretch" ? "stretch" : "respectWidth");
    var printTypeMode = raw.printTypeMode === "folder" ? "folder" : (raw.printTypeMode === "prefix" ? "prefix" : "none");
    return {
        resizeMode: resizeMode,
        printTypeMode: printTypeMode,
        runWeMustAction: !!raw.runWeMustAction,
        filenameFormat: "qtyFilename"
    };
}

function sizerSerializeRow(index){
    var item = SIZER_HOST_STATE.items[index];
    var row = SIZER_HOST_STATE.rows[index];
    var matchInfo = item && item.matchInfo ? item.matchInfo : { file: null, matchType: "missing", suggested: "" };
    var sourcePath = "";
    try {
        if (matchInfo.file) sourcePath = matchInfo.file.fsName;
    } catch (ePath) {}

    return {
        index: index,
        file: row.file,
        qty: row.qty,
        printType: row.printType || "",
        note: row.note || "",
        price: row.price,
        currency: row.currency || "",
        match: row.match || "",
        matchType: matchInfo.matchType || "missing",
        suggested: matchInfo.suggested || "",
        orderW: row.orderW,
        orderH: row.orderH,
        orderSize: row.orderSize || "",
        outputW: row.outputW,
        outputH: row.outputH,
        outputSize: row.outputSize || "",
        outputFsPath: row.outputFsPath || "",
        statusNote: row.statusNote || "",
        delta: row.delta || "",
        status: row.status || "",
        rowClass: row.rowClass || "",
        sourcePath: sourcePath,
        isMatched: !!(matchInfo.file && matchInfo.file.exists),
        isSelectable: row.status !== "MISSING_FILE" && row.status !== "BAD_WIDTH_HEIGHT"
    };
}

function sizerBuildSnapshot(message){
    var rows = [];
    for (var i = 0; i < SIZER_HOST_STATE.rows.length; i++){
        rows.push(sizerSerializeRow(i));
    }

    return {
        message: message || "",
        settings: SIZER_HOST_STATE.settings,
        summary: buildReportStats(SIZER_HOST_STATE.rows),
        financials: SIZER_HOST_STATE.financials,
        lastRun: SIZER_HOST_STATE.lastRun,
        rows: rows
    };
}

function sizerGetOpenDocumentByFile(fileObj){
    var targetPath = "";
    try { targetPath = fileObj.fsName; } catch (ePath) {}
    if (!targetPath) return null;

    try {
        for (var i = 0; i < app.documents.length; i++){
            var doc = app.documents[i];
            try {
                if (doc.fullName && doc.fullName.fsName === targetPath) return doc;
            } catch (eFullName) {}
        }
    } catch (eDocs) {}
    return null;
}

function sizerActivateDocument(doc){
    if (!doc) return false;
    try {
        doc.activate();
        return true;
    } catch (eActivate) {}

    try {
        app.activeDocument = doc;
        return true;
    } catch (eAssign) {}

    return false;
}

function sizerEnsureDocumentActive(doc, reason){
    if (!doc) throw new Error(reason || "No document reference.");
    if (!sizerActivateDocument(doc)) throw new Error(reason || "Could not activate document.");
    stabilizeIllustratorHost(30);
    return doc;
}

function sizerCreateTempWorkingCopy(sourceFile){
    var tempRoot = new Folder(Folder.temp.fsName + "/Sizer_AI_Work");
    ensureFolder(tempRoot);
    var ext = "";
    var dot = sourceFile.name.lastIndexOf(".");
    if (dot >= 0) ext = sourceFile.name.substring(dot);
    var tempName = stripExt(sourceFile.name) + "__" + makeTimestampTag() + "_" + Math.floor(Math.random() * 100000) + ext;
    var tempFile = new File(tempRoot.fsName + "/" + tempName);
    if (!sourceFile.copy(tempFile.fsName)) throw new Error("Failed to create temp working copy.");
    return tempFile;
}

function sizerRemoveFileIfExists(filePath){
    if (!filePath) return;
    try {
        var f = new File(filePath);
        if (f.exists) f.remove();
    } catch (eRemove) {}
}

function sizerOpenSourceForInspectionPath(filePath){
    var doc = null;
    if (!filePath) return false;

    try {
        var fileObj = new File(filePath);
        if (!fileObj.exists) return false;
        doc = sizerGetOpenDocumentByFile(fileObj);
        if (!doc) doc = app.open(fileObj);
        if (doc) {
            sizerActivateDocument(doc);
            stabilizeIllustratorHost(80);
            return true;
        }
    } catch (eOpenInspect) {}
    return false;
}

function sizerPrepareStatusRow(item, statusCode, statusNote, inspectSource){
    var matchInfo = item.matchInfo || { file: null, matchType: "missing", suggested: "" };
    var row = makeStatusRow(item.file, item.qty, item.printType, item.note, item.price, item.currency, matchInfo, item.width, item.height, statusCode, statusNote);
    if (inspectSource && matchInfo.file && matchInfo.file.exists) {
        try { row.inspectSourcePath = matchInfo.file.fsName; } catch (eInspectPath) {}
    }
    return row;
}

function sizerCanExportStatus(status){
    return status === "OK" || status === "CHECK";
}

function sizerMeasureAndMaybeExport(item, settings, exportFolder){
    var matchInfo = item.matchInfo || { file: null, matchType: "missing", suggested: "" };

    if (isNaN(item.width) || isNaN(item.height)) return sizerPrepareStatusRow(item, "BAD_WIDTH_HEIGHT");
    if (!matchInfo.file || !matchInfo.file.exists) return sizerPrepareStatusRow(item, "MISSING_FILE");

    var tempFile = null;
    var doc = null;
    var outputFilePath = "";

    try {
        tempFile = sizerCreateTempWorkingCopy(matchInfo.file);
        doc = app.open(tempFile);
        sizerEnsureDocumentActive(doc, "Opened temp document but could not activate it.");

        sizerEnsureDocumentActive(doc, "There is no active temp document for color conversion.");
        ensureRGB(doc);

        sizerEnsureDocumentActive(doc, "There is no active temp document for unlock/show.");
        if (!unlockAllArtwork(doc)){
            return sizerPrepareStatusRow(item, "UNLOCK_FAIL", "Could not unlock/show all artwork in the file.");
        }

        if (settings.runWeMustAction){
            try {
                sizerEnsureDocumentActive(doc, "There is no active temp document for WeMust.");
                app.doScript("WeMust", "WeMust");
            } catch (eAction) {
                return sizerPrepareStatusRow(item, "ACTION_FAIL", "Illustrator action WeMust / WeMust failed.");
            }

            sizerEnsureDocumentActive(doc, "There is no active temp document after WeMust.");
            if (!unlockAllArtwork(doc)){
                return sizerPrepareStatusRow(item, "UNLOCK_FAIL", "Could not unlock/show all artwork after running the action.");
            }
        }

        sizerEnsureDocumentActive(doc, "There is no active temp document for the second color conversion.");
        ensureRGB(doc);

        var artworkItems = getTopLevelArtworkItems(doc);
        var b0 = getArtworkBounds(artworkItems);
        if (!b0){
            artworkItems = getFallbackArtworkItems(doc);
            b0 = getArtworkBounds(artworkItems);
        }
        if (!b0) {
            return sizerPrepareStatusRow(item, "NO_ARTWORK", "No usable artwork bounds were detected. Source file was opened for inspection.", true);
        }

        var cur = boundsSizePt(b0);
        if (cur.w <= 0 || cur.h <= 0) {
            return sizerPrepareStatusRow(item, "BAD_BOUNDS", "Artwork bounds were detected but width/height resolved to zero.", true);
        }

        var sx = ((item.width * 72) / cur.w) * 100.0;
        var sy = ((item.height * 72) / cur.h) * 100.0;
        var scaleResult = null;
        if (settings.resizeMode === "respectWidth") scaleResult = scaleArtworkItems(artworkItems, sx, sx, b0);
        else if (settings.resizeMode === "respectHeight") scaleResult = scaleArtworkItems(artworkItems, sy, sy, b0);
        else scaleResult = scaleArtworkItems(artworkItems, sx, sy, b0);

        if (!scaleResult || !scaleResult.ok) return sizerPrepareStatusRow(item, "RESIZE_FAIL", "One or more artwork items failed during resize.");

        artworkItems = getTopLevelArtworkItems(doc);
        if (!getArtworkBounds(artworkItems)) artworkItems = getFallbackArtworkItems(doc);
        sizerEnsureDocumentActive(doc, "There is no active temp document for artboard fitting.");
        if (!fitArtboardToArtwork(doc, artworkItems, ARTBOARD_PADDING_PT)) return sizerPrepareStatusRow(item, "FIT_ARTBOARD_FAIL", "The artboard could not be fitted to the detected artwork.");

        var bOut = getArtworkBounds(artworkItems);
        var outPt = bOut ? boundsSizePt(bOut) : { w: 0, h: 0 };
        var outW = outPt.w / 72.0;
        var outH = outPt.h / 72.0;

        var measuredRow = makeMeasuredRow(
            item.file,
            item.qty,
            item.printType,
            item.note,
            item.price,
            item.currency,
            matchInfo,
            settings.resizeMode,
            item.width,
            item.height,
            outW,
            outH,
            ""
        );

        if (!sizerCanExportStatus(measuredRow.status)) return measuredRow;

        var base = makeBaseWithQtyOption(item.qty, stripExt(item.file), settings.filenameFormat);
        if (settings.printTypeMode === "prefix" && item.printType) base = item.printType + "___" + base;

        var destFolder = getOutputFolderByPrintType(exportFolder, settings.printTypeMode, item.printType);
        var prefixPNG = base + "__PNG__";
        sizerEnsureDocumentActive(doc, "There is no active temp document for export.");
        var ab1 = doc.artboards.getActiveArtboardIndex() + 1;
        exportPNG_Resolution(doc, destFolder, prefixPNG, TARGET_PPI, true, ab1);
        renameLatestExport(destFolder, prefixPNG, base + ".png", "png");

        outputFilePath = new File(destFolder.fsName + "/" + base + ".png").fsName;
        measuredRow.outputFsPath = outputFilePath;
        return measuredRow;
    } catch (eProc) {
        return sizerPrepareStatusRow(item, "PROCESS_ERROR", eProc && eProc.message ? eProc.message : String(eProc));
    } finally {
        try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (eClose) {}
        try { if (tempFile && tempFile.exists) tempFile.remove(); } catch (eTemp) {}
        stabilizeIllustratorHost(40);
    }
}

function sizerPing(){
    return sizerSuccess({ app: "Illustrator", ready: true });
}

function sizerPickFolder(){
    try {
        var picked = Folder.selectDialog("Select the source folder");
        if (!picked) return sizerSuccess({ path: "" });
        return sizerSuccess({ path: picked.fsName });
    } catch (e) {
        return sizerFailure(e && e.message ? e.message : e);
    }
}

function sizerClearState(){
    SIZER_HOST_STATE = {
        ready: false,
        inputFolderPath: "",
        emailText: "",
        inputFolder: null,
        items: [],
        rows: [],
        settings: null,
        financials: null,
        lastRun: null
    };
    return sizerSuccess({ cleared: true });
}

function sizerScan(payloadJson){
    try {
        var payload = sizerParsePayload(payloadJson);
        var folderPath = trimStr(payload.folderPath || "");
        var emailText = String(payload.emailText || "");
        var settings = sizerNormalizeSettings(payload.settings);

        if (!folderPath) return sizerFailure("Folder path is required.");
        if (!emailText || emailText.length < 10) return sizerFailure("Email text is required.");

        var inputFolder = new Folder(folderPath);
        if (!inputFolder.exists) return sizerFailure("Selected folder does not exist.");

        var items = parseEmailItems(emailText);
        if (!items.length) return sizerFailure("No valid items found in the pasted email.");

        var allFiles = getFilesInFolder(inputFolder);
        var missingCount = 0;
        for (var i = 0; i < items.length; i++){
            items[i].matchInfo = findFileMatchByEmailName(allFiles, items[i].file);
            if (!items[i].matchInfo.file) missingCount++;
        }

        SIZER_HOST_STATE.ready = true;
        SIZER_HOST_STATE.inputFolderPath = inputFolder.fsName;
        SIZER_HOST_STATE.emailText = emailText;
        SIZER_HOST_STATE.inputFolder = inputFolder;
        SIZER_HOST_STATE.items = items;
        SIZER_HOST_STATE.rows = buildInitialReportRows(items);
        SIZER_HOST_STATE.settings = settings;
        SIZER_HOST_STATE.financials = parseEmailFinancials(emailText, items);
        SIZER_HOST_STATE.lastRun = {
            scannedAt: (new Date()).toString(),
            processed: 0,
            exported: 0,
            skipped: 0,
            selectedCount: 0,
            missingCount: missingCount
        };

        return sizerSuccess(sizerBuildSnapshot("Scan completed."));
    } catch (e) {
        return sizerFailure(e && e.message ? e.message : e);
    }
}

function sizerActivateRow(payloadJson){
    try {
        if (!SIZER_HOST_STATE.ready) return sizerFailure("Nothing is loaded yet.");

        var payload = sizerParsePayload(payloadJson);
        var index = parseInt(payload.index, 10);
        if (isNaN(index) || index < 0 || index >= SIZER_HOST_STATE.items.length) return sizerFailure("Invalid row index.");

        var item = SIZER_HOST_STATE.items[index];
        var matchInfo = item.matchInfo || { file: null, matchType: "missing", suggested: "" };
        if (!matchInfo.file || !matchInfo.file.exists) return sizerFailure("This row does not have a matched source file.");

        var doc = sizerGetOpenDocumentByFile(matchInfo.file);
        if (doc) {
            sizerActivateDocument(doc);
            stabilizeIllustratorHost(60);
            return sizerSuccess({ opened: false, file: doc.name, index: index });
        }

        doc = app.open(matchInfo.file);
        stabilizeIllustratorHost(80);
        sizerActivateDocument(doc);
        return sizerSuccess({ opened: true, file: doc.name, index: index });
    } catch (e) {
        return sizerFailure(e && e.message ? e.message : e);
    }
}

function sizerProcessSelected(payloadJson){
    if (!SIZER_HOST_STATE.ready) return sizerFailure("Scan the folder and email first.");

    var oldUserInteractionLevel = app.userInteractionLevel;
    try {
        var payload = sizerParsePayload(payloadJson);
        var settings = sizerNormalizeSettings(payload.settings || SIZER_HOST_STATE.settings);
        var rawIndexes = payload.selectedIndexes || [];
        var normalizedIndexes = [];
        var seen = {};
        var i;

        for (i = 0; i < rawIndexes.length; i++){
            var idx = parseInt(rawIndexes[i], 10);
            if (isNaN(idx) || idx < 0 || idx >= SIZER_HOST_STATE.items.length) continue;
            if (seen[idx]) continue;
            seen[idx] = true;
            normalizedIndexes.push(idx);
        }

        if (!normalizedIndexes.length) return sizerFailure("Select at least one row.");

        normalizedIndexes.sort(function(a, b){ return a - b; });
        SIZER_HOST_STATE.settings = settings;

        var exportFolder = new Folder(SIZER_HOST_STATE.inputFolder.fsName + "/Export");
        ensureFolder(exportFolder);

        var processed = 0;
        var exported = 0;
        var skipped = 0;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

        for (i = 0; i < normalizedIndexes.length; i++){
            var rowIndex = normalizedIndexes[i];
            var item = SIZER_HOST_STATE.items[rowIndex];
            var nextRow = null;
            try {
                var previousRow = SIZER_HOST_STATE.rows[rowIndex];
                if (previousRow && previousRow.outputFsPath) sizerRemoveFileIfExists(previousRow.outputFsPath);
                nextRow = sizerMeasureAndMaybeExport(item, settings, exportFolder);
            } catch (eRow) {
                nextRow = sizerPrepareStatusRow(item, "PROCESS_ERROR", eRow && eRow.message ? eRow.message : String(eRow));
            }
            SIZER_HOST_STATE.rows[rowIndex] = nextRow;
            if (nextRow && nextRow.inspectSourcePath) {
                try { sizerOpenSourceForInspectionPath(nextRow.inspectSourcePath); } catch (eInspectOpen) {}
            }
            processed++;
            if (nextRow.outputFsPath) exported++;
            else skipped++;
        }

        SIZER_HOST_STATE.lastRun = {
            scannedAt: SIZER_HOST_STATE.lastRun ? SIZER_HOST_STATE.lastRun.scannedAt : "",
            processed: processed,
            exported: exported,
            skipped: skipped,
            selectedCount: normalizedIndexes.length,
            missingCount: SIZER_HOST_STATE.lastRun ? SIZER_HOST_STATE.lastRun.missingCount : 0
        };

        return sizerSuccess(sizerBuildSnapshot("Selected rows processed."));
    } catch (e) {
        return sizerFailure(e && e.message ? e.message : e);
    } finally {
        app.userInteractionLevel = oldUserInteractionLevel;
    }
}
