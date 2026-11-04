(function () {
    "use strict";

    const FORM = "Created_Work";
    const REPORT = "All_Work";
    const STORAGE_KEY = "mcg_created_work_pending_v1";

    function text(value) { return value == null ? "" : String(value).trim(); }

    function isNoMatch(value) {
        if (typeof value === "string") {
            try { return isNoMatch(JSON.parse(value)); } catch (error) { return false; }
        }
        if (!value || typeof value !== "object") return false;
        const code = Number(value.code);
        return code === 9220 || code === 9280 ||
            isNoMatch(value.responseText) || isNoMatch(value.error);
    }

    function pending() {
        try {
            const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
            return Array.isArray(value) ? value : [];
        } catch (error) { return []; }
    }

    function store(records) {
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-25))); }
        catch (error) { /* Creator may restrict storage in an embed. */ }
    }

    function keep(record) {
        store(pending().filter(function (item) { return item.Output_Key !== record.Output_Key; }).concat(record));
    }

    function remove(key) {
        store(pending().filter(function (item) { return item.Output_Key !== key; }));
    }

    function sdk() {
        if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA ||
            typeof ZOHO.CREATOR.DATA.addRecords !== "function") {
            throw new Error("Creator records are unavailable in this page.");
        }
        return ZOHO.CREATOR;
    }

    async function creatorEmail() {
        const creator = sdk();
        if (!creator.UTIL || typeof creator.UTIL.getInitParams !== "function") return "";
        try {
            const params = await creator.UTIL.getInitParams();
            return text(params && params.loginUser);
        } catch (error) { return ""; }
    }

    async function record(output) {
        const key = text(output && output.key);
        const url = text(output && output.url);
        if (!key || !url || !/^https:\/\//i.test(url)) throw new Error("A valid output ID and link are required.");
        const data = {
            Output_Key: key.slice(0, 250),
            Customer_Name: text(output.customerName).slice(0, 250),
            CRM_Account_ID: text(output.crmAccountId).slice(0, 250),
            Output_Type: text(output.type).slice(0, 80),
            scope_field: text(output.scope).slice(0, 250),
            External_ID: text(output.externalId).slice(0, 250),
            Output_URL: url,
            Created_At: text(output.createdAt) || new Date().toISOString(),
            Created_By_Email: text(output.email)
        };
        keep(data);
        try {
            if (!data.Created_By_Email) data.Created_By_Email = await creatorEmail();
            keep(data);
            const response = await sdk().DATA.addRecords({ form_name: FORM, payload: { data: data } });
            if (Number(response && response.code) !== 3000) {
                // A timed-out response can mean the record was saved. Check the unique key before retrying.
                const found = await find(key);
                if (!found) throw new Error(text(response && response.message) || "Creator could not save the entry.");
            }
            remove(key);
            return data;
        } catch (error) {
            // A lost add response must not cause two entries when the user retries.
            try { if (await find(key)) { remove(key); return data; } } catch (lookupError) { /* Preserve for retry. */ }
            throw error;
        }
    }

    async function find(key) {
        const escaped = text(key).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        try {
            const response = await sdk().DATA.getRecords({
                report_name: REPORT,
                criteria: 'Output_Key == "' + escaped + '"',
                field_config: "custom",
                fields: "Output_Key",
                max_records: 200
            });
            if (isNoMatch(response)) return false;
            return Array.isArray(response && response.data) && response.data.some(function (row) {
                return text(row.Output_Key) === key;
            });
        } catch (error) {
            if (isNoMatch(error)) return false;
            throw error;
        }
    }

    async function retryPending() {
        const records = pending();
        let failed = 0;
        for (const item of records) {
            try {
                if (await find(item.Output_Key)) { remove(item.Output_Key); continue; }
                const response = await sdk().DATA.addRecords({ form_name: FORM, payload: { data: item } });
                if (Number(response && response.code) !== 3000 && !(await find(item.Output_Key))) {
                    throw new Error("Created Work entry could not be saved.");
                }
                remove(item.Output_Key);
            } catch (error) { failed += 1; }
        }
        return { saved: records.length - failed, failed: failed };
    }

    window.MCGCreatedWork = { record: record, retryPending: retryPending, pendingCount: function () { return pending().length; } };
})();
