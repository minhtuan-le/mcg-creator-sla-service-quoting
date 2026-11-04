(function () {
    "use strict";
    const REPORT = "All_Work";
    const state = { records: [], cursor: "", loading: false, view: "all", customerKey: "" };
    const elements = {
        rows: document.getElementById("workRows"),
        status: document.getElementById("workStatus"),
        search: document.getElementById("searchInput"),
        filter: document.getElementById("typeFilter"),
        allView: document.getElementById("allWorkView"),
        customerView: document.getElementById("customerWorkView"),
        sidebar: document.getElementById("customerSidebar"),
        customerList: document.getElementById("customerList"),
        customerCount: document.getElementById("customerCount"),
        customerHeading: document.getElementById("customerHeading"),
        customerName: document.getElementById("selectedCustomerName"),
        selectedCount: document.getElementById("selectedCustomerCount"),
        customerColumn: document.getElementById("customerColumn"),
        total: document.getElementById("totalCount"),
        presentations: document.getElementById("presentationCount"),
        quotes: document.getElementById("quoteCount"),
        refresh: document.getElementById("refreshButton"),
        more: document.getElementById("loadMore")
    };

    function text(value) { return value == null ? "" : String(value).trim(); }

    function outputDetail(item) {
        const key = text(item.Output_Key);
        if (item.Output_Type === "Presentation") {
            if (key.endsWith(":With%20prices")) return "With prices";
            if (key.endsWith(":Without%20prices")) return "Without prices";
        }
        if (item.Output_Type === "Quote") {
            const part = key.match(/:Draft%20%23(.+)$/);
            if (part) {
                try { return "Draft #" + decodeURIComponent(part[1]); }
                catch (error) { return ""; }
            }
        }
        return "";
    }

    function apiFailure(value) {
        if (typeof value === "string") {
            try { return apiFailure(JSON.parse(value)); }
            catch (error) { return { code: 0, message: value }; }
        }
        if (!value || typeof value !== "object") return { code: 0, message: text(value) };
        for (const key of ["responseText", "error", "response"]) {
            if (value[key]) {
                const nested = apiFailure(value[key]);
                if (nested.code || nested.message) return nested;
            }
        }
        return { code: Number(value.code) || 0,
            message: text(value.message || value.statusText || value.details) };
    }

    function emptyReport(value) { return apiFailure(value).code === 9220; }

    function validOutputUrl(value) {
        try {
            const url = new URL(text(value));
            const host = url.hostname.toLowerCase();
            return url.protocol === "https:" && (
                host === "books.mcgcomputer.com.au" ||
                host === "show.zoho.com" || host === "show.zoho.com.au"
            ) ? url.href : "";
        } catch (error) { return ""; }
    }

    function formatDate(value) {
        const date = new Date(text(value));
        return Number.isNaN(date.getTime()) ? text(value) :
            new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
    }

    function putCell(row, value, className) {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = text(value);
        row.appendChild(cell);
        return cell;
    }

    function customerKey(item) {
        const id = text(item.CRM_Account_ID);
        return id ? "crm:" + id : "name:" + text(item.Customer_Name).toLocaleLowerCase();
    }

    function matchesSearch(item, query) {
        return [item.Customer_Name, item.scope_field, outputDetail(item), item.Created_By_Email, item.External_ID]
            .some(function (value) { return text(value).toLowerCase().includes(query); });
    }

    function renderCustomerList(sorted, query, type) {
        const groups = new Map();
        sorted.forEach(function (item) {
            if (type && item.Output_Type !== type) return;
            const key = customerKey(item);
            if (!groups.has(key)) groups.set(key, { key: key, name: text(item.Customer_Name) || "Unnamed customer", items: [] });
            groups.get(key).items.push(item);
        });
        const customers = Array.from(groups.values()).filter(function (group) {
            return !query || group.name.toLowerCase().includes(query) ||
                group.items.some(function (item) { return matchesSearch(item, query); });
        }).sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }); });
        if (!customers.some(function (group) { return group.key === state.customerKey; })) {
            state.customerKey = customers.length ? customers[0].key : "";
        }
        elements.customerList.replaceChildren();
        const fragment = document.createDocumentFragment();
        customers.forEach(function (group) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "customer-button" + (group.key === state.customerKey ? " is-selected" : "");
            button.setAttribute("aria-pressed", String(group.key === state.customerKey));
            const name = document.createElement("span");
            name.textContent = group.name;
            const count = document.createElement("small");
            count.textContent = String(group.items.length);
            button.append(name, count);
            button.addEventListener("click", function () { state.customerKey = group.key; render(); });
            fragment.appendChild(button);
        });
        elements.customerList.appendChild(fragment);
        elements.customerCount.textContent = String(customers.length);
        const selected = customers.find(function (group) { return group.key === state.customerKey; });
        elements.customerHeading.hidden = !selected;
        elements.customerName.textContent = selected ? selected.name : "";
        elements.selectedCount.textContent = selected ? selected.items.length + " output" + (selected.items.length === 1 ? "" : "s") : "";
        return selected ? selected.items : [];
    }

    function render() {
        const query = text(elements.search.value).toLowerCase();
        const type = elements.filter.value;
        const sorted = state.records.slice().sort(function (a, b) {
            return text(b.Created_At).localeCompare(text(a.Created_At));
        });
        const byCustomer = state.view === "customer";
        elements.allView.classList.toggle("is-selected", !byCustomer);
        elements.customerView.classList.toggle("is-selected", byCustomer);
        elements.allView.setAttribute("aria-pressed", String(!byCustomer));
        elements.customerView.setAttribute("aria-pressed", String(byCustomer));
        elements.sidebar.hidden = !byCustomer;
        elements.customerHeading.hidden = !byCustomer;
        elements.customerColumn.hidden = byCustomer;
        const visible = byCustomer ? renderCustomerList(sorted, query, type) : sorted.filter(function (item) {
            return (!type || item.Output_Type === type) && (!query || matchesSearch(item, query));
        });
        elements.rows.replaceChildren();
        const fragment = document.createDocumentFragment();
        visible.forEach(function (item) {
            const row = document.createElement("tr");
            if (!byCustomer) putCell(row, item.Customer_Name || "Unnamed customer");
            const typeCell = document.createElement("td");
            const pill = document.createElement("span");
            pill.className = "type-pill" + (item.Output_Type === "Quote" ? " is-quote" : "");
            const detail = outputDetail(item);
            pill.textContent = item.Output_Type === "Presentation"
                ? "Presentation" + (detail ? " · " + detail : "") : "Draft quote";
            typeCell.appendChild(pill); row.appendChild(typeCell);
            putCell(row, item.scope_field || detail || "—");
            putCell(row, formatDate(item.Created_At), "date-cell");
            putCell(row, item.Created_By_Email || "Unknown", "creator-cell");
            const linkCell = document.createElement("td");
            const href = validOutputUrl(item.Output_URL);
            if (href) {
                const link = document.createElement("a");
                link.className = "open-link";
                link.href = href;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = item.Output_Type === "Presentation" ? "Open in Show ↗" : "Open in Books ↗";
                linkCell.appendChild(link);
            } else { linkCell.textContent = "Link unavailable"; }
            row.appendChild(linkCell); fragment.appendChild(row);
        });
        elements.rows.appendChild(fragment);
        elements.total.textContent = state.records.length + (state.cursor ? "+" : "");
        elements.presentations.textContent = state.records.filter(function (row) { return row.Output_Type === "Presentation"; }).length + (state.cursor ? "+" : "");
        elements.quotes.textContent = state.records.filter(function (row) { return row.Output_Type === "Quote"; }).length + (state.cursor ? "+" : "");
        elements.status.textContent = state.records.length
            ? byCustomer
                ? (visible.length ? "Showing " + visible.length + " loaded outputs for this customer" : "No matching customers in loaded work") +
                    (state.cursor ? ". Load more to see older work." : ".")
                : "Showing " + visible.length + " of " + state.records.length + " loaded outputs" + (state.cursor ? ". Load more to see older work." : ".")
            : "No created work yet. Successful presentations and quotes will appear here.";
        elements.status.className = "";
    }

    async function load(reset) {
        if (state.loading) return;
        state.loading = true;
        elements.refresh.disabled = true;
        elements.more.disabled = true;
        elements.status.textContent = "Loading Created Work…";
        elements.status.className = "";
        try {
            if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA ||
                typeof ZOHO.CREATOR.DATA.getRecords !== "function") throw new Error("Open this page in Zoho Creator.");
            const config = {
                report_name: REPORT, field_config: "custom",
                fields: "Output_Key,Customer_Name,CRM_Account_ID,Output_Type,scope_field,External_ID,Output_URL,Created_At,Created_By_Email",
                max_records: 1000
            };
            if (!reset && state.cursor) config.record_cursor = state.cursor;
            const response = await ZOHO.CREATOR.DATA.getRecords(config);
            if (!emptyReport(response) && Number(response && response.code) !== 3000 &&
                Number(response && response.code) !== 3100 &&
                !Array.isArray(response && response.data)) {
                throw response;
            }
            const rows = Array.isArray(response && response.data) ? response.data : [];
            state.records = reset ? rows : state.records.concat(rows);
            // Zoho's cursor may be carried in the SDK response or its header wrapper.
            state.cursor = text(response.record_cursor || response.recordCursor ||
                (response.headers && (response.headers.record_cursor || response.headers.recordCursor)) ||
                (response.info && response.info.record_cursor));
            elements.more.hidden = !state.cursor;
            render();
        } catch (error) {
            if (emptyReport(error)) {
                if (reset) state.records = [];
                state.cursor = "";
                elements.more.hidden = true;
                render();
            } else {
                const failure = apiFailure(error);
                elements.status.textContent = "Could not load Created Work: " +
                    (failure.code ? failure.code + " — " : "") +
                    (failure.message || "Creator did not provide an error message.");
                elements.status.className = "is-error";
            }
        } finally {
            state.loading = false;
            elements.refresh.disabled = false;
            elements.more.disabled = false;
        }
    }

    elements.refresh.addEventListener("click", function () { load(true); });
    elements.more.addEventListener("click", function () { load(false); });
    elements.search.addEventListener("input", render);
    elements.filter.addEventListener("change", render);
    elements.allView.addEventListener("click", function () { state.view = "all"; render(); });
    elements.customerView.addEventListener("click", function () { state.view = "customer"; render(); });
    load(true);
})();