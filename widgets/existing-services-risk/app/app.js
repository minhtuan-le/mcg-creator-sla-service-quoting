(function () {
    "use strict";

    const CUSTOM_API_NAME = "get_sla_analytics_data";
    const QUOTE_API_NAME = "create_sla_draft_quote";
    const NO_RECURRING_SLA_FILTER = "NO SLA | NO RECURRING INV";
    const DEFAULT_DELIVERY_ITEM_ID = "1417654000008249014";
    const BOOKS_EDR_ITEM_ID = "1417654000018767777";
    const WORKFLOW_QUERY_PARAM = "workflow_data";
    const LEGACY_PROPOSAL_QUERY_PARAM = "proposal_data";
    const APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/environment/development/recurring-invoice-report/";
    const CRM_APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/crm-homepage/";
    const APP_QUOTE_PAGE_LINK = "Quote_Finalisation";
    const CRM_QUOTE_PAGE_LINK = "Quote_Finalisation1";
    const QUOTE_QUERY_PARAM = "quote_data";
    const RETRY_DELAY_MS = 4000;
    const MAX_PENDING_RETRIES = 30;
    const RISK_TOTAL = 15;
    const RISK_CATEGORIES = [
        { name: "Computer Security", total: 3 },
        { name: "Email Backup & Security", aliases: ["Email Security & Backup"], total: 3 },
        { name: "Network Security", total: 5 },
        { name: "User Security", total: 4 }
    ];
    const RISK_COLORS = ["#d74747", "#ee8b2d", "#d7ad21", "#2da56e"];

    const collator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });
    const state = {
        invoiceRows: [], catalogueRows: [], customerRows: [], pendingRetries: 0, exportModel: null,
        serviceEdits: new Map(), serviceOrder: [], hardware: [], incoming: null, searchResults: [],
        draggedServiceKey: "", draggedHardwareIndex: null,
        hardwareSearchTimer: null, hardwareSearchRequest: 0,
        navigationMode: detectNavigationMode(), ready: false
    };

    const elements = {
        banner: document.getElementById("connectionBanner"),
        slaType: document.getElementById("slaTypeFilter"),
        customer: document.getElementById("customerFilter"),
        copy: document.getElementById("copyPowerPointButton"),
        copyRisk: document.getElementById("copyRiskButton"),
        download: document.getElementById("downloadPowerPointButton"),
        downloadRisk: document.getElementById("downloadRiskButton"),
        print: document.getElementById("printButton"),
        loadingState: document.getElementById("initialLoadingState"),
        content: document.getElementById("reportContent"),
        empty: document.getElementById("emptyState"),
        emptyTitle: document.getElementById("emptyTitle"),
        emptyMessage: document.getElementById("emptyMessage"),
        report: document.getElementById("generatedReport"),
        client: document.getElementById("clientName"),
        footerClient: document.getElementById("footerClient"),
        generatedDate: document.getElementById("generatedDate"),
        serviceCount: document.getElementById("serviceCount"),
        licenceCount: document.getElementById("licenceCount"),
        monthlyCost: document.getElementById("monthlyCost"),
        riskGap: document.getElementById("riskGap"),
        serviceLineStatus: document.getElementById("serviceLineStatus"),
        servicesBody: document.getElementById("servicesBody"),
        riskDonut: document.getElementById("riskDonut"),
        donutPercent: document.getElementById("donutPercent"),
        riskHeadline: document.getElementById("riskHeadline"),
        riskWheelLegend: document.getElementById("riskWheelLegend"),
        riskBars: document.getElementById("riskBars"),
        riskBody: document.getElementById("riskBody"),
        hardwareSearch: document.getElementById("hardwareSearch"),
        searchHardware: document.getElementById("searchHardwareButton"),
        closeHardwareResults: document.getElementById("closeHardwareResultsButton"),
        hardwareStatus: document.getElementById("hardwareSearchStatus"),
        hardwareResults: document.getElementById("hardwareSearchResults"),
        hardwareBody: document.getElementById("hardwareBody"),
        deliveryIncluded: document.getElementById("deliveryIncluded"),
        deliveryItemId: document.getElementById("deliveryItemId"),
        deliveryRate: document.getElementById("deliveryRate"),
        discountMode: document.getElementById("discountMode"),
        discountValue: document.getElementById("discountValue"),
        checkedServicesTotal: document.getElementById("checkedServicesTotal"),
        hardwareTotal: document.getElementById("hardwareTotal"),
        deliveryTotal: document.getElementById("deliveryTotal"),
        discountTotal: document.getElementById("discountTotal"),
        packageTotal: document.getElementById("packageTotal"),
        packageStatus: document.getElementById("packageStatus"),
        continueToMissing: document.getElementById("continueToMissing")
    };

    function parseJson(value) {
        if (typeof value !== "string") return value;
        const trimmed = value.trim();
        if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
        try { return JSON.parse(trimmed); } catch (error) { return value; }
    }

    function detectNavigationMode() {
        if (window.__EXISTING_SERVICES_NAVIGATION_MODE__ === "embed" || window.__EXISTING_SERVICES_NAVIGATION_MODE__ === "shell") {
            return window.__EXISTING_SERVICES_NAVIGATION_MODE__;
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

    function pageUrl(pageLink, encodedPayload) {
        const base = state.navigationMode === "embed"
            ? CRM_APP_ROOT_URL + "#Page:" + pageLink
            : APP_ROOT_URL + "#Page:" + pageLink;
        return encodedPayload ? base + "?" + WORKFLOW_QUERY_PARAM + "=" + encodeURIComponent(encodedPayload) : base;
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

    function findQueryParameter(value, name, depth) {
        if (depth > 6 || value === null || value === undefined) return "";
        const parsed = parseJson(value);
        if (!parsed || typeof parsed !== "object") return "";
        if (Object.prototype.hasOwnProperty.call(parsed, name)) return parsed[name];
        for (const child of Object.values(parsed)) {
            const found = findQueryParameter(child, name, depth + 1);
            if (text(found)) return found;
        }
        return "";
    }

    async function readIncomingWorkflow() {
        let encoded = "";
        try {
            if (window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL && typeof ZOHO.CREATOR.UTIL.getQueryParams === "function") {
                const params = await ZOHO.CREATOR.UTIL.getQueryParams();
                encoded = findQueryParameter(params, WORKFLOW_QUERY_PARAM, 0) ||
                    findQueryParameter(params, LEGACY_PROPOSAL_QUERY_PARAM, 0);
            }
        } catch (error) { /* The page can be opened directly. */ }
        if (!encoded) {
            const locations = [];
            try { locations.push(window.location.href); } catch (error) { /* Restricted frame. */ }
            try { locations.push(window.parent.location.href); } catch (error) { /* Restricted frame. */ }
            try { locations.push(window.top.location.href); } catch (error) { /* Restricted frame. */ }
            try { locations.push(document.referrer); } catch (error) { /* Referrer may be blank. */ }
            for (const location of locations) {
                encoded = parameterFromUrl(location, WORKFLOW_QUERY_PARAM) ||
                    parameterFromUrl(location, LEGACY_PROPOSAL_QUERY_PARAM);
                if (encoded) break;
            }
        }
        if (!window.MCGQuoteWorkspace) return null;
        return typeof window.MCGQuoteWorkspace.decodeTransfer === "function"
            ? await window.MCGQuoteWorkspace.decodeTransfer(encoded)
            : window.MCGQuoteWorkspace.decode(encoded);
    }

    function findFunctionPayload(value, depth) {
        if (depth > 7) return null;
        const parsed = parseJson(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        if (
            Object.prototype.hasOwnProperty.call(parsed, "invoiceRows") ||
            Object.prototype.hasOwnProperty.call(parsed, "catalogueRows") ||
            Object.prototype.hasOwnProperty.call(parsed, "customerRows") ||
            (
                Object.prototype.hasOwnProperty.call(parsed, "status") &&
                Object.prototype.hasOwnProperty.call(parsed, "message")
            )
        ) return parsed;

        const preferredKeys = ["result", "data", "response", "output", "details"];
        for (const key of preferredKeys) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                const match = findFunctionPayload(parsed[key], depth + 1);
                if (match) return match;
            }
        }
        for (const child of Object.values(parsed)) {
            const match = findFunctionPayload(child, depth + 1);
            if (match) return match;
        }
        return null;
    }

    function extractArray(payload, key) {
        const value = parseJson(payload && payload[key]);
        if (Array.isArray(value)) return value;
        if (value && Array.isArray(value.data)) return value.data;
        return [];
    }

    function text(value) {
        if (value === null || value === undefined) return "";
        if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
        if (typeof value === "object") {
            return text(value.display_value || value.name || value.value || value.ID || "");
        }
        return String(value).trim();
    }

    function pick(row, aliases) {
        if (!row || typeof row !== "object") return "";
        for (const key of aliases) {
            if (Object.prototype.hasOwnProperty.call(row, key) && text(row[key]) !== "") return row[key];
        }
        const normalizedKeys = new Map(Object.keys(row).map(function (key) {
            return [normalize(key), key];
        }));
        for (const alias of aliases) {
            const actual = normalizedKeys.get(normalize(alias));
            if (actual && text(row[actual]) !== "") return row[actual];
        }
        return "";
    }

    function normalize(value) {
        return text(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
    }

    function invoiceCustomerMatches(invoiceName, selectedCustomer) {
        const selected = text(selectedCustomer);
        const statusSuffix = selected.match(/^(.*-\s*\d{2})\s+ACCOUNT ON HOLD$/i);
        return normalize(invoiceName) === normalize(selected) ||
            Boolean(statusSuffix && normalize(invoiceName) === normalize(statusSuffix[1]));
    }

    function isEdrService(service, businessName) {
        return ["edr", "kedr", "kaseyawatchguardedr"].includes(normalize(service)) ||
            normalize(businessName) === "kaseyawatchguardedr";
    }

    function number(value, fallback) {
        const cleaned = text(value).replace(/[$,%\s,]/g, "");
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function money(value) {
        return new Intl.NumberFormat("en-AU", {
            style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(number(value, 0));
    }

    function compactNumber(value) {
        return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(number(value, 0));
    }

    function customerName(row) {
        return text(pick(row, ["Customer", "Customer Name", "Company", "Company Name"]));
    }

    function crmCustomerName(row) {
        return text(pick(row, ["Account_Name", "Account Name", "Customer", "Customer Name", "Company", "Company Name"]));
    }

    function crmCustomerId(row) {
        return text(pick(row, ["id", "Id", "CRM Account ID", "CRM_Account_ID", "Account ID", "Account_ID"]));
    }

    function crmCustomerIsInactive(row) {
        const value = pick(row, ["Inactive"]);
        if (value === true || value === 1) return true;
        const normalized = normalize(value);
        return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
    }

    function selectedCrmCustomer() {
        const selected = normalize(elements.customer.value);
        return state.customerRows.find(function (row) {
            return normalize(crmCustomerName(row)) === selected;
        }) || null;
    }

    function slaTypeCode(value) {
        const match = text(value).match(/^SLA\s*-\s*(0[1-5])\b/i);
        return match ? match[1] : "";
    }

    function customerSlaCode(customer) {
        const match = text(customer).match(/-\s*(0[1-5])\s*$/);
        return match ? match[1] : "";
    }

    function orderedSlaTypes(rows) {
        const names = new Set(rows.map(function (row) { return text(row["SLA Type"]); }).filter(Boolean));
        return Array.from(names).sort(function (left, right) {
            const leftCode = slaTypeCode(left);
            const rightCode = slaTypeCode(right);
            if (leftCode && rightCode && leftCode !== rightCode) return Number(leftCode) - Number(rightCode);
            if (leftCode !== rightCode) return leftCode ? -1 : 1;
            return collator.compare(left, right);
        });
    }

    function customerHasRecurringInvoice(customer) {
        return state.invoiceRows.some(function (row) { return invoiceCustomerMatches(customerName(row), customer); });
    }

    function availableCustomerNames() {
        const names = Array.from(new Set(state.customerRows.map(crmCustomerName).filter(Boolean))).sort(collator.compare);
        const slaType = elements.slaType.value;
        if (slaType === NO_RECURRING_SLA_FILTER) {
            return names.filter(function (customer) { return !customerHasRecurringInvoice(customer); });
        }
        const code = slaTypeCode(slaType);
        return code ? names.filter(function (customer) { return customerSlaCode(customer) === code; }) : names;
    }

    function itemId(row) {
        return text(pick(row, ["Item ID", "Item Id", "Item_ID", "item_id", "Product ID", "Product Id"]));
    }

    function serviceName(row) {
        return text(pick(row, ["Item Display Name", "Service", "Item Name", "Product Name", "Name"]));
    }

    function categoryName(row) {
        return text(pick(row, ["Display Group", "Group", "Category", "Service Category"]));
    }

    function subgroupName(row) {
        return text(pick(row, ["Sub Group", "Subgroup", "Service Type", "Services"]));
    }

    function quantity(row) {
        return number(pick(row, ["Quantity", "Qty", "No of Licenses", "No. of Licences", "Licences", "Licenses", "License"]), 0);
    }

    function monthlyCharge(row) {
        return number(pick(row, ["Average Monthly Charges", "Monthly Cost", "Monthly $", "Monthly Charge", "Recurring Amount"]), 0);
    }

    function billingFrequency(row) {
        const direct = text(pick(row, ["Billing Frequency", "Frequency", "Billing Cycle", "Interval", "Repeat Every", "Recurring Every"]));
        if (direct) return cleanFrequency(direct);
        const unit = text(pick(row, ["Interval Unit", "Recurring Interval Unit"]));
        if (unit) return cleanFrequency(unit);
        return frequencyFromContract(text(pick(row, ["Contracts", "Contract", "Contract Details"])));
    }

    function frequencyFromContract(value) {
        const contract = text(value);
        if (!contract) return "—";

        const match = contract.match(/\/\s*(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i);
        if (!match) return "—";

        const amount = Number(match[1]);
        const period = match[2].toLowerCase();

        if (period.startsWith("day")) {
            return amount === 1 ? "Daily" : "Every " + compactNumber(amount) + " days";
        }
        if (period.startsWith("week")) {
            return amount === 1 ? "Weekly" : "Every " + compactNumber(amount) + " weeks";
        }
        if (period.startsWith("month")) {
            if (amount === 1) return "Monthly";
            if (amount === 3) return "Quarterly";
            if (amount === 6) return "Half-yearly";
            if (amount === 12) return "Yearly";
            return "Every " + compactNumber(amount) + " months";
        }
        if (period.startsWith("year")) {
            return amount === 1 ? "Yearly" : "Every " + compactNumber(amount) + " years";
        }

        return "—";
    }

    function cleanFrequency(value) {
        const raw = text(value).replace(/^\/+|\/+$/g, "").trim();
        const key = normalize(raw);
        if (!key) return "—";
        if (key.includes("month")) return "Monthly";
        if (key.includes("year") || key.includes("annual")) return "Yearly";
        if (key.includes("week")) return "Weekly";
        if (key.includes("quarter")) return "Quarterly";
        return raw;
    }

    function catalogueIndexes(rows) {
        const byId = new Map();
        const byName = new Map();
        rows.forEach(function (row) {
            if (itemId(row)) byId.set(normalize(itemId(row)), row);
            if (serviceName(row)) byName.set(normalize(serviceName(row)), row);
        });
        return { byId: byId, byName: byName };
    }

    function enrichRows(rows) {
        const indexes = catalogueIndexes(state.catalogueRows);
        return rows.map(function (invoice, index) {
            const catalogue = indexes.byId.get(normalize(itemId(invoice))) ||
                indexes.byName.get(normalize(serviceName(invoice))) || {};
            const invoiceFrequency = billingFrequency(invoice);
            const service = serviceName(invoice) || serviceName(catalogue) || "Unnamed service";
            const businessName = text(pick(catalogue, ["Business Name", "Business_Name"]));
            const booksItemId = isEdrService(service, businessName)
                ? BOOKS_EDR_ITEM_ID
                : itemId(invoice) || itemId(catalogue);
            const lineQuantity = quantity(invoice);
            const lineMonthly = monthlyCharge(invoice);
            const key = (booksItemId ? "item:" + booksItemId : "name:" + normalize(service)) + ":" + index;
            const saved = state.serviceEdits.get(key) || {};
            const category = displayCategoryName(categoryName(invoice) || categoryName(catalogue) || "Others");
            const subgroup = subgroupName(invoice) || subgroupName(catalogue) ||
                (normalize(category) === "others" ? "Miscellaneous services / discounts" : serviceName(invoice) || serviceName(catalogue) || "Other");
            return {
                key: key,
                invoice: invoice,
                catalogue: catalogue,
                category: category,
                subgroup: subgroup,
                service: service,
                included: saved.included !== false,
                itemId: isEdrService(service, businessName) ? BOOKS_EDR_ITEM_ID : text(saved.itemId) || booksItemId,
                sku: text(pick(invoice, ["SKU", "Sku"])) || text(pick(catalogue, ["SKU", "Sku"])),
                quantity: numericOrNull(saved.quantity) !== null ? Math.max(0, numericOrNull(saved.quantity)) : lineQuantity,
                frequency: invoiceFrequency !== "—" ? invoiceFrequency : billingFrequency(catalogue),
                monthly: (lineQuantity > 0 ? lineMonthly / lineQuantity : lineMonthly) * (numericOrNull(saved.quantity) !== null ? Math.max(0, numericOrNull(saved.quantity)) : lineQuantity),
                rate: lineQuantity > 0 ? lineMonthly / lineQuantity : lineMonthly,
                slaOrder: number(pick(invoice, ["SLA Order"]) || pick(catalogue, ["SLA Order"]), 999999),
                itemOrder: number(pick(invoice, ["Item Display Order"]) || pick(catalogue, ["Item Display Order"]), 999999)
            };
        });
    }

    function selectedInvoiceRows() {
        const selected = normalize(elements.customer.value);
        if (!selected) return [];
        const slaType = elements.slaType.value;
        if (slaType === NO_RECURRING_SLA_FILTER) return [];
        return state.invoiceRows.filter(function (row) {
            return invoiceCustomerMatches(customerName(row), elements.customer.value) &&
                (!slaType || text(row["SLA Type"]) === slaType) &&
                (serviceName(row) || itemId(row));
        });
    }

    function groupServices(enriched) {
        const groups = new Map();
        enriched.forEach(function (row) {
            const key = normalize(row.category) + "::" + normalize(row.subgroup);
            if (!groups.has(key)) {
                groups.set(key, {
                    category: row.category,
                    subgroup: row.subgroup,
                    services: new Set(),
                    frequencies: new Set(),
                    quantity: 0,
                    monthly: 0,
                    slaOrder: row.slaOrder,
                    itemOrder: row.itemOrder
                });
            }
            const group = groups.get(key);
            group.services.add(row.service);
            if (row.frequency && row.frequency !== "—") group.frequencies.add(row.frequency);
            group.quantity += row.quantity;
            group.monthly += row.monthly;
            group.slaOrder = Math.min(group.slaOrder, row.slaOrder);
            group.itemOrder = Math.min(group.itemOrder, row.itemOrder);
        });
        return Array.from(groups.values()).sort(function (left, right) {
            return left.slaOrder - right.slaOrder || left.itemOrder - right.itemOrder ||
                collator.compare(left.category, right.category) || collator.compare(left.subgroup, right.subgroup);
        });
    }

    function appendCell(row, value, className) {
        const cell = document.createElement("td");
        cell.textContent = text(value);
        if (className) cell.className = className;
        row.appendChild(cell);
        return cell;
    }

    function quantityStepper(value, label, onChange, options) {
        const settings = options || {};
        const wrap = document.createElement("span"); wrap.className = "quantity-stepper";
        const minus = document.createElement("button"); minus.type = "button"; minus.className = "quantity-button"; minus.textContent = "−"; minus.setAttribute("aria-label", "Decrease " + label);
        const input = document.createElement("input"); input.type = "number"; input.min = String(settings.min === undefined ? 1 : settings.min); input.step = String(settings.step || 1); input.value = String(value === null || value === undefined ? 1 : value); input.setAttribute("aria-label", label);
        const plus = document.createElement("button"); plus.type = "button"; plus.className = "quantity-button"; plus.textContent = "+"; plus.setAttribute("aria-label", "Increase " + label);
        function commit(next) {
            const minimum = number(input.min, 1); const parsed = Math.max(minimum, number(next, minimum));
            input.value = String(parsed); onChange(parsed);
        }
        minus.addEventListener("click", function () { commit(number(input.value, 1) - number(input.step, 1)); });
        plus.addEventListener("click", function () { commit(number(input.value, 1) + number(input.step, 1)); });
        input.addEventListener("change", function () { if (text(input.value)) commit(input.value); });
        wrap.append(minus, input, plus); return wrap;
    }

    function moveArrayItem(items, fromIndex, toIndex) {
        const copy = items.slice();
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= copy.length || toIndex >= copy.length || fromIndex === toIndex) return copy;
        const moved = copy.splice(fromIndex, 1)[0];
        copy.splice(toIndex, 0, moved);
        return copy;
    }

    function applyServiceOrder(lines) {
        const source = lines.slice();
        if (!state.serviceOrder.length) {
            state.serviceOrder = source.map(function (line) { return line.key; });
            return source;
        }
        const rank = new Map(state.serviceOrder.map(function (key, index) { return [key, index]; }));
        const originalRank = new Map(source.map(function (line, index) { return [line.key, index]; }));
        source.sort(function (left, right) {
            const leftRank = rank.has(left.key) ? rank.get(left.key) : state.serviceOrder.length + originalRank.get(left.key);
            const rightRank = rank.has(right.key) ? rank.get(right.key) : state.serviceOrder.length + originalRank.get(right.key);
            return leftRank - rightRank;
        });
        state.serviceOrder = source.map(function (line) { return line.key; });
        return source;
    }

    function reorderServiceLine(sourceKey, targetKey) {
        const keys = (state.currentLines || []).map(function (line) { return line.key; });
        const fromIndex = keys.indexOf(sourceKey);
        const toIndex = keys.indexOf(targetKey);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        state.serviceOrder = moveArrayItem(keys, fromIndex, toIndex);
        renderReport();
    }

    function dragHandle(label) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "drag-handle print-hide";
        handle.draggable = true;
        handle.textContent = "⋮⋮";
        handle.title = label;
        handle.setAttribute("aria-label", label);
        return handle;
    }

    function renderServices(lines) {
        elements.servicesBody.replaceChildren();
        if (!lines.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 7;
            cell.className = "table-empty";
            cell.textContent = "No current recurring services were found for this customer.";
            row.appendChild(cell);
            elements.servicesBody.appendChild(row);
            return;
        }

        let previousCategory = "";
        const fragment = document.createDocumentFragment();
        lines.forEach(function (line) {
            if (normalize(line.category) !== normalize(previousCategory)) {
                const categoryRow = document.createElement("tr");
                categoryRow.className = "category-row";
                const categoryCell = document.createElement("td");
                categoryCell.colSpan = 7;
                categoryCell.textContent = line.category;
                categoryRow.appendChild(categoryCell);
                fragment.appendChild(categoryRow);
                previousCategory = line.category;
            }
            const row = document.createElement("tr");
            row.className = line.included ? "is-included" : "is-excluded";
            const includeCell = document.createElement("td");
            includeCell.className = "include-cell";
            const handle = dragHandle("Drag " + line.service + " to change its quote position");
            handle.addEventListener("dragstart", function (event) {
                state.draggedServiceKey = line.key;
                row.classList.add("is-dragging");
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", line.key);
                }
            });
            handle.addEventListener("dragend", function () {
                state.draggedServiceKey = "";
                row.classList.remove("is-dragging");
            });
            row.addEventListener("dragover", function (event) {
                if (!state.draggedServiceKey || state.draggedServiceKey === line.key) return;
                event.preventDefault();
                row.classList.add("drag-over");
                if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            });
            row.addEventListener("dragleave", function () { row.classList.remove("drag-over"); });
            row.addEventListener("drop", function (event) {
                event.preventDefault();
                row.classList.remove("drag-over");
                const sourceKey = state.draggedServiceKey || event.dataTransfer && event.dataTransfer.getData("text/plain");
                state.draggedServiceKey = "";
                reorderServiceLine(sourceKey, line.key);
            });
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = line.included;
            checkbox.setAttribute("aria-label", "Include " + line.service + " in quote");
            checkbox.addEventListener("change", function () {
                line.included = checkbox.checked;
                state.serviceEdits.set(line.key, { included: line.included, itemId: line.itemId, quantity: line.quantity });
                row.className = line.included ? "is-included" : "is-excluded";
                renderReport();
            });
            includeCell.append(handle, checkbox);
            row.appendChild(includeCell);
            appendCell(row, line.subgroup, "service-type");
            appendCell(row, line.service);
            const itemCell = document.createElement("td");
            const itemInput = document.createElement("input");
            itemInput.type = "text";
            itemInput.className = "item-id-input";
            itemInput.value = line.itemId;
            itemInput.placeholder = "Map item";
            itemInput.setAttribute("aria-label", "Books Item ID for " + line.service);
            itemInput.addEventListener("input", function () {
                line.itemId = text(itemInput.value);
                state.serviceEdits.set(line.key, { included: line.included, itemId: line.itemId, quantity: line.quantity });
                saveWorkspacePackage();
            });
            itemCell.appendChild(itemInput);
            row.appendChild(itemCell);
            const quantityCell = document.createElement("td"); quantityCell.className = "number-col";
            quantityCell.appendChild(quantityStepper(line.quantity, "licence quantity for " + line.service, function (next) {
                line.quantity = next; line.monthly = line.rate * next;
                state.serviceEdits.set(line.key, { included: line.included, itemId: line.itemId, quantity: line.quantity });
                renderReport();
            }));
            row.appendChild(quantityCell);
            appendCell(row, line.frequency || "—");
            appendCell(row, money(line.monthly), "money-col print-hide");
            fragment.appendChild(row);
        });
        elements.servicesBody.appendChild(fragment);
    }

    function resolveRiskCategory(value) {
        const key = normalize(value);
        return RISK_CATEGORIES.find(function (category) {
            return [category.name].concat(category.aliases || []).some(function (name) {
                return normalize(name) === key;
            });
        }) || null;
    }

    function displayCategoryName(value) {
        const category = resolveRiskCategory(value);
        return category ? category.name : text(value);
    }

    function coverageKey(category, subgroup) {
        return normalize(category) + "::" + normalize(subgroup);
    }

    function calculateRisk(enriched) {
        const activeKeys = new Set();
        enriched.forEach(function (row) {
            const riskCategory = resolveRiskCategory(row.category);
            if (riskCategory) activeKeys.add(coverageKey(riskCategory.name, row.subgroup));
        });

        return RISK_CATEGORIES.map(function (riskCategory) {
            const catalogueSubgroups = new Set();
            state.catalogueRows.forEach(function (row) {
                if (resolveRiskCategory(categoryName(row)) === riskCategory) {
                    const subgroup = subgroupName(row) || serviceName(row);
                    if (subgroup) catalogueSubgroups.add(normalize(subgroup));
                }
            });

            let covered = 0;
            catalogueSubgroups.forEach(function (subgroup) {
                if (activeKeys.has(coverageKey(riskCategory.name, subgroup))) covered += 1;
            });

            if (!catalogueSubgroups.size) {
                const activeSubgroups = new Set(enriched.filter(function (row) {
                    return resolveRiskCategory(row.category) === riskCategory;
                }).map(function (row) { return normalize(row.subgroup); }).filter(Boolean));
                covered = activeSubgroups.size;
            }

            covered = Math.min(riskCategory.total, covered);
            const missing = Math.max(0, riskCategory.total - covered);
            return {
                name: riskCategory.name,
                total: riskCategory.total,
                covered: covered,
                missing: missing,
                percentage: riskCategory.total ? (missing / riskCategory.total) * 100 : 0
            };
        });
    }

    function sortRisksBySeverity(risks) {
        return risks.map(function (risk, sourceIndex) {
            return Object.assign({ sourceIndex: sourceIndex }, risk);
        }).sort(function (left, right) {
            return right.percentage - left.percentage || left.sourceIndex - right.sourceIndex;
        });
    }

    function riskTone(percentage) {
        if (percentage >= 67) return "high";
        if (percentage >= 34) return "medium";
        return "low";
    }

    const SVG_NS = "http://www.w3.org/2000/svg";

    function svgElement(name, attributes) {
        const element = document.createElementNS(SVG_NS, name);
        Object.keys(attributes || {}).forEach(function (attribute) {
            element.setAttribute(attribute, attributes[attribute]);
        });
        return element;
    }

    function polarPoint(cx, cy, radius, angle) {
        const radians = angle * Math.PI / 180;
        return {
            x: cx + Math.cos(radians) * radius,
            y: cy + Math.sin(radians) * radius
        };
    }

    function donutSegmentPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
        const safeEndAngle = endAngle - startAngle >= 360 ? endAngle - 0.001 : endAngle;
        const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
        const outerEnd = polarPoint(cx, cy, outerRadius, safeEndAngle);
        const innerEnd = polarPoint(cx, cy, innerRadius, safeEndAngle);
        const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
        const largeArc = safeEndAngle - startAngle > 180 ? 1 : 0;

        return "M " + outerStart.x.toFixed(2) + " " + outerStart.y.toFixed(2) +
            " A " + outerRadius + " " + outerRadius + " 0 " + largeArc + " 1 " +
            outerEnd.x.toFixed(2) + " " + outerEnd.y.toFixed(2) +
            " L " + innerEnd.x.toFixed(2) + " " + innerEnd.y.toFixed(2) +
            " A " + innerRadius + " " + innerRadius + " 0 " + largeArc + " 0 " +
            innerStart.x.toFixed(2) + " " + innerStart.y.toFixed(2) + " Z";
    }

    function renderRiskDonut(risks) {
        const cx = 310;
        const cy = 166;
        const outerRadius = 138;
        const innerRadius = 84;
        const categoryGap = 5;
        const controlGap = 1.3;
        const internalGapCount = RISK_TOTAL - RISK_CATEGORIES.length;
        const segmentAngle = (360 - categoryGap * RISK_CATEGORIES.length -
            controlGap * internalGapCount) / RISK_TOTAL;
        let currentAngle = -90 + categoryGap / 2;
        elements.riskDonut.replaceChildren();
        elements.riskWheelLegend.replaceChildren();

        risks.forEach(function (risk, index) {
            const color = RISK_COLORS[index % RISK_COLORS.length];
            const categoryStartAngle = currentAngle;
            for (let controlIndex = 0; controlIndex < risk.total; controlIndex += 1) {
                const covered = controlIndex < risk.covered;
                const segment = svgElement("path", {
                    class: "risk-wheel-segment " + (covered ? "is-covered" : "is-missing"),
                    d: donutSegmentPath(cx, cy, outerRadius, innerRadius,
                        currentAngle, currentAngle + segmentAngle),
                    fill: color,
                    tabindex: 0,
                    "aria-label": risk.name + " control " + (controlIndex + 1) +
                        " of " + risk.total + ": " + (covered ? "covered" : "missing")
                });
                const title = svgElement("title");
                title.textContent = risk.name + " — control " + (controlIndex + 1) +
                    " of " + risk.total + ": " + (covered ? "covered" : "missing");
                segment.appendChild(title);
                elements.riskDonut.appendChild(segment);
                currentAngle += segmentAngle;
                currentAngle += controlIndex < risk.total - 1 ? controlGap : categoryGap;
            }

            const categoryEndAngle = currentAngle - categoryGap;
            const labelAngle = categoryStartAngle + (categoryEndAngle - categoryStartAngle) / 2;
            const lineStart = polarPoint(cx, cy, outerRadius + 2, labelAngle);
            const lineBend = polarPoint(cx, cy, outerRadius + 20, labelAngle);
            const onRight = Math.cos(labelAngle * Math.PI / 180) >= 0;
            const lineEndX = onRight ? 475 : 145;
            const textX = onRight ? lineEndX + 7 : lineEndX - 7;
            const textAnchor = onRight ? "start" : "end";
            const callout = svgElement("g", { class: "risk-wheel-callout" });
            const leader = svgElement("path", {
                d: "M " + lineStart.x.toFixed(2) + " " + lineStart.y.toFixed(2) +
                    " L " + lineBend.x.toFixed(2) + " " + lineBend.y.toFixed(2) +
                    " L " + lineEndX + " " + lineBend.y.toFixed(2)
            });
            const dot = svgElement("circle", {
                cx: lineStart.x.toFixed(2), cy: lineStart.y.toFixed(2), r: 2
            });
            const label = svgElement("text", {
                x: textX, y: (lineBend.y + 4).toFixed(2), "text-anchor": textAnchor
            });
            label.textContent = risk.name + " " + Math.round(risk.percentage) + "%";
            callout.append(leader, dot, label);
            elements.riskDonut.appendChild(callout);
        });

        [
            { label: "Covered", className: "risk-wheel-key is-covered" },
            { label: "Missing", className: "risk-wheel-key is-missing" }
        ].forEach(function (key) {
            const legendItem = document.createElement("span");
            legendItem.className = key.className;
            const swatch = document.createElement("span");
            swatch.className = "risk-wheel-swatch";
            swatch.setAttribute("aria-hidden", "true");
            const label = document.createElement("span");
            label.textContent = key.label;
            legendItem.append(swatch, label);
            elements.riskWheelLegend.appendChild(legendItem);
        });

        elements.riskDonut.setAttribute("aria-label", risks.map(function (risk) {
            return risk.name + ": " + risk.covered + " of " + risk.total + " covered, " +
                Math.round(risk.percentage) + "% unprotected";
        }).join("; "));
    }

    function renderRisk(risks) {
        elements.riskBars.replaceChildren();
        elements.riskBody.replaceChildren();
        let totalMissing = 0;
        const bars = document.createDocumentFragment();
        const rows = document.createDocumentFragment();

        risks.forEach(function (risk, index) {
            totalMissing += risk.missing;
            const color = RISK_COLORS[index % RISK_COLORS.length];
            const coveragePercentage = risk.total ? (risk.covered / risk.total) * 100 : 0;

            const bar = document.createElement("div");
            bar.className = "risk-bar-row";

            const label = document.createElement("div");
            label.className = "risk-bar-label";
            const name = document.createElement("span");
            name.textContent = risk.name;
            const percent = document.createElement("strong");
            percent.textContent = Math.round(risk.percentage) + "% unprotected";
            label.append(name, percent);

            const track = document.createElement("div");
            track.className = "bar-track";
            const fill = document.createElement("span");
            fill.className = "bar-fill";
            fill.style.backgroundColor = color;
            fill.style.width = Math.min(100, coveragePercentage) + "%";
            track.appendChild(fill);
            bar.append(label, track);
            bars.appendChild(bar);

            const row = document.createElement("tr");
            const categoryCell = appendCell(row, risk.name);
            categoryCell.style.borderLeft = "4px solid " + color;
            appendCell(row, risk.total, "number-col");
            appendCell(row, risk.missing, "number-col");
            const riskCell = appendCell(row, risk.percentage.toFixed(1) + "%", "number-col");
            riskCell.style.color = color;
            riskCell.style.fontWeight = "800";
            rows.appendChild(row);
        });

        const overall = RISK_TOTAL ? (totalMissing / RISK_TOTAL) * 100 : 0;
        renderRiskDonut(risks);
        elements.donutPercent.textContent = Math.round(overall) + "%";
        elements.riskGap.textContent = Math.round(overall) + "%";
        elements.riskHeadline.textContent = totalMissing + " of " + RISK_TOTAL +
            (totalMissing === 1 ? " control missing" : " controls missing");
        elements.riskBars.appendChild(bars);
        elements.riskBody.appendChild(rows);
    }

    function numericOrNull(value) {
        if (value === null || value === undefined || text(value) === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function customerCrmAccountId() {
        const crmId = crmCustomerId(selectedCrmCustomer());
        if (crmId) return crmId;
        const row = selectedInvoiceRows()[0] || {};
        return text(pick(row, ["CRM Account ID", "CRM_Account_ID", "ZCRM Account ID", "ZCRM_Account_ID", "Account ID", "Account_ID"]));
    }

    function existingLinesForPackage() {
        return (state.currentLines || []).map(function (line) {
            return {
                key: line.key,
                source: "existing",
                included: line.included,
                category: line.category,
                subGroup: line.subgroup,
                service: line.service,
                description: line.service,
                itemId: text(line.itemId),
                sku: text(line.sku),
                quantity: line.quantity,
                rate: line.rate,
                total: line.monthly
            };
        });
    }

    function packageTotals(existingPackage) {
        const services = (existingPackage.lines || []).filter(function (line) { return line.included !== false; })
            .reduce(function (sum, line) { return sum + number(line.total, number(line.quantity, 0) * number(line.rate, 0)); }, 0);
        const hardware = (existingPackage.hardware || []).reduce(function (sum, line) {
            return sum + number(line.quantity, 0) * number(line.rate, 0);
        }, 0);
        const delivery = existingPackage.delivery && existingPackage.delivery.included === true
            ? number(existingPackage.delivery.rate, 0) * number(existingPackage.delivery.quantity, 1)
            : 0;
        const subtotal = services + hardware + delivery;
        const discountValue = Math.max(0, number(existingPackage.discount && existingPackage.discount.value, 0));
        const discount = existingPackage.discount && existingPackage.discount.mode === "percent"
            ? subtotal * Math.min(100, discountValue) / 100
            : Math.min(subtotal, discountValue);
        return { services: services, hardware: hardware, delivery: delivery, subtotal: subtotal, discount: discount, total: Math.max(0, subtotal - discount) };
    }

    function currentPackage() {
        return {
            version: 2,
            lines: existingLinesForPackage(),
            hardware: state.hardware.map(function (line) {
                return {
                    source: "hardware", included: true, service: line.name, description: text(line.description) || line.name,
                    itemId: text(line.itemId), sku: text(line.sku), quantity: number(line.quantity, 1), rate: number(line.rate, 0)
                };
            }),
            delivery: {
                source: "delivery", included: elements.deliveryIncluded.checked, service: "Delivery", description: "Delivery",
                itemId: text(elements.deliveryItemId.value), sku: "", quantity: 1, rate: Math.max(0, number(elements.deliveryRate.value, 29))
            },
            discount: {
                mode: elements.discountMode.value === "percent" ? "percent" : "amount",
                value: Math.max(0, number(elements.discountValue.value, 0))
            }
        };
    }

    function packageIssues(existingPackage) {
        const issues = [];
        const includedServices = (existingPackage.lines || []).filter(function (line) { return line.included !== false; });
        const includedHardware = (existingPackage.hardware || []).filter(function (line) { return line.included !== false; });
        if (!includedServices.length && !includedHardware.length && !existingPackage.delivery.included) {
            issues.push("Choose at least one service, hardware item or delivery line");
        }
        includedServices.forEach(function (line) {
            if (!text(line.itemId)) issues.push(line.service + ": Books Item ID missing");
            if (number(line.quantity, 0) <= 0) issues.push(line.service + ": quantity missing");
        });
        includedHardware.forEach(function (line) {
            if (!text(line.itemId)) issues.push(line.service + ": Books Item ID missing");
            if (number(line.quantity, 0) <= 0) issues.push(line.service + ": quantity missing");
        });
        if (existingPackage.delivery.included && !text(existingPackage.delivery.itemId)) issues.push("Delivery: Books Item ID missing");
        if (existingPackage.discount.mode === "percent" && number(existingPackage.discount.value, 0) > 100) issues.push("Percentage discount cannot exceed 100%");
        return issues;
    }

    function renderPackageSummary() {
        const existingPackage = currentPackage();
        const totals = packageTotals(existingPackage);
        elements.checkedServicesTotal.textContent = money(totals.services);
        elements.hardwareTotal.textContent = money(totals.hardware);
        elements.deliveryTotal.textContent = money(totals.delivery);
        elements.discountTotal.textContent = "−" + money(totals.discount);
        elements.packageTotal.textContent = money(totals.total);
        const issues = packageIssues(existingPackage);
        elements.continueToMissing.disabled = !elements.customer.value || (!existingPackage.lines.some(function (line) { return line.included !== false; }) && !existingPackage.hardware.length && !existingPackage.delivery.included);
        const issueSummary = issues.slice(0, 3).join("; ") + (issues.length > 3 ? "; plus " + (issues.length - 3) + " more" : "");
        elements.packageStatus.textContent = issues.length
            ? "Complete before creating the Books draft: " + issueSummary + ". You can still continue to Quote Finalisation."
            : "Existing services package is ready for Quote Finalisation.";
        elements.packageStatus.className = "package-help" + (issues.length ? " is-warning" : " is-ready");
        saveWorkspacePackage(existingPackage);
    }

    function saveWorkspacePackage(existingPackage) {
        if (!window.MCGQuoteWorkspace || !elements.customer.value) return null;
        const prior = window.MCGQuoteWorkspace.get(elements.customer.value) || state.incoming || {};
        return window.MCGQuoteWorkspace.save(elements.customer.value, {
            crmAccountId: customerCrmAccountId() || text(prior.crmAccountId),
            proposals: Array.isArray(prior.proposals) ? prior.proposals : Array.isArray(prior.selections) ? prior.selections : [],
            selectedPhase: prior.selectedPhase || null,
            navigationMode: state.navigationMode,
            existingPackage: existingPackage || currentPackage()
        });
    }

    function renderHardware() {
        elements.hardwareBody.replaceChildren();
        if (!state.hardware.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 7;
            cell.className = "table-empty";
            cell.textContent = "No hardware added.";
            row.appendChild(cell);
            elements.hardwareBody.appendChild(row);
            renderPackageSummary();
            return;
        }
        state.hardware.forEach(function (line, index) {
            const row = document.createElement("tr");
            const nameCell = document.createElement("td");
            nameCell.className = "service-type draggable-name";
            const handle = dragHandle("Drag " + line.name + " to change its quote position");
            handle.addEventListener("dragstart", function (event) {
                state.draggedHardwareIndex = index;
                row.classList.add("is-dragging");
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index));
                }
            });
            handle.addEventListener("dragend", function () {
                state.draggedHardwareIndex = null;
                row.classList.remove("is-dragging");
            });
            row.addEventListener("dragover", function (event) {
                if (state.draggedHardwareIndex === null || state.draggedHardwareIndex === index) return;
                event.preventDefault();
                row.classList.add("drag-over");
                if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            });
            row.addEventListener("dragleave", function () { row.classList.remove("drag-over"); });
            row.addEventListener("drop", function (event) {
                event.preventDefault();
                row.classList.remove("drag-over");
                const sourceIndex = state.draggedHardwareIndex === null ? Number(event.dataTransfer && event.dataTransfer.getData("text/plain")) : state.draggedHardwareIndex;
                state.draggedHardwareIndex = null;
                if (!Number.isInteger(sourceIndex) || sourceIndex === index) return;
                state.hardware = moveArrayItem(state.hardware, sourceIndex, index);
                renderHardware();
            });
            nameCell.append(handle, document.createTextNode(line.name));
            row.appendChild(nameCell);
            appendCell(row, line.sku || "—");
            appendCell(row, line.itemId, "mono");
            const rateCell = document.createElement("td");
            const rate = document.createElement("input");
            rate.type = "number"; rate.min = "0"; rate.step = "0.01"; rate.value = line.rate;
            rate.addEventListener("input", function () {
                line.rate = Math.max(0, number(rate.value, 0));
                totalCell.textContent = money(number(line.rate, 0) * number(line.quantity, 0));
                renderPackageSummary();
            });
            rateCell.appendChild(rate); row.appendChild(rateCell);
            const quantityCell = document.createElement("td");
            quantityCell.appendChild(quantityStepper(line.quantity, "hardware quantity for " + line.name, function (next) {
                line.quantity = next;
                totalCell.textContent = money(number(line.rate, 0) * number(line.quantity, 0));
                renderPackageSummary();
            }));
            row.appendChild(quantityCell);
            const totalCell = appendCell(row, money(number(line.rate, 0) * number(line.quantity, 0)), "money-col");
            const removeCell = document.createElement("td");
            const remove = document.createElement("button");
            remove.type = "button"; remove.className = "remove-button"; remove.textContent = "Remove";
            remove.addEventListener("click", function () { state.hardware.splice(index, 1); renderHardware(); });
            removeCell.appendChild(remove); row.appendChild(removeCell);
            elements.hardwareBody.appendChild(row);
        });
        renderPackageSummary();
    }

    function findApiPayload(value, depth) {
        if (depth > 7) return null;
        const parsed = parseJson(value);
        if (!parsed || typeof parsed !== "object") return null;
        if (Array.isArray(parsed.items) || (Object.prototype.hasOwnProperty.call(parsed, "status") && Object.prototype.hasOwnProperty.call(parsed, "message"))) return parsed;
        for (const child of Object.values(parsed)) {
            const found = findApiPayload(child, depth + 1);
            if (found) return found;
        }
        return null;
    }

    function invokeQuoteApi(request) {
        const config = { api_name: QUOTE_API_NAME, http_method: "POST", content_type: "application/json", payload: { request_data: JSON.stringify(request) } };
        if (window.__EXISTING_SERVICES_API_TEST_HANDLER__) return Promise.resolve(window.__EXISTING_SERVICES_API_TEST_HANDLER__(config));
        if (window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.DATA) return Promise.resolve(ZOHO.CREATOR.DATA.invokeCustomApi(config));
        return Promise.reject(new Error("Creator Custom API is unavailable."));
    }

    function renderSearchResults() {
        elements.hardwareResults.replaceChildren();
        state.searchResults.slice(0, 12).forEach(function (item) {
            const card = document.createElement("div");
            card.className = "hardware-result";
            const copy = document.createElement("div");
            const name = document.createElement("strong"); name.textContent = item.name;
            const meta = document.createElement("small"); meta.textContent = (item.sku ? "SKU " + item.sku + " · " : "") + money(item.rate) + " · " + item.itemId;
            copy.append(name, meta);
            const actions = document.createElement("div");
            const add = document.createElement("button"); add.type = "button"; add.className = "small-action primary-small-action"; add.textContent = "Add";
            add.addEventListener("click", function () {
                if (!state.hardware.some(function (line) { return line.itemId === item.itemId; })) {
                    state.hardware.push({ itemId: item.itemId, name: item.name, description: item.description, sku: item.sku, rate: item.rate, quantity: 1 });
                }
                renderHardware();
                closeHardwareResults();
                elements.hardwareSearch.value = "";
                elements.hardwareStatus.textContent = item.name + " added.";
            });
            actions.append(add); card.append(copy, actions); elements.hardwareResults.appendChild(card);
        });
        elements.closeHardwareResults.hidden = state.searchResults.length === 0;
    }

    function closeHardwareResults() {
        state.hardwareSearchRequest += 1;
        if (state.hardwareSearchTimer) window.clearTimeout(state.hardwareSearchTimer);
        state.hardwareSearchTimer = null;
        state.searchResults = [];
        elements.hardwareResults.replaceChildren();
        elements.closeHardwareResults.hidden = true;
        elements.searchHardware.disabled = false;
    }

    async function searchBooksItems() {
        if (state.hardwareSearchTimer) window.clearTimeout(state.hardwareSearchTimer);
        state.hardwareSearchTimer = null;
        const query = text(elements.hardwareSearch.value);
        if (query.length < 2) {
            closeHardwareResults();
            elements.hardwareStatus.textContent = "Enter at least 2 characters.";
            return;
        }
        const requestId = ++state.hardwareSearchRequest;
        elements.searchHardware.disabled = true;
        elements.hardwareStatus.textContent = "Searching Zoho Books…";
        try {
            const result = findApiPayload(await invokeQuoteApi({ action: "searchItems", query: query }), 0);
            if (requestId !== state.hardwareSearchRequest || query !== text(elements.hardwareSearch.value)) return;
            if (!result || text(result.status).toLowerCase() !== "success") throw new Error(result && result.message ? result.message : "No valid item response returned.");
            state.searchResults = Array.isArray(result.items) ? result.items.map(function (item) {
                return { itemId: text(item.itemId || item.item_id), name: text(item.name) || "Unnamed item", description: text(item.description), sku: text(item.sku), rate: number(item.rate, 0) };
            }) : [];
            elements.hardwareStatus.textContent = state.searchResults.length ? "Showing " + Math.min(12, state.searchResults.length) + " of " + state.searchResults.length + " matching Books items." : "No active Books items matched that search.";
            renderSearchResults();
        } catch (error) {
            if (requestId !== state.hardwareSearchRequest) return;
            elements.hardwareStatus.textContent = "Books item search failed: " + (error.message || String(error));
        } finally {
            if (requestId === state.hardwareSearchRequest) elements.searchHardware.disabled = false;
        }
    }

    function scheduleHardwareSearch() {
        if (state.hardwareSearchTimer) window.clearTimeout(state.hardwareSearchTimer);
        state.hardwareSearchTimer = null;
        const query = text(elements.hardwareSearch.value);
        if (query.length < 2) {
            closeHardwareResults();
            elements.hardwareStatus.textContent = query ? "Type one more character to search." : "";
            return;
        }
        elements.hardwareStatus.textContent = "Waiting for you to finish typing…";
        state.hardwareSearchTimer = window.setTimeout(function () {
            state.hardwareSearchTimer = null;
            searchBooksItems();
        }, 350);
    }

    function restoreExistingPackage(existingPackage) {
        state.hardware = [];
        state.serviceOrder = [];
        elements.deliveryIncluded.checked = false;
        elements.deliveryItemId.value = DEFAULT_DELIVERY_ITEM_ID;
        elements.deliveryRate.value = "29";
        elements.discountMode.value = "amount";
        elements.discountValue.value = "0";
        if (!existingPackage || typeof existingPackage !== "object") {
            renderHardware();
            return;
        }
        state.hardware = Array.isArray(existingPackage.hardware) ? existingPackage.hardware.map(function (line) {
            return { itemId: text(line.itemId), name: text(line.service || line.name), description: text(line.description), sku: text(line.sku), rate: number(line.rate, 0), quantity: number(line.quantity, 1) };
        }) : [];
        const delivery = existingPackage.delivery || {};
        elements.deliveryIncluded.checked = delivery.included === true;
        elements.deliveryItemId.value = text(delivery.itemId) || DEFAULT_DELIVERY_ITEM_ID;
        elements.deliveryRate.value = String(number(delivery.rate, 29));
        const discount = existingPackage.discount || {};
        elements.discountMode.value = discount.mode === "percent" ? "percent" : "amount";
        elements.discountValue.value = String(number(discount.value, 0));
        if (Array.isArray(existingPackage.lines)) {
            state.serviceOrder = existingPackage.lines.map(function (line) { return text(line.key); }).filter(Boolean);
            existingPackage.lines.forEach(function (line) {
                if (line.key) state.serviceEdits.set(line.key, { included: line.included !== false, itemId: text(line.itemId), quantity: number(line.quantity, 1) });
            });
        }
        renderHardware();
    }

    function navigate(url) {
        const target = state.navigationMode === "embed" ? "top" : "same";
        if (window.__EXISTING_SERVICES_NAVIGATE_TEST_HANDLER__) return window.__EXISTING_SERVICES_NAVIGATE_TEST_HANDLER__(url, target);
        if (state.navigationMode === "embed") return window.open(url, "_top");
        if (window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL && typeof ZOHO.CREATOR.UTIL.navigateParentURL === "function") {
            return ZOHO.CREATOR.UTIL.navigateParentURL({ action: "open", url: url, window: "same" });
        }
        return window.open(url, "_top");
    }

    async function continueToMissingServices() {
        if (!elements.customer.value || !window.MCGQuoteWorkspace) return;
        try {
            await savePresentationNow();
        } catch (error) {
            // Presentation capture is intentionally independent of quote navigation.
        }
        const existingPackage = currentPackage();
        const session = saveWorkspacePackage(existingPackage) || {};
        window.MCGQuoteWorkspace.save(elements.customer.value, { quoteSource: "existing", existingPackage: existingPackage });
        const payload = {
            version: 2, createdAt: new Date().toISOString(), customerName: elements.customer.value,
            crmAccountId: customerCrmAccountId() || text(session.crmAccountId), navigationMode: state.navigationMode,
            sourceRoute: "existing", selections: [], existingPackage: existingPackage
        };
        const pageLink = state.navigationMode === "embed" ? CRM_QUOTE_PAGE_LINK : APP_QUOTE_PAGE_LINK;
        // Quote Finalisation can run in an isolated widget iframe. Include the
        // package in quote_data instead of relying on this widget's storage.
        const encoded = typeof window.MCGQuoteWorkspace.encodeTransfer === "function"
            ? await window.MCGQuoteWorkspace.encodeTransfer(payload)
            : window.MCGQuoteWorkspace.encode(payload);
        const target = (state.navigationMode === "embed" ? CRM_APP_ROOT_URL : APP_ROOT_URL) + "#Page:" + pageLink + "?" + QUOTE_QUERY_PARAM + "=" + encodeURIComponent(encoded);
        navigate(target);
    }

    function renderReport() {
        const customer = elements.customer.value;
        if (!customer) {
            const noMatches = Boolean(elements.slaType.value) && elements.customer.options.length <= 1;
            elements.emptyTitle.textContent = noMatches ? "No customers match " + elements.slaType.value : "Select a customer";
            elements.emptyMessage.textContent = noMatches
                ? "Choose another SLA type or All SLA types."
                : "The existing-services report and risk analysis will appear here.";
            elements.empty.hidden = false;
            elements.report.hidden = true;
            elements.content.classList.add("is-empty");
            state.exportModel = null;
            elements.copy.disabled = true;
            elements.copyRisk.disabled = true;
            elements.download.disabled = true;
            elements.downloadRisk.disabled = true;
            elements.print.disabled = true;
            return;
        }

        const selectedRows = selectedInvoiceRows();
        const enriched = applyServiceOrder(enrichRows(selectedRows));
        state.currentLines = enriched;
        const included = enriched.filter(function (row) { return row.included; });
        const groups = groupServices(included);
        const risks = sortRisksBySeverity(calculateRisk(included));
        const distinctServices = new Set(included.map(function (row) { return normalize(row.service); }).filter(Boolean)).size;
        const totalLicences = included.reduce(function (sum, row) { return sum + row.quantity; }, 0);
        const totalMonthly = included.reduce(function (sum, row) { return sum + row.monthly; }, 0);
        const totalMissing = risks.reduce(function (sum, risk) { return sum + risk.missing; }, 0);
        const overallRisk = RISK_TOTAL ? Math.round(totalMissing / RISK_TOTAL * 100) : 0;
        const now = new Intl.DateTimeFormat("en-AU", {
            day: "2-digit", month: "short", year: "numeric"
        }).format(new Date());

        elements.client.textContent = customer;
        elements.footerClient.textContent = customer;
        elements.generatedDate.textContent = now;
        elements.serviceCount.textContent = compactNumber(distinctServices);
        elements.licenceCount.textContent = compactNumber(totalLicences);
        elements.monthlyCost.textContent = money(totalMonthly);
        elements.serviceLineStatus.textContent = included.length + " of " + enriched.length + " services included · Drag ⋮⋮ to reorder";
        renderServices(enriched);
        renderRisk(risks);

        state.exportModel = {
            customer: customer,
            generated: now,
            serviceCount: compactNumber(distinctServices),
            licenceCount: compactNumber(totalLicences),
            monthlyCost: money(totalMonthly),
            overallRisk: overallRisk + "%",
            riskHeadline: totalMissing + " of " + RISK_TOTAL + " controls missing",
            risks: risks.map(function (risk) {
                return {
                    name: risk.name,
                    total: risk.total,
                    covered: risk.covered,
                    missing: risk.missing,
                    percentage: risk.percentage
                };
            }),
            groups: groups.map(function (group) {
                return {
                    category: group.category,
                    subgroup: group.subgroup,
                    services: Array.from(group.services).sort(collator.compare).join(", "),
                    quantity: compactNumber(group.quantity),
                    frequency: Array.from(group.frequencies).sort(collator.compare).join(" / ") || "—",
                    monthly: money(group.monthly)
                };
            })
        };

        elements.empty.hidden = true;
        elements.report.hidden = false;
        elements.content.classList.remove("is-empty");
        elements.copy.disabled = false;
        elements.copyRisk.disabled = false;
        elements.download.disabled = false;
        elements.downloadRisk.disabled = false;
        elements.print.disabled = false;
        renderPackageSummary();
        schedulePresentationSave();
    }

    function replaceCustomerOptions() {
        const previousCustomer = elements.customer.value;
        const customers = availableCustomerNames();
        elements.customer.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select a customer";
        elements.customer.appendChild(placeholder);
        customers.forEach(function (customer) {
            const option = document.createElement("option");
            option.value = customer;
            option.textContent = customer;
            elements.customer.appendChild(option);
        });
        if (customers.includes(previousCustomer)) elements.customer.value = previousCustomer;
        elements.customer.disabled = false;
    }

    function replaceSlaTypeOptions(rows) {
        const slaTypes = orderedSlaTypes(rows);
        if (!slaTypes.includes(NO_RECURRING_SLA_FILTER)) slaTypes.push(NO_RECURRING_SLA_FILTER);
        elements.slaType.replaceChildren();
        const all = document.createElement("option");
        all.value = "";
        all.textContent = "All SLA types";
        elements.slaType.appendChild(all);
        slaTypes.forEach(function (slaType) {
            const option = document.createElement("option");
            option.value = slaType;
            option.textContent = slaType;
            elements.slaType.appendChild(option);
        });
        elements.slaType.disabled = false;
    }

    let bannerHideTimer = null;

    function setBanner(message, mode) {
        if (bannerHideTimer) window.clearTimeout(bannerHideTimer);
        elements.banner.textContent = message;
        elements.banner.classList.remove("is-loading", "is-error", "is-success", "is-stale", "is-hidden");
        if (mode) elements.banner.classList.add(mode);
        else elements.banner.classList.add("is-success");
        if (mode !== "is-loading" && mode !== "is-error") {
            bannerHideTimer = window.setTimeout(function () { elements.banner.classList.add("is-hidden"); }, 3000);
        }
    }

    function setInitialLoading(active) {
        elements.loadingState.hidden = !active;
        document.body.setAttribute("aria-busy", active ? "true" : "false");
    }

    function handlePayload(payload) {
        const status = text(payload.status).toLowerCase();
        const invoiceRows = extractArray(payload, "invoiceRows");
        const catalogueRows = extractArray(payload, "catalogueRows");
        const customerRows = extractArray(payload, "customerRows");
        const activeCustomerRows = customerRows.filter(function (row) { return !crmCustomerIsInactive(row); });
        const carriedCustomer = state.incoming && text(state.incoming.customerName)
            ? state.incoming : window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.current();
        if (carriedCustomer && text(carriedCustomer.crmAccountId) && text(carriedCustomer.customerName) &&
            !activeCustomerRows.some(function (row) { return normalize(crmCustomerName(row)) === normalize(carriedCustomer.customerName); })) {
            activeCustomerRows.push({ "Account Name": carriedCustomer.customerName, "CRM Account ID": carriedCustomer.crmAccountId });
        }

        if (invoiceRows.length && activeCustomerRows.length) {
            setInitialLoading(false);
            state.invoiceRows = invoiceRows;
            state.catalogueRows = catalogueRows;
            state.customerRows = activeCustomerRows;
            replaceSlaTypeOptions(invoiceRows);
            replaceCustomerOptions();
            state.ready = true;
            const saved = window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.current();
            const candidate = state.incoming && text(state.incoming.customerName)
                ? Object.assign({}, window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.get(state.incoming.customerName) || {}, state.incoming)
                : saved;
            const available = Array.from(elements.customer.options).map(function (option) { return option.value; });
            if (candidate && available.includes(candidate.customerName)) {
                elements.customer.value = candidate.customerName;
                // Keep the navigation mode detected from the current host.
                restoreExistingPackage(candidate.existingPackage);
                renderReport();
            }
            if (!elements.customer.value) renderReport();
            setBanner("CRM and Analytics connected — " + activeCustomerRows.length + " active companies, " + invoiceRows.length + " invoice rows and " +
                catalogueRows.length + " catalogue services loaded.");
            if (payload.cacheStale) {
                setBanner("Using saved data from " + (payload.lastUpdated || "the last successful refresh") + ". Source refresh is pending or unavailable.", "is-stale");
            }
            return;
        }

        if (status === "pending") {
            setInitialLoading(true);
            state.pendingRetries += 1;
            setBanner(payload.message || "Analytics export is being prepared…", "is-loading");
            if (state.pendingRetries <= MAX_PENDING_RETRIES) {
                window.setTimeout(loadAnalyticsData, RETRY_DELAY_MS);
            } else {
                setInitialLoading(false);
                renderReport();
                setBanner("The Analytics export is taking longer than expected. Refresh this page shortly.", "is-error");
            }
            return;
        }

        setInitialLoading(false);
        renderReport();
        setBanner(payload.message || "The API returned no CRM companies or invoice rows.", "is-error");
    }

    function loadAnalyticsData() {
        if (window.__EXISTING_SERVICES_TEST_PAYLOAD__) {
            handlePayload(window.__EXISTING_SERVICES_TEST_PAYLOAD__);
            return;
        }
        if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA) {
            setInitialLoading(false);
            renderReport();
            setBanner("Zoho Creator widget SDK did not load. Open this page inside the Creator application.", "is-error");
            return;
        }
        ZOHO.CREATOR.DATA.invokeCustomApi({ api_name: CUSTOM_API_NAME, http_method: "GET" })
            .then(function (response) {
                const payload = findFunctionPayload(response, 0);
                if (!payload) throw new Error("The response did not contain invoiceRows or catalogueRows.");
                handlePayload(payload);
            })
            .catch(function (error) {
                const message = error && error.message ? error.message : String(error);
                setBanner(
                    "Could not load saved report data: " + message + ". Refresh later or check the Custom API execution log.",
                    "is-error"
                );
                setInitialLoading(false);
                renderReport();
            });
    }

    elements.slaType.addEventListener("change", function () {
        const previousCustomer = elements.customer.value;
        replaceCustomerOptions();
        if (previousCustomer !== elements.customer.value) {
            state.serviceEdits.clear();
            state.serviceOrder = [];
            state.hardware = [];
        }
        renderReport();
    });

    elements.customer.addEventListener("change", function () {
        state.serviceEdits.clear();
        state.serviceOrder = [];
        state.hardware = [];
        const saved = window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.get(elements.customer.value);
        restoreExistingPackage(saved && saved.existingPackage);
        renderReport();
    });
    function exportIncludesPrices() {
        const selected = document.querySelector('input[name="existingExportPrices"]:checked');
        return selected && selected.value === "show";
    }

    function buildExportSlides() {
        if (!state.exportModel || !window.MCGSlideExport) return [];
        return window.MCGSlideExport.renderExistingSlides(state.exportModel, { includePrices: exportIncludesPrices() });
    }

    function buildPresentationSlideVariants() {
        if (!state.exportModel || !window.MCGSlideExport) return { withoutPrices: [], withPrices: [] };
        return {
            withoutPrices: window.MCGSlideExport.renderExistingSlides(state.exportModel, { includePrices: false }),
            withPrices: window.MCGSlideExport.renderExistingSlides(state.exportModel, { includePrices: true })
        };
    }

    function schedulePresentationSave() {
        if (!state.exportModel || !window.MCGPresentationWorkspace) return;
        window.MCGPresentationWorkspace.queueSave("existing", function () {
            if (!state.exportModel) return null;
            const variants = buildPresentationSlideVariants();
            return {
                customerName: state.exportModel.customer,
                companyId: customerCrmAccountId(),
                slidesWithoutPrices: variants.withoutPrices,
                slidesWithPrices: variants.withPrices,
                fingerprint: JSON.stringify(state.exportModel) + "|both-price-variants"
            };
        });
    }

    async function savePresentationNow() {
        if (!state.exportModel || !window.MCGPresentationWorkspace) return null;
        const variants = buildPresentationSlideVariants();
        return window.MCGPresentationWorkspace.saveSlides({
            kind: "existing",
            customerName: state.exportModel.customer,
            companyId: customerCrmAccountId(),
            slidesWithoutPrices: variants.withoutPrices,
            slidesWithPrices: variants.withPrices
        });
    }

    elements.copy.addEventListener("click", async function () {
        const originalText = elements.copy.textContent;
        try {
            const slides = buildExportSlides();
            if (!slides.length) throw new Error("No report is ready to export.");
            await window.MCGSlideExport.copyCanvas(slides[0]);
            elements.copy.textContent = "✓ Copied";
        } catch (error) {
            const fallbackSlides = buildExportSlides();
            if (fallbackSlides.length) {
                window.MCGSlideExport.downloadCanvas(fallbackSlides[0], state.exportModel.customer + " existing services");
                elements.copy.textContent = "✓ PNG downloaded";
            } else {
                elements.copy.textContent = "No report ready";
            }
        } finally {
            window.setTimeout(function () { elements.copy.textContent = originalText; }, 3000);
        }
    });
    elements.copyRisk.addEventListener("click", async function () {
        const originalText = elements.copyRisk.textContent;
        try {
            const slides = buildExportSlides();
            if (slides.length < 2) throw new Error("No risk image is ready.");
            await window.MCGSlideExport.copyCanvas(slides[1]);
            elements.copyRisk.textContent = "✓ Copied";
        } catch (error) {
            const slides = buildExportSlides();
            if (slides.length > 1) {
                window.MCGSlideExport.downloadCanvas(slides[1], state.exportModel.customer + " risk analysis");
                elements.copyRisk.textContent = "✓ PNG downloaded";
            }
        } finally {
            window.setTimeout(function () { elements.copyRisk.textContent = originalText; }, 3000);
        }
    });
    elements.download.addEventListener("click", function () {
        const originalText = elements.download.textContent;
        const slides = buildExportSlides();
        if (!slides.length) return;
        window.MCGSlideExport.downloadCanvas(slides[0], state.exportModel.customer + " existing services");
        elements.download.textContent = "✓ Downloaded";
        window.setTimeout(function () { elements.download.textContent = originalText; }, 3000);
    });
    elements.downloadRisk.addEventListener("click", function () {
        const originalText = elements.downloadRisk.textContent;
        const slides = buildExportSlides();
        if (slides.length < 2) return;
        window.MCGSlideExport.downloadCanvas(slides[1], state.exportModel.customer + " risk analysis");
        elements.downloadRisk.textContent = "✓ Downloaded";
        window.setTimeout(function () { elements.downloadRisk.textContent = originalText; }, 3000);
    });
    elements.print.addEventListener("click", function () { window.print(); });

    document.querySelectorAll('input[name="existingExportPrices"]').forEach(function (input) {
        input.addEventListener("change", schedulePresentationSave);
    });

    const exportMenus = Array.from(document.querySelectorAll("details.export-menu"));
    document.addEventListener("click", function (event) {
        exportMenus.forEach(function (menu) {
            if (menu.open && !menu.contains(event.target)) menu.open = false;
        });
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") exportMenus.forEach(function (menu) { menu.open = false; });
    });
    elements.searchHardware.addEventListener("click", searchBooksItems);
    elements.hardwareSearch.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); searchBooksItems(); } });
    elements.hardwareSearch.addEventListener("input", scheduleHardwareSearch);
    elements.closeHardwareResults.addEventListener("click", function () {
        closeHardwareResults();
        elements.hardwareStatus.textContent = "Results closed.";
    });
    [elements.deliveryIncluded, elements.deliveryItemId, elements.deliveryRate, elements.discountMode, elements.discountValue].forEach(function (control) {
        control.addEventListener(control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "input", renderPackageSummary);
    });
    elements.continueToMissing.addEventListener("click", continueToMissingServices);

    readIncomingWorkflow().then(function (incoming) {
        state.incoming = incoming;
        if (incoming && window.MCGQuoteWorkspace) {
            const update = { crmAccountId: incoming.crmAccountId, selectedPhase: incoming.selectedPhase || null, navigationMode: state.navigationMode };
            if (Array.isArray(incoming.proposals) || Array.isArray(incoming.selections)) update.proposals = incoming.proposals || incoming.selections;
            if (incoming.existingPackage && typeof incoming.existingPackage === "object") update.existingPackage = incoming.existingPackage;
            window.MCGQuoteWorkspace.save(incoming.customerName, update);
        }
        if (state.ready && incoming && text(incoming.customerName)) {
            if (text(incoming.crmAccountId) && !state.customerRows.some(function (row) {
                return normalize(crmCustomerName(row)) === normalize(incoming.customerName);
            })) {
                state.customerRows.push({ "Account Name": incoming.customerName, "CRM Account ID": incoming.crmAccountId });
                replaceCustomerOptions();
            }
            const available = Array.from(elements.customer.options).map(function (option) { return option.value; });
            if (available.includes(incoming.customerName)) {
                elements.customer.value = incoming.customerName;
                const saved = window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.get(incoming.customerName);
                restoreExistingPackage(incoming.existingPackage || saved && saved.existingPackage);
                renderReport();
            }
        }
    });
    renderHardware();
    loadAnalyticsData();

    window.__existingServicesApp = {
        findFunctionPayload: findFunctionPayload,
        packageTotals: packageTotals,
        packageIssues: packageIssues,
        currentPackage: currentPackage,
        continueToMissingServices: continueToMissingServices,
        searchBooksItems: searchBooksItems
    };
}());
