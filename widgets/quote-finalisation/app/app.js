(function () {
    "use strict";

    const CREATE_QUOTE_API_NAME = "create_sla_draft_quote";
    const LEGACY_PROPOSAL_TRANSFER_KEY = "mcg_sla_proposal_transfer_v1";
    const PROPOSAL_QUERY_PARAM = "proposal_data";
    const LEGACY_QUOTE_TRANSFER_KEY = "mcg_sla_quote_finalisation_transfer_v1";
    const QUOTE_QUERY_PARAM = "quote_data";
    const TRANSFER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/environment/development/recurring-invoice-report/";
    const CRM_APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/crm-homepage/";
    const MISSING_SERVICES_PAGE_LINK = "Missing_Services_Proposals";
    const EXISTING_SERVICES_PAGE_LINK = "Existing_Services_Risk_Analysis";
    const WORKFLOW_QUERY_PARAM = "workflow_data";
    const BOOKS_EDR_ITEM_ID = "1417654000018767777";

    const state = {
        payload: null,
        selectedPhase: "",
        lineEdits: new Map(),
        customerId: "",
        customerLookupError: "",
        resolvingCustomer: false,
        submittingPhases: new Set(),
        bulkSubmitting: false,
        references: new Map(),
        phaseViews: new Map(),
        phaseErrors: new Map(),
        createdQuotes: new Map(),
        existingPackage: null,
        existingCreated: null,
        existingSubmitting: false,
        combinedCreated: null,
        combinedSubmitting: false,
        selectedCombinedPhases: new Set(),
        mappingTarget: null,
        mappingResults: [],
        presentationSubmitting: false,
        presentationWorkspaceStatus: null,
        mode: "separate",
        navigationMode: detectNavigationMode()
    };

    const elements = {
        banner: document.getElementById("connectionBanner"),
        loadingState: document.getElementById("initialLoadingState"),
        empty: document.getElementById("emptyState"),
        content: document.getElementById("quoteContent"),
        stickyCustomerName: document.getElementById("stickyCustomerName"),
        stickyPhaseSummary: document.getElementById("stickyPhaseSummary"),
        customerName: document.getElementById("customerName"),
        customerId: document.getElementById("customerId"),
        customerIdHelp: document.getElementById("customerIdHelp"),
        retryCustomer: document.getElementById("retryCustomerLookup"),
        phaseCount: document.getElementById("phaseCount"),
        salesperson: document.getElementById("salespersonName"),
        phaseList: document.getElementById("phaseList"),
        bulkStatus: document.getElementById("bulkQuoteStatus"),
        createAll: document.getElementById("createAllDraftQuotes"),
        back: document.getElementById("backToProposal"),
        modePanel: document.getElementById("quoteModePanel"),
        separateMode: document.getElementById("separateMode"),
        combinedMode: document.getElementById("combinedMode"),
        separatePhasesPanel: document.getElementById("separatePhasesPanel"),
        separateBulkPanel: document.getElementById("separateBulkPanel"),
        combinedPanel: document.getElementById("combinedPanel"),
        combinedPhaseOptions: document.getElementById("combinedPhaseOptions"),
        combinedReference: document.getElementById("combinedReference"),
        combinedStatus: document.getElementById("combinedStatus"),
        createCombined: document.getElementById("createCombinedDraft"),
        openCombined: document.getElementById("openCombinedDraft"),
        existingPanel: document.getElementById("existingPackagePanel"),
        existingSummary: document.getElementById("existingPackageSummary"),
        existingBody: document.getElementById("existingPackageBody"),
        existingStatus: document.getElementById("existingPackageStatus"),
        createExisting: document.getElementById("createExistingDraft"),
        openExisting: document.getElementById("openExistingDraft"),
        mappingPanel: document.getElementById("itemMappingPanel"),
        mappingTitle: document.getElementById("itemMappingTitle"),
        mappingSearch: document.getElementById("itemMappingSearch"),
        mappingSearchButton: document.getElementById("itemMappingSearchButton"),
        mappingCloseButton: document.getElementById("itemMappingCloseButton"),
        mappingStatus: document.getElementById("itemMappingStatus"),
        mappingResults: document.getElementById("itemMappingResults"),
        presentationPanel: document.getElementById("presentationPanel"),
        presentationStatus: document.getElementById("presentationStatus"),
        createPresentation: document.getElementById("createPresentation"),
        presentationPrices: Array.from(document.querySelectorAll('input[name="presentationPrices"]')),
        createdWorkNotice: document.getElementById("createdWorkNotice"),
        createdWorkNoticeText: document.getElementById("createdWorkNoticeText"),
        retryCreatedWork: document.getElementById("retryCreatedWork")
    };

    function text(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
    }

    function compactName(value) {
        return text(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
    }

    function isEdrService(service, businessName) {
        return ["edr", "kedr", "kaseyawatchguardedr"].includes(compactName(service)) ||
            compactName(businessName) === "kaseyawatchguardedr";
    }

    function numericOrNull(value) {
        if (value === null || value === undefined || text(value) === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function money(value) {
        const parsed = numericOrNull(value);
        if (parsed === null) return "TBC";
        return new Intl.NumberFormat("en-AU", {
            style: "currency",
            currency: "AUD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(parsed);
    }

    function parseJson(value) {
        if (typeof value !== "string") return value;
        try { return JSON.parse(value); } catch (error) { return null; }
    }

    function fingerprintValue(value) {
        if (Array.isArray(value)) return value.map(fingerprintValue);
        if (!value || typeof value !== "object") return value;
        return Object.keys(value).sort().reduce(function (result, key) {
            if (key !== "salespersonName" && key !== "referenceNumber") result[key] = fingerprintValue(value[key]);
            return result;
        }, {});
    }

    function quoteFingerprint(request) {
        const source = JSON.stringify(fingerprintValue(request));
        let first = 2166136261;
        let second = 5381;
        for (let index = 0; index < source.length; index += 1) {
            const code = source.charCodeAt(index);
            first = Math.imul(first ^ code, 16777619);
            second = Math.imul(second, 33) ^ code;
        }
        return source.length + "-" + (first >>> 0).toString(36) + "-" + (second >>> 0).toString(36);
    }

    function matchingCreatedQuote(created, fingerprint) {
        return created && text(created.fingerprint) === fingerprint ? created : null;
    }

    function detectNavigationMode() {
        if (window.__QUOTE_FINALISATION_NAVIGATION_MODE__ === "embed" || window.__QUOTE_FINALISATION_NAVIGATION_MODE__ === "shell") {
            return window.__QUOTE_FINALISATION_NAVIGATION_MODE__;
        }
        try {
            const topUrl = String(window.top.location.href || "");
            if (topUrl.includes("/recurring-invoice-report/")) return "shell";
            if (window.top !== window.parent) return "embed";
        } catch (error) {
            if (window.top !== window.parent) return "embed";
        }
        return "shell";
    }

    function normaliseNavigationMode(value) {
        return value === "embed" ? "embed" : value === "shell" ? "shell" : state.navigationMode;
    }

    function pageUrl(pageLink, parameterName, encodedPayload, navigationMode) {
        const mode = normaliseNavigationMode(navigationMode);
        const base = mode === "embed"
            ? CRM_APP_ROOT_URL + "#Page:" + pageLink
            : APP_ROOT_URL + "#Page:" + pageLink;
        return encodedPayload
            ? base + "?" + parameterName + "=" + encodeURIComponent(encodedPayload)
            : base;
    }

    function decodePayload(value) {
        const encoded = text(value).replaceAll("-", "+").replaceAll("_", "/");
        if (!encoded) return null;
        try {
            const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
            const binary = window.atob(padded);
            const bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
            return parseJson(new TextDecoder().decode(bytes));
        } catch (error) {
            return null;
        }
    }

    async function decodeTransferValue(value) {
        if (window.MCGQuoteWorkspace && typeof window.MCGQuoteWorkspace.decodeTransfer === "function") {
            return window.MCGQuoteWorkspace.decodeTransfer(value);
        }
        return decodePayload(value);
    }

    function parameterFromUrl(url, name) {
        const href = text(url);
        const queryIndex = href.indexOf("?");
        if (queryIndex < 0) return "";
        const query = href.slice(queryIndex + 1).split("#")[0];
        const prefix = encodeURIComponent(name) + "=";
        const pair = query.split("&").find(function (entry) { return entry.startsWith(prefix); });
        if (!pair) return "";
        try { return decodeURIComponent(pair.slice(prefix.length)); }
        catch (error) { return pair.slice(prefix.length); }
    }

    function readBrowserPageParameter(name) {
        const candidates = [];
        try { candidates.push(window.location && window.location.href); } catch (error) { /* Restricted frame. */ }
        try { candidates.push(window.parent && window.parent.location && window.parent.location.href); } catch (error) { /* Restricted frame. */ }
        try { candidates.push(window.top && window.top.location && window.top.location.href); } catch (error) { /* Restricted frame. */ }
        try { candidates.push(document.referrer); } catch (error) { /* Referrer may be unavailable. */ }

        for (const candidate of candidates) {
            const value = parameterFromUrl(candidate, name);
            if (value) return value;
        }
        return "";
    }

    function findQueryParameter(value, name, depth) {
        if (depth > 6 || value === null || value === undefined) return "";
        const parsed = parseJson(value);
        if (parsed === null || parsed === undefined || typeof parsed !== "object") return "";
        if (Object.prototype.hasOwnProperty.call(parsed, name)) return parsed[name];
        const children = Array.isArray(parsed) ? parsed : Object.values(parsed);
        for (const child of children) {
            const match = findQueryParameter(child, name, depth + 1);
            if (text(match)) return match;
        }
        return "";
    }

    function clearLegacyTransferCache() {
        try {
            window.localStorage.removeItem(LEGACY_PROPOSAL_TRANSFER_KEY);
            window.localStorage.removeItem(LEGACY_QUOTE_TRANSFER_KEY);
        } catch (error) {
            // Storage may be blocked inside a Creator iframe.
        }
    }

    function encodePayload(payload) {
        const json = JSON.stringify(payload);
        const bytes = new TextEncoder().encode(json);
        let binary = "";
        bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
        return window.btoa(binary)
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replace(/=+$/g, "");
    }

    function normaliseSelection(selection) {
        const phase = Number(selection && selection.phase);
        if (!Number.isInteger(phase) || phase < 1) return null;
        const service = text(selection.service) || "Unnamed service";
        const businessName = text(selection.businessName) || service;
        return {
            order: numericOrNull(selection.order),
            group: text(selection.group) || "Other services",
            subGroup: text(selection.subGroup) || "Other",
            service: service,
            businessName: businessName,
            recommendation: text(selection.recommendation) || "—",
            active: Boolean(selection.active),
            phase: phase,
            quantity: numericOrNull(selection.quantity),
            customPrice: numericOrNull(selection.customPrice),
            standardPrice: numericOrNull(selection.standardPrice),
            monthlyRate: numericOrNull(selection.monthlyRate),
            unit: text(selection.unit),
            customSetup: numericOrNull(selection.customSetup),
            standardSetup: numericOrNull(selection.standardSetup),
            setupRate: numericOrNull(selection.setupRate),
            monthlyTotal: numericOrNull(selection.monthlyTotal),
            itemId: isEdrService(service, businessName) ? BOOKS_EDR_ITEM_ID : text(selection.itemId),
            setupItemId: text(selection.setupItemId),
            sku: text(selection.sku)
        };
    }

    function normalisePayload(payload) {
        if (!payload || !text(payload.customerName) || !Array.isArray(payload.selections)) return null;
        const selections = payload.selections.map(normaliseSelection).filter(Boolean).sort(function (left, right) {
            if (left.phase !== right.phase) return left.phase - right.phase;
            const leftOrder = left.order === null ? Number.MAX_SAFE_INTEGER : left.order;
            const rightOrder = right.order === null ? Number.MAX_SAFE_INTEGER : right.order;
            return leftOrder - rightOrder || left.service.localeCompare(right.service);
        });
        const hasExistingPackage = Boolean(payload.existingPackage && typeof payload.existingPackage === "object");
        const presentationOnly = Boolean(payload.presentationOnly);
        if (!selections.length && !hasExistingPackage && !presentationOnly) return null;
        const availablePhases = Array.from(new Set(selections.map(function (row) { return row.phase; })));
        const requestedPhase = Number(payload.selectedPhase);
        const selectedPhase = availablePhases.includes(requestedPhase) ? requestedPhase : (availablePhases[0] || null);
        return {
            version: payload.version || 1,
            createdAt: text(payload.createdAt),
            customerName: text(payload.customerName),
            crmAccountId: text(payload.crmAccountId),
            selectedPhase: selectedPhase,
            navigationMode: normaliseNavigationMode(payload.navigationMode),
            sourceRoute: payload.sourceRoute === "existing" ? "existing" : payload.sourceRoute === "combined" ? "combined" : "proposal",
            presentationOnly: presentationOnly,
            selections: selections,
            existingPackage: payload.existingPackage && typeof payload.existingPackage === "object" ? payload.existingPackage : null
        };
    }

    function normaliseTransfer(payload) {
        if (!payload || !text(payload.customerName)) return null;
        if (Array.isArray(payload.selections)) return normalisePayload(payload);
        if (!window.MCGQuoteWorkspace) return null;
        const session = window.MCGQuoteWorkspace.get(payload.customerName);
        if (!session) return null;
        const sourceRoute = payload.sourceRoute || session.quoteSource || (Array.isArray(session.proposals) && session.proposals.length ? "proposal" : "existing");
        return normalisePayload({
            version: payload.version || 2,
            createdAt: payload.createdAt || session.updatedAt,
            customerName: payload.customerName,
            crmAccountId: payload.crmAccountId || session.crmAccountId,
            selectedPhase: payload.selectedPhase || session.selectedPhase,
            navigationMode: payload.navigationMode || session.navigationMode,
            sourceRoute: sourceRoute,
            selections: sourceRoute === "existing" ? [] : session.proposals || [],
            existingPackage: sourceRoute === "proposal" ? null : session.existingPackage || null
        });
    }

    function presentationIncludesPrices() {
        const selected = document.querySelector('input[name="presentationPrices"]:checked');
        return Boolean(selected && selected.value === "show");
    }

    function createdWorkNotice(message, tone, retry) {
        if (!elements.createdWorkNotice) return;
        elements.createdWorkNotice.hidden = false;
        elements.createdWorkNotice.className = "created-work-notice" + (tone ? " " + tone : "");
        elements.createdWorkNoticeText.textContent = message;
        elements.retryCreatedWork.hidden = !retry;
    }

    async function logCreatedOutput(type, scope, id, url, detail) {
        if (!window.MCGCreatedWork) {
            createdWorkNotice("Output created, but the Created Work recorder is unavailable. Keep its link.", "is-error", false);
            return;
        }
        createdWorkNotice("Saving the " + type.toLowerCase() + " to Created Work…", "is-saving", false);
        try {
            await window.MCGCreatedWork.record({
                key: type.toLowerCase() + ":" + id +
                    (detail ? ":" + encodeURIComponent(detail) : ""),
                type: type,
                scope: scope,
                externalId: id,
                url: url,
                customerName: state.payload.customerName,
                crmAccountId: state.payload.crmAccountId
            });
            const pendingCount = window.MCGCreatedWork.pendingCount();
            createdWorkNotice(pendingCount
                ? type + " saved. " + pendingCount + " earlier output still needs a Created Work entry."
                : type + " saved in Created Work. Open it from the link above.",
                pendingCount ? "is-error" : "", Boolean(pendingCount));
        } catch (error) {
            createdWorkNotice(type + " created, but its Created Work entry was not saved. Retry here; the output link remains available.", "is-error", true);
        }
    }

    function renderPresentationReadiness(result) {
        if (!result || state.presentationSubmitting) return;
        if (!result.ready) {
            const missing = [];
            if (!result.existingReady) missing.push("Existing Services and Risk Analysis");
            if (!result.missingReady) missing.push("Missing Services and Proposal Phases");
            elements.presentationStatus.textContent = "Not ready: " + missing.join("; ") + " images have not been saved for this same customer.";
            elements.presentationStatus.className = "quote-status is-error";
            elements.createPresentation.disabled = true;
            return;
        }
        if (presentationIncludesPrices() && !result.withPricesReady) {
            elements.presentationStatus.textContent = "With-price images are not ready yet. Complete this customer's Existing and Missing steps in the live SLA workflow, then return here.";
            elements.presentationStatus.className = "quote-status is-error";
            elements.createPresentation.disabled = true;
            return;
        }
        const variant = presentationIncludesPrices() ? "with-price" : "without-price";
        elements.presentationStatus.textContent = "All four " + variant + " images are ready for " + state.payload.customerName + ". The original template will remain unchanged.";
        elements.presentationStatus.className = "quote-status is-ready";
        elements.createPresentation.disabled = false;
    }

    async function refreshPresentationStatus() {
        if (!elements.presentationStatus || !elements.createPresentation) return;
        elements.createPresentation.disabled = true;
        if (!window.MCGPresentationWorkspace || !state.payload) {
            elements.presentationStatus.textContent = "Presentation workspace is unavailable.";
            elements.presentationStatus.className = "quote-status is-error";
            return;
        }
        elements.presentationStatus.textContent = "Checking Existing and Missing presentation images…";
        elements.presentationStatus.className = "quote-status is-loading";
        try {
            const result = await window.MCGPresentationWorkspace.status(state.payload.crmAccountId, state.payload.customerName);
            state.presentationWorkspaceStatus = result;
            renderPresentationReadiness(result);
        } catch (error) {
            state.presentationWorkspaceStatus = null;
            const details = window.MCGPresentationWorkspace && typeof window.MCGPresentationWorkspace.errorMessage === "function"
                ? window.MCGPresentationWorkspace.errorMessage(error)
                : (error.message || String(error));
            elements.presentationStatus.textContent = "Could not check presentation images: " + details;
            elements.presentationStatus.className = "quote-status is-error";
        }
    }

    async function createAndOpenPresentation() {
        if (state.presentationSubmitting || elements.createPresentation.disabled || !state.payload) return;
        state.presentationSubmitting = true;
        elements.createPresentation.disabled = true;
        elements.createPresentation.textContent = "Creating in Zoho Show…";
        elements.presentationStatus.textContent = "Duplicating the template and inserting slides 4–7…";
        elements.presentationStatus.className = "quote-status is-loading";
        const showWindow = window.open("", "_blank");
        if (showWindow) {
            showWindow.document.title = "Creating customer presentation";
            showWindow.document.body.innerHTML = "<p style=\"font:16px Arial,sans-serif;padding:24px;color:#17324d\">Creating the customer presentation in Zoho Show&hellip;</p>";
        }
        try {
            const result = await window.MCGPresentationWorkspace.createPresentation({
                companyId: state.payload.crmAccountId,
                customerName: state.payload.customerName,
                includePrices: presentationIncludesPrices(),
                onProgress: function (message) {
                    elements.presentationStatus.textContent = message;
                    elements.presentationStatus.className = "quote-status is-loading";
                }
            });
            elements.presentationStatus.textContent = "Presentation created for " + state.payload.customerName + ". Opening Zoho Show…";
            elements.presentationStatus.className = "quote-status is-success";
            if (showWindow) showWindow.location.replace(result.showUrl);
            else window.open(result.showUrl, "_blank", "noopener");
            const priceLabel = presentationIncludesPrices() ? "With prices" : "Without prices";
            void logCreatedOutput("Presentation", "Customer presentation · " + priceLabel,
                text(result.presentationId) || text(result.showUrl), text(result.showUrl), priceLabel);
        } catch (error) {
            if (showWindow && !showWindow.closed) showWindow.close();
            const details = window.MCGPresentationWorkspace && typeof window.MCGPresentationWorkspace.errorMessage === "function"
                ? window.MCGPresentationWorkspace.errorMessage(error)
                : (error.message || String(error));
            elements.presentationStatus.textContent = "Presentation creation failed: " + details;
            elements.presentationStatus.className = "quote-status is-error";
        } finally {
            state.presentationSubmitting = false;
            elements.createPresentation.textContent = "Create & Open in Zoho Show";
            elements.createPresentation.disabled = !state.presentationWorkspaceStatus ||
                !state.presentationWorkspaceStatus.ready ||
                (presentationIncludesPrices() && !state.presentationWorkspaceStatus.withPricesReady);
        }
    }

    async function readTransfer() {
        if (window.__QUOTE_FINALISATION_TEST_PAYLOAD__) {
            return normaliseTransfer(window.__QUOTE_FINALISATION_TEST_PAYLOAD__);
        }

        try {
            if (
                window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL &&
                typeof ZOHO.CREATOR.UTIL.getQueryParams === "function"
            ) {
                const queryParams = await ZOHO.CREATOR.UTIL.getQueryParams();
                const encodedPayload = findQueryParameter(queryParams, QUOTE_QUERY_PARAM, 0);
                const payload = normaliseTransfer(await decodeTransferValue(encodedPayload));
                if (payload) {
                    const created = Date.parse(payload.createdAt);
                    if (Number.isFinite(created) && Date.now() - created > TRANSFER_MAX_AGE_MS) return null;
                    return payload;
                }
            }
        } catch (error) {
            // Continue through browser-visible page locations below.
        }

        const outerPayload = normaliseTransfer(await decodeTransferValue(readBrowserPageParameter(QUOTE_QUERY_PARAM)));
        if (outerPayload) {
            const created = Date.parse(outerPayload.createdAt);
            if (!Number.isFinite(created) || Date.now() - created <= TRANSFER_MAX_AGE_MS) return outerPayload;
        }
        if (window.MCGQuoteWorkspace) {
            const session = window.MCGQuoteWorkspace.current();
            if (session) {
                return normalisePayload({
                    version: 2,
                    createdAt: session.updatedAt,
                    customerName: session.customerName,
                    crmAccountId: session.crmAccountId,
                    selectedPhase: session.selectedPhase,
                    navigationMode: session.navigationMode,
                    sourceRoute: session.quoteSource || (Array.isArray(session.proposals) && session.proposals.length ? "proposal" : "existing"),
                    selections: session.quoteSource === "existing" ? [] : session.proposals || [],
                    existingPackage: session.quoteSource === "proposal" ? null : session.existingPackage || null
                });
            }
        }
        return null;
    }

    function phases() {
        return Array.from(new Set(state.payload.selections.map(function (row) { return row.phase; })))
            .sort(function (left, right) { return left - right; });
    }

    function selectionsForPhase(phase) {
        return state.payload.selections.filter(function (row) {
            return String(row.phase) === String(phase);
        });
    }

    function lineKey(selection, type) {
        return [selection.phase, selection.order, selection.itemId, selection.service, type].join("|");
    }

    function lineFor(selection, type) {
        const key = lineKey(selection, type);
        if (state.lineEdits.has(key)) return state.lineEdits.get(key);
        const isSetup = type === "Setup";
        const line = {
            key: key,
            type: type,
            service: selection.service,
            description: isSetup ? "Setup — " + selection.businessName : selection.businessName,
            itemId: isSetup ? selection.setupItemId : selection.itemId,
            sku: isSetup ? "" : selection.sku,
            quantity: isSetup ? 1 : selection.quantity,
            rate: isSetup ? selection.setupRate : selection.monthlyRate
        };
        state.lineEdits.set(key, line);
        return line;
    }

    function linesForPhase(phase) {
        const lines = [];
        selectionsForPhase(phase).forEach(function (selection) {
            lines.push(lineFor(selection, "Service"));
            lines.push(lineFor(selection, "Setup"));
        });
        return lines;
    }

    function lineTotal(line) {
        const quantity = numericOrNull(line.quantity);
        const rate = numericOrNull(line.rate);
        return quantity !== null && quantity > 0 && rate !== null && rate >= 0 ? quantity * rate : null;
    }

    function totalsForPhase(phase) {
        let monthly = 0;
        let setup = 0;
        let monthlyTbc = false;
        let setupTbc = false;
        linesForPhase(phase).forEach(function (line) {
            const total = lineTotal(line);
            if (line.type === "Setup") {
                if (total === null) setupTbc = true;
                else setup += total;
            } else if (total === null) monthlyTbc = true;
            else monthly += total;
        });
        return { monthly: monthly, setup: setup, monthlyTbc: monthlyTbc, setupTbc: setupTbc };
    }

    function defaultReference(phase) {
        const services = selectionsForPhase(phase).map(function (row) { return row.service; });
        if (!services.length) return "Phase " + phase;
        const summary = services.length > 2
            ? services.slice(0, 2).join(", ") + " + " + (services.length - 2) + " more"
            : services.join(", ");
        return "Phase " + phase + " - " + summary;
    }

    function appendCell(row, content, className) {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        if (content && typeof content === "object") cell.appendChild(content);
        else cell.textContent = content;
        row.appendChild(cell);
        return cell;
    }

    function phaseReference(phase) {
        const key = String(phase);
        if (!state.references.has(key)) state.references.set(key, defaultReference(phase));
        return state.references.get(key);
    }

    function setPhaseStatus(view, message, mode) {
        view.status.textContent = message;
        view.status.className = "quote-status" + (mode ? " " + mode : "");
    }

    function setBulkStatus(message, mode) {
        elements.bulkStatus.textContent = message;
        elements.bulkStatus.className = "quote-status" + (mode ? " " + mode : "");
    }

    function createNumberInput(line, property, options, phase) {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "cell-input";
        input.min = options.min;
        input.step = options.step;
        input.placeholder = options.placeholder;
        input.value = numericOrNull(line[property]) === null ? "" : String(line[property]);
        input.readOnly = Boolean(options.readOnly);
        input.setAttribute("aria-label", options.label + " for " + line.description);
        if (!input.readOnly) {
            input.addEventListener("input", function () {
                line[property] = numericOrNull(input.value);
                const totalCell = input._totalCell;
                if (totalCell) {
                    const total = lineTotal(line);
                    totalCell.textContent = total === null ? "TBC" : money(total);
                    totalCell.className = total === null ? "money-cell tbc" : "money-cell";
                }
                state.phaseErrors.delete(String(phase));
                updatePhaseView(phase);
                updateCombinedStatus();
                saveQuoteWorkspace();
            });
        }
        return input;
    }

    function renderLines(phase, body) {
        body.replaceChildren();
        const lines = linesForPhase(phase);
        lines.forEach(function (line) {
            const row = document.createElement("tr");
            const type = document.createElement("span");
            type.className = "line-type " + (line.type === "Setup" ? "is-setup" : "is-service");
            type.textContent = line.type;
            appendCell(row, type);

            const description = document.createElement("div");
            description.className = "description-cell";
            const descriptionName = document.createElement("strong");
            descriptionName.textContent = line.description;
            const serviceName = document.createElement("small");
            serviceName.textContent = line.type === "Setup" ? "Automatic setup item · quantity fixed at 1" : line.service;
            description.append(descriptionName, serviceName);
            appendCell(row, description);

            const itemWrap = document.createElement("div");
            itemWrap.className = "item-map-control";
            const itemInput = document.createElement("input");
            itemInput.type = "text";
            itemInput.className = "cell-input mono";
            itemInput.value = line.itemId;
            itemInput.placeholder = "Books Item ID";
            itemInput.addEventListener("input", function () {
                line.itemId = text(itemInput.value);
                state.phaseErrors.delete(String(phase));
                updatePhaseView(phase);
                saveQuoteWorkspace();
            });
            itemWrap.append(itemInput);
            appendCell(row, itemWrap);
            const rateInput = createNumberInput(line, "rate", {
                min: "0", step: "0.01", placeholder: "TBC", label: "Unit price", readOnly: false
            }, phase);
            appendCell(row, rateInput);
            const quantityInput = createNumberInput(line, "quantity", {
                min: line.type === "Setup" ? "1" : "0.01",
                step: line.type === "Setup" ? "1" : "any",
                placeholder: "TBC",
                label: "Quantity",
                readOnly: line.type === "Setup"
            }, phase);
            appendCell(row, quantityInput);

            const total = lineTotal(line);
            const totalCell = appendCell(row, total === null ? "TBC" : money(total), total === null ? "money-cell tbc" : "money-cell");
            rateInput._totalCell = totalCell;
            quantityInput._totalCell = totalCell;
            body.appendChild(row);
        });
    }

    function quoteIssuesForPhase(phase) {
        phase = phase || state.selectedPhase || phases()[0];
        const issues = [];
        if (!state.customerId) issues.push(state.customerLookupError || "Zoho Books Customer ID is not resolved");
        if (!text(phaseReference(phase))) issues.push("Reference number is blank");
        linesForPhase(phase).forEach(function (line) {
            if (!line.itemId) issues.push(line.description + ": Books Item ID is missing");
            const quantity = numericOrNull(line.quantity);
            const rate = numericOrNull(line.rate);
            if (quantity === null || quantity <= 0) issues.push(line.description + ": quantity is TBC");
            if (rate === null || rate < 0) issues.push(line.description + ": unit price is TBC");
        });
        return issues;
    }

    function updatePhaseView(phase) {
        const key = String(phase);
        const view = state.phaseViews.get(key);
        if (!view) return;
        const lines = linesForPhase(phase);
        const totals = totalsForPhase(phase);
        view.lineCount.textContent = String(lines.length);
        view.monthlyTotal.textContent = totals.monthlyTbc ? "TBC" : money(totals.monthly);
        view.setupTotal.textContent = totals.setupTbc ? "TBC" : money(totals.setup);

        if (state.resolvingCustomer) {
            view.create.disabled = true;
            setPhaseStatus(view, "Resolving the Zoho Books customer…", "is-loading");
        } else if (state.submittingPhases.has(key)) {
            view.create.disabled = true;
            setPhaseStatus(view, "Creating the Phase " + phase + " draft in Zoho Books…", "is-loading");
        } else if (state.createdQuotes.has(key)) {
            const created = state.createdQuotes.get(key);
            view.create.disabled = true;
            view.create.textContent = "Draft Quote Created";
            setPhaseStatus(view, created.message || "Draft quote created successfully.", "is-success");
            if (created.url) {
                view.openLink.href = created.url;
                view.openLink.hidden = false;
            }
        } else if (state.phaseErrors.has(key)) {
            view.create.disabled = Boolean(quoteIssuesForPhase(phase).length);
            setPhaseStatus(view, state.phaseErrors.get(key), "is-error");
        } else {
            const issues = quoteIssuesForPhase(phase);
            view.create.disabled = Boolean(issues.length);
            view.create.textContent = "Create Phase " + phase + " Draft Quote";
            view.openLink.hidden = true;
            if (issues.length) {
                const shown = issues.slice(0, 3).join("; ");
                const extra = issues.length > 3 ? "; plus " + (issues.length - 3) + " more" : "";
                setPhaseStatus(view, "Complete before creating this draft: " + shown + extra + ".", "is-error");
            } else {
                setPhaseStatus(view, "Phase " + phase + " is ready to create as a Zoho Books draft quote.", "is-ready");
            }
        }
        updateBulkStatus();
    }

    function updateAllPhaseViews() {
        phases().forEach(updatePhaseView);
    }

    function updateBulkStatus() {
        const availablePhases = phases();
        const createdCount = availablePhases.filter(function (phase) {
            return state.createdQuotes.has(String(phase));
        }).length;
        const issueCount = availablePhases.filter(function (phase) {
            return !state.createdQuotes.has(String(phase)) && quoteIssuesForPhase(phase).length;
        }).length;
        const remaining = availablePhases.length - createdCount;

        if (state.resolvingCustomer) {
            elements.createAll.disabled = true;
            setBulkStatus("Resolving the Zoho Books customer before checking all phases…", "is-loading");
        } else if (state.bulkSubmitting) {
            elements.createAll.disabled = true;
            setBulkStatus("Creating the remaining phase drafts one at a time…", "is-loading");
        } else if (!remaining) {
            elements.createAll.disabled = true;
            elements.createAll.textContent = "All Draft Quotes Created";
            setBulkStatus(availablePhases.length + (availablePhases.length === 1 ? " draft quote created successfully." : " draft quotes created successfully."), "is-success");
        } else if (issueCount) {
            elements.createAll.disabled = true;
            elements.createAll.textContent = createdCount ? "Create Remaining Draft Quotes" : "Create All Draft Quotes";
            setBulkStatus(issueCount + (issueCount === 1 ? " phase needs" : " phases need") + " missing quote details completed first.", "is-error");
        } else {
            elements.createAll.disabled = false;
            elements.createAll.textContent = createdCount ? "Create Remaining Draft Quotes" : "Create All Draft Quotes";
            setBulkStatus(
                (createdCount ? createdCount + " already created. " : "") +
                remaining + (remaining === 1 ? " phase is" : " phases are") + " ready to create.",
                "is-ready"
            );
        }
    }

    function createSummaryCard(label, valueClass, note, accentClass) {
        const card = document.createElement("article");
        card.className = "summary-card " + accentClass;
        const labelNode = document.createElement("span");
        labelNode.textContent = label;
        const value = document.createElement("strong");
        value.className = valueClass;
        value.textContent = "0";
        const noteNode = document.createElement("small");
        noteNode.textContent = note;
        card.append(labelNode, value, noteNode);
        return { card: card, value: value };
    }

    function createPhaseCard(phase) {
        const key = String(phase);
        const card = document.createElement("article");
        card.className = "phase-card";

        const heading = document.createElement("div");
        heading.className = "phase-card-heading";
        const headingCopy = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = "Phase " + phase;
        const subtitle = document.createElement("p");
        subtitle.textContent = selectionsForPhase(phase).length +
            (selectionsForPhase(phase).length === 1 ? " selected service" : " selected services");
        headingCopy.append(title, subtitle);
        const badge = document.createElement("span");
        badge.className = "phase-badge";
        badge.textContent = "Draft quote";
        heading.append(headingCopy, badge);

        const referenceField = document.createElement("label");
        referenceField.className = "field phase-reference-field";
        const referenceLabel = document.createElement("span");
        referenceLabel.textContent = "Reference no.";
        const reference = document.createElement("input");
        reference.type = "text";
        reference.maxLength = 100;
        reference.value = phaseReference(phase);
        reference.addEventListener("input", function () {
            state.references.set(key, reference.value);
            state.phaseErrors.delete(key);
            updatePhaseView(phase);
        });
        referenceField.append(referenceLabel, reference);

        const summaries = document.createElement("div");
        summaries.className = "summary-grid phase-summary-grid";
        const lineSummary = createSummaryCard("Books line items", "", "Service and setup lines", "accent-blue");
        const monthlySummary = createSummaryCard("Monthly total", "", "Selected phase services", "accent-teal");
        const setupSummary = createSummaryCard("Setup total", "", "One setup line per service", "accent-gold");
        summaries.append(lineSummary.card, monthlySummary.card, setupSummary.card);

        const tableScroll = document.createElement("div");
        tableScroll.className = "table-scroll";
        const table = document.createElement("table");
        table.className = "quote-table";
        table.innerHTML = "<thead><tr><th>Type</th><th>Description</th><th>Item ID</th><th>Unit price</th><th>Quantity</th><th>Total</th></tr></thead>";
        const body = document.createElement("tbody");
        table.appendChild(body);
        tableScroll.appendChild(table);

        const action = document.createElement("div");
        action.className = "phase-action";
        const actionCopy = document.createElement("div");
        const status = document.createElement("p");
        status.className = "quote-status";
        status.setAttribute("aria-live", "polite");
        const openLink = document.createElement("a");
        openLink.href = "#";
        openLink.target = "_blank";
        openLink.rel = "noopener";
        openLink.hidden = true;
        openLink.textContent = "Open Phase " + phase + " in Zoho Books";
        actionCopy.append(status, openLink);
        const create = document.createElement("button");
        create.type = "button";
        create.className = "primary-button phase-create-button";
        create.textContent = "Create Phase " + phase + " Draft Quote";
        create.addEventListener("click", function () {
            createDraftQuoteForPhase(phase, true).catch(function () { /* Status is shown in the phase card. */ });
        });
        action.append(actionCopy, create);

        card.append(heading, referenceField, summaries, tableScroll, action);
        state.phaseViews.set(key, {
            lineCount: lineSummary.value,
            monthlyTotal: monthlySummary.value,
            setupTotal: setupSummary.value,
            status: status,
            create: create,
            openLink: openLink
        });
        renderLines(phase, body);
        updatePhaseView(phase);
        return card;
    }

    function renderAllPhases() {
        elements.phaseList.replaceChildren();
        state.phaseViews.clear();
        phases().forEach(function (phase) {
            elements.phaseList.appendChild(createPhaseCard(phase));
        });
        updateBulkStatus();
    }

    function findApiPayload(value, depth) {
        if (depth > 7) return null;
        const parsed = parseJson(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        if (
            Object.prototype.hasOwnProperty.call(parsed, "customerId") ||
            Object.prototype.hasOwnProperty.call(parsed, "estimateId") ||
            Object.prototype.hasOwnProperty.call(parsed, "editUrl")
        ) return parsed;
        for (const child of Object.values(parsed)) {
            const match = findApiPayload(child, depth + 1);
            if (match) return match;
        }
        if (Object.prototype.hasOwnProperty.call(parsed, "status") && Object.prototype.hasOwnProperty.call(parsed, "message")) {
            return parsed;
        }
        return null;
    }

    function invokeQuoteApi(request) {
        const config = {
            api_name: CREATE_QUOTE_API_NAME,
            http_method: "POST",
            content_type: "application/json",
            payload: { request_data: JSON.stringify(request) }
        };
        if (window.__QUOTE_FINALISATION_API_TEST_HANDLER__) {
            return Promise.resolve(window.__QUOTE_FINALISATION_API_TEST_HANDLER__(config));
        }
        if (window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.DATA) {
            return Promise.resolve(ZOHO.CREATOR.DATA.invokeCustomApi(config));
        }
        return Promise.reject(new Error("Creator Custom API is unavailable."));
    }

    function normaliseExistingPackage(existingPackage) {
        const source = existingPackage && typeof existingPackage === "object" ? existingPackage : {};
        return {
            version: 2,
            lines: Array.isArray(source.lines) ? source.lines.map(function (line) {
                const normalised = Object.assign({}, line);
                if (isEdrService(normalised.service, normalised.businessName || normalised.description)) {
                    normalised.itemId = BOOKS_EDR_ITEM_ID;
                }
                return normalised;
            }) : [],
            hardware: Array.isArray(source.hardware) ? source.hardware.map(function (line) { return Object.assign({}, line); }) : [],
            delivery: Object.assign({ source: "delivery", included: false, service: "Delivery", description: "Delivery", itemId: "", sku: "", quantity: 1, rate: 29 }, source.delivery || {}),
            discount: Object.assign({ mode: "amount", value: 0 }, source.discount || {})
        };
    }

    function existingServiceLines() {
        const existingPackage = state.existingPackage || normaliseExistingPackage(null);
        return existingPackage.lines.filter(function (line) { return line.included !== false; });
    }

    function existingHardwareLines() {
        const existingPackage = state.existingPackage || normaliseExistingPackage(null);
        return existingPackage.hardware.filter(function (line) { return line.included !== false; });
    }

    function existingDeliveryLines() {
        const existingPackage = state.existingPackage || normaliseExistingPackage(null);
        return existingPackage.delivery && existingPackage.delivery.included === true ? [existingPackage.delivery] : [];
    }

    function existingPackageLines() {
        return existingHardwareLines().concat(existingServiceLines(), existingDeliveryLines());
    }

    function quoteLineDescription(line) {
        if (line && line.source === "hardware") return text(line.service || line.name || line.description);
        return text(line && (line.description || line.service));
    }

    function booksLineDescription(line) {
        if (line && line.source === "hardware") return text(line.description || line.service || line.name);
        return text(line && (line.description || line.service));
    }

    function requestLine(line) {
        return {
            type: text(line.type || line.source || "Service"), service: text(line.service || line.description),
            description: booksLineDescription(line), itemId: text(line.itemId), sku: text(line.sku),
            quantity: numericOrNull(line.quantity), rate: numericOrNull(line.rate)
        };
    }

    function totalLines(lines) {
        let total = 0; let tbc = false;
        lines.forEach(function (line) {
            const quantity = numericOrNull(line.quantity); const rate = numericOrNull(line.rate);
            if (quantity === null || rate === null) tbc = true; else total += quantity * rate;
        });
        return { total: total, tbc: tbc };
    }

    function packageDiscountAmount(subtotal) {
        const discount = state.existingPackage && state.existingPackage.discount || { mode: "amount", value: 0 };
        const value = Math.max(0, numericOrNull(discount.value) || 0);
        return discount.mode === "percent" ? subtotal * Math.min(100, value) / 100 : Math.min(subtotal, value);
    }

    function lineIssues(lines) {
        const issues = [];
        lines.forEach(function (line) {
            const label = quoteLineDescription(line) || "Quote line";
            if (!text(line.itemId)) issues.push(label + ": Books Item ID is missing");
            if (numericOrNull(line.quantity) === null || Number(line.quantity) <= 0) issues.push(label + ": quantity is TBC");
            if (numericOrNull(line.rate) === null || Number(line.rate) < 0) issues.push(label + ": unit price is TBC");
        });
        return issues;
    }

    function existingPackageIssues() {
        const issues = [];
        if (!state.customerId) issues.push(state.customerLookupError || "Zoho Books Customer ID is not resolved");
        const lines = existingPackageLines();
        if (!lines.length) issues.push("No existing-services package lines are included");
        issues.push.apply(issues, lineIssues(lines));
        const discount = state.existingPackage && state.existingPackage.discount;
        if (discount && discount.mode === "percent" && numberOrZero(discount.value) > 100) issues.push("Percentage discount cannot exceed 100%");
        return issues;
    }

    function numberOrZero(value) { const parsed = numericOrNull(value); return parsed === null ? 0 : parsed; }

    function createPackageSummaryCard(label, value, note, accent) {
        const card = document.createElement("article"); card.className = "summary-card " + accent;
        const labelNode = document.createElement("span"); labelNode.textContent = label;
        const valueNode = document.createElement("strong"); valueNode.textContent = value;
        const noteNode = document.createElement("small"); noteNode.textContent = note;
        card.append(labelNode, valueNode, noteNode); return card;
    }

    function packageLineSource(line) {
        if (line.source === "hardware") return "Hardware";
        if (line.source === "delivery") return "Delivery";
        return "Existing service";
    }

    function editablePackageCell(line, property, type, onChange) {
        const input = document.createElement("input"); input.type = type || "text"; input.className = "cell-input";
        if (type === "number") { input.min = property === "quantity" ? "0.01" : "0"; input.step = "any"; }
        input.value = line[property] === null || line[property] === undefined ? "" : String(line[property]);
        input.addEventListener("input", function () { line[property] = type === "number" ? numericOrNull(input.value) : text(input.value); onChange(); });
        return input;
    }

    function renderExistingPackage() {
        elements.existingBody.replaceChildren(); elements.existingSummary.replaceChildren();
        const lines = existingPackageLines(); const totals = totalLines(lines); const discount = packageDiscountAmount(totals.total); const grandTotal = Math.max(0, totals.total - discount);
        const existingCount = (state.existingPackage.lines || []).filter(function (line) { return line.included !== false; }).length;
        const hardwareCount = (state.existingPackage.hardware || []).filter(function (line) { return line.included !== false; }).length;
        elements.existingSummary.append(
            createPackageSummaryCard("Checked services", String(existingCount), "Current recurring lines", "accent-blue"),
            createPackageSummaryCard("Hardware", String(hardwareCount), "Books items added", "accent-teal"),
            createPackageSummaryCard("Discount", "−" + money(discount), state.existingPackage.discount.mode === "percent" ? numberOrZero(state.existingPackage.discount.value) + "%" : "Dollar amount", "accent-gold"),
            createPackageSummaryCard("Package total", totals.tbc ? "TBC" : money(grandTotal), "Before tax", "accent-blue")
        );
        if (!lines.length) {
            const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 6; cell.className = "table-empty"; cell.textContent = "No existing-services package was transferred."; row.appendChild(cell); elements.existingBody.appendChild(row);
        }
        lines.forEach(function (line) {
            const row = document.createElement("tr"); appendCell(row, packageLineSource(line)); appendCell(row, quoteLineDescription(line), "description-cell");
            const itemWrap = document.createElement("div"); itemWrap.className = "item-map-control";
            const itemInput = editablePackageCell(line, "itemId", "text", updatePackageViews); itemInput.classList.add("mono"); itemInput.placeholder = "Books Item ID";
            itemWrap.append(itemInput); appendCell(row, itemWrap);
            appendCell(row, editablePackageCell(line, "rate", "number", updatePackageViews)); appendCell(row, editablePackageCell(line, "quantity", "number", updatePackageViews));
            appendCell(row, numericOrNull(line.quantity) !== null && numericOrNull(line.rate) !== null ? money(Number(line.quantity) * Number(line.rate)) : "TBC", "money-cell");
            elements.existingBody.appendChild(row);
        });
        updateExistingStatus();
    }

    function updateExistingStatus() {
        const issues = existingPackageIssues();
        elements.createExisting.disabled = Boolean(issues.length) || state.existingSubmitting || Boolean(state.existingCreated);
        if (state.existingCreated) {
            elements.createExisting.textContent = "Draft Quote Created"; elements.existingStatus.textContent = state.existingCreated.message; elements.existingStatus.className = "quote-status is-success";
            if (state.existingCreated.url) { elements.openExisting.href = state.existingCreated.url; elements.openExisting.hidden = false; }
        } else if (state.existingSubmitting) {
            elements.existingStatus.textContent = "Creating the existing-services draft…"; elements.existingStatus.className = "quote-status is-loading";
        } else if (issues.length) {
            elements.existingStatus.textContent = "Complete before creating: " + issues.slice(0, 3).join("; ") + (issues.length > 3 ? "; plus " + (issues.length - 3) + " more" : "") + "."; elements.existingStatus.className = "quote-status is-error";
        } else {
            elements.createExisting.textContent = "Create Draft Quote"; elements.existingStatus.textContent = "Ready to create a separate Zoho Books draft quote."; elements.existingStatus.className = "quote-status is-ready";
        }
        updateCombinedStatus();
    }

    function invalidateChangedPackageDrafts() {
        if (state.existingCreated && state.existingCreated.fingerprint !== quoteFingerprint(existingQuoteRequest())) {
            state.existingCreated = null;
            elements.openExisting.hidden = true;
        }
        if (state.combinedCreated && state.combinedCreated.fingerprint !== quoteFingerprint(combinedQuoteRequest())) {
            state.combinedCreated = null;
            elements.openCombined.hidden = true;
        }
    }

    function updatePackageViews() { invalidateChangedPackageDrafts(); renderExistingPackage(); saveQuoteWorkspace(); }

    function discountRequestFields(request) {
        const discount = state.existingPackage && state.existingPackage.discount || { mode: "amount", value: 0 };
        request.discountMode = discount.mode === "percent" ? "percent" : "amount";
        request.discountValue = numberOrZero(discount.value);
        return request;
    }

    function existingQuoteRequest() {
        return discountRequestFields({
            quoteMode: "existing", quoteLabel: "Existing services", customerName: state.payload.customerName,
            crmAccountId: state.payload.crmAccountId, referenceNumber: "Existing services - " + state.payload.customerName,
            salespersonName: text(elements.salesperson.value), lineItems: existingPackageLines().map(requestLine)
        });
    }

    function combinedProposalLines() {
        const lines = [];
        phases().forEach(function (phase) {
            if (!state.selectedCombinedPhases.has(String(phase))) return;
            linesForPhase(phase).forEach(function (line) { lines.push(line); });
        });
        return lines;
    }

    function combinedLines() {
        return existingHardwareLines().concat(existingServiceLines(), combinedProposalLines(), existingDeliveryLines());
    }

    function combinedIssues() {
        const issues = [];
        if (!state.customerId) issues.push(state.customerLookupError || "Zoho Books Customer ID is not resolved");
        if (!state.selectedCombinedPhases.size && !existingPackageLines().length) issues.push("Select at least one proposal phase or include an existing-package line");
        if (!text(elements.combinedReference.value)) issues.push("Combined reference number is blank");
        issues.push.apply(issues, lineIssues(combinedLines()));
        const discount = state.existingPackage && state.existingPackage.discount;
        if (discount && discount.mode === "percent" && numberOrZero(discount.value) > 100) issues.push("Percentage discount cannot exceed 100%");
        return issues;
    }

    function combinedQuoteRequest() {
        return discountRequestFields({
            quoteMode: "combined", quoteLabel: "Combined quote", customerName: state.payload.customerName,
            crmAccountId: state.payload.crmAccountId, referenceNumber: text(elements.combinedReference.value),
            salespersonName: text(elements.salesperson.value), lineItems: combinedLines().map(requestLine),
            phases: Array.from(state.selectedCombinedPhases).map(Number).sort(function (a, b) { return a - b; })
        });
    }

    function renderCombinedPhaseOptions() {
        elements.combinedPhaseOptions.replaceChildren();
        phases().forEach(function (phase) {
            const label = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = state.selectedCombinedPhases.has(String(phase));
            checkbox.addEventListener("change", function () { if (checkbox.checked) state.selectedCombinedPhases.add(String(phase)); else state.selectedCombinedPhases.delete(String(phase)); updateCombinedStatus(); saveQuoteWorkspace(); });
            const copy = document.createElement("span"); copy.innerHTML = "<strong>Phase " + phase + "</strong><small>" + linesForPhase(phase).length + " Books line items</small>"; label.append(checkbox, copy); elements.combinedPhaseOptions.appendChild(label);
        });
    }

    function updateCombinedStatus() {
        if (!elements.combinedStatus) return;
        const issues = combinedIssues();
        elements.createCombined.disabled = Boolean(issues.length) || state.combinedSubmitting || Boolean(state.combinedCreated);
        if (state.combinedCreated) {
            elements.createCombined.textContent = "Draft Quote Created"; elements.combinedStatus.textContent = state.combinedCreated.message; elements.combinedStatus.className = "quote-status is-success";
            if (state.combinedCreated.url) { elements.openCombined.href = state.combinedCreated.url; elements.openCombined.hidden = false; }
        } else if (state.combinedSubmitting) {
            elements.combinedStatus.textContent = "Creating one combined Zoho Books draft…"; elements.combinedStatus.className = "quote-status is-loading";
        } else if (issues.length) {
            elements.combinedStatus.textContent = "Complete before creating: " + issues.slice(0, 3).join("; ") + (issues.length > 3 ? "; plus " + (issues.length - 3) + " more" : "") + "."; elements.combinedStatus.className = "quote-status is-error";
        } else {
            const totals = totalLines(combinedLines()); const discount = packageDiscountAmount(totals.total);
            elements.createCombined.textContent = "Create Combined Draft Quote"; elements.combinedStatus.textContent = combinedLines().length + " line items · total " + (totals.tbc ? "TBC" : money(Math.max(0, totals.total - discount))) + "."; elements.combinedStatus.className = "quote-status is-ready";
        }
    }

    function switchMode(mode) {
        state.mode = mode === "combined" ? "combined" : "separate";
        elements.separatePhasesPanel.hidden = state.mode !== "separate";
        elements.separateBulkPanel.hidden = state.mode !== "separate";
        elements.combinedPanel.hidden = state.mode !== "combined";
        elements.existingPanel.classList.toggle("combined-context", state.mode === "combined");
        saveQuoteWorkspace();
    }

    async function createExistingDraft() {
        if (existingPackageIssues().length || state.existingSubmitting || state.existingCreated) return;
        const booksTab = reserveBooksTab();
        state.existingSubmitting = true; updateExistingStatus();
        try {
            const request = existingQuoteRequest();
            const fingerprint = quoteFingerprint(request);
            const result = findApiPayload(await invokeQuoteApi(request), 0);
            if (!result || text(result.status).toLowerCase() !== "success") throw new Error(result && result.message ? result.message : "The quote API did not return success.");
            const number = text(result.estimateNumber);
            state.existingCreated = { message: draftCreatedMessage(number), url: text(result.editUrl || result.viewUrl), estimateId: text(result.estimateId), estimateNumber: number, fingerprint: fingerprint };
            if (state.existingCreated.url) openBooksQuote(state.existingCreated.url, booksTab);
            else closeReservedTab(booksTab);
            void logCreatedOutput("Quote", "Existing services" + (number ? " · Draft #" + number : ""), state.existingCreated.estimateId || state.existingCreated.url, state.existingCreated.url, number ? "Draft #" + number : "");
        } catch (error) { closeReservedTab(booksTab); elements.existingStatus.textContent = "Existing-services quote creation failed: " + (error.message || String(error)); elements.existingStatus.className = "quote-status is-error"; }
        finally { state.existingSubmitting = false; updateExistingStatus(); saveQuoteWorkspace(); }
    }

    async function createCombinedDraft() {
        if (combinedIssues().length || state.combinedSubmitting || state.combinedCreated) return;
        const booksTab = reserveBooksTab();
        state.combinedSubmitting = true; updateCombinedStatus();
        try {
            const request = combinedQuoteRequest();
            const fingerprint = quoteFingerprint(request);
            const result = findApiPayload(await invokeQuoteApi(request), 0);
            if (!result || text(result.status).toLowerCase() !== "success") throw new Error(result && result.message ? result.message : "The quote API did not return success.");
            const number = text(result.estimateNumber);
            state.combinedCreated = { message: draftCreatedMessage(number), url: text(result.editUrl || result.viewUrl), estimateId: text(result.estimateId), estimateNumber: number, fingerprint: fingerprint };
            if (state.combinedCreated.url) openBooksQuote(state.combinedCreated.url, booksTab);
            else closeReservedTab(booksTab);
            void logCreatedOutput("Quote", "Combined proposal" + (number ? " · Draft #" + number : ""), state.combinedCreated.estimateId || state.combinedCreated.url, state.combinedCreated.url, number ? "Draft #" + number : "");
        } catch (error) { closeReservedTab(booksTab); elements.combinedStatus.textContent = "Combined quote creation failed: " + (error.message || String(error)); elements.combinedStatus.className = "quote-status is-error"; }
        finally { state.combinedSubmitting = false; updateCombinedStatus(); saveQuoteWorkspace(); }
    }

    function openItemMapping(line, phase, input) {
        state.mappingTarget = { line: line, phase: phase, input: input };
        elements.mappingPanel.hidden = false; elements.mappingTitle.textContent = "Map Books item for " + quoteLineDescription(line);
        elements.mappingSearch.value = text(line.sku) || text(line.service || line.description); elements.mappingResults.replaceChildren(); elements.mappingStatus.textContent = "Search by name, SKU or Item ID."; elements.mappingSearch.focus();
    }

    function renderMappingResults() {
        elements.mappingResults.replaceChildren();
        state.mappingResults.forEach(function (item) {
            const card = document.createElement("div"); card.className = "mapping-result"; const copy = document.createElement("div");
            const name = document.createElement("strong"); name.textContent = item.name; const meta = document.createElement("small"); meta.textContent = (item.sku ? "SKU " + item.sku + " · " : "") + money(item.rate) + " · " + item.itemId; copy.append(name, meta);
            const choose = document.createElement("button"); choose.type = "button"; choose.className = "small-button"; choose.textContent = "Use this item";
            choose.addEventListener("click", function () {
                if (!state.mappingTarget) return; const target = state.mappingTarget; target.line.itemId = item.itemId; target.line.sku = item.sku;
                if (target.input) target.input.value = item.itemId;
                elements.mappingPanel.hidden = true; state.mappingTarget = null;
                if (target.phase === "existing") renderExistingPackage(); else { state.phaseErrors.delete(String(target.phase)); renderAllPhases(); }
                saveQuoteWorkspace();
            });
            card.append(copy, choose); elements.mappingResults.appendChild(card);
        });
    }

    async function searchMappingItems() {
        const query = text(elements.mappingSearch.value); if (query.length < 2) { elements.mappingStatus.textContent = "Enter at least 2 characters."; return; }
        elements.mappingSearchButton.disabled = true; elements.mappingStatus.textContent = "Searching Zoho Books…";
        try {
            const result = findApiPayload(await invokeQuoteApi({ action: "searchItems", query: query }), 0);
            if (!result || text(result.status).toLowerCase() !== "success") throw new Error(result && result.message ? result.message : "No valid item response returned.");
            state.mappingResults = Array.isArray(result.items) ? result.items.map(function (item) { return { itemId: text(item.itemId || item.item_id), name: text(item.name) || "Unnamed item", sku: text(item.sku), rate: numericOrNull(item.rate) }; }) : [];
            elements.mappingStatus.textContent = state.mappingResults.length ? state.mappingResults.length + " matching Books items." : "No active Books items matched."; renderMappingResults();
        } catch (error) { elements.mappingStatus.textContent = "Books item search failed: " + (error.message || String(error)); }
        finally { elements.mappingSearchButton.disabled = false; }
    }

    function saveQuoteWorkspace() {
        if (!window.MCGQuoteWorkspace || !state.payload) return null;
        const proposal = proposalPayloadForBack();
        const update = {
            crmAccountId: state.payload.crmAccountId, selectedPhase: Number(state.selectedPhase),
            navigationMode: state.navigationMode, quoteMode: state.mode,
            quoteSource: state.payload.sourceRoute,
            combinedPhases: Array.from(state.selectedCombinedPhases),
            createdQuotes: { phases: Object.fromEntries(state.createdQuotes), existing: state.existingCreated, combined: state.combinedCreated }
        };
        if (state.payload.sourceRoute !== "existing") {
            update.proposals = proposal.selections;
            update.proposalDrafts = proposal.selections;
        }
        if (state.payload.sourceRoute !== "proposal") update.existingPackage = state.existingPackage;
        return window.MCGQuoteWorkspace.save(state.payload.customerName, update);
    }

    function resolveCustomer() {
        state.resolvingCustomer = true;
        state.customerLookupError = "";
        state.customerId = "";
        elements.customerId.value = "Resolving…";
        elements.customerIdHelp.textContent = "Resolving the Zoho Books customer through the CRM Account ID.";
        elements.retryCustomer.hidden = true;
        updateAllPhaseViews();

        return invokeQuoteApi({
            lookupOnly: true,
            customerName: state.payload.customerName,
            crmAccountId: state.payload.crmAccountId
        }).then(function (response) {
            const result = findApiPayload(response, 0);
            if (!result || text(result.status).toLowerCase() !== "success" || !text(result.customerId)) {
                throw new Error(result && result.message ? result.message : "The customer lookup did not return a Customer ID.");
            }
            state.customerId = text(result.customerId);
            elements.customerId.value = state.customerId;
            elements.customerIdHelp.textContent = state.payload.crmAccountId
                ? "Matched from CRM Account ID " + state.payload.crmAccountId + "."
                : "Matched by exact customer name because no CRM Account ID was transferred.";
        }).catch(function (error) {
            state.customerLookupError = error.message || String(error);
            elements.customerId.value = "Not resolved";
            elements.customerIdHelp.textContent = state.customerLookupError;
            elements.retryCustomer.hidden = false;
        }).finally(function () {
            state.resolvingCustomer = false;
            updateAllPhaseViews();
            updateExistingStatus();
            updateCombinedStatus();
        });
    }

    function quoteRequest(phase) {
        phase = phase || state.selectedPhase || phases()[0];
        return {
            quoteMode: "phase",
            quoteLabel: "Phase " + phase,
            customerName: state.payload.customerName,
            crmAccountId: state.payload.crmAccountId,
            phase: Number(phase),
            referenceNumber: text(phaseReference(phase)),
            salespersonName: text(elements.salesperson.value),
            lineItems: linesForPhase(phase).map(function (line) {
                return {
                    type: line.type,
                    service: line.service,
                    description: line.description,
                    itemId: line.itemId,
                    sku: line.sku,
                    quantity: numericOrNull(line.quantity),
                    rate: numericOrNull(line.rate)
                };
            })
        };
    }

    function navigate(url, target) {
        if (window.__QUOTE_FINALISATION_NAVIGATE_TEST_HANDLER__) {
            window.__QUOTE_FINALISATION_NAVIGATE_TEST_HANDLER__(url, target);
            return;
        }
        if (state.navigationMode === "embed" && target !== "new") {
            window.open(url, "_top");
            return;
        }
        if (
            window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL &&
            typeof ZOHO.CREATOR.UTIL.navigateParentURL === "function"
        ) {
            ZOHO.CREATOR.UTIL.navigateParentURL({
                action: "open",
                url: url,
                window: target === "new" ? "new" : "same"
            });
            return;
        }
        window.open(url, target === "new" ? "_blank" : "_top");
    }

    function reserveBooksTab() {
        if (window.__QUOTE_FINALISATION_NAVIGATE_TEST_HANDLER__) return null;
        let tab = null;
        try { tab = window.open("", "_blank"); }
        catch (error) { return null; }
        if (tab) {
            try {
                tab.document.title = "Creating Zoho Books draft quote";
                tab.document.body.textContent = "Creating the draft quote in Zoho Books…";
            } catch (error) { /* The tab can still be redirected. */ }
        }
        return tab;
    }

    function closeReservedTab(tab) {
        try { if (tab && !tab.closed) tab.close(); }
        catch (error) { /* The Books link remains available on the quote card. */ }
    }

    function openBooksQuote(url, tab) {
        try {
            if (tab && !tab.closed) tab.location.replace(url);
            else navigate(url, "new");
        } catch (error) { /* Browser restrictions cannot undo a successfully created quote. */ }
    }

    function draftCreatedMessage(number) {
        return "Draft quote" + (number ? " " + number : "") + " created successfully.";
    }

    function proposalPayloadForBack() {
        return {
            version: 2,
            createdAt: new Date().toISOString(),
            customerName: state.payload.customerName,
            crmAccountId: state.payload.crmAccountId,
            selectedPhase: Number(state.selectedPhase),
            navigationMode: state.navigationMode,
            existingPackage: state.existingPackage,
            selections: state.payload.selections.map(function (selection) {
                const serviceLine = lineFor(selection, "Service");
                const setupLine = lineFor(selection, "Setup");
                const quantity = numericOrNull(serviceLine.quantity);
                const monthlyRate = numericOrNull(serviceLine.rate);
                const setupRate = numericOrNull(setupLine.rate);
                return Object.assign({}, selection, {
                    quantity: quantity,
                    customPrice: monthlyRate,
                    monthlyRate: monthlyRate,
                    customSetup: setupRate,
                    setupRate: setupRate,
                    itemId: text(serviceLine.itemId),
                    setupItemId: text(setupLine.itemId),
                    sku: text(serviceLine.sku),
                    monthlyTotal: quantity !== null && quantity > 0 && monthlyRate !== null
                        ? quantity * monthlyRate
                        : null
                });
            })
        };
    }

    async function returnToProposal() {
        if (!state.payload) {
            navigate(pageUrl(MISSING_SERVICES_PAGE_LINK, "", "", state.navigationMode), "same");
            return;
        }
        saveQuoteWorkspace();
        const payload = state.payload.sourceRoute === "existing"
            ? {
                version: 2,
                createdAt: new Date().toISOString(),
                customerName: state.payload.customerName,
                crmAccountId: state.payload.crmAccountId,
                selectedPhase: null,
                navigationMode: state.navigationMode,
                sourceRoute: "existing",
                selections: [],
                existingPackage: state.existingPackage
            }
            : Object.assign(proposalPayloadForBack(), { sourceRoute: "proposal" });
        const encodedPayload = window.MCGQuoteWorkspace && typeof window.MCGQuoteWorkspace.encodeTransfer === "function"
            ? await window.MCGQuoteWorkspace.encodeTransfer(payload)
            : encodePayload(payload);
        const pageLink = state.payload.sourceRoute === "existing" ? EXISTING_SERVICES_PAGE_LINK : MISSING_SERVICES_PAGE_LINK;
        const parameter = state.payload.sourceRoute === "existing" ? WORKFLOW_QUERY_PARAM : PROPOSAL_QUERY_PARAM;
        navigate(
            pageUrl(pageLink, parameter, encodedPayload, state.navigationMode),
            "same"
        );
    }

    async function createDraftQuoteForPhase(phase, openAfterCreate, reservedTab, skipReserve) {
        const key = String(phase);
        if (quoteIssuesForPhase(phase).length || state.createdQuotes.has(key)) {
            updatePhaseView(phase);
            return state.createdQuotes.get(key) || null;
        }
        const booksTab = openAfterCreate ? (skipReserve ? reservedTab : reserveBooksTab()) : null;
        state.submittingPhases.add(key);
        state.phaseErrors.delete(key);
        updatePhaseView(phase);

        try {
            const request = quoteRequest(phase);
            const fingerprint = quoteFingerprint(request);
            const response = await invokeQuoteApi(request);
            const result = findApiPayload(response, 0);
            if (!result || text(result.status).toLowerCase() !== "success") {
                throw new Error(result && result.message ? result.message : "The quote API did not return a success response.");
            }
            if (text(result.customerId)) {
                state.customerId = text(result.customerId);
                elements.customerId.value = state.customerId;
            }
            const url = text(result.editUrl) || text(result.viewUrl);
            const created = {
                message: draftCreatedMessage(text(result.estimateNumber)),
                url: url,
                estimateId: text(result.estimateId),
                estimateNumber: text(result.estimateNumber),
                fingerprint: fingerprint
            };
            state.createdQuotes.set(key, created);
            if (url && openAfterCreate) {
                openBooksQuote(url, booksTab);
            } else {
                closeReservedTab(booksTab);
            }
            void logCreatedOutput("Quote", "Phase " + phase + (created.estimateNumber ? " · Draft #" + created.estimateNumber : ""), created.estimateId || url, url, created.estimateNumber ? "Draft #" + created.estimateNumber : "");
            return created;
        } catch (error) {
            closeReservedTab(booksTab);
            const message = "Phase " + phase + " quote creation failed: " + (error.message || String(error));
            state.phaseErrors.set(key, message);
            throw error;
        } finally {
            state.submittingPhases.delete(key);
            updatePhaseView(phase);
            updateCombinedStatus();
            saveQuoteWorkspace();
        }
    }

    async function createAllDraftQuotes() {
        const availablePhases = phases();
        const blocked = availablePhases.some(function (phase) {
            return !state.createdQuotes.has(String(phase)) && quoteIssuesForPhase(phase).length;
        });
        if (blocked || state.bulkSubmitting) {
            updateBulkStatus();
            return;
        }

        state.bulkSubmitting = true;
        updateAllPhaseViews();
        const failed = [];
        // Reserve tabs while this button click is still a user gesture. Browsers may block
        // some tabs; each phase keeps its own clickable Books link either way.
        const reservedTabs = new Map();
        availablePhases.forEach(function (phase) {
            if (!state.createdQuotes.has(String(phase))) reservedTabs.set(String(phase), reserveBooksTab());
        });
        const blockedTabs = Array.from(reservedTabs.values()).filter(function (tab) { return !tab; }).length;
        for (const phase of availablePhases) {
            if (state.createdQuotes.has(String(phase))) continue;
            try {
                await createDraftQuoteForPhase(phase, true, reservedTabs.get(String(phase)), true);
            } catch (error) {
                failed.push(phase);
            }
        }
        state.bulkSubmitting = false;
        updateAllPhaseViews();
        if (failed.length) {
            setBulkStatus(
                "Created the completed phases, but Phase " + failed.join(", Phase ") + " failed. Review the message in that phase.",
                "is-error"
            );
        } else if (blockedTabs) {
            setBulkStatus("Draft quotes created. Your browser may block some automatic tabs; use each phase's Open in Zoho Books link.", "is-success");
        }
    }

    let bannerHideTimer = null;

    function showBanner(message, mode) {
        if (bannerHideTimer) window.clearTimeout(bannerHideTimer);
        elements.banner.textContent = message;
        elements.banner.className = "connection-banner" + (mode ? " " + mode : "");
        if (mode !== "is-loading" && mode !== "is-error") {
            bannerHideTimer = window.setTimeout(function () {
                elements.banner.classList.add("is-hidden");
            }, 3000);
        }
    }

    function renderContent() {
        elements.loadingState.hidden = true;
        document.body.setAttribute("aria-busy", "false");
        elements.empty.hidden = true;
        elements.content.hidden = false;
        elements.customerName.value = state.payload.customerName;
        elements.stickyCustomerName.textContent = state.payload.customerName;
        state.selectedPhase = state.payload.selectedPhase === null ? "" : String(state.payload.selectedPhase);
        const availablePhases = phases();
        const saved = window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.get(state.payload.customerName);
        state.existingPackage = normaliseExistingPackage(state.payload.existingPackage);
        const hasExisting = existingPackageLines().length > 0;
        const hasPhases = availablePhases.length > 0;
        state.selectedCombinedPhases = new Set(
            saved && Array.isArray(saved.combinedPhases) && saved.combinedPhases.length
                ? saved.combinedPhases.map(String)
                : availablePhases.map(String)
        );
        state.mode = saved && saved.quoteMode === "combined" ? "combined" : "separate";
        if (saved && saved.createdQuotes) {
            if (saved.createdQuotes.phases) Object.entries(saved.createdQuotes.phases).forEach(function (entry) {
                const restored = matchingCreatedQuote(entry[1], quoteFingerprint(quoteRequest(entry[0])));
                if (restored) state.createdQuotes.set(entry[0], restored);
            });
            state.existingCreated = matchingCreatedQuote(saved.createdQuotes.existing, quoteFingerprint(existingQuoteRequest()));
            state.combinedCreated = matchingCreatedQuote(saved.createdQuotes.combined, quoteFingerprint(combinedQuoteRequest()));
        }
        elements.combinedReference.value = "Combined proposal - " + state.payload.customerName;
        elements.phaseCount.value = availablePhases.length
            ? availablePhases.length + (availablePhases.length === 1 ? " phase: " : " phases: ") + availablePhases.join(", ")
            : hasExisting ? "Existing-services package only" : "Presentation only";
        elements.stickyPhaseSummary.textContent = availablePhases.length
            ? availablePhases.length + (availablePhases.length === 1 ? " phase" : " phases") + " selected"
            : hasExisting ? "Existing-services package" : "Presentation only";
        showBanner(availablePhases.length
            ? availablePhases.length + (availablePhases.length === 1 ? " phase loaded for " : " phases loaded for ") + state.payload.customerName + "."
            : hasExisting ? "Existing-services package loaded for " + state.payload.customerName + "." : "Presentation workspace loaded for " + state.payload.customerName + ".", "is-success");
        renderAllPhases();
        renderExistingPackage();
        renderCombinedPhaseOptions();
        elements.modePanel.hidden = !(hasExisting && hasPhases);
        elements.existingPanel.hidden = !hasExisting;
        elements.separatePhasesPanel.hidden = !hasPhases;
        elements.separateBulkPanel.hidden = !hasPhases;
        elements.back.innerHTML = '<span aria-hidden="true">←</span> Back';
        elements.back.setAttribute("aria-label", state.payload.sourceRoute === "existing"
            ? "Back to Existing Services" : "Back to Missing Services and Proposals");
        if (hasExisting && hasPhases) switchMode(state.mode);
        else {
            state.mode = "separate";
            elements.combinedPanel.hidden = true;
        }
        elements.separateMode.checked = state.mode === "separate";
        elements.combinedMode.checked = state.mode === "combined";
        refreshPresentationStatus();
        if (hasExisting || hasPhases) resolveCustomer();
        else {
            elements.customerId.value = "Not required";
            elements.customerIdHelp.textContent = "Zoho Books customer lookup is not required for presentation creation.";
            elements.retryCustomer.hidden = true;
        }
    }

    function renderEmpty() {
        elements.loadingState.hidden = true;
        document.body.setAttribute("aria-busy", "false");
        elements.empty.hidden = false;
        elements.content.hidden = true;
        elements.banner.textContent = "";
        elements.banner.className = "connection-banner is-hidden";
    }

    elements.retryCustomer.addEventListener("click", resolveCustomer);
    elements.createAll.addEventListener("click", createAllDraftQuotes);
    elements.createExisting.addEventListener("click", createExistingDraft);
    elements.createCombined.addEventListener("click", createCombinedDraft);
    elements.createPresentation.addEventListener("click", createAndOpenPresentation);
    elements.retryCreatedWork.addEventListener("click", async function () {
        if (!window.MCGCreatedWork) return;
        elements.retryCreatedWork.disabled = true;
        createdWorkNotice("Retrying Created Work entries…", "is-saving", false);
        try {
            const result = await window.MCGCreatedWork.retryPending();
            createdWorkNotice(result.failed
                ? result.failed + " entry could not be saved yet. Retry here later."
                : "Created Work entries saved.", result.failed ? "is-error" : "", Boolean(result.failed));
        } catch (error) {
            createdWorkNotice("Could not save the entry yet. Retry here later.", "is-error", true);
        } finally { elements.retryCreatedWork.disabled = false; }
    });
    elements.presentationPrices.forEach(function (input) {
        input.addEventListener("change", function () {
            renderPresentationReadiness(state.presentationWorkspaceStatus);
        });
    });
    elements.separateMode.addEventListener("change", function () { if (elements.separateMode.checked) switchMode("separate"); });
    elements.combinedMode.addEventListener("change", function () { if (elements.combinedMode.checked) switchMode("combined"); });
    elements.combinedReference.addEventListener("input", function () { updateCombinedStatus(); saveQuoteWorkspace(); });
    elements.mappingSearchButton.addEventListener("click", searchMappingItems);
    elements.mappingSearch.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); searchMappingItems(); } });
    elements.mappingCloseButton.addEventListener("click", function () { elements.mappingPanel.hidden = true; state.mappingTarget = null; });
    elements.back.addEventListener("click", function () {
        if (window.__QUOTE_FINALISATION_BACK_TEST_HANDLER__) {
            window.__QUOTE_FINALISATION_BACK_TEST_HANDLER__();
            return;
        }
        returnToProposal();
    });

    async function initialise() {
        if (window.MCGCreatedWork && window.MCGCreatedWork.pendingCount()) {
            createdWorkNotice("A previous output still needs a Created Work entry. Retry saving it here.", "is-error", true);
        }
        clearLegacyTransferCache();
        state.payload = await readTransfer();
        if (state.payload) {
            // Runtime detection is authoritative. A transferred payload may
            // have been saved in the standalone Creator shell.
            renderContent();
        }
        else renderEmpty();
    }

    initialise().catch(function (error) {
        renderEmpty();
    });

    window.__quoteFinalisationApp = {
        normalisePayload: normalisePayload,
        linesForPhase: linesForPhase,
        quoteIssues: quoteIssuesForPhase,
        quoteRequest: quoteRequest,
        createDraftQuoteForPhase: createDraftQuoteForPhase,
        createAllDraftQuotes: createAllDraftQuotes,
        createExistingDraft: createExistingDraft,
        createCombinedDraft: createCombinedDraft,
        existingQuoteRequest: existingQuoteRequest,
        combinedQuoteRequest: combinedQuoteRequest,
        readTransferForTest: readTransfer
    };
}());
