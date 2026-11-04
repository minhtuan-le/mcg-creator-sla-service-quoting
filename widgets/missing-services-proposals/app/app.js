(function () {
    "use strict";

    const ANALYTICS_API_NAME = "get_sla_analytics_data";
    const QUOTE_API_NAME = "create_sla_draft_quote";
    const WORKFLOW_QUERY_PARAM = "workflow_data";
    const LEGACY_PROPOSAL_QUERY_PARAM = "proposal_data";
    const QUOTE_QUERY_PARAM = "quote_data";
    const BOOKS_EDR_ITEM_ID = "1417654000018767777";
    const APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/environment/development/recurring-invoice-report/";
    const CRM_APP_ROOT_URL = "https://creatorapp.zoho.com/michaella2/crm-homepage/";
    const SLA_PAGE_LINK = "SLA_Services_Tracking";
    const APP_QUOTE_PAGE_LINK = "Quote_Finalisation";
    const CRM_QUOTE_PAGE_LINK = "Quote_Finalisation1";
    const RETRY_DELAY_MS = 4000;
    const MAX_PENDING_RETRIES = 30;
    const APPROVED_MISSING_SERVICES = [
        {
            service: "EDR",
            aliases: ["EDR", "KEDR", "Kaseya/WatchGuard EDR", "WatchGuard EDR", "Endpoint Detection and Response"],
            recommendation: "Implement enterprise-grade EDR to continuously monitor, detect, and respond to threats across all endpoints."
        },
        {
            service: "MFA",
            aliases: ["MFA", "WatchGuard MFA", "Multi-Factor Authentication", "Multifactor Authentication"],
            recommendation: "Enable Multi-Factor Authentication (MFA) to secure user accounts and prevent unauthorised access across all systems."
        },
        {
            service: "MDR",
            aliases: ["MDR", "Managed Detection and Response"],
            recommendation: "Deploy Managed Detection & Response for around-the-clock monitoring and expert threat containment."
        },
        {
            service: "Email Filter",
            aliases: ["Email Filter", "Email Filtering", "Microsoft Defender", "Microsoft Defender for Office 365", "Mail Filter", "Mail Filtering"],
            recommendation: "Implement advanced email filtering to block phishing, malware, and business email compromise."
        },
        {
            service: "Collaboration Tool",
            aliases: ["Collaboration Tool", "SharePoint", "Microsoft SharePoint", "SharePoint Online"],
            recommendation: "Use SharePoint for secure document sharing and collaboration."
        },
        {
            service: "Penetration Testing",
            aliases: ["Penetration Testing", "Pen Test", "Pentest", "Crest Pen Test"],
            recommendation: "Use CREST-certified penetration testing to identify and remediate security weaknesses."
        },
        {
            service: "Mobile Security",
            aliases: ["Mobile Security", "McAfee Mobile Security", "Mobile Device Security", "Mobile Device Management", "MDM"],
            recommendation: "Protect company mobile devices and user access with managed mobile security."
        },
        {
            service: "Security Awareness Training",
            aliases: ["Security Awareness Training", "Security Training", "Cyber Security Awareness Training", "SAT"],
            recommendation: "Implement security awareness training to reduce human risk."
        },
        {
            service: "Password Management System",
            aliases: ["Password Management System", "Password Manager", "Password Management", "Keeper", "Keeper Security"],
            recommendation: "Deploy a managed password platform to enforce strong credential practices."
        },
        {
            service: "FireCloud",
            aliases: ["FireCloud", "Fire Cloud", "WatchGuard FireCloud", "Watchguard Firecloud"],
            recommendation: "Implement WatchGuard FireCloud for work-from-home users and improved network visibility."
        },
        {
            service: "AI",
            aliases: ["AI", "Microsoft Copilot", "Copilot", "Microsoft 365 Copilot"],
            recommendation: "Use Microsoft Copilot as a secure AI companion."
        },
        {
            service: "Web Backup",
            aliases: ["Web Backup", "Website Backup", "Website Protection", "Cloud Website Backup"],
            recommendation: "Enable website backup to support fast recovery."
        }
    ];

    const collator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });
    const state = {
        invoiceRows: [], catalogueRows: [], customerRows: [], serviceRows: [], selections: new Map(),
        incoming: null, existingPackage: null, selectedPhase: "", machineCount: null,
        mappingTarget: null, mappingResults: [], pendingRetries: 0, ready: false,
        collapsedGroups: new Set(), collapseInitialized: false, selectedOnly: false,
        navigationMode: detectNavigationMode()
    };

    const elements = {
        banner: document.getElementById("connectionBanner"),
        customer: document.getElementById("customerFilter"),
        generatedAt: document.getElementById("proposalGeneratedAt"),
        selectedCount: document.getElementById("selectedCount"),
        phaseCount: document.getElementById("phaseCount"),
        monthlyTotal: document.getElementById("monthlyTotal"),
        setupTotal: document.getElementById("setupTotal"),
        loadingState: document.getElementById("initialLoadingState"),
        emptyState: document.getElementById("emptyState"),
        generatedContent: document.getElementById("generatedContent"),
        servicesBody: document.getElementById("servicesBody"),
        editorStatus: document.getElementById("editorStatus"),
        categoryBody: document.getElementById("categoryBody"),
        proposalContainer: document.getElementById("proposalContainer"),
        quotePhase: document.getElementById("quotePhase"),
        continueToQuote: document.getElementById("continueToQuote"),
        quoteStatus: document.getElementById("quoteActionStatus"),
        copy: document.getElementById("copyPowerPointButton"),
        download: document.getElementById("downloadPowerPointButton"),
        copyCategory: document.getElementById("copyCategoryButton"),
        downloadCategory: document.getElementById("downloadCategoryButton"),
        print: document.getElementById("printButton"),
        back: document.getElementById("backToExisting"),
        expandGroups: document.getElementById("expandGroups"),
        collapseGroups: document.getElementById("collapseGroups"),
        selectedOnlyGroups: document.getElementById("selectedOnlyGroups"),
        mappingPanel: document.getElementById("mappingPanel"),
        mappingTitle: document.getElementById("mappingTitle"),
        mappingSearch: document.getElementById("mappingSearch"),
        mappingSearchButton: document.getElementById("mappingSearchButton"),
        mappingCloseButton: document.getElementById("mappingCloseButton"),
        mappingStatus: document.getElementById("mappingStatus"),
        mappingResults: document.getElementById("mappingResults")
    };

    function text(value) {
        if (value === null || value === undefined) return "";
        if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
        if (typeof value === "object") return text(value.display_value || value.name || value.value || value.ID || "");
        return String(value).trim();
    }

    function normalize(value) {
        return text(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
    }

    function isEdrService(service, businessName) {
        return ["edr", "kedr", "kaseyawatchguardedr"].includes(normalize(service)) ||
            normalize(businessName) === "kaseyawatchguardedr";
    }

    function numericOrNull(value) {
        if (value === null || value === undefined || text(value) === "") return null;
        const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
    }

    function number(value, fallback) {
        const parsed = numericOrNull(value);
        return parsed === null ? fallback : parsed;
    }

    function money(value) {
        const parsed = numericOrNull(value);
        if (parsed === null) return "—";
        return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed);
    }

    function parseJson(value) {
        if (typeof value !== "string") return value;
        try { return JSON.parse(value); } catch (error) { return value; }
    }

    function pick(row, aliases) {
        if (!row || typeof row !== "object") return "";
        for (const alias of aliases) {
            if (Object.prototype.hasOwnProperty.call(row, alias) && text(row[alias]) !== "") return row[alias];
        }
        const keys = new Map(Object.keys(row).map(function (key) { return [normalize(key), key]; }));
        for (const alias of aliases) {
            const actual = keys.get(normalize(alias));
            if (actual && text(row[actual]) !== "") return row[actual];
        }
        return "";
    }

    function customerName(row) { return text(pick(row, ["Customer", "Customer Name", "Company", "Company Name"])); }
    function crmCustomerName(row) { return text(pick(row, ["Account_Name", "Account Name", "Customer", "Customer Name", "Company", "Company Name"])); }
    function crmCustomerId(row) { return text(pick(row, ["id", "Id", "CRM Account ID", "CRM_Account_ID", "Account ID", "Account_ID"])); }
    function crmCustomerIsInactive(row) {
        const value = pick(row, ["Inactive"]);
        if (value === true || value === 1) return true;
        const normalized = normalize(value);
        return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
    }
    function selectedCrmCustomer() {
        const selected = normalize(elements.customer.value);
        return state.customerRows.find(function (row) { return normalize(crmCustomerName(row)) === selected; }) || null;
    }
    function serviceName(row) { return text(pick(row, ["Name", "Item Display Name", "Service", "Item Name", "Product Name"])); }
    function itemId(row) { return text(pick(row, ["Item ID", "Item Id", "Item_ID", "Books Item ID", "Books_Item_ID", "item_id"])); }
    function groupName(row) { return text(pick(row, ["Grouping", "Display Group", "Group", "Category", "Service Category"])) || "Others"; }
    function subgroupName(row) {
        const value = text(pick(row, ["Sub Grouping", "Sub Group", "Subgroup", "Service Type"]));
        if (value) return value;
        return normalize(groupName(row)) === "others" ? "Miscellaneous services / discounts" : serviceName(row);
    }
    function isValidPhase(value) { const parsed = Number(value); return text(value) !== "" && Number.isInteger(parsed) && parsed >= 1; }

    function detectNavigationMode() {
        if (window.__MISSING_SERVICES_NAVIGATION_MODE__ === "embed" || window.__MISSING_SERVICES_NAVIGATION_MODE__ === "shell") return window.__MISSING_SERVICES_NAVIGATION_MODE__;
        try {
            const topUrl = String(window.top.location.href || "");
            if (topUrl.includes("/recurring-invoice-report/")) return "shell";
            if (window.top !== window.parent) return "embed";
        } catch (error) { if (window.top !== window.parent) return "embed"; }
        return "shell";
    }

    function pageUrl(pageLink, parameterName, encodedPayload) {
        const base = state.navigationMode === "embed"
            ? CRM_APP_ROOT_URL + "#Page:" + pageLink
            : APP_ROOT_URL + "#Page:" + pageLink;
        return encodedPayload ? base + "?" + parameterName + "=" + encodeURIComponent(encodedPayload) : base;
    }

    function parameterFromUrl(url, name) {
        const href = text(url);
        const queryIndex = href.indexOf("?");
        if (queryIndex < 0) return "";
        const prefix = encodeURIComponent(name) + "=";
        const pair = href.slice(queryIndex + 1).split("#")[0].split("&").find(function (entry) { return entry.startsWith(prefix); });
        if (!pair) return "";
        try { return decodeURIComponent(pair.slice(prefix.length)); } catch (error) { return pair.slice(prefix.length); }
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
                encoded = findQueryParameter(params, WORKFLOW_QUERY_PARAM, 0) || findQueryParameter(params, LEGACY_PROPOSAL_QUERY_PARAM, 0);
            }
        } catch (error) { /* Direct page access is valid. */ }
        if (!encoded) {
            const locations = [];
            try { locations.push(window.location.href); } catch (error) { /* Restricted frame. */ }
            try { locations.push(window.parent.location.href); } catch (error) { /* Restricted frame. */ }
            try { locations.push(window.top.location.href); } catch (error) { /* Restricted frame. */ }
            try { locations.push(document.referrer); } catch (error) { /* Referrer may be blank. */ }
            for (const location of locations) {
                encoded = parameterFromUrl(location, WORKFLOW_QUERY_PARAM) || parameterFromUrl(location, LEGACY_PROPOSAL_QUERY_PARAM);
                if (encoded) break;
            }
        }
        if (!window.MCGQuoteWorkspace) return null;
        return typeof window.MCGQuoteWorkspace.decodeTransfer === "function"
            ? await window.MCGQuoteWorkspace.decodeTransfer(encoded)
            : window.MCGQuoteWorkspace.decode(encoded);
    }

    function navigate(url) {
        const target = state.navigationMode === "embed" ? "top" : "same";
        if (window.__MISSING_SERVICES_NAVIGATE_TEST_HANDLER__) return window.__MISSING_SERVICES_NAVIGATE_TEST_HANDLER__(url, target);
        if (state.navigationMode === "embed") return window.open(url, "_top");
        if (window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL && typeof ZOHO.CREATOR.UTIL.navigateParentURL === "function") {
            return ZOHO.CREATOR.UTIL.navigateParentURL({ action: "open", url: url, window: "same" });
        }
        return window.open(url, "_top");
    }

    function findAnalyticsPayload(value, depth) {
        if (depth > 7) return null;
        const parsed = parseJson(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        if (Object.prototype.hasOwnProperty.call(parsed, "invoiceRows") || Object.prototype.hasOwnProperty.call(parsed, "catalogueRows") || Object.prototype.hasOwnProperty.call(parsed, "customerRows") || (Object.prototype.hasOwnProperty.call(parsed, "status") && Object.prototype.hasOwnProperty.call(parsed, "message"))) return parsed;
        for (const child of Object.values(parsed)) {
            const found = findAnalyticsPayload(child, depth + 1);
            if (found) return found;
        }
        return null;
    }

    function extractArray(payload, key) {
        const value = parseJson(payload && payload[key]);
        if (Array.isArray(value)) return value;
        if (value && Array.isArray(value.data)) return value.data;
        return [];
    }

    function findQuoteApiPayload(value, depth) {
        if (depth > 7) return null;
        const parsed = parseJson(value);
        if (!parsed || typeof parsed !== "object") return null;
        if (Array.isArray(parsed.items) || (Object.prototype.hasOwnProperty.call(parsed, "status") && Object.prototype.hasOwnProperty.call(parsed, "message"))) return parsed;
        for (const child of Object.values(parsed)) {
            const found = findQuoteApiPayload(child, depth + 1);
            if (found) return found;
        }
        return null;
    }

    function invokeQuoteApi(request) {
        const config = { api_name: QUOTE_API_NAME, http_method: "POST", content_type: "application/json", payload: { request_data: JSON.stringify(request) } };
        if (window.__MISSING_SERVICES_API_TEST_HANDLER__) return Promise.resolve(window.__MISSING_SERVICES_API_TEST_HANDLER__(config));
        if (window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.DATA) return Promise.resolve(ZOHO.CREATOR.DATA.invokeCustomApi(config));
        return Promise.reject(new Error("Creator Custom API is unavailable."));
    }

    function correctedItemId(row) {
        return isEdrService(row.service, row.businessName) ? BOOKS_EDR_ITEM_ID : itemId(row.catalogue);
    }

    function selectionKey(row) { return correctedItemId(row) ? "item:" + correctedItemId(row) : "name:" + normalize(row.service); }

    function blankSelection(row) {
        return {
            phase: "", quantity: state.machineCount === null ? "" : String(state.machineCount), customPrice: "", customSetup: "",
            itemId: correctedItemId(row), setupItemId: text(pick(row.catalogue, ["Setup ID", "Setup_ID", "Setup Item ID", "Setup_Item_ID"])),
            mappedName: "", mappedSku: ""
        };
    }

    function getSelection(row) {
        const key = selectionKey(row);
        if (!state.selections.has(key)) state.selections.set(key, blankSelection(row));
        const selection = state.selections.get(key);
        if (isEdrService(row.service, row.businessName)) selection.itemId = BOOKS_EDR_ITEM_ID;
        if (!text(selection.quantity) && state.machineCount !== null) selection.quantity = String(state.machineCount);
        return selection;
    }

    function activeRowsForCustomer() {
        return state.invoiceRows.filter(function (row) { return normalize(customerName(row)) === normalize(elements.customer.value); });
    }

    function deriveMachineCount(activeRows) {
        const candidates = activeRows.filter(function (row) {
            const name = normalize(serviceName(row));
            return name.includes("sla") && (name.includes("premium") || name.includes("pro") || name.includes("remote") || name.includes("workstation"));
        }).map(function (row) { return number(pick(row, ["Quantity", "Qty", "Licences", "Licenses"]), 0); }).filter(function (value) { return value > 0; });
        return candidates.length ? Math.max.apply(null, candidates) : null;
    }

    function buildMissingRows() {
        const active = activeRowsForCustomer();
        state.machineCount = deriveMachineCount(active);
        const activeNames = new Set(active.map(function (row) { return normalize(serviceName(row)); }).filter(Boolean));
        const activeCoverage = new Set();
        active.forEach(function (invoice) {
            const name = normalize(serviceName(invoice));
            const catalogue = state.catalogueRows.find(function (row) { return normalize(serviceName(row)) === name || (itemId(invoice) && itemId(row) === itemId(invoice)); });
            if (catalogue) activeCoverage.add(normalize(groupName(catalogue)) + "::" + normalize(subgroupName(catalogue)));
        });
        return state.catalogueRows.map(function (catalogue) {
            return {
                catalogue: catalogue,
                service: serviceName(catalogue) || "Unnamed service",
                group: groupName(catalogue),
                subGroup: subgroupName(catalogue),
                order: number(pick(catalogue, ["Order", "Item Display Order"]), Number.MAX_SAFE_INTEGER),
                standardPrice: numericOrNull(pick(catalogue, ["Standard Price", "Standard_Price", "Price", "Rate"])),
                standardSetup: numericOrNull(pick(catalogue, ["Setup Cost", "Setup_Cost", "Standard Setup Cost", "Once-Off Setup"])),
                recommendation: text(pick(catalogue, ["Business Summary", "Business_Summary", "Recommended Solution", "Description"])),
                businessName: text(pick(catalogue, ["Business Name", "Business_Name"])) || serviceName(catalogue)
            };
        }).filter(function (row) {
            const key = normalize(row.group) + "::" + normalize(row.subGroup);
            const selectedEarlier = state.selections.has(selectionKey(row));
            return selectedEarlier || (!activeNames.has(normalize(row.service)) && !activeCoverage.has(key));
        }).sort(function (left, right) { return left.order - right.order || collator.compare(left.group, right.group) || collator.compare(left.service, right.service); });
    }

    function approvedAliasSet(definition) {
        return new Set([definition.service].concat(definition.aliases || []).map(normalize).filter(Boolean));
    }

    function valuesForApprovedMatch(row) {
        if (!row) return [];
        const catalogue = row.catalogue || row;
        return [
            row.service,
            row.businessName,
            row.subGroup,
            serviceName(catalogue),
            subgroupName(catalogue),
            pick(catalogue, ["Business Name", "Business_Name", "Display Name", "Item Display Name"])
        ].map(normalize).filter(Boolean);
    }

    function matchesApprovedService(row, definition) {
        const aliases = approvedAliasSet(definition);
        return valuesForApprovedMatch(row).some(function (value) { return aliases.has(value); });
    }

    function customerHasApprovedService(definition) {
        const aliases = approvedAliasSet(definition);
        return activeRowsForCustomer().some(function (invoice) {
            const invoiceValues = [
                serviceName(invoice),
                pick(invoice, ["Business Name", "Business_Name", "Sub Grouping", "Sub Group", "Subgroup"])
            ].map(normalize).filter(Boolean);
            if (invoiceValues.some(function (value) { return aliases.has(value); })) return true;
            const invoiceItemId = itemId(invoice);
            const catalogue = state.catalogueRows.find(function (candidate) {
                return (invoiceItemId && itemId(candidate) === invoiceItemId) ||
                    normalize(serviceName(candidate)) === normalize(serviceName(invoice));
            });
            return catalogue ? valuesForApprovedMatch(catalogue).some(function (value) { return aliases.has(value); }) : false;
        });
    }

    function approvedMissingSummaryRows() {
        return APPROVED_MISSING_SERVICES.map(function (definition) {
            const matched = state.serviceRows.find(function (row) { return matchesApprovedService(row, definition); });
            if (!matched && customerHasApprovedService(definition)) return null;
            const quantity = matched
                ? (text(matched.selection && matched.selection.quantity) || (state.machineCount === null ? "—" : String(state.machineCount)))
                : (state.machineCount === null ? "—" : String(state.machineCount));
            return {
                service: definition.service,
                recommendation: matched && matched.recommendation ? matched.recommendation : definition.recommendation,
                quantity: quantity,
                unitPrice: matched && monthlyRate(matched) !== null ? money(monthlyRate(matched)) : "TBA"
            };
        }).filter(Boolean);
    }

    function monthlyRate(row) {
        const custom = numericOrNull(row.selection.customPrice);
        return custom !== null ? custom : row.standardPrice;
    }

    function setupRate(row) {
        const custom = numericOrNull(row.selection.customSetup);
        return custom !== null ? custom : row.standardSetup;
    }

    function monthlyTotal(row) {
        const quantity = numericOrNull(row.selection.quantity);
        const rate = monthlyRate(row);
        return quantity !== null && quantity > 0 && rate !== null ? quantity * rate : null;
    }

    function selectedRows() { return state.serviceRows.filter(function (row) { return isValidPhase(row.selection.phase); }); }

    function transferRow(row) {
        const quantity = numericOrNull(row.selection.quantity);
        const recurring = monthlyRate(row);
        const setup = setupRate(row);
        return {
            order: row.order, group: row.group, subGroup: row.subGroup, service: row.service,
            businessName: row.businessName, recommendation: row.recommendation, active: false,
            phase: Number(row.selection.phase), quantity: quantity,
            customPrice: numericOrNull(row.selection.customPrice), standardPrice: row.standardPrice, monthlyRate: recurring,
            customSetup: numericOrNull(row.selection.customSetup), standardSetup: row.standardSetup, setupRate: setup,
            monthlyTotal: monthlyTotal(row), itemId: text(row.selection.itemId), setupItemId: text(row.selection.setupItemId),
            sku: text(row.selection.mappedSku || pick(row.catalogue, ["SKU", "Sku"]))
        };
    }

    function allDraftRows() {
        return state.serviceRows.map(function (row) {
            return Object.assign(transferRow(row), {
                phase: text(row.selection.phase), quantity: text(row.selection.quantity),
                customPrice: text(row.selection.customPrice), customSetup: text(row.selection.customSetup)
            });
        });
    }

    function restoreSelections(entries) {
        if (!Array.isArray(entries)) return;
        entries.forEach(function (entry) {
            if (!entry || !text(entry.service)) return;
            const restoredItemId = isEdrService(entry.service, entry.businessName) ? BOOKS_EDR_ITEM_ID : text(entry.itemId);
            const key = restoredItemId ? "item:" + restoredItemId : "name:" + normalize(entry.service);
            const restored = {
                phase: text(entry.phase), quantity: text(entry.quantity), customPrice: text(entry.customPrice), customSetup: text(entry.customSetup),
                itemId: restoredItemId, setupItemId: text(entry.setupItemId), mappedName: text(entry.businessName), mappedSku: text(entry.sku)
            };
            state.selections.set(key, restored);
            state.selections.set("name:" + normalize(entry.service), restored);
        });
    }

    function saveWorkspace() {
        if (!window.MCGQuoteWorkspace || !elements.customer.value) return null;
        const proposals = selectedRows().map(transferRow);
        return window.MCGQuoteWorkspace.save(elements.customer.value, {
            crmAccountId: customerCrmAccountId(), proposals: proposals, proposalDrafts: allDraftRows(),
            selectedPhase: Number(state.selectedPhase || elements.quotePhase.value) || null,
            navigationMode: state.navigationMode, quoteSource: "proposal"
        });
    }

    function customerCrmAccountId() {
        const crmId = crmCustomerId(selectedCrmCustomer());
        if (crmId) return crmId;
        const row = activeRowsForCustomer()[0] || {};
        return text(pick(row, ["CRM Account ID", "CRM_Account_ID", "ZCRM Account ID", "ZCRM_Account_ID", "Account ID", "Account_ID"])) || text(state.incoming && state.incoming.crmAccountId);
    }

    function appendCell(row, value, className) {
        const cell = document.createElement("td"); cell.textContent = text(value) || "—"; if (className) cell.className = className; row.appendChild(cell); return cell;
    }

    function createNumberInput(row, property, options, onUpdate) {
        const input = document.createElement("input");
        input.type = "number"; input.min = options.min; input.step = options.step; input.placeholder = options.placeholder; input.value = text(row.selection[property]);
        input.setAttribute("aria-label", options.label + " for " + row.service);
        input.addEventListener("input", function () { row.selection[property] = input.value; onUpdate(); });
        return input;
    }

    function itemIdControl(row, field, label) {
        const wrap = document.createElement("label"); wrap.className = "item-id-control";
        const caption = document.createElement("span"); caption.textContent = label;
        const input = document.createElement("input"); input.type = "text"; input.className = "item-id-input"; input.value = text(row.selection[field]); input.placeholder = label;
        input.setAttribute("aria-label", label + " for " + row.service);
        input.addEventListener("input", function () { row.selection[field] = text(input.value); saveWorkspace(); updateProposalViews(); });
        wrap.append(caption, input); return wrap;
    }

    function groupHeader(group, services) {
        const row = document.createElement("tr"); row.className = "editor-group-row";
        const cell = document.createElement("td"); cell.colSpan = 7;
        const button = document.createElement("button"); button.type = "button"; button.className = "editor-group-toggle";
        const collapsed = state.collapsedGroups.has(group);
        const selected = services.filter(function (service) { return isValidPhase(service.selection.phase); }).length;
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        const chevron = document.createElement("span"); chevron.className = "group-chevron"; chevron.textContent = collapsed ? "▶" : "▼";
        const name = document.createElement("strong"); name.textContent = group;
        const meta = document.createElement("small"); meta.textContent = services.length + (services.length === 1 ? " service" : " services") + (selected ? " · " + selected + " selected" : "");
        button.append(chevron, name, meta);
        button.addEventListener("click", function () {
            if (collapsed) state.collapsedGroups.delete(group); else state.collapsedGroups.add(group);
            renderEditor();
        });
        cell.appendChild(button); row.appendChild(cell); return row;
    }

    function renderEditor() {
        elements.servicesBody.replaceChildren();
        if (!state.serviceRows.length) {
            const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 7; cell.className = "table-empty"; cell.textContent = "No uncovered catalogue services were found for this customer."; row.appendChild(cell); elements.servicesBody.appendChild(row); return;
        }
        const visibleRows = state.selectedOnly
            ? state.serviceRows.filter(function (service) { return isValidPhase(service.selection.phase); })
            : state.serviceRows;
        if (!visibleRows.length) {
            const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 7; cell.className = "table-empty";
            cell.textContent = state.selectedOnly ? "No services are currently selected." : "No uncovered catalogue services were found for this customer.";
            row.appendChild(cell); elements.servicesBody.appendChild(row); return;
        }
        const grouped = new Map();
        visibleRows.forEach(function (service) {
            if (!grouped.has(service.group)) grouped.set(service.group, []);
            grouped.get(service.group).push(service);
        });
        if (!state.collapseInitialized) {
            grouped.forEach(function (services, group) {
                if (!services.some(function (service) { return isValidPhase(service.selection.phase); })) state.collapsedGroups.add(group);
            });
            state.collapseInitialized = true;
        }
        grouped.forEach(function (services, group) {
            elements.servicesBody.appendChild(groupHeader(group, services));
            if (state.collapsedGroups.has(group)) return;
            services.forEach(function (service) {
            const row = document.createElement("tr"); row.className = isValidPhase(service.selection.phase) ? "is-selected" : "";
            const serviceCell = appendCell(row, service.service, "service-name");
            const recommendation = document.createElement("small"); recommendation.textContent = service.recommendation || "No description"; serviceCell.appendChild(recommendation);
            const mappingCell = document.createElement("td"); mappingCell.append(itemIdControl(service, "itemId", "Monthly Item ID"), itemIdControl(service, "setupItemId", "Setup Item ID")); row.appendChild(mappingCell);
            let totalCell = null;
            const update = function () {
                row.classList.toggle("is-selected", isValidPhase(service.selection.phase));
                if (totalCell) {
                    const currentTotal = monthlyTotal(service);
                    totalCell.textContent = money(currentTotal);
                    totalCell.classList.toggle("is-required", currentTotal === null && isValidPhase(service.selection.phase));
                    totalCell.title = totalCell.classList.contains("is-required") ? "Price required" : "";
                }
                updateProposalViews(); saveWorkspace();
                if (state.selectedOnly) renderEditor();
            };
            const phaseCell = document.createElement("td"); phaseCell.appendChild(createNumberInput(service, "phase", { min: "1", step: "1", placeholder: "Phase" , label: "Phase"}, update)); row.appendChild(phaseCell);
            const quantityCell = document.createElement("td"); quantityCell.appendChild(createNumberInput(service, "quantity", { min: "0.01", step: "any", placeholder: state.machineCount === null ? "Enter qty" : String(state.machineCount), label: "Quantity" }, update)); row.appendChild(quantityCell);
            const priceCell = document.createElement("td"); priceCell.appendChild(createNumberInput(service, "customPrice", { min: "0", step: "0.01", placeholder: service.standardPrice === null ? "Enter price" : money(service.standardPrice), label: "Monthly price" }, update)); row.appendChild(priceCell);
            const setupCell = document.createElement("td"); setupCell.appendChild(createNumberInput(service, "customSetup", { min: "0", step: "0.01", placeholder: service.standardSetup === null ? "Enter setup" : money(service.standardSetup), label: "Setup price" }, update)); row.appendChild(setupCell);
            totalCell = appendCell(row, money(monthlyTotal(service)), "money-cell calculated-total");
            totalCell.classList.toggle("is-required", monthlyTotal(service) === null && isValidPhase(service.selection.phase));
            totalCell.title = totalCell.classList.contains("is-required") ? "Price required" : "";
            elements.servicesBody.appendChild(row);
            });
        });
        elements.editorStatus.textContent = state.machineCount === null
            ? "No workstation SLA quantity was found. Enter a quantity for selected services."
            : "Blank quantities were filled with the workstation SLA count: " + state.machineCount + ". Manually entered quantities are preserved.";
    }

    function phases() { return Array.from(new Set(selectedRows().map(function (row) { return Number(row.selection.phase); }))).sort(function (a, b) { return a - b; }); }
    function rowsForPhase(phase) { return selectedRows().filter(function (row) { return Number(row.selection.phase) === Number(phase); }); }

    function totalFor(rows, getter) {
        let total = 0; let tbc = false;
        rows.forEach(function (row) { const value = getter(row); if (value === null) tbc = true; else total += value; });
        return { total: total, tbc: tbc };
    }

    function renderSummary() {
        const selected = selectedRows(); const availablePhases = phases();
        const monthly = totalFor(selected, monthlyTotal); const setup = totalFor(selected, setupRate);
        elements.selectedCount.textContent = String(selected.length); elements.phaseCount.textContent = availablePhases.length ? availablePhases.join(", ") : "—";
        elements.monthlyTotal.textContent = monthly.tbc ? "—" : money(monthly.total); elements.setupTotal.textContent = setup.tbc ? "—" : money(setup.total);
    }

    function renderProposalTables() {
        elements.proposalContainer.replaceChildren(); elements.categoryBody.replaceChildren();
        phases().forEach(function (phase) {
            const rows = rowsForPhase(phase); const card = document.createElement("article"); card.className = "proposal-card";
            const title = document.createElement("h3"); title.textContent = "Phase " + phase; card.appendChild(title);
            const table = document.createElement("table"); table.className = "proposal-table"; table.innerHTML = "<thead><tr><th>Description</th><th>Unit Price</th><th>Quantity</th><th>Monthly Cost</th><th>Setup Cost</th></tr></thead>";
            const body = document.createElement("tbody");
            rows.forEach(function (service) {
                const tr = document.createElement("tr"); appendCell(tr, service.businessName || service.service, "description-cell"); appendCell(tr, money(monthlyRate(service)), "money-cell"); appendCell(tr, service.selection.quantity || "—", "number-cell"); appendCell(tr, money(monthlyTotal(service)), "money-cell"); appendCell(tr, money(setupRate(service)), "money-cell"); body.appendChild(tr);
                const categoryRow = document.createElement("tr"); appendCell(categoryRow, service.service, "service-name"); appendCell(categoryRow, service.recommendation, "description-cell"); appendCell(categoryRow, money(monthlyRate(service)), "money-cell"); appendCell(categoryRow, phase, "number-cell"); appendCell(categoryRow, service.selection.quantity || "—", "number-cell"); appendCell(categoryRow, money(monthlyTotal(service)), "money-cell"); elements.categoryBody.appendChild(categoryRow);
            });
            table.appendChild(body); const wrap = document.createElement("div"); wrap.className = "proposal-table-wrap"; wrap.appendChild(table); card.appendChild(wrap); elements.proposalContainer.appendChild(card);
        });
    }

    function proposalIssues() {
        const issues = [];
        selectedRows().forEach(function (row) {
            if (!text(row.selection.itemId)) issues.push(row.service + ": service Item ID missing");
            if (!text(row.selection.setupItemId)) issues.push(row.service + ": setup Item ID missing");
            if (numericOrNull(row.selection.quantity) === null || Number(row.selection.quantity) <= 0) issues.push(row.service + ": quantity missing");
            if (monthlyRate(row) === null) issues.push(row.service + ": monthly price missing");
            if (setupRate(row) === null) issues.push(row.service + ": setup price missing");
        });
        return issues;
    }

    function replacePhaseOptions() {
        const available = phases(); const previous = state.selectedPhase || elements.quotePhase.value;
        elements.quotePhase.replaceChildren();
        available.forEach(function (phase) { const option = document.createElement("option"); option.value = String(phase); option.textContent = "Phase " + phase; elements.quotePhase.appendChild(option); });
        elements.quotePhase.disabled = !available.length;
        state.selectedPhase = available.map(String).includes(String(previous)) ? String(previous) : available.length ? String(available[0]) : "";
        elements.quotePhase.value = state.selectedPhase;
    }

    function renderQuoteAction() {
        const selected = selectedRows(); const issues = proposalIssues();
        elements.continueToQuote.disabled = !elements.customer.value;
        if (!selected.length) {
            elements.quoteStatus.textContent = "No proposal services selected. You can still continue to create the customer presentation.";
            elements.quoteStatus.className = "quote-status is-ready";
            return;
        }
        elements.quoteStatus.textContent = issues.length
            ? issues.length + (issues.length === 1 ? " mapping/detail needs" : " mappings/details need") + " completion. You can continue, but Books draft creation stays blocked."
            : "All " + selected.length + " selected services are ready for Quote Finalisation.";
        elements.quoteStatus.className = "quote-status " + (issues.length ? "is-error" : "is-ready");
    }

    function updateProposalViews() {
        renderSummary(); renderProposalTables(); replacePhaseOptions(); renderQuoteAction();
        const selected = selectedRows();
        elements.copy.disabled = !selected.length;
        elements.download.disabled = !selected.length;
        elements.copyCategory.disabled = !selected.length;
        elements.downloadCategory.disabled = !selected.length;
        elements.print.disabled = !selected.length;
        schedulePresentationSave();
    }

    function openMapping(row, field, label) {
        state.mappingTarget = { row: row, field: field, label: label };
        elements.mappingPanel.hidden = false; elements.mappingTitle.textContent = "Map " + label.toLowerCase() + " item for " + row.service;
        elements.mappingSearch.value = label === "Setup" ? "Setup " + row.service : (text(pick(row.catalogue, ["SKU", "Sku"])) || row.service);
        elements.mappingSearch.focus(); elements.mappingResults.replaceChildren(); elements.mappingStatus.textContent = "Search by name, SKU or Item ID.";
    }

    function renderMappingResults() {
        elements.mappingResults.replaceChildren();
        state.mappingResults.forEach(function (item) {
            const card = document.createElement("div"); card.className = "mapping-result";
            const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = item.name; const meta = document.createElement("small"); meta.textContent = (item.sku ? "SKU " + item.sku + " · " : "") + money(item.rate) + " · " + item.itemId; copy.append(name, meta);
            const choose = document.createElement("button"); choose.type = "button"; choose.className = "map-button"; choose.textContent = "Use this item";
            choose.addEventListener("click", function () {
                if (!state.mappingTarget) return;
                const target = state.mappingTarget; target.row.selection[target.field] = item.itemId; target.row.selection.mappedName = item.name; target.row.selection.mappedSku = item.sku;
                if (target.field === "itemId" && !text(target.row.selection.customPrice) && item.rate !== null) target.row.selection.customPrice = String(item.rate);
                if (target.field === "setupItemId" && !text(target.row.selection.customSetup) && item.rate !== null) target.row.selection.customSetup = String(item.rate);
                elements.mappingPanel.hidden = true; state.mappingTarget = null; renderEditor(); updateProposalViews(); saveWorkspace();
            });
            card.append(copy, choose); elements.mappingResults.appendChild(card);
        });
    }

    async function searchMappingItems() {
        const query = text(elements.mappingSearch.value);
        if (query.length < 2) { elements.mappingStatus.textContent = "Enter at least 2 characters."; return; }
        elements.mappingSearchButton.disabled = true; elements.mappingStatus.textContent = "Searching Zoho Books…";
        try {
            const result = findQuoteApiPayload(await invokeQuoteApi({ action: "searchItems", query: query }), 0);
            if (!result || text(result.status).toLowerCase() !== "success") throw new Error(result && result.message ? result.message : "No valid item response returned.");
            state.mappingResults = Array.isArray(result.items) ? result.items.map(function (item) { return { itemId: text(item.itemId || item.item_id), name: text(item.name) || "Unnamed item", sku: text(item.sku), description: text(item.description), rate: numericOrNull(item.rate) }; }) : [];
            elements.mappingStatus.textContent = state.mappingResults.length ? state.mappingResults.length + " matching Books items." : "No active Books items matched."; renderMappingResults();
        } catch (error) { elements.mappingStatus.textContent = "Books item search failed: " + (error.message || String(error)); }
        finally { elements.mappingSearchButton.disabled = false; }
    }

    function quotePayload() {
        saveWorkspace();
        const proposals = selectedRows().map(transferRow);
        return { version: 2, createdAt: new Date().toISOString(), customerName: elements.customer.value, crmAccountId: customerCrmAccountId(), selectedPhase: Number(state.selectedPhase || phases()[0]), navigationMode: state.navigationMode, sourceRoute: "proposal", presentationOnly: proposals.length === 0, proposals: proposals, selections: proposals, existingPackage: null };
    }

    async function continueToQuote() {
        if (elements.continueToQuote.disabled || !window.MCGQuoteWorkspace) return;
        try {
            await savePresentationNow();
        } catch (error) {
            if (window.console && typeof window.console.warn === "function") {
                window.console.warn("Presentation images could not be saved before navigation:", error);
            }
        }
        const payload = quotePayload();
        const pageLink = state.navigationMode === "embed" ? CRM_QUOTE_PAGE_LINK : APP_QUOTE_PAGE_LINK;
        // Quote Finalisation is a different widget iframe, so its localStorage
        // may be isolated. Transfer the complete selected proposal explicitly.
        const encoded = typeof window.MCGQuoteWorkspace.encodeTransfer === "function"
            ? await window.MCGQuoteWorkspace.encodeTransfer(payload)
            : window.MCGQuoteWorkspace.encode(payload);
        navigate(pageUrl(pageLink, QUOTE_QUERY_PARAM, encoded));
    }

    async function returnToExisting() {
        const session = elements.customer.value ? saveWorkspace() : window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.current();
        if (!session || !window.MCGQuoteWorkspace) return navigate(pageUrl(SLA_PAGE_LINK, "", ""));
        const proposals = selectedRows().map(transferRow);
        const payload = {
            version: 2,
            createdAt: new Date().toISOString(),
            customerName: elements.customer.value,
            crmAccountId: customerCrmAccountId(),
            selectedPhase: session.selectedPhase || null,
            navigationMode: state.navigationMode,
            sourceRoute: "proposal",
            proposals: proposals,
            selections: proposals
        };
        const encoded = typeof window.MCGQuoteWorkspace.encodeTransfer === "function"
            ? await window.MCGQuoteWorkspace.encodeTransfer(payload)
            : window.MCGQuoteWorkspace.encode(payload);
        navigate(pageUrl(SLA_PAGE_LINK, LEGACY_PROPOSAL_QUERY_PARAM, encoded));
    }

    function buildExportModel() {
        const rows = selectedRows();
        const monthly = totalFor(rows, monthlyTotal); const setup = totalFor(rows, setupRate);
        return {
            customer: elements.customer.value,
            generated: new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date()),
            selectedCount: String(rows.length), phases: phases().join(", "), monthlyTotal: monthly.tbc ? "—" : money(monthly.total), setupTotal: setup.tbc ? "—" : money(setup.total),
            missingRows: approvedMissingSummaryRows(),
            rows: rows.map(function (row) {
                return {
                    phase: "Phase " + row.selection.phase,
                    phaseNumber: Number(row.selection.phase),
                    group: row.group,
                    service: row.service,
                    description: row.businessName || row.service,
                    recommendation: row.recommendation,
                    quantity: row.selection.quantity || "—",
                    unitPrice: money(monthlyRate(row)),
                    monthly: money(monthlyTotal(row)),
                    setup: money(setupRate(row))
                };
            })
        };
    }

    function exportIncludesPrices() {
        const selected = document.querySelector('input[name="missingExportPrices"]:checked');
        return selected && selected.value === "show";
    }

    function buildExportSlides() {
        const model = buildExportModel();
        return {
            model: model,
            slides: model && window.MCGSlideExport
                ? window.MCGSlideExport.renderMissingSlides(model, { includePrices: exportIncludesPrices() })
                : []
        };
    }

    function buildPresentationSlides(includePrices) {
        if (!elements.customer.value || !window.MCGSlideExport) return { model: null, slides: [] };
        const model = buildExportModel() || {
            customer: elements.customer.value,
            generated: new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date()),
            selectedCount: "0",
            phases: "—",
            monthlyTotal: "—",
            setupTotal: "—",
            rows: []
        };
        const rendered = window.MCGSlideExport.renderMissingSlides(model, { includePrices: Boolean(includePrices) });
        return { model: model, slides: [rendered[1], rendered[0]] };
    }

    function buildPresentationSlideVariants() {
        const withoutPrices = buildPresentationSlides(false);
        const withPrices = buildPresentationSlides(true);
        return {
            model: withoutPrices.model,
            withoutPrices: withoutPrices.slides,
            withPrices: withPrices.slides
        };
    }

    function schedulePresentationSave() {
        if (!elements.customer.value || !window.MCGPresentationWorkspace) return;
        window.MCGPresentationWorkspace.queueSave("missing", function () {
            const presentation = buildPresentationSlideVariants();
            if (!presentation.model || presentation.withoutPrices.length !== 2 || presentation.withPrices.length !== 2) return null;
            return {
                customerName: elements.customer.value,
                companyId: customerCrmAccountId(),
                slidesWithoutPrices: presentation.withoutPrices,
                slidesWithPrices: presentation.withPrices,
                fingerprint: JSON.stringify(presentation.model) + "|both-price-variants"
            };
        });
    }

    function savePresentationNow() {
        if (!elements.customer.value || !window.MCGPresentationWorkspace) return Promise.resolve(null);
        const presentation = buildPresentationSlideVariants();
        if (!presentation.model || presentation.withoutPrices.length !== 2 || presentation.withPrices.length !== 2) return Promise.resolve(null);
        return window.MCGPresentationWorkspace.saveSlides({
            kind: "missing",
            customerName: elements.customer.value,
            companyId: customerCrmAccountId(),
            slidesWithoutPrices: presentation.withoutPrices,
            slidesWithPrices: presentation.withPrices
        });
    }

    function applyCustomer(customer, source) {
        state.selections.clear();
        const stored = (window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.get(customer)) || {};
        const session = Object.assign({}, stored, source || {});
        const incomingSelections = source && (
            Array.isArray(source.proposalDrafts) ? source.proposalDrafts :
            Array.isArray(source.proposals) ? source.proposals :
            Array.isArray(source.selections) ? source.selections : null
        );
        const storedSelections = Array.isArray(stored.proposalDrafts) ? stored.proposalDrafts :
            Array.isArray(stored.proposals) ? stored.proposals :
            Array.isArray(stored.selections) ? stored.selections : [];
        state.existingPackage = null;
        // Runtime detection is authoritative; stored workspaces may come from
        // the standalone Creator app and contain a stale shell mode.
        // A return trip from SLA carries the newest phase selection explicitly.
        // Prefer it over this iframe's older proposalDrafts cache so newly added
        // SLA phases are not replaced by the proposal state from before going back.
        restoreSelections(incomingSelections !== null ? incomingSelections : storedSelections);
        state.selectedPhase = text(session.selectedPhase);
        state.serviceRows = buildMissingRows(); state.serviceRows.forEach(function (row) { row.selection = getSelection(row); });
        state.collapsedGroups.clear(); state.collapseInitialized = false;
        elements.emptyState.hidden = true; elements.generatedContent.hidden = false;
        elements.generatedAt.textContent = "Workspace saved for 7 days · " + state.serviceRows.length + " missing service options loaded.";
        renderEditor(); updateProposalViews(); saveWorkspace();
    }

    function replaceCustomerOptions() {
        const customers = Array.from(new Set(state.customerRows.map(crmCustomerName).filter(Boolean))).sort(collator.compare);
        elements.customer.replaceChildren(); const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Select a customer"; elements.customer.appendChild(placeholder);
        customers.forEach(function (customer) { const option = document.createElement("option"); option.value = customer; option.textContent = customer; elements.customer.appendChild(option); });
        elements.customer.disabled = false;
        const candidate = state.incoming && text(state.incoming.customerName) ? state.incoming : window.MCGQuoteWorkspace && window.MCGQuoteWorkspace.current();
        if (candidate && customers.includes(candidate.customerName)) {
            elements.customer.value = candidate.customerName;
            applyCustomer(candidate.customerName, candidate);
        } else {
            elements.emptyState.hidden = false;
            elements.generatedContent.hidden = true;
        }
    }

    function setInitialLoading(active) {
        elements.loadingState.hidden = !active;
        document.body.setAttribute("aria-busy", active ? "true" : "false");
    }

    let bannerHideTimer = null;
    function setBanner(message, mode) {
        if (bannerHideTimer) window.clearTimeout(bannerHideTimer);
        elements.banner.textContent = message;
        elements.banner.className = "connection-banner" + (mode ? " " + mode : "");
        if (mode !== "is-loading" && mode !== "is-error") {
            bannerHideTimer = window.setTimeout(function () { elements.banner.classList.add("is-hidden"); }, 3000);
        }
    }

    function handleAnalytics(payload) {
        const invoiceRows = extractArray(payload, "invoiceRows"); const catalogueRows = extractArray(payload, "catalogueRows"); const customerRows = extractArray(payload, "customerRows"); const activeCustomerRows = customerRows.filter(function (row) { return !crmCustomerIsInactive(row); }); const status = text(payload.status).toLowerCase();
        if (invoiceRows.length && catalogueRows.length && activeCustomerRows.length) {
            setInitialLoading(false);
            state.invoiceRows = invoiceRows; state.catalogueRows = catalogueRows; state.customerRows = activeCustomerRows; state.ready = true; replaceCustomerOptions();
            setBanner("CRM and Analytics connected — " + activeCustomerRows.length + " active companies, " + invoiceRows.length + " invoice rows and " + catalogueRows.length + " catalogue services loaded.", "is-success");
            if (payload.cacheStale) setBanner("Using saved data from " + (payload.lastUpdated || "the last successful refresh") + ". Source refresh is pending or unavailable.", "is-stale");
            return;
        }
        if (status === "pending") {
            setInitialLoading(true);
            state.pendingRetries += 1; setBanner(payload.message || "Analytics export is being prepared…", "is-loading");
            if (state.pendingRetries <= MAX_PENDING_RETRIES) window.setTimeout(loadAnalyticsData, RETRY_DELAY_MS);
            else {
                setInitialLoading(false);
                elements.emptyState.hidden = false;
                setBanner("The Analytics export is taking longer than expected. Refresh shortly.", "is-error");
            }
            return;
        }
        setInitialLoading(false);
        elements.emptyState.hidden = false;
        setBanner(payload.message || "The API returned no CRM companies or SLA viewer data.", "is-error");
    }

    function loadAnalyticsData() {
        if (window.__MISSING_SERVICES_TEST_PAYLOAD__) return handleAnalytics(window.__MISSING_SERVICES_TEST_PAYLOAD__);
        if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA) {
            setInitialLoading(false);
            elements.emptyState.hidden = false;
            return setBanner("Open this widget inside Zoho Creator.", "is-error");
        }
        ZOHO.CREATOR.DATA.invokeCustomApi({ api_name: ANALYTICS_API_NAME, http_method: "GET" }).then(function (response) {
            const payload = findAnalyticsPayload(response, 0); if (!payload) throw new Error("The response did not contain SLA viewer data."); handleAnalytics(payload);
        }).catch(function (error) {
            setInitialLoading(false);
            elements.emptyState.hidden = false;
            setBanner("Could not load SLA data: " + (error.message || String(error)), "is-error");
        });
    }

    elements.customer.addEventListener("change", function () {
        if (!elements.customer.value) { elements.emptyState.hidden = false; elements.generatedContent.hidden = true; return; }
        applyCustomer(elements.customer.value, null);
    });
    elements.quotePhase.addEventListener("change", function () { state.selectedPhase = elements.quotePhase.value; saveWorkspace(); });
    elements.continueToQuote.addEventListener("click", continueToQuote);

    document.querySelectorAll('input[name="missingExportPrices"]').forEach(function (input) {
        input.addEventListener("change", schedulePresentationSave);
    });
    elements.back.addEventListener("click", returnToExisting);
    elements.expandGroups.addEventListener("click", function () { state.collapsedGroups.clear(); state.collapseInitialized = true; renderEditor(); });
    elements.collapseGroups.addEventListener("click", function () { state.collapsedGroups = new Set(state.serviceRows.map(function (row) { return row.group; })); state.collapseInitialized = true; renderEditor(); });
    elements.selectedOnlyGroups.addEventListener("click", function () {
        state.selectedOnly = !state.selectedOnly;
        elements.selectedOnlyGroups.classList.toggle("is-active", state.selectedOnly);
        elements.selectedOnlyGroups.setAttribute("aria-pressed", state.selectedOnly ? "true" : "false");
        renderEditor();
    });
    elements.mappingSearchButton.addEventListener("click", searchMappingItems);
    elements.mappingSearch.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); searchMappingItems(); } });
    elements.mappingCloseButton.addEventListener("click", function () { elements.mappingPanel.hidden = true; state.mappingTarget = null; });
    elements.copy.addEventListener("click", async function () {
        const original = elements.copy.textContent;
        try { const data = buildExportSlides(); if (!data.slides.length) throw new Error("No proposal ready."); await window.MCGSlideExport.copyCanvas(data.slides[0]); elements.copy.textContent = "✓ Copied"; }
        catch (error) { const data = buildExportSlides(); if (data.slides.length) { window.MCGSlideExport.downloadCanvas(data.slides[0], data.model.customer + " proposal phases"); elements.copy.textContent = "✓ PNG downloaded"; } }
        finally { window.setTimeout(function () { elements.copy.textContent = original; }, 3000); }
    });
    elements.download.addEventListener("click", function () {
        const original = elements.download.textContent;
        const data = buildExportSlides();
        if (!data.slides.length) return;
        window.MCGSlideExport.downloadCanvas(data.slides[0], data.model.customer + " proposal phases");
        elements.download.textContent = "✓ Downloaded";
        window.setTimeout(function () { elements.download.textContent = original; }, 3000);
    });
    elements.copyCategory.addEventListener("click", async function () {
        const original = elements.copyCategory.textContent;
        try {
            const data = buildExportSlides();
            if (data.slides.length < 2) throw new Error("No category image ready.");
            await window.MCGSlideExport.copyCanvas(data.slides[1]);
            elements.copyCategory.textContent = "✓ Copied";
        } catch (error) {
            const data = buildExportSlides();
            if (data.slides.length > 1) {
                window.MCGSlideExport.downloadCanvas(data.slides[1], data.model.customer + " summary of missing services");
                elements.copyCategory.textContent = "✓ PNG downloaded";
            }
        } finally { window.setTimeout(function () { elements.copyCategory.textContent = original; }, 3000); }
    });
    elements.downloadCategory.addEventListener("click", function () {
        const original = elements.downloadCategory.textContent;
        const data = buildExportSlides();
        if (data.slides.length < 2) return;
        window.MCGSlideExport.downloadCanvas(data.slides[1], data.model.customer + " summary of missing services");
        elements.downloadCategory.textContent = "✓ Downloaded";
        window.setTimeout(function () { elements.downloadCategory.textContent = original; }, 3000);
    });
    elements.print.addEventListener("click", function () { window.print(); });

    readIncomingWorkflow().then(function (incoming) {
        state.incoming = incoming;
        if (incoming && window.MCGQuoteWorkspace) {
            const update = { crmAccountId: incoming.crmAccountId, selectedPhase: incoming.selectedPhase || null, navigationMode: state.navigationMode };
            const incomingSelections = Array.isArray(incoming.proposalDrafts) ? incoming.proposalDrafts :
                Array.isArray(incoming.proposals) ? incoming.proposals :
                Array.isArray(incoming.selections) ? incoming.selections : null;
            if (incomingSelections !== null) {
                update.proposals = incomingSelections;
                update.proposalDrafts = incomingSelections;
            }
            window.MCGQuoteWorkspace.save(incoming.customerName, update);
        }
        if (state.ready && incoming && text(incoming.customerName)) { elements.customer.value = incoming.customerName; applyCustomer(incoming.customerName, incoming); }
    });
    loadAnalyticsData();

    window.__missingServicesApp = {
        buildMissingRows: buildMissingRows, transferRow: transferRow, proposalIssues: proposalIssues,
        quotePayload: quotePayload, searchMappingItems: searchMappingItems, saveWorkspace: saveWorkspace,
        buildExportModel: buildExportModel, approvedMissingSummaryRows: approvedMissingSummaryRows
    };
}());
