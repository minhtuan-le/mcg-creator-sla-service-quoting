(function () {
    "use strict";

    const CUSTOM_API_NAME = "get_sla_analytics_data";
    const CREATE_CUSTOMER_API_NAME = "create_sla_customer";
    const LEGACY_PROPOSAL_TRANSFER_KEY = "mcg_sla_proposal_transfer_v1";
    const LEGACY_QUOTE_TRANSFER_KEY = "mcg_sla_quote_finalisation_transfer_v1";
    const PROPOSAL_QUERY_PARAM = "proposal_data";
    const WORKFLOW_QUERY_PARAM = "workflow_data";
    const APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/environment/development/recurring-invoice-report/";
    const CRM_APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/crm-homepage/";
    const MISSING_SERVICES_PAGE_LINK = "Missing_Services_Proposals";
    const TRANSFER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const RETRY_DELAY_MS = 4000;
    const MAX_PENDING_RETRIES = 30;
    const TABLE_COLUMN_COUNT = 16;
    const BOOKS_RECURRING_INVOICE_URL =
        "https://books.mcgcomputer.com.au/app/669587761#/recurringinvoices/";
    const BOOKS_RECURRING_INVOICE_QUERY =
        "?filter_by=Status.All&per_page=200&show_affected_list=&sort_column=created_time&sort_order=D";
    const BOOKS_EDR_ITEM_ID = "1417654000018767777";
    const NO_RECURRING_SLA_FILTER = "NO SLA | NO RECURRING INV";

    // Temporary fallback copied from the original SLA Services Tracking sheet.
    // Analytics remains the preferred source whenever it returns Unit.
    const UNIT_FALLBACKS = {
        "sla premium": "/Month per Workstation",
        "sla pro": "/Month per Workstation",
        "sla remote": "/Month per Workstation",
        "sla pro (server)": "/Month per Server",
        "kedr": "/Month per Workstation",
        "watchguard mfa": "/Month per User",
        "mdr": "/Month per Workstation",
        "avast av": "/Month per License",
        "mcafee av": "/Month per License",
        "kaseya av": "/Month per License",
        "trend micro": "/Month per License",
        "microsoft defender": "/Month per License",
        "mailguard email filter": "/Month per Mailbox",
        "inky email filtering": "/Month per Mailbox",
        "safeguard email backup": "/Month per Mailbox",
        "kaseya email backup": "/Month per Mailbox",
        "datto email backup - saas protection": "/Month per Mailbox",
        "backup microsoft office 365": "/Month per Mailbox",
        "backup microsoft office 365 acronis": "/Month per Mailbox",
        "exclaimer": "/Month per Mailbox",
        "inky email signature": "/Month per Mailbox",
        "kaseya cloud image backup": "/Month per Workstation (Max 500GB storage)",
        "acronis backup": "/Month per Workstation (Max 500GB storage)",
        "dropbox": "/Month (5TB Storage)",
        "sharepoint backup": "/Month (Max 10 users + $6/extra)",
        "azure backup": "/Month per Server",
        "kaseya cloud detection & response": "/Month per Workstation",
        "kaseya dark web monitoring": "/Month per Workstation",
        "security awareness training": "/Month per Workstation",
        "keeper password manager": "/Month per User",
        "mcafee for mobile": "/Month per Mobile device",
        "watchguard firecloud": "/Month per Workstation",
        "ms co-pilot": "/Month per User",
        "ms copilot": "/Month per User",
        "ms office 365 basic": "/Month per User",
        "ms office 365 business premium": "/Month per User",
        "office 365 csp": "/Month per User",
        "ms office application": "/Month per User",
        "microsoft 365 applications for business": "/Month per User",
        "microsoft 365 applications for enterprise | azure terminal access": "/Month per User",
        "office 365 business standard": "/Month per User",
        "ms exchange": "/Month per Mailbox",
        "ms e1": "/Month per Mailbox",
        "ms e3": "/Month per Mailbox",
        "ms e5": "/Month per Mailbox",
        "domain hosting": "/Month per Domain",
        "ssl certificate": "/Month per Domain",
        "website support": "/Month per Server"
    };

    const collator = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base"
    });

    const state = {
        invoiceRows: [],
        catalogueRows: [],
        customerRows: [],
        quoteSelections: new Map(),
        selectedQuotePhase: "",
        latestServiceRows: [],
        machineCount: null,
        pendingRetries: 0,
        serviceFilter: "all",
        collapsedGroups: new Set(),
        searchCollapsedGroups: new Set(),
        collapseInitialized: false,
        navigationMode: detectNavigationMode(),
        restorePayload: null,
        viewerReady: false
    };

    const elements = {
        banner: document.getElementById("connectionBanner"),
        slaType: document.getElementById("slaTypeFilter"),
        customer: document.getElementById("customerFilter"),
        openNewCustomer: document.getElementById("openNewCustomer"),
        newCustomerModal: document.getElementById("newCustomerModal"),
        newCustomerForm: document.getElementById("newCustomerForm"),
        newCustomerStatus: document.getElementById("newCustomerStatus"),
        saveNewCustomer: document.getElementById("saveNewCustomer"),
        cancelNewCustomer: document.getElementById("cancelNewCustomer"),
        cancelNewCustomerTop: document.getElementById("cancelNewCustomerTop"),
        serviceSearch: document.getElementById("serviceSearch"),
        status: document.getElementById("tableStatus"),
        tableRegion: document.getElementById("serviceTableRegion"),
        body: document.getElementById("servicesBody"),
        activeServicesValue: document.getElementById("activeServicesValue"),
        activeServicesMeta: document.getElementById("activeServicesMeta"),
        totalLicencesValue: document.getElementById("totalLicencesValue"),
        monthlyCostValue: document.getElementById("monthlyCostValue"),
        nextRenewalValue: document.getElementById("nextRenewalValue"),
        allServicesCount: document.getElementById("allServicesCount"),
        activeOnlyCount: document.getElementById("activeOnlyCount"),
        inactiveOnlyCount: document.getElementById("inactiveOnlyCount"),
        proposalSelectedValue: document.getElementById("proposalSelectedValue"),
        proposalPhasesValue: document.getElementById("proposalPhasesValue"),
        proposalMonthlyValue: document.getElementById("proposalMonthlyValue"),
        proposalSetupValue: document.getElementById("proposalSetupValue"),
        phaseSummary: document.getElementById("phaseSummary"),
        clearQuoteInputs: document.getElementById("clearQuoteInputs"),
        clearQuoteModal: document.getElementById("clearQuoteModal"),
        cancelClearQuote: document.getElementById("cancelClearQuote"),
        confirmClearQuote: document.getElementById("confirmClearQuote"),
        quotePhase: document.getElementById("quotePhase"),
        generateProposal: document.getElementById("generateProposal"),
        quoteActionStatus: document.getElementById("quoteActionStatus"),
        quotePreview: document.getElementById("quotePreview"),
        quotePreviewBody: document.getElementById("quotePreviewBody"),
        quotePreviewMeta: document.getElementById("quotePreviewMeta"),
        filterButtons: Array.from(document.querySelectorAll("[data-service-filter]"))
    };

    function parseJson(value) {
        if (typeof value !== "string") {
            return value;
        }

        const trimmed = value.trim();
        if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
            return value;
        }

        try {
            return JSON.parse(trimmed);
        } catch (error) {
            return value;
        }
    }

    function detectNavigationMode() {
        if (window.__SLA_NAVIGATION_MODE__ === "embed" || window.__SLA_NAVIGATION_MODE__ === "shell") {
            return window.__SLA_NAVIGATION_MODE__;
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

    function decodeProposalPayload(value) {
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

    function normaliseRestorePayload(payload) {
        if (!payload || !text(payload.customerName) || !Array.isArray(payload.selections)) return null;
        const selections = payload.selections.filter(function (selection) {
            return selection && isValidPhase(selection.phase) && text(selection.service);
        });
        if (!selections.length) return null;
        const created = Date.parse(payload.createdAt);
        if (Number.isFinite(created) && Date.now() - created > TRANSFER_MAX_AGE_MS) return null;
        return {
            createdAt: text(payload.createdAt),
            customerName: text(payload.customerName),
            selectedPhase: text(payload.selectedPhase),
            navigationMode: normaliseNavigationMode(payload.navigationMode),
            selections: selections
        };
    }

    async function readRestorePayload() {
        if (window.__SLA_RESTORE_TEST_PAYLOAD__) {
            return normaliseRestorePayload(window.__SLA_RESTORE_TEST_PAYLOAD__);
        }
        try {
            if (
                window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL &&
                typeof ZOHO.CREATOR.UTIL.getQueryParams === "function"
            ) {
                const params = await ZOHO.CREATOR.UTIL.getQueryParams();
                const encodedPayload = findQueryParameter(params, PROPOSAL_QUERY_PARAM, 0);
                const decodedPayload = window.MCGQuoteWorkspace && typeof window.MCGQuoteWorkspace.decodeTransfer === "function"
                    ? await window.MCGQuoteWorkspace.decodeTransfer(encodedPayload)
                    : decodeProposalPayload(encodedPayload);
                const embeddedPayload = normaliseRestorePayload(decodedPayload);
                if (embeddedPayload) return embeddedPayload;
            }
        } catch (error) { /* A normal first visit has no workflow payload. */ }
        const browserValue = readBrowserPageParameter(PROPOSAL_QUERY_PARAM);
        const browserPayload = window.MCGQuoteWorkspace && typeof window.MCGQuoteWorkspace.decodeTransfer === "function"
            ? await window.MCGQuoteWorkspace.decodeTransfer(browserValue)
            : decodeProposalPayload(browserValue);
        return normaliseRestorePayload(browserPayload);
    }

    function findFunctionPayload(value, depth) {
        if (depth > 6) {
            return null;
        }

        const parsed = parseJson(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }

        if (
            Object.prototype.hasOwnProperty.call(parsed, "invoiceRows") ||
            Object.prototype.hasOwnProperty.call(parsed, "catalogueRows") ||
            Object.prototype.hasOwnProperty.call(parsed, "customerRows") ||
            (
                Object.prototype.hasOwnProperty.call(parsed, "status") &&
                Object.prototype.hasOwnProperty.call(parsed, "message")
            )
        ) {
            return parsed;
        }

        const preferredKeys = ["result", "data", "response", "output", "details"];
        for (const key of preferredKeys) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                const match = findFunctionPayload(parsed[key], depth + 1);
                if (match) {
                    return match;
                }
            }
        }

        for (const child of Object.values(parsed)) {
            const match = findFunctionPayload(child, depth + 1);
            if (match) {
                return match;
            }
        }

        return null;
    }

    function extractRows(payload, key) {
        const collection = parseJson(payload && payload[key]);

        if (Array.isArray(collection)) {
            return collection;
        }

        if (collection && Array.isArray(collection.data)) {
            return collection.data;
        }

        return [];
    }

    function text(value) {
        if (value === null || value === undefined) {
            return "";
        }

        if (Array.isArray(value)) {
            return value.map(text).filter(Boolean).join("; ");
        }

        if (typeof value === "object") {
            return JSON.stringify(value);
        }

        return String(value).trim();
    }

    function number(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function decimalValue(value) {
        const cleaned = text(value).replace(/[^0-9.-]/g, "");
        if (!cleaned || cleaned === "-" || cleaned === ".") {
            return null;
        }

        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function money(value) {
        if (value === null || value === undefined || text(value) === "") {
            return "";
        }

        const cleaned = String(value).replace(/[^0-9.-]/g, "");

        // Preserve text values such as TBA.
        if (cleaned === "" || cleaned === "-" || cleaned === ".") {
            return text(value);
        }

        const parsed = Number(cleaned);
        if (!Number.isFinite(parsed)) {
            return text(value);
        }

        return new Intl.NumberFormat("en-AU", {
            style: "currency",
            currency: "AUD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(parsed);
    }

    function normalizeName(value) {
        return text(value).toLocaleLowerCase();
    }

    function invoiceCustomerMatches(invoiceName, selectedCustomer) {
        const selected = text(selectedCustomer);
        const statusSuffix = selected.match(/^(.*-\s*\d{2})\s+ACCOUNT ON HOLD$/i);
        const key = function (value) { return normalizeName(value).replace(/&/g, "and").replace(/[^a-z0-9]+/g, ""); };
        const invoice = key(invoiceName);
        return Boolean(invoice) && (invoice === key(selected) || Boolean(statusSuffix && invoice === key(statusSuffix[1])));
    }

    function invoiceCustomerName(row) {
        return fieldValue(row, ["Customer", "Company", "Company Name", "Customer Name"]);
    }

    function fieldValue(record, names) {
        if (!record) {
            return "";
        }

        for (const name of names) {
            if (Object.prototype.hasOwnProperty.call(record, name) && text(record[name]) !== "") {
                return record[name];
            }
        }

        const normalizedNames = new Set(names.map(function (name) {
            return normalizeName(name).replace(/[^a-z0-9]/g, "");
        }));

        for (const key of Object.keys(record)) {
            const normalizedKey = normalizeName(key).replace(/[^a-z0-9]/g, "");
            if (normalizedNames.has(normalizedKey) && text(record[key]) !== "") {
                return record[key];
            }
        }

        return "";
    }

    function firstAvailable(primaryValues, fallbackRecord, fallbackNames) {
        if (primaryValues && primaryValues.length) {
            return primaryValues[0];
        }

        return fieldValue(fallbackRecord, fallbackNames);
    }

    let bannerHideTimer = null;

    function setBanner(message, mode) {
        if (bannerHideTimer) window.clearTimeout(bannerHideTimer);
        elements.banner.textContent = message;
        elements.banner.classList.remove("is-loading", "is-error", "is-success", "is-stale", "is-hidden");
        if (mode) {
            elements.banner.classList.add(mode);
        } else {
            elements.banner.classList.add("is-success");
        }
        if (mode !== "is-loading" && mode !== "is-error") {
            bannerHideTimer = window.setTimeout(function () {
                elements.banner.classList.add("is-hidden");
            }, 3000);
        }
    }

    function setTableBusy(isBusy) {
        if (elements.tableRegion) elements.tableRegion.setAttribute("aria-busy", isBusy ? "true" : "false");
    }

    function showLoadingRows() {
        elements.body.replaceChildren();
        ["wide", "", "medium", "", "medium"].forEach(function (size) {
            const row = document.createElement("tr");
            row.className = "skeleton-row";
            row.setAttribute("aria-hidden", "true");
            const cell = document.createElement("td");
            cell.colSpan = TABLE_COLUMN_COUNT;
            const line = document.createElement("span");
            line.className = "skeleton-line" + (size ? " skeleton-line-" + size : "");
            cell.appendChild(line);
            row.appendChild(cell);
            elements.body.appendChild(row);
        });
        setTableBusy(true);
    }

    function showEmpty(message) {
        elements.body.replaceChildren();
        setTableBusy(false);

        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = TABLE_COLUMN_COUNT;
        cell.className = "sla-empty";
        cell.textContent = message;

        row.appendChild(cell);
        elements.body.appendChild(row);
    }

    function resetSummary() {
        elements.activeServicesValue.textContent = "—";
        elements.activeServicesMeta.textContent = "Select a customer";
        elements.totalLicencesValue.textContent = "—";
        elements.monthlyCostValue.textContent = "—";
        elements.nextRenewalValue.textContent = "—";
        elements.allServicesCount.textContent = "0";
        elements.activeOnlyCount.textContent = "0";
        elements.inactiveOnlyCount.textContent = "0";
    }

    function serviceKey(catalogue) {
        return "name:" + normalizeName(catalogue.Name);
    }

    function blankSelection() {
        return {
            phase: "",
            quantity: "",
            customPrice: "",
            customSetup: "",
            itemId: "",
            setupItemId: ""
        };
    }

    function getSelection(key) {
        return state.quoteSelections.get(key) || blankSelection();
    }

    function hasSelectionInput(selection) {
        return Boolean(
            text(selection.phase) ||
            text(selection.quantity) ||
            text(selection.customPrice) ||
            text(selection.customSetup)
        );
    }

    function isValidPhase(value) {
        if (!text(value)) {
            return false;
        }

        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 1;
    }

    function isValidOptionalAmount(value, allowZero) {
        if (!text(value)) {
            return true;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
    }

    function uniqueCustomers(rows) {
        return Array.from(new Set(rows.map(function (row) {
            return text(row.Customer);
        }).filter(Boolean))).sort(collator.compare);
    }

    function crmCustomerName(row) {
        return text(fieldValue(row, [
            "Customer",
            "Account Name",
            "Account_Name",
            "Company",
            "Company Name"
        ]));
    }

    function crmCustomerId(row) {
        return text(fieldValue(row, [
            "CRM Account ID",
            "CRM_Account_ID",
            "Account ID",
            "Account_ID",
            "id",
            "Id"
        ]));
    }

    function crmCustomerIsInactive(row) {
        const value = fieldValue(row, ["Inactive"]);
        if (value === true || value === 1) return true;
        const normalized = normalizeName(value);
        return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
    }

    function uniqueCrmCustomers(rows) {
        return Array.from(new Set(rows.map(crmCustomerName).filter(Boolean))).sort(collator.compare);
    }

    function selectedCrmCustomer() {
        const selectedName = normalizeName(elements.customer.value);
        return state.customerRows.find(function (row) {
            return normalizeName(crmCustomerName(row)) === selectedName;
        }) || null;
    }

    function customerHasRecurringInvoice(customerName) {
        return state.invoiceRows.some(function (row) {
            return invoiceCustomerMatches(invoiceCustomerName(row), customerName);
        });
    }

    function slaTypeCode(value) {
        const match = text(value).match(/^SLA\s*-\s*(0[1-5])\b/i);
        return match ? match[1] : "";
    }

    function customerSlaCode(customerName) {
        const match = text(customerName).match(/-\s*(0[1-5])\s*$/);
        return match ? match[1] : "";
    }

    function availableCustomerNames() {
        const names = uniqueCrmCustomers(state.customerRows);
        const slaType = elements.slaType.value;
        if (slaType === NO_RECURRING_SLA_FILTER) {
            return names.filter(function (customerName) {
                return !customerHasRecurringInvoice(customerName);
            });
        }
        const code = slaTypeCode(slaType);
        if (code) {
            return names.filter(function (customerName) {
                return customerSlaCode(customerName) === code;
            });
        }
        return names;
    }

    function addSavedCustomer(customerRows) {
        const session = window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.current();
        if (!session || !session.newCustomer || !text(session.crmAccountId)) return customerRows;
        if (customerRows.some(function (row) { return normalizeName(crmCustomerName(row)) === normalizeName(session.customerName); })) return customerRows;
        return customerRows.concat([{ "Account Name": session.customerName, "CRM Account ID": session.crmAccountId }]);
    }

    function refreshCustomerOptions() {
        const previousCustomer = elements.customer.value;
        const customerNames = availableCustomerNames();
        replaceOptions(elements.customer, "Select a customer", customerNames);
        if (customerNames.includes(previousCustomer)) {
            elements.customer.value = previousCustomer;
        }
    }

    function orderedSlaTypes(rows) {
        const names = new Set(rows.map(function (row) {
            return text(row["SLA Type"]);
        }).filter(Boolean));
        return Array.from(names).sort(function (left, right) {
            const leftCode = slaTypeCode(left);
            const rightCode = slaTypeCode(right);
            if (leftCode && rightCode && leftCode !== rightCode) {
                return Number(leftCode) - Number(rightCode);
            }
            if (leftCode !== rightCode) {
                return leftCode ? -1 : 1;
            }
            return collator.compare(left, right);
        });
    }

    function replaceOptions(select, placeholder, values) {
        select.replaceChildren();

        const firstOption = document.createElement("option");
        firstOption.value = "";
        firstOption.textContent = placeholder;
        select.appendChild(firstOption);

        values.forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
    }

    function addCell(row, value, className) {
        const cell = document.createElement("td");
        cell.textContent = text(value);
        if (className) {
            cell.className = className;
        }
        row.appendChild(cell);
        return cell;
    }

    function recurringInvoiceId(value) {
        const cleaned = text(value).replace(/\s+/g, "");
        return /^\d+$/.test(cleaned) ? cleaned : "";
    }

    function recurringInvoiceValues(values) {
        const result = [];
        (Array.isArray(values) ? values : []).forEach(function (value) {
            const source = text(value);
            if (!source) return;
            const ids = source.match(/\d{10,}/g);
            const parts = ids && ids.length ? ids : [source];
            parts.forEach(function (part) {
                const cleaned = text(part);
                if (cleaned && !result.includes(cleaned)) result.push(cleaned);
            });
        });
        return result;
    }

    function addRecurringInvoiceCell(row, values) {
        const cell = document.createElement("td");
        cell.className = "multiline recurring-invoice-links";
        const ids = recurringInvoiceValues(values);

        ids.forEach(function (value, index) {
            if (index > 0) cell.appendChild(document.createTextNode("; "));

            const id = recurringInvoiceId(value);
            if (!id) {
                cell.appendChild(document.createTextNode(text(value)));
                return;
            }

            const link = document.createElement("a");
            link.className = "recurring-invoice-link";
            link.href = BOOKS_RECURRING_INVOICE_URL + encodeURIComponent(id) + BOOKS_RECURRING_INVOICE_QUERY;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = id;
            link.title = "Open recurring invoice " + id + " in Zoho Books";
            cell.appendChild(link);
        });

        row.appendChild(cell);
        return cell;
    }

    function addStatusCell(row, isActive) {
        const cell = document.createElement("td");
        const pill = document.createElement("span");

        pill.className = "status-pill " + (isActive ? "is-active" : "is-inactive");
        pill.textContent = isActive ? "Active" : "Inactive";

        cell.appendChild(pill);
        row.appendChild(cell);
    }

    function matchingInvoiceRows() {
        const customer = elements.customer.value;
        const slaType = elements.slaType.value;

        if (slaType === NO_RECURRING_SLA_FILTER) {
            return [];
        }

        return state.invoiceRows.filter(function (row) {
            const customerMatches = invoiceCustomerMatches(invoiceCustomerName(row), customer);
            const slaMatches = !slaType || text(row["SLA Type"]) === slaType;
            return customerMatches && slaMatches;
        });
    }

    function customerInvoiceRows() {
        const customer = elements.customer.value;
        return state.invoiceRows.filter(function (row) {
            return invoiceCustomerMatches(invoiceCustomerName(row), customer);
        });
    }

    function addUnique(list, value) {
        const cleaned = text(value);
        if (!cleaned) {
            return;
        }

        if (!list.includes(cleaned)) {
            list.push(cleaned);
        }
    }

    function buildActiveServiceMap(rows) {
        const activeMap = new Map();

        rows.forEach(function (row) {
            const name = text(row["Item Display Name"]);

            // Only invoice rows mapped to an SLA catalogue item can be joined.
            if (!name) {
                return;
            }

            const key = normalizeName(name);

            if (!activeMap.has(key)) {
                activeMap.set(key, {
                    quantity: 0,
                    monthly: 0,
                    group: "",
                    subGroup: "",
                    contracts: [],
                    recurringIds: [],
                    nextDates: [],
                    phases: [],
                    quoteQuantities: [],
                    customPrices: [],
                    onceOffSetup: [],
                    quotingAmounts: []
                });
            }

            const entry = activeMap.get(key);
            entry.quantity += number(row.Quantity, 0);
            entry.monthly += number(row["Average Monthly Charges"], 0);
            if (!entry.group) entry.group = invoiceGroupName(row);
            if (!entry.subGroup) entry.subGroup = invoiceSubGroupName(row);

            addUnique(entry.contracts, row.Contracts);
            addUnique(entry.recurringIds, row["Recurring Inv ID"]);
            addUnique(entry.nextDates, row["Next Invoice Date"]);
            addUnique(entry.phases, fieldValue(row, ["Phases", "Phase"]));
            addUnique(entry.quoteQuantities, fieldValue(row, ["Qty. Quoting", "Qty Quoting", "Quantity Quoting"]));
            addUnique(entry.customPrices, fieldValue(row, ["Custom Price ($/unit)", "Custom Price", "Custom Unit Price"]));
            addUnique(entry.onceOffSetup, fieldValue(row, ["Once-Off Setup", "Once Off Setup", "One-Off Setup"]));
            addUnique(entry.quotingAmounts, fieldValue(row, ["Quoting $", "$ Quoting", "Quoting Amount"]));
        });

        return activeMap;
    }

    function invoiceServiceName(row) {
        const value = text(fieldValue(row, [
            "Item Display Name",
            "Service",
            "Item Name",
            "Product Name",
            "Name"
        ]));
        return normalizeName(value) === "(blank)" ? "" : value;
    }

    function invoiceGroupName(row) {
        return text(fieldValue(row, [
            "Display Group",
            "Grouping",
            "Group",
            "Category",
            "Service Category"
        ])) || "Others";
    }

    function invoiceSubGroupName(row) {
        return text(fieldValue(row, [
            "Sub Group",
            "Sub Grouping",
            "Subgroup",
            "Service Type",
            "Services"
        ])) || "Miscellaneous services / discounts";
    }

    function unmatchedInvoiceGroupName(row) {
        const group = text(fieldValue(row, ["Display Group", "Grouping"]));
        if (!group || normalizeName(group) === "other") {
            return "Others";
        }
        return group;
    }

    function buildUnmatchedInvoiceRows(rows) {
        const catalogueNames = new Set(state.catalogueRows.map(function (catalogue) {
            return normalizeName(catalogue.Name);
        }).filter(Boolean));
        const unmatched = new Map();

        rows.forEach(function (invoiceRow) {
            const sourceService = invoiceServiceName(invoiceRow);
            if (sourceService && catalogueNames.has(normalizeName(sourceService))) return;

            const group = unmatchedInvoiceGroupName(invoiceRow);
            const subGroup = invoiceSubGroupName(invoiceRow);
            const service = sourceService || "Other recurring service";
            const key = [normalizeName(group), normalizeName(subGroup), normalizeName(service)].join("::");

            if (!unmatched.has(key)) {
                unmatched.set(key, {
                    catalogue: {},
                    quoteKey: "invoice-only:" + key,
                    selection: blankSelection(),
                    group: group,
                    subGroup: subGroup,
                    service: service,
                    active: true,
                    displayOnly: true,
                    invoice: {
                        quantity: 0,
                        monthly: 0,
                        contracts: [],
                        recurringIds: [],
                        nextDates: []
                    },
                    itemId: "",
                    sku: "",
                    setupItemId: "",
                    businessName: "",
                    recommendation: "",
                    standardPrice: "",
                    standardSetup: "",
                    unit: fieldValue(invoiceRow, ["Unit", "Billing Unit", "Billing_Unit"])
                });
            }

            const entry = unmatched.get(key);
            entry.invoice.quantity += number(invoiceRow.Quantity, 0);
            entry.invoice.monthly += number(invoiceRow["Average Monthly Charges"], 0);
            addUnique(entry.invoice.contracts, invoiceRow.Contracts);
            addUnique(entry.invoice.recurringIds, invoiceRow["Recurring Inv ID"]);
            addUnique(entry.invoice.nextDates, invoiceRow["Next Invoice Date"]);
            if (!text(entry.unit)) {
                entry.unit = fieldValue(invoiceRow, ["Unit", "Billing Unit", "Billing_Unit"]);
            }
        });

        return Array.from(unmatched.values()).sort(function (left, right) {
            return collator.compare(left.group, right.group) ||
                collator.compare(left.subGroup, right.subGroup) ||
                collator.compare(left.service, right.service);
        });
    }

    function sortedCatalogueRows() {
        return state.catalogueRows.slice().sort(function (left, right) {
            const orderDifference =
                number(left.Order, Number.MAX_SAFE_INTEGER) -
                number(right.Order, Number.MAX_SAFE_INTEGER);

            if (orderDifference) {
                return orderDifference;
            }

            const groupDifference = collator.compare(
                text(left.Grouping),
                text(right.Grouping)
            );

            if (groupDifference) {
                return groupDifference;
            }

            const subGroupDifference = collator.compare(
                text(left["Sub Grouping"]),
                text(right["Sub Grouping"])
            );

            if (subGroupDifference) {
                return subGroupDifference;
            }

            return collator.compare(text(left.Name), text(right.Name));
        });
    }

    function buildServiceRows(activeMap) {
        return sortedCatalogueRows().map(function (catalogue) {
            const service = text(catalogue.Name);
            const businessName = fieldValue(catalogue, ["Business Name", "Business_Name"]);
            const key = normalizeName(service);
            const active = activeMap.get(key);
            const quoteKey = serviceKey(catalogue);
            const selection = getSelection(quoteKey);
            if (!Object.prototype.hasOwnProperty.call(selection, "itemId") || !text(selection.itemId)) {
                selection.itemId = fieldValue(catalogue, ["Item ID", "Item_ID", "Books Item ID", "Books_Item_ID"]);
            }
            if (!Object.prototype.hasOwnProperty.call(selection, "setupItemId") || !text(selection.setupItemId)) {
                selection.setupItemId = fieldValue(catalogue, ["Setup ID", "Setup_ID", "Setup Item ID", "Setup_Item_ID"]);
            }
            const edrKey = normalizeName(service || businessName).replace(/[^a-z0-9]/g, "");
            const edrBusinessKey = normalizeName(businessName).replace(/[^a-z0-9]/g, "");
            if (["edr", "kedr", "kaseyawatchguardedr"].includes(edrKey) || edrBusinessKey === "kaseyawatchguardedr") {
                selection.itemId = BOOKS_EDR_ITEM_ID;
            }

            return {
                catalogue: catalogue,
                quoteKey: quoteKey,
                selection: selection,
                group: active && text(active.group) ? text(active.group) : text(catalogue.Grouping) || "Other",
                subGroup: active && text(active.subGroup) ? text(active.subGroup) : text(catalogue["Sub Grouping"]),
                service: service,
                active: Boolean(active),
                invoice: active || null,
                itemId: text(selection.itemId),
                sku: fieldValue(catalogue, ["SKU", "Sku"]),
                setupItemId: text(selection.setupItemId),
                businessName: businessName,
                recommendation: fieldValue(catalogue, ["Business Summary", "Business_Summary", "Recommended Solution", "Description"]),
                standardPrice: fieldValue(catalogue, ["Standard Price", "Standard_Price", "Price"]),
                standardSetup: fieldValue(catalogue, ["Setup Cost", "Setup_Cost", "Standard Setup Cost", "Once-Off Setup", "Once Off Setup", "One-Off Setup"]),
                unit: fieldValue(catalogue, ["Unit", "Billing Unit", "Billing_Unit"]) || UNIT_FALLBACKS[normalizeName(service)] || ""
            };
        });
    }

    function isWorkstationUnit(value) {
        const unit = normalizeName(value);
        return unit.includes("workstation") ||
            unit.includes("machine") ||
            unit.includes("device") ||
            unit.includes("endpoint") ||
            unit.includes("computer");
    }

    function deriveMachineCount(serviceRows) {
        const preferred = serviceRows.filter(function (row) {
            return row.active &&
                isWorkstationUnit(row.unit) &&
                normalizeName(row.group).includes("support") &&
                normalizeName(row.service).includes("sla");
        });
        const fallback = serviceRows.filter(function (row) {
            return row.active && isWorkstationUnit(row.unit);
        });
        const candidates = preferred.length ? preferred : fallback;
        const quantities = candidates.map(function (row) {
            return number(row.invoice && row.invoice.quantity, 0);
        }).filter(function (value) {
            return value > 0;
        });
        return quantities.length ? Math.max.apply(null, quantities) : null;
    }

    function quantityPlaceholder(data) {
        if (state.machineCount !== null) {
            return String(state.machineCount);
        }
        return "Blank = TBC";
    }

    function applyDefaultQuoteQuantities(serviceRows) {
        if (state.machineCount === null) return;
        serviceRows.forEach(function (row) {
            if (row.displayOnly) return;
            if (text(row.selection.quantity)) return;
            row.selection.quantity = String(state.machineCount);
            state.quoteSelections.set(row.quoteKey, row.selection);
        });
    }

    function subgroupCoverageKey(row) {
        const subgroup = text(row.subGroup) || text(row.service);
        return normalizeName(row.group) + "::" + normalizeName(subgroup);
    }

    function coveredSubgroupKeys(serviceRows) {
        const covered = new Set();
        serviceRows.forEach(function (row) {
            if (row.active) {
                covered.add(subgroupCoverageKey(row));
            }
        });
        return covered;
    }

    function isMissingCoverage(row, coveredSubgroups) {
        return !row.active && !coveredSubgroups.has(subgroupCoverageKey(row));
    }

    function groupRows(rows) {
        const groups = new Map();

        rows.forEach(function (row) {
            if (!groups.has(row.group)) {
                groups.set(row.group, []);
            }
            groups.get(row.group).push(row);
        });

        return groups;
    }

    function parseCreatorDate(value) {
        const parts = text(value).split("/");
        if (parts.length !== 3) {
            return null;
        }

        const day = Number(parts[0]);
        const month = Number(parts[1]);
        const year = Number(parts[2]);

        if (!day || !month || !year) {
            return null;
        }

        const date = new Date(year, month - 1, day);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function earliestRenewal(serviceRows) {
        const dates = [];

        serviceRows.forEach(function (row) {
            if (!row.active || !row.invoice) return;
            row.invoice.nextDates.forEach(function (dateGroup) {
                text(dateGroup).split(";").forEach(function (part) {
                    const parsed = parseCreatorDate(part.trim());
                    if (parsed) {
                        dates.push(parsed);
                    }
                });
            });
        });

        if (!dates.length) {
            return "—";
        }

        dates.sort(function (left, right) {
            return left.getTime() - right.getTime();
        });

        return new Intl.DateTimeFormat("en-AU", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(dates[0]);
    }

    function updateSummary(serviceRows, activeMap) {
        const activeRows = serviceRows.filter(function (row) {
            return row.active;
        });

        const coveredSubgroups = coveredSubgroupKeys(serviceRows);
        const missingCoverageRows = serviceRows.filter(function (row) {
            return isMissingCoverage(row, coveredSubgroups);
        });

        const totalLicences = activeRows.reduce(function (sum, row) {
            return sum + number(row.invoice.quantity, 0);
        }, 0);

        const totalMonthly = activeRows.reduce(function (sum, row) {
            return sum + number(row.invoice.monthly, 0);
        }, 0);

        elements.activeServicesValue.textContent = String(activeRows.length);
        elements.activeServicesMeta.textContent = serviceRows.length + " catalogue services";
        elements.totalLicencesValue.textContent = String(totalLicences);
        elements.monthlyCostValue.textContent = money(totalMonthly) || "$0.00";
        elements.nextRenewalValue.textContent = earliestRenewal(serviceRows);

        elements.allServicesCount.textContent = String(serviceRows.length);
        elements.activeOnlyCount.textContent = String(activeRows.length);
        elements.inactiveOnlyCount.textContent = String(missingCoverageRows.length);
    }

    function updateProposalSummary(serviceRows) {
        state.latestServiceRows = serviceRows;
        const selectedRows = serviceRows.filter(function (row) {
            return isValidPhase(row.selection.phase);
        });
        const phaseMap = new Map();
        let monthlyTotal = 0;
        let setupTotal = 0;
        let monthlyHasTbc = false;
        let setupHasTbc = false;

        selectedRows.forEach(function (row) {
            const phase = Number(row.selection.phase);
            if (!phaseMap.has(phase)) {
                phaseMap.set(phase, {
                    rows: [],
                    monthly: 0,
                    setup: 0,
                    monthlyTbc: false,
                    setupTbc: false
                });
            }

            const phaseData = phaseMap.get(phase);
            const recurring = monthlyQuote(row);
            const setup = setupQuote(row);
            phaseData.rows.push(row);

            if (recurring.tbc) {
                monthlyHasTbc = true;
                phaseData.monthlyTbc = true;
            } else {
                monthlyTotal += recurring.value;
                phaseData.monthly += recurring.value;
            }

            if (setup.tbc) {
                setupHasTbc = true;
                phaseData.setupTbc = true;
            } else {
                setupTotal += setup.value;
                phaseData.setup += setup.value;
            }
        });

        const phases = Array.from(phaseMap.keys()).sort(function (left, right) {
            return left - right;
        });

        elements.proposalSelectedValue.textContent = String(selectedRows.length);
        elements.proposalPhasesValue.textContent = phases.length ? phases.join(", ") : "—";
        elements.proposalMonthlyValue.textContent = monthlyHasTbc ? "TBC" : (money(monthlyTotal) || "$0.00");
        elements.proposalSetupValue.textContent = setupHasTbc ? "TBC" : (money(setupTotal) || "$0.00");
        elements.clearQuoteInputs.disabled = state.quoteSelections.size === 0;
        elements.phaseSummary.replaceChildren();

        const previousPhase = state.selectedQuotePhase || elements.quotePhase.value;
        replaceOptions(
            elements.quotePhase,
            phases.length ? "Select a phase" : "No phases selected",
            phases.map(String)
        );
        elements.quotePhase.disabled = !phases.length;

        if (phases.map(String).includes(String(previousPhase))) {
            elements.quotePhase.value = String(previousPhase);
            state.selectedQuotePhase = String(previousPhase);
        } else if (phases.length) {
            elements.quotePhase.value = String(phases[0]);
            state.selectedQuotePhase = String(phases[0]);
        } else {
            elements.quotePhase.value = "";
            state.selectedQuotePhase = "";
        }

        if (!phases.length) {
            const empty = document.createElement("span");
            empty.className = "phase-summary-empty";
            empty.textContent = "No services selected for quoting.";
            elements.phaseSummary.appendChild(empty);
            renderQuotePreview();
            return;
        }

        phases.forEach(function (phase) {
            const details = phaseMap.get(phase);
            const chip = document.createElement("span");
            chip.className = "phase-chip";

            const recurringText = details.monthlyTbc ? "TBC monthly" : (money(details.monthly) + " monthly");
            const setupText = details.setupTbc ? "TBC setup" : (money(details.setup) + " setup");
            chip.textContent =
                "Phase " + phase +
                " · " + details.rows.length + (details.rows.length === 1 ? " service" : " services") +
                " · " + recurringText +
                " · " + setupText;

            elements.phaseSummary.appendChild(chip);
        });

        renderQuotePreview();
    }

    function customerCrmAccountId() {
        const crmCustomer = selectedCrmCustomer();
        const crmId = crmCustomerId(crmCustomer);
        if (crmId) {
            return crmId;
        }

        const row = matchingInvoiceRows()[0];
        return fieldValue(row, [
            "CRM Account ID",
            "CRM_Account_ID",
            "ZCRM Account ID",
            "ZCRM_Account_ID",
            "Account ID",
            "Account_ID"
        ]);
    }

    function quoteLinesForPhase(phase) {
        const selectedRows = state.latestServiceRows.filter(function (row) {
            return String(row.selection.phase) === String(phase) && isValidPhase(row.selection.phase);
        });
        const lines = [];
        const issues = [];

        selectedRows.forEach(function (row) {
            const quantity = decimalValue(row.selection.quantity);
            const recurringPrice = monthlyUnitPrice(row);
            const setupPrice = effectiveSetup(row);
            const serviceDescription = row.businessName || row.service;

            if (!text(row.itemId)) {
                issues.push(row.service + ": Books Item ID is missing");
            }
            if (quantity === null || quantity <= 0) {
                issues.push(row.service + ": quantity is TBC");
            }
            if (recurringPrice === null) {
                issues.push(row.service + ": monthly price is TBC");
            }

            lines.push({
                type: "Service",
                service: row.service,
                description: serviceDescription,
                recommendation: row.recommendation,
                itemId: text(row.itemId),
                sku: text(row.sku),
                quantity: quantity,
                rate: recurringPrice,
                total: quantity !== null && quantity > 0 && recurringPrice !== null ? quantity * recurringPrice : null,
                sourceRow: row,
                itemField: "itemId"
            });

            if (!text(row.setupItemId)) {
                issues.push(row.service + ": Setup Item ID is missing");
            }
            if (text(row.itemId) && text(row.itemId) === text(row.setupItemId)) {
                issues.push(row.service + ": monthly and setup Books Item IDs are the same");
            }
            if (setupPrice === null) {
                issues.push(row.service + ": setup price is TBC");
            }

            lines.push({
                type: "Setup",
                service: row.service,
                description: "Setup — " + serviceDescription,
                recommendation: "",
                itemId: text(row.setupItemId),
                sku: "",
                quantity: 1,
                rate: setupPrice,
                total: setupPrice,
                sourceRow: row,
                itemField: "setupItemId"
            });
        });

        return { rows: selectedRows, lines: lines, issues: issues };
    }

    function previewValue(value, formatter) {
        return value === null || value === undefined || value === "" ? "TBC" : formatter(value);
    }

    function addPreviewCell(row, value, className) {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (className) {
            cell.className = className;
        }
        row.appendChild(cell);
    }

    function setQuoteActionStatus(message, mode) {
        elements.quoteActionStatus.textContent = message;
        elements.quoteActionStatus.classList.remove("is-ready", "is-error", "is-loading", "is-success");
        if (mode) {
            elements.quoteActionStatus.classList.add(mode);
        }
    }

    function renderQuotePreview() {
        const phase = state.selectedQuotePhase || elements.quotePhase.value;
        elements.quotePreviewBody.replaceChildren();

        if (!phase) {
            elements.quotePreview.hidden = true;
            elements.generateProposal.disabled = true;
            setQuoteActionStatus(
                state.latestServiceRows.some(function (row) { return isValidPhase(row.selection.phase); })
                    ? "Select a phase to review its quote lines."
                    : "Select services by entering a Phase."
            );
            return;
        }

        const preview = quoteLinesForPhase(phase);
        elements.quotePreview.hidden = false;
        elements.quotePreviewMeta.textContent =
            preview.rows.length + (preview.rows.length === 1 ? " service" : " services") +
            " · " + preview.lines.length + " Books line items";

        preview.lines.forEach(function (line) {
            const row = document.createElement("tr");
            const typeCell = document.createElement("td");
            const type = document.createElement("span");
            type.className = "quote-line-type " + (line.type === "Setup" ? "is-setup" : "is-service");
            type.textContent = line.type;
            typeCell.appendChild(type);
            row.appendChild(typeCell);

            addPreviewCell(row, line.description);
            const itemCell = document.createElement("td");
            const itemInput = document.createElement("input");
            itemInput.type = "text";
            itemInput.className = "preview-item-id";
            itemInput.value = line.itemId || "";
            itemInput.placeholder = line.type === "Setup" ? "Setup Item ID" : "Monthly Item ID";
            itemInput.setAttribute("aria-label", itemInput.placeholder + " for " + line.service);
            itemInput.addEventListener("input", function () {
                line.itemId = text(itemInput.value);
                line.sourceRow.selection[line.itemField] = line.itemId;
                line.sourceRow[line.itemField] = line.itemId;
                itemInput.classList.toggle("is-missing", !line.itemId);
                saveProposalWorkspace();
            });
            itemInput.addEventListener("change", renderQuotePreview);
            itemInput.classList.toggle("is-missing", !line.itemId);
            itemCell.appendChild(itemInput);
            row.appendChild(itemCell);
            addPreviewCell(row, previewValue(line.quantity, function (value) { return String(value); }), line.quantity ? "numeric" : "is-tbc");
            addPreviewCell(row, previewValue(line.rate, money), line.rate !== null ? "money" : "is-tbc");
            addPreviewCell(row, previewValue(line.total, money), line.total !== null ? "money" : "is-tbc");
            elements.quotePreviewBody.appendChild(row);
        });

        const allSelectedRows = state.latestServiceRows.filter(function (row) {
            return isValidPhase(row.selection.phase);
        });
        elements.generateProposal.disabled = !allSelectedRows.length;

        if (preview.issues.length) {
            setQuoteActionStatus(
                "Phase " + phase + " contains TBC or missing quote details. It can still be generated, but the draft quote will remain blocked until completed.",
                "is-error"
            );
        } else {
            setQuoteActionStatus(
                "Ready to generate " + allSelectedRows.length +
                (allSelectedRows.length === 1 ? " selected service" : " selected services") +
                " across all phases.",
                "is-ready"
            );
        }
    }

    function transferSelection(row) {
        const quantity = decimalValue(row.selection.quantity);
        const monthlyRate = monthlyUnitPrice(row);
        const setupRate = effectiveSetup(row);

        return {
            order: number(row.catalogue.Order, Number.MAX_SAFE_INTEGER),
            group: row.group,
            subGroup: row.subGroup,
            service: row.service,
            businessName: row.businessName || row.service,
            recommendation: row.recommendation,
            active: row.active,
            phase: Number(row.selection.phase),
            quantity: quantity,
            customPrice: decimalValue(row.selection.customPrice),
            standardPrice: decimalValue(row.standardPrice),
            monthlyRate: monthlyRate,
            unit: row.unit,
            customSetup: decimalValue(row.selection.customSetup),
            standardSetup: decimalValue(row.standardSetup),
            setupRate: setupRate,
            monthlyTotal: quantity !== null && quantity > 0 && monthlyRate !== null ? quantity * monthlyRate : null,
            itemId: text(row.itemId),
            setupItemId: text(row.setupItemId),
            sku: text(row.sku)
        };
    }

    function saveProposalWorkspace() {
        if (!window.MCGQuoteWorkspace || !elements.customer.value) return null;
        const proposals = state.latestServiceRows.filter(function (row) {
            return isValidPhase(row.selection.phase);
        }).map(transferSelection);
        const slaDrafts = state.latestServiceRows.filter(function (row) {
            return hasSelectionInput(row.selection);
        }).map(function (row) {
            return Object.assign(transferSelection(row), {
                phase: editableValue(row.selection.phase),
                quantity: editableValue(row.selection.quantity),
                customPrice: editableValue(row.selection.customPrice),
                customSetup: editableValue(row.selection.customSetup)
            });
        });
        return window.MCGQuoteWorkspace.save(elements.customer.value, {
            crmAccountId: text(customerCrmAccountId()),
            proposals: proposals,
            slaDrafts: slaDrafts,
            selectedPhase: Number(state.selectedQuotePhase || elements.quotePhase.value) || null,
            navigationMode: state.navigationMode
        });
    }

    function restoreWorkspaceSelections(customerName) {
        if (!window.MCGQuoteWorkspace) return false;
        const session = window.MCGQuoteWorkspace.get(customerName);
        if (!session) return false;
        const selections = Array.isArray(session.slaDrafts) ? session.slaDrafts : session.proposals;
        if (!Array.isArray(selections)) return false;
        selections.forEach(function (selection) {
            if (!selection || !text(selection.service)) return;
            state.quoteSelections.set(restoreSelectionKey(selection), {
                phase: editableValue(selection.phase),
                quantity: editableValue(selection.quantity),
                customPrice: editableValue(selection.customPrice),
                customSetup: editableValue(selection.customSetup),
                itemId: editableValue(selection.itemId),
                setupItemId: editableValue(selection.setupItemId)
            });
        });
        state.selectedQuotePhase = editableValue(session.selectedPhase);
        return Boolean(selections.length);
    }

    function encodeProposalPayload(payload) {
        const json = JSON.stringify(payload);
        const bytes = new TextEncoder().encode(json);
        let binary = "";
        bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
        return window.btoa(binary)
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replace(/=+$/g, "");
    }

    function restoreSelectionKey(selection) {
        return "name:" + normalizeName(selection.service);
    }

    function editableValue(value) {
        return value === null || value === undefined || text(value) === "" ? "" : String(value);
    }

    function applyRestorePayload() {
        const payload = state.restorePayload;
        if (!state.viewerReady || !payload) return false;

        const availableCustomers = Array.from(elements.customer.children || []).map(function (option) {
            return text(option.value);
        });
        if (!availableCustomers.includes(payload.customerName)) {
            setBanner("The previous proposal customer is no longer available: " + payload.customerName + ".", "is-error");
            state.restorePayload = null;
            return false;
        }

        elements.customer.value = payload.customerName;
        state.quoteSelections.clear();
        payload.selections.forEach(function (selection) {
            state.quoteSelections.set(restoreSelectionKey(selection), {
                phase: String(selection.phase),
                quantity: editableValue(selection.quantity),
                customPrice: editableValue(selection.customPrice),
                customSetup: editableValue(selection.customSetup),
                itemId: editableValue(selection.itemId),
                setupItemId: editableValue(selection.setupItemId)
            });
        });
        state.selectedQuotePhase = payload.selectedPhase || String(payload.selections[0].phase);
        // Keep the mode detected from the page currently hosting this widget.
        // A customer workspace may have been saved in the other app shell.
        state.restorePayload = null;
        state.collapsedGroups.clear();
        state.collapseInitialized = false;
        renderRows();
        setBanner("Proposal selections restored for " + payload.customerName + ".");
        return true;
    }

    function openMissingServicesPage(encodedPayload) {
        const targetUrl = pageUrl(
            MISSING_SERVICES_PAGE_LINK,
            WORKFLOW_QUERY_PARAM,
            encodedPayload,
            state.navigationMode
        );

        if (window.__SLA_PROPOSAL_NAVIGATE_TEST_HANDLER__) {
            window.__SLA_PROPOSAL_NAVIGATE_TEST_HANDLER__(targetUrl, state.navigationMode === "embed" ? "top" : "same");
            return;
        }

        if (state.navigationMode === "embed") {
            window.open(targetUrl, "_top");
            return;
        }

        if (
            window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL &&
            typeof ZOHO.CREATOR.UTIL.navigateParentURL === "function"
        ) {
            ZOHO.CREATOR.UTIL.navigateParentURL({
                action: "open",
                url: targetUrl,
                window: "same"
            });
            return;
        }

        window.open(targetUrl, "_top");
    }

    async function generateMissingServicesProposal() {
        const selectedRows = state.latestServiceRows.filter(function (row) {
            return isValidPhase(row.selection.phase);
        });

        if (!elements.customer.value || !selectedRows.length) {
            renderQuotePreview();
            return;
        }

        const payload = {
            version: 2,
            createdAt: new Date().toISOString(),
            customerName: elements.customer.value,
            crmAccountId: text(customerCrmAccountId()),
            selectedPhase: Number(state.selectedQuotePhase || elements.quotePhase.value),
            navigationMode: state.navigationMode,
            proposals: selectedRows.map(transferSelection),
            selections: selectedRows.map(transferSelection)
        };

        if (window.MCGQuoteWorkspace) {
            window.MCGQuoteWorkspace.save(payload.customerName, {
                crmAccountId: payload.crmAccountId,
                proposals: payload.proposals,
                selectedPhase: payload.selectedPhase,
                navigationMode: state.navigationMode
            });
        }

        let encodedPayload;
        try {
            // Creator widgets do not reliably share localStorage with one another.
            // Carry the selected proposal rows in the page variable so Missing
            // Services can restore them even when it runs in a separate iframe.
            const transfer = Object.assign({}, payload, { sourceRoute: "proposal" });
            encodedPayload = window.MCGQuoteWorkspace && typeof window.MCGQuoteWorkspace.encodeTransfer === "function"
                ? await window.MCGQuoteWorkspace.encodeTransfer(transfer)
                : encodeProposalPayload(transfer);
        } catch (error) {
            setQuoteActionStatus(
                "The temporary proposal could not be prepared. Please try again.",
                "is-error"
            );
            return;
        }

        setQuoteActionStatus("Opening Missing Services & Proposals…", "is-loading");
        openMissingServicesPage(encodedPayload);
    }

    function setServiceFilter(filterName) {
        state.serviceFilter = filterName;

        elements.filterButtons.forEach(function (button) {
            button.classList.toggle(
                "is-active",
                button.dataset.serviceFilter === filterName
            );
        });

        renderRows();
    }

    function matchesServiceFilter(row, coveredSubgroups) {
        if (state.serviceFilter === "active") {
            return row.active;
        }

        if (state.serviceFilter === "inactive") {
            return isMissingCoverage(row, coveredSubgroups);
        }

        return true;
    }

    function matchesServiceSearch(row, query) {
        if (!query) return true;
        return [row.service, row.group, row.subGroup, row.sku].some(function (value) {
            return normalizeName(value).includes(query);
        });
    }

    function initializeCollapsedGroups(allGroups) {
        if (state.collapseInitialized) {
            return;
        }

        state.collapsedGroups.clear();

        // Keep groups containing active services or restored proposal inputs open.
        allGroups.forEach(function (rows, groupName) {
            const hasActive = rows.some(function (row) {
                return row.active;
            });
            const hasProposalInput = rows.some(function (row) {
                return hasSelectionInput(row.selection);
            });

            if (!hasActive && !hasProposalInput) {
                state.collapsedGroups.add(groupName);
            }
        });

        state.collapseInitialized = true;
    }

    function createGroupHeader(groupName, visibleRows, allGroupRows) {
        const groupRow = document.createElement("tr");
        groupRow.className = "sla-group-row";

        const cell = document.createElement("td");
        cell.colSpan = TABLE_COLUMN_COUNT;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "sla-group-toggle";

        const collapsedGroups = elements.serviceSearch.value.trim()
            ? state.searchCollapsedGroups
            : state.collapsedGroups;
        const collapsed = collapsedGroups.has(groupName);
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");

        const chevron = document.createElement("span");
        chevron.className = "sla-group-chevron";
        chevron.textContent = collapsed ? "▶" : "▼";

        const name = document.createElement("span");
        name.className = "sla-group-name";
        name.textContent = groupName;

        const activeCount = allGroupRows.filter(function (row) {
            return row.active;
        }).length;

        const meta = document.createElement("span");
        meta.className = "sla-group-meta";
        meta.textContent = activeCount + " active / " + allGroupRows.length + " services";

        button.appendChild(chevron);
        button.appendChild(name);
        button.appendChild(meta);

        button.addEventListener("click", function () {
            if (collapsedGroups.has(groupName)) {
                collapsedGroups.delete(groupName);
            } else {
                collapsedGroups.add(groupName);
            }
            renderRows();
        });

        cell.appendChild(button);
        groupRow.appendChild(cell);

        return groupRow;
    }

    function effectivePrice(data) {
        const custom = decimalValue(data.selection.customPrice);
        if (custom !== null && custom >= 0) {
            return custom;
        }

        const standard = decimalValue(data.standardPrice);
        return standard !== null && standard >= 0 ? standard : null;
    }

    function monthlyUnitPrice(data) {
        const unitPrice = effectivePrice(data);
        if (unitPrice === null) {
            return null;
        }

        const unit = normalizeName(data.unit);
        if (unit.includes("year") || unit.includes("annual")) {
            return unitPrice / 12;
        }

        return unitPrice;
    }

    function effectiveSetup(data) {
        const custom = decimalValue(data.selection.customSetup);
        if (custom !== null && custom >= 0) {
            return custom;
        }

        const standard = decimalValue(data.standardSetup);
        return standard !== null && standard >= 0 ? standard : null;
    }

    function monthlyQuote(data) {
        if (!isValidPhase(data.selection.phase)) {
            return { selected: false, tbc: false, value: 0 };
        }

        const quantity = decimalValue(data.selection.quantity);
        const price = monthlyUnitPrice(data);
        if (quantity === null || quantity <= 0 || price === null) {
            return { selected: true, tbc: true, value: 0 };
        }

        return { selected: true, tbc: false, value: quantity * price };
    }

    function setupQuote(data) {
        if (!isValidPhase(data.selection.phase)) {
            return { selected: false, tbc: false, value: 0 };
        }

        const setup = effectiveSetup(data);
        if (setup === null) {
            return { selected: true, tbc: true, value: 0 };
        }

        return { selected: true, tbc: false, value: setup };
    }

    function validateInput(input, fieldName) {
        let message = "";

        if (fieldName === "phase" && text(input.value) && !isValidPhase(input.value)) {
            message = "Phase must be a whole number starting from 1.";
        } else if (fieldName === "quantity" && !isValidOptionalAmount(input.value, false)) {
            message = "Quantity must be greater than 0 or left blank for TBC.";
        } else if (
            (fieldName === "customPrice" || fieldName === "customSetup") &&
            !isValidOptionalAmount(input.value, true)
        ) {
            message = "Enter 0 or a positive amount, or leave this blank.";
        }

        input.setCustomValidity(message);
        input.classList.toggle("is-invalid", Boolean(message));
        input.setAttribute("aria-invalid", message ? "true" : "false");
        input.title = message;
        return !message;
    }

    function setQuoteCell(cell, quote) {
        cell.classList.remove("muted-value", "is-tbc");

        if (!quote.selected) {
            cell.textContent = "—";
            cell.classList.add("muted-value");
        } else if (quote.tbc) {
            cell.textContent = "TBC";
            cell.classList.add("is-tbc");
        } else {
            cell.textContent = money(quote.value);
        }
    }

    function addQuoteInputCell(row, data, fieldName, options) {
        const cell = document.createElement("td");
        cell.className = "quote-input-cell " + (options.cellClass || "");

        const input = document.createElement("input");
        input.type = "number";
        input.className = "quote-input";
        // Show the current catalogue price as an editable value. Keep an empty
        // selection until the user changes it, so later Books syncs still apply.
        const catalogueValue = fieldName === "customPrice" ? data.standardPrice :
            fieldName === "customSetup" ? data.standardSetup : null;
        input.value = text(data.selection[fieldName]) ||
            (catalogueValue !== null && catalogueValue !== undefined ? String(catalogueValue) : "");
        input.placeholder = options.placeholder || "";
        input.min = options.min;
        input.step = options.step;
        input.setAttribute("aria-label", options.label + " for " + data.service);

        input.addEventListener("input", function () {
            data.selection[fieldName] = input.value;

            if (hasSelectionInput(data.selection)) {
                state.quoteSelections.set(data.quoteKey, data.selection);
            } else {
                state.quoteSelections.delete(data.quoteKey);
            }

            validateInput(input, fieldName);
            row.classList.toggle("is-quote-selected", isValidPhase(data.selection.phase));
            row.classList.toggle("has-quote-input", hasSelectionInput(data.selection));
            setQuoteCell(options.quoteCell, monthlyQuote(data));
            updateProposalSummary(buildServiceRows(buildActiveServiceMap(matchingInvoiceRows())));
            saveProposalWorkspace();
        });

        input.addEventListener("blur", function () {
            validateInput(input, fieldName);
        });

        cell.appendChild(input);
        row.appendChild(cell);
        return cell;
    }

    function createServiceRow(data) {
        const row = document.createElement("tr");
        row.className = "sla-service-row " + (data.active ? "is-active" : "is-inactive");
        row.classList.toggle("is-quote-selected", isValidPhase(data.selection.phase));
        row.classList.toggle("has-quote-input", hasSelectionInput(data.selection));

        addCell(row, data.subGroup);

        const serviceCell = addCell(row, data.service);
        serviceCell.classList.add("service-name");

        addStatusCell(row, data.active);

        addCell(
            row,
            data.active ? data.invoice.quantity : "—",
            data.active ? "numeric" : "numeric muted-value"
        );

        addCell(
            row,
            data.active ? data.invoice.contracts.join("; ") : "",
            "multiline"
        );

        addCell(
            row,
            data.active ? money(data.invoice.monthly) : "",
            "money"
        );

        addCell(
            row,
            data.active ? data.invoice.quantity : 0,
            "numeric"
        );

        const quoteCell = document.createElement("td");
        quoteCell.className = "money quote-result";

        if (data.displayOnly) {
            ["phase", "quantity", "custom price", "custom setup"].forEach(function () {
                addCell(row, "—", "muted-value invoice-only-field");
            });
            row.classList.add("is-display-only");
            serviceCell.title = "Invoice-only item. Add it to the service catalogue before quoting.";
        } else {
            addQuoteInputCell(row, data, "phase", {
                label: "Phase",
                min: "1",
                step: "1",
                placeholder: "Enter phase",
                quoteCell: quoteCell
            });
            addQuoteInputCell(row, data, "quantity", {
                label: "Quantity quoting",
                min: "0.01",
                step: "any",
                placeholder: quantityPlaceholder(data),
                cellClass: "numeric",
                quoteCell: quoteCell
            });
            addQuoteInputCell(row, data, "customPrice", {
                label: "Custom price",
                min: "0",
                step: "0.01",
                placeholder: decimalValue(data.standardPrice) !== null ? "Uses " + money(data.standardPrice) : "Price TBC",
                cellClass: "money",
                quoteCell: quoteCell
            });
            addQuoteInputCell(row, data, "customSetup", {
                label: "Custom setup",
                min: "0",
                step: "0.01",
                placeholder: decimalValue(data.standardSetup) !== null ? "Uses " + money(data.standardSetup) : "Setup TBC",
                cellClass: "money",
                quoteCell: quoteCell
            });
        }

        addCell(row, money(data.standardPrice), "money");
        addCell(row, data.unit);

        addRecurringInvoiceCell(row, data.active ? data.invoice.recurringIds : []);

        addCell(
            row,
            data.active ? data.invoice.nextDates.join("; ") : "",
            "multiline"
        );

        if (data.displayOnly) {
            quoteCell.textContent = "—";
            quoteCell.classList.add("muted-value");
        } else {
            setQuoteCell(quoteCell, monthlyQuote(data));
        }
        row.appendChild(quoteCell);

        return row;
    }

    function renderRows() {
        const customer = elements.customer.value;
        const slaType = elements.slaType.value;
        const searchQuery = normalizeName(elements.serviceSearch.value);

        if (!customer) {
            const message = slaType && elements.customer.options.length <= 1
                ? "No customers match " + slaType + "."
                : "Select a customer to display services.";
            state.machineCount = null;
            elements.status.textContent = message;
            resetSummary();
            updateProposalSummary([]);
            showEmpty(message);
            return;
        }

        const invoiceRows = matchingInvoiceRows();
        const activeMap = buildActiveServiceMap(invoiceRows);
        const serviceRows = buildServiceRows(activeMap).concat(buildUnmatchedInvoiceRows(invoiceRows));
        const allCustomerInvoiceRows = customerInvoiceRows();
        const customerServiceRows = buildServiceRows(buildActiveServiceMap(allCustomerInvoiceRows))
            .concat(buildUnmatchedInvoiceRows(allCustomerInvoiceRows));
        state.machineCount = deriveMachineCount(customerServiceRows);
        applyDefaultQuoteQuantities(serviceRows);
        const allGroups = groupRows(serviceRows);
        const coveredSubgroups = coveredSubgroupKeys(serviceRows);

        updateSummary(serviceRows, activeMap);
        updateProposalSummary(serviceRows);
        initializeCollapsedGroups(allGroups);

        const visibleRows = serviceRows.filter(function (row) {
            return matchesServiceFilter(row, coveredSubgroups) &&
                matchesServiceSearch(row, searchQuery);
        });
        const visibleGroups = groupRows(visibleRows);

        elements.body.replaceChildren();

        if (!visibleRows.length) {
            const emptyMessage = searchQuery
                ? "No services match your search in this view."
                : state.serviceFilter === "inactive"
                ? "No uncovered service subgroups were found for this customer."
                : "No services match the selected view.";
            elements.status.textContent = emptyMessage;
            showEmpty(emptyMessage);
            return;
        }

        const activeCount = serviceRows.filter(function (row) {
            return row.active;
        }).length;

        elements.status.textContent =
            customer +
            " — " +
            activeCount +
            " active — showing " +
            visibleRows.length +
            " of " +
            serviceRows.length +
            (slaType ? " in " + slaType : "");

        const fragment = document.createDocumentFragment();

        visibleGroups.forEach(function (rows, groupName) {
            const allGroupRows = allGroups.get(groupName) || rows;
            fragment.appendChild(createGroupHeader(groupName, rows, allGroupRows));

            const collapsedGroups = searchQuery ? state.searchCollapsedGroups : state.collapsedGroups;
            if (!collapsedGroups.has(groupName)) {
                rows.forEach(function (rowData) {
                    fragment.appendChild(createServiceRow(rowData));
                });
            }
        });

        elements.body.appendChild(fragment);
    }

    function enableViewer(invoiceRows, catalogueRows, customerRows) {
        const activeCustomerRows = addSavedCustomer(customerRows.filter(function (row) {
            return !crmCustomerIsInactive(row);
        }));
        state.invoiceRows = invoiceRows;
        state.catalogueRows = catalogueRows;
        state.customerRows = activeCustomerRows;
        state.quoteSelections.clear();
        state.viewerReady = true;
        state.pendingRetries = 0;
        state.serviceFilter = "all";
        state.collapsedGroups.clear();
        state.searchCollapsedGroups.clear();
        elements.serviceSearch.value = "";
        state.collapseInitialized = false;

        const slaTypes = orderedSlaTypes(invoiceRows);
        if (!slaTypes.includes(NO_RECURRING_SLA_FILTER)) {
            slaTypes.push(NO_RECURRING_SLA_FILTER);
        }
        replaceOptions(elements.slaType, "All SLA types", slaTypes);
        refreshCustomerOptions();

        elements.slaType.disabled = false;
        elements.customer.disabled = false;
        elements.openNewCustomer.disabled = false;
        elements.serviceSearch.disabled = false;
        elements.filterButtons.forEach(function (button) {
            button.disabled = false;
            button.classList.toggle("is-active", button.dataset.serviceFilter === "all");
        });

        elements.status.textContent = "Select a customer to display services.";
        resetSummary();
        updateProposalSummary([]);
        showEmpty("Select a customer to display services.");

        setBanner(
            "CRM and Analytics connected — " +
            activeCustomerRows.length +
            " active companies, " +
            invoiceRows.length +
            " invoice rows and " +
            catalogueRows.length +
            " catalogue services loaded."
        );
        if (!state.restorePayload && window.MCGQuoteWorkspace) {
            const session = window.MCGQuoteWorkspace.current();
            const customerNames = uniqueCrmCustomers(activeCustomerRows);
            if (session && customerNames.includes(session.customerName)) {
                state.restorePayload = normaliseRestorePayload({
                    createdAt: session.updatedAt,
                    customerName: session.customerName,
                    selectedPhase: session.selectedPhase,
                    navigationMode: session.navigationMode,
                    selections: session.proposals || []
                });
            }
        }
        applyRestorePayload();
    }

    function handlePayload(payload) {
        const status = text(payload.status).toLowerCase();
        const invoiceRows = extractRows(payload, "invoiceRows");
        const catalogueRows = extractRows(payload, "catalogueRows");
        const customerRows = extractRows(payload, "customerRows");

        if (status === "pending") {
            state.pendingRetries += 1;
            setBanner(
                payload.message || "Analytics export is being prepared…",
                "is-loading"
            );
            elements.status.textContent = "Waiting for Analytics data…";
            showLoadingRows();

            if (state.pendingRetries <= MAX_PENDING_RETRIES) {
                window.setTimeout(loadAnalyticsData, RETRY_DELAY_MS);
            } else {
                setBanner(
                    "The Analytics export is taking longer than expected. Refresh this page shortly.",
                    "is-error"
                );
                showEmpty("Analytics is still preparing the data. Refresh this page shortly.");
            }
            return;
        }

        if (catalogueRows.length && customerRows.length) {
            enableViewer(invoiceRows, catalogueRows, customerRows);
            if (payload.cacheStale) {
                setBanner("Using saved data from " + (payload.lastUpdated || "the last successful refresh") + ". Source refresh is pending or unavailable.", "is-stale");
            }
            return;
        }

        if (invoiceRows.length && !catalogueRows.length) {
            const message =
                "Invoice data loaded, but the SLA catalogue is missing. " +
                "Update the Creator Custom API to execute GetSLAViewerData.";

            setBanner(message, "is-error");
            elements.status.textContent = "Catalogue data is missing.";
            showEmpty(message);
            return;
        }

        if (catalogueRows.length && !customerRows.length) {
            const message =
                "CRM company data is missing. Update GetSLAViewerData to include customerRows.";
            setBanner(message, "is-error");
            elements.status.textContent = "CRM company data is missing.";
            showEmpty(message);
            return;
        }

        const message =
            payload.message || "The API did not return the required SLA viewer data.";

        setBanner(message, "is-error");
        elements.status.textContent = "Data could not be loaded.";
        showEmpty(message);
    }

    function loadAnalyticsData() {
        if (window.__SLA_SERVICES_TEST_PAYLOAD__) {
            handlePayload(window.__SLA_SERVICES_TEST_PAYLOAD__);
            return;
        }

        if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA) {
            setBanner("Zoho Creator widget SDK did not load.", "is-error");
            elements.status.textContent = "Data could not be loaded.";
            showEmpty("Open this widget from inside the signed-in Creator application.");
            return;
        }

        const config = {
            api_name: CUSTOM_API_NAME,
            http_method: "GET"
        };

        ZOHO.CREATOR.DATA.invokeCustomApi(config)
            .then(function (response) {
                const payload = findFunctionPayload(response, 0);

                if (!payload) {
                    throw new Error(
                        "The Custom API response did not contain SLA viewer data."
                    );
                }

                handlePayload(payload);
            })
            .catch(function (error) {
                const message = error && error.message ? error.message : String(error);

                setBanner(
                    "Could not call the Creator Custom API: " + message,
                    "is-error"
                );
                elements.status.textContent = "Data could not be loaded.";
                showEmpty(
                    "Check that the Custom API link name is " +
                    CUSTOM_API_NAME +
                    " and its user scope allows this user."
                );
            });
    }

    elements.slaType.addEventListener("change", function () {
        const previousCustomer = elements.customer.value;
        refreshCustomerOptions();
        if (previousCustomer !== elements.customer.value) {
            state.quoteSelections.clear();
            state.selectedQuotePhase = "";
        }
        state.collapsedGroups.clear();
        state.collapseInitialized = false;
        renderRows();
    });

    elements.customer.addEventListener("change", function () {
        state.quoteSelections.clear();
        state.selectedQuotePhase = "";
        restoreWorkspaceSelections(elements.customer.value);
        state.serviceFilter = "all";
        state.collapsedGroups.clear();
        state.searchCollapsedGroups.clear();
        elements.serviceSearch.value = "";
        state.collapseInitialized = false;

        elements.filterButtons.forEach(function (button) {
            button.classList.toggle("is-active", button.dataset.serviceFilter === "all");
        });

        renderRows();
        saveProposalWorkspace();
    });

    let newCustomerReturnFocus = null;
    let savingNewCustomer = false;

    function closeNewCustomerDialog() {
        if (savingNewCustomer) return;
        elements.newCustomerModal.hidden = true;
        document.body.classList.remove("has-open-modal");
        if (newCustomerReturnFocus) newCustomerReturnFocus.focus();
        newCustomerReturnFocus = null;
    }

    function openNewCustomerDialog() {
        newCustomerReturnFocus = document.activeElement;
        elements.newCustomerForm.reset();
        elements.newCustomerStatus.textContent = "";
        elements.newCustomerStatus.className = "new-customer-status";
        elements.newCustomerModal.hidden = false;
        document.body.classList.add("has-open-modal");
        elements.newCustomerForm.elements.companyName.focus();
    }

    async function submitNewCustomer(event) {
        event.preventDefault();
        if (savingNewCustomer) return;
        const form = elements.newCustomerForm.elements;
        const request = {
            companyName: text(form.companyName.value),
            firstName: text(form.firstName.value),
            lastName: text(form.lastName.value),
            email: text(form.email.value),
            mobile: text(form.mobile.value)
        };
        if (state.customerRows.some(function (row) { return normalizeName(crmCustomerName(row)) === normalizeName(request.companyName); })) {
            elements.newCustomerStatus.textContent = "This company is already in the customer list. Select it instead.";
            elements.newCustomerStatus.className = "new-customer-status is-error";
            return;
        }
        if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA) {
            elements.newCustomerStatus.textContent = "Open this page inside Zoho Creator to create a customer.";
            elements.newCustomerStatus.className = "new-customer-status is-error";
            return;
        }
        savingNewCustomer = true;
        elements.saveNewCustomer.disabled = true;
        elements.cancelNewCustomer.disabled = true;
        elements.cancelNewCustomerTop.disabled = true;
        elements.newCustomerStatus.textContent = "Creating CRM company and contact, then importing to Books…";
        try {
            const response = await ZOHO.CREATOR.DATA.invokeCustomApi({
                api_name: CREATE_CUSTOMER_API_NAME,
                http_method: "POST",
                payload: { request_data: JSON.stringify(request) }
            });
            const result = findFunctionPayload(response, 0);
            if (!result || result.status !== "success" || !text(result.crmAccountId) || !text(result.booksCustomerId)) {
                throw new Error(result && result.message || "Customer creation returned an incomplete result. Check CRM and Books before trying again.");
            }
            const name = text(result.customerName || request.companyName);
            state.customerRows.push({ "Account Name": name, "CRM Account ID": String(result.crmAccountId) });
            elements.slaType.value = "";
            refreshCustomerOptions();
            elements.customer.value = name;
            state.quoteSelections.clear();
            state.selectedQuotePhase = "";
            if (window.MCGQuoteWorkspace) {
                window.MCGQuoteWorkspace.save(name, {
                    newCustomer: true,
                    crmAccountId: String(result.crmAccountId),
                    booksCustomerId: String(result.booksCustomerId),
                    navigationMode: state.navigationMode
                });
            }
            renderRows();
            setBanner(name + " is ready for proposal and Books quoting.");
            elements.newCustomerModal.hidden = true;
            document.body.classList.remove("has-open-modal");
            elements.customer.focus();
        } catch (error) {
            elements.newCustomerStatus.textContent = error.message || String(error);
            elements.newCustomerStatus.className = "new-customer-status is-error";
        } finally {
            savingNewCustomer = false;
            elements.saveNewCustomer.disabled = false;
            elements.cancelNewCustomer.disabled = false;
            elements.cancelNewCustomerTop.disabled = false;
        }
    }

    elements.openNewCustomer.addEventListener("click", openNewCustomerDialog);
    elements.cancelNewCustomer.addEventListener("click", closeNewCustomerDialog);
    elements.cancelNewCustomerTop.addEventListener("click", closeNewCustomerDialog);
    elements.newCustomerForm.addEventListener("submit", submitNewCustomer);
    elements.newCustomerModal.addEventListener("click", function (event) {
        if (event.target === elements.newCustomerModal) closeNewCustomerDialog();
    });

    let clearDialogReturnFocus = null;

    function closeClearQuoteDialog() {
        elements.clearQuoteModal.hidden = true;
        document.body.classList.remove("has-open-modal");
        if (clearDialogReturnFocus) clearDialogReturnFocus.focus();
        clearDialogReturnFocus = null;
    }

    function openClearQuoteDialog() {
        clearDialogReturnFocus = document.activeElement;
        elements.clearQuoteModal.hidden = false;
        document.body.classList.add("has-open-modal");
        window.requestAnimationFrame(function () {
            elements.cancelClearQuote.focus();
        });
    }

    function clearTemporaryQuoteInputs() {
        state.quoteSelections.clear();
        state.selectedQuotePhase = "";
        clearLegacyTransferCache();
        renderRows();
        saveProposalWorkspace();
        closeClearQuoteDialog();
    }

    elements.clearQuoteInputs.addEventListener("click", openClearQuoteDialog);
    elements.cancelClearQuote.addEventListener("click", closeClearQuoteDialog);
    elements.confirmClearQuote.addEventListener("click", clearTemporaryQuoteInputs);
    elements.clearQuoteModal.addEventListener("click", function (event) {
        if (event.target === elements.clearQuoteModal) closeClearQuoteDialog();
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !elements.clearQuoteModal.hidden) closeClearQuoteDialog();
        if (event.key === "Escape" && !elements.newCustomerModal.hidden) closeNewCustomerDialog();
    });

    elements.quotePhase.addEventListener("change", function () {
        state.selectedQuotePhase = elements.quotePhase.value;
        renderQuotePreview();
        saveProposalWorkspace();
    });

    elements.generateProposal.addEventListener("click", generateMissingServicesProposal);

    elements.filterButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            setServiceFilter(button.dataset.serviceFilter);
        });
    });

    elements.serviceSearch.addEventListener("input", function () {
        state.searchCollapsedGroups.clear();
        renderRows();
    });

    resetSummary();
    updateProposalSummary([]);
    setBanner("Connecting to Zoho CRM and Analytics…", "is-loading");
    showLoadingRows();
    clearLegacyTransferCache();
    readRestorePayload().then(function (payload) {
        state.restorePayload = payload;
        if (payload) {
            applyRestorePayload();
        }
    });
    loadAnalyticsData();

    window.__slaServicesApp = {
        normaliseRestorePayload: normaliseRestorePayload,
        deriveMachineCount: deriveMachineCount,
        isWorkstationUnit: isWorkstationUnit,
        restoreForTest: function (payload) {
            state.restorePayload = normaliseRestorePayload(payload);
            return applyRestorePayload();
        }
    };
}());
