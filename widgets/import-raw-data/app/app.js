(function () {
    "use strict";

    // Reuse the existing Creator Custom API.
    const CUSTOM_API_NAME = "get_sla_analytics_data";
    const RETRY_DELAY_MS = 4000;
    const MAX_PENDING_RETRIES = 30;
    const PAGE_SIZE = 50;
    const TABLE_COLUMN_COUNT = 15;
    const UNMAPPED_SERVICE = "__unmapped__";

    const columns = [
        "Group",
        "Customer",
        "Customer ID",
        "Average Monthly Charges",
        "Quantity",
        "Contracts",
        "SLA Type",
        "Item Display Order",
        "Item Display Name",
        "SLA Order",
        "Helper Column",
        "Display Group",
        "Sub Group",
        "Recurring Inv ID",
        "Next Invoice Date"
    ];

    const numericColumns = new Set([
        "Average Monthly Charges",
        "Quantity",
        "Item Display Order",
        "SLA Order"
    ]);

    const collator = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base"
    });

    const state = {
        rows: [],
        filteredRows: [],
        page: 1,
        pendingRetries: 0,
        loadedAt: null
    };

    const elements = {
        banner: document.getElementById("connectionBanner"),
        search: document.getElementById("searchFilter"),
        customer: document.getElementById("customerFilter"),
        slaType: document.getElementById("slaTypeFilter"),
        service: document.getElementById("serviceFilter"),
        rawRowCount: document.getElementById("rawRowCount"),
        filteredRowCount: document.getElementById("filteredRowCount"),
        statusValue: document.getElementById("statusValue"),
        refreshValue: document.getElementById("refreshValue"),
        tableStatus: document.getElementById("tableStatus"),
        body: document.getElementById("rawBody"),
        prevPage: document.getElementById("prevPage"),
        nextPage: document.getElementById("nextPage"),
        pageInfo: document.getElementById("pageInfo")
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

    function extractRows(payload) {
        const collection = parseJson(payload && payload.invoiceRows);

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

    function setBanner(message, mode) {
        elements.banner.textContent = message;
        elements.banner.classList.remove("is-loading", "is-error");

        if (mode) {
            elements.banner.classList.add(mode);
        }
    }

    function showEmpty(message) {
        elements.body.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = TABLE_COLUMN_COUNT;
        cell.className = "empty-cell";
        cell.textContent = message;

        row.appendChild(cell);
        elements.body.appendChild(row);
    }

    function replaceOptions(select, placeholder, values, specialOptions) {
        select.replaceChildren();

        const first = document.createElement("option");
        first.value = "";
        first.textContent = placeholder;
        select.appendChild(first);

        (specialOptions || []).forEach(function (entry) {
            const option = document.createElement("option");
            option.value = entry.value;
            option.textContent = entry.label;
            select.appendChild(option);
        });

        values.forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
    }

    function uniqueValues(rows, field) {
        return Array.from(
            new Set(
                rows.map(function (row) {
                    return text(row[field]);
                }).filter(Boolean)
            )
        ).sort(collator.compare);
    }

    function orderedSlaTypes(rows) {
        const orderByName = new Map();

        rows.forEach(function (row) {
            const name = text(row["SLA Type"]);
            if (!name) {
                return;
            }

            const rawOrder = Number(row["SLA Order"]);
            const order = Number.isFinite(rawOrder) ? rawOrder : Number.MAX_SAFE_INTEGER;

            if (!orderByName.has(name) || order < orderByName.get(name)) {
                orderByName.set(name, order);
            }
        });

        return Array.from(orderByName.keys()).sort(function (left, right) {
            const difference = orderByName.get(left) - orderByName.get(right);
            return difference || collator.compare(left, right);
        });
    }

    function rowMatchesSearch(row, query) {
        if (!query) {
            return true;
        }

        const haystack = columns.map(function (column) {
            return text(row[column]);
        }).join(" ").toLocaleLowerCase();

        return haystack.includes(query);
    }

    function applyFilters() {
        const query = text(elements.search.value).toLocaleLowerCase();
        const customer = elements.customer.value;
        const slaType = elements.slaType.value;
        const service = elements.service.value;

        state.filteredRows = state.rows.filter(function (row) {
            if (customer && text(row.Customer) !== customer) {
                return false;
            }

            if (slaType && text(row["SLA Type"]) !== slaType) {
                return false;
            }

            const itemDisplayName = text(row["Item Display Name"]);

            if (service === UNMAPPED_SERVICE && itemDisplayName !== "") {
                return false;
            }

            if (
                service &&
                service !== UNMAPPED_SERVICE &&
                itemDisplayName !== service
            ) {
                return false;
            }

            return rowMatchesSearch(row, query);
        });

        state.page = 1;
        render();
    }

    function addCell(row, value, columnName) {
        const cell = document.createElement("td");
        cell.textContent = text(value);

        if (numericColumns.has(columnName)) {
            cell.classList.add("numeric");
        }

        row.appendChild(cell);
    }

    function renderTable() {
        elements.body.replaceChildren();

        if (!state.filteredRows.length) {
            showEmpty("No raw-data rows match the selected filters.");
            return;
        }

        const startIndex = (state.page - 1) * PAGE_SIZE;
        const endIndex = Math.min(startIndex + PAGE_SIZE, state.filteredRows.length);
        const pageRows = state.filteredRows.slice(startIndex, endIndex);
        const fragment = document.createDocumentFragment();

        pageRows.forEach(function (data) {
            const row = document.createElement("tr");

            columns.forEach(function (column) {
                addCell(row, data[column], column);
            });

            fragment.appendChild(row);
        });

        elements.body.appendChild(fragment);
    }

    function renderPagination() {
        const totalRows = state.filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

        if (state.page > totalPages) {
            state.page = totalPages;
        }

        const start = totalRows ? ((state.page - 1) * PAGE_SIZE) + 1 : 0;
        const end = totalRows ? Math.min(state.page * PAGE_SIZE, totalRows) : 0;

        elements.pageInfo.textContent =
            "Page " + state.page + " of " + totalPages;

        elements.prevPage.disabled = state.page <= 1;
        elements.nextPage.disabled = state.page >= totalPages;

        elements.tableStatus.textContent =
            "Showing " + start + "–" + end +
            " of " + totalRows + " filtered rows · " +
            state.rows.length + " raw rows loaded";
    }

    function renderSummary() {
        elements.rawRowCount.textContent = String(state.rows.length);
        elements.filteredRowCount.textContent = String(state.filteredRows.length);
        elements.statusValue.textContent = "Ready";

        if (state.loadedAt) {
            elements.refreshValue.textContent =
                new Intl.DateTimeFormat("en-AU", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit"
                }).format(state.loadedAt);
        } else {
            elements.refreshValue.textContent = "—";
        }
    }

    function render() {
        renderSummary();
        renderPagination();
        renderTable();
    }

    function enableViewer(rows, payload) {
        state.rows = rows;
        state.filteredRows = rows.slice();
        state.page = 1;
        state.pendingRetries = 0;
        state.loadedAt = new Date();

        const hasUnmapped = rows.some(function (row) {
            return text(row["Item Display Name"]) === "";
        });

        replaceOptions(
            elements.customer,
            "All customers",
            uniqueValues(rows, "Customer")
        );

        replaceOptions(
            elements.slaType,
            "All SLA types",
            orderedSlaTypes(rows)
        );

        replaceOptions(
            elements.service,
            "All services",
            uniqueValues(rows, "Item Display Name"),
            hasUnmapped ? [{
                value: UNMAPPED_SERVICE,
                label: "Unmapped / blank service"
            }] : []
        );

        elements.search.disabled = false;
        elements.customer.disabled = false;
        elements.slaType.disabled = false;
        elements.service.disabled = false;

        setBanner(
            (payload && payload.message ? text(payload.message) + " — " : "") +
            rows.length +
            " raw invoice rows loaded."
        );

        render();
    }

    function handlePayload(payload) {
        const status = text(payload && payload.status).toLowerCase();
        const rows = extractRows(payload);

        if (rows.length) {
            enableViewer(rows, payload);
            return;
        }

        if (status === "ready") {
            enableViewer([], payload);
            return;
        }

        if (status === "pending") {
            state.pendingRetries += 1;

            elements.statusValue.textContent = "Waiting";
            setBanner(
                text(payload.message) || "Analytics export is being prepared…",
                "is-loading"
            );
            showEmpty("Analytics is preparing the data. This page will retry automatically.");

            if (state.pendingRetries <= MAX_PENDING_RETRIES) {
                window.setTimeout(loadAnalyticsData, RETRY_DELAY_MS);
            } else {
                setBanner(
                    "The Analytics export is taking longer than expected. Refresh this page shortly.",
                    "is-error"
                );
                elements.statusValue.textContent = "Delayed";
            }

            return;
        }

        const message =
            text(payload && payload.message) ||
            "The API did not return raw invoice rows.";

        setBanner(message, "is-error");
        elements.statusValue.textContent = "Error";
        elements.tableStatus.textContent = "Data could not be loaded.";
        showEmpty(message);
    }

    function loadAnalyticsData() {
        if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA) {
            setBanner("Zoho Creator widget SDK did not load.", "is-error");
            elements.statusValue.textContent = "Error";
            elements.tableStatus.textContent = "Data could not be loaded.";
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
                        "The Custom API response did not contain invoiceRows."
                    );
                }

                handlePayload(payload);
            })
            .catch(function (error) {
                const message =
                    error && error.message ? error.message : String(error);

                setBanner(
                    "Could not call the Creator Custom API: " + message,
                    "is-error"
                );
                elements.statusValue.textContent = "Error";
                elements.tableStatus.textContent = "Data could not be loaded.";

                showEmpty(
                    "Check that the existing Custom API link name is " +
                    CUSTOM_API_NAME +
                    " and that this user has access."
                );
            });
    }

    elements.search.addEventListener("input", applyFilters);
    elements.customer.addEventListener("change", applyFilters);
    elements.slaType.addEventListener("change", applyFilters);
    elements.service.addEventListener("change", applyFilters);

    elements.prevPage.addEventListener("click", function () {
        if (state.page > 1) {
            state.page -= 1;
            render();
        }
    });

    elements.nextPage.addEventListener("click", function () {
        const totalPages = Math.max(
            1,
            Math.ceil(state.filteredRows.length / PAGE_SIZE)
        );

        if (state.page < totalPages) {
            state.page += 1;
            render();
        }
    });

    setBanner("Connecting to Zoho Analytics…", "is-loading");
    loadAnalyticsData();
}());
