(function (global) {
    "use strict";

    const CONFIG = {
        appName: "recurring-invoice-report",
        formName: "Presentation_Workspace",
        reportName: "All_Presentation_Workspaces",
        createApiName: "create_customer_presentation",
        fields: {
            companyId: "Company_ID",
            customerName: "Customer_Name",
            existingServices: "Existing_Services_Image",
            riskAnalysis: "Risk_Analysis_Image",
            missingServices: "Missing_Services_Image",
            proposalPhases: "Proposal_Phases_Image",
            existingServicesWithPrices: "Existing_Services_Image_With_Prices",
            riskAnalysisWithPrices: "Risk_Analysis_Image_With_Prices",
            missingServicesWithPrices: "Missing_Services_Image_With_Prices",
            proposalPhasesWithPrices: "Proposal_Phases_Image_With_Prices",
            existingReady: "Existing_Ready",
            missingReady: "Missing_Ready"
        }
    };

    const timers = new Map();
    const fingerprints = new Map();

    function text(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "object") return text(value.display_value || value.value || value.name || value.ID || "");
        return String(value).trim();
    }

    function normalise(value) {
        return text(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    function identity(companyId, customerName) {
        return text(companyId) || (text(customerName) ? "customer-" + normalise(customerName) : "");
    }

    function escapeCriteria(value) {
        return text(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    function sdkAvailable() {
        return Boolean(global.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.DATA && ZOHO.CREATOR.FILE);
    }

    function errorMessage(error) {
        if (error && typeof error.message === "string" && error.message.trim()) return error.message.trim();
        if (typeof error === "string" && error.trim()) return error.trim();
        try {
            const serialised = JSON.stringify(error);
            return serialised && serialised !== "{}" ? serialised : "Unknown Zoho Creator error.";
        } catch (serialiseError) {
            return String(error || "Unknown Zoho Creator error.");
        }
    }

    function isNoRecordError(error) {
        const details = errorMessage(error).toLowerCase();
        return details.includes("9220") ||
            details.includes("9280") ||
            details.includes("no records") ||
            details.includes("no data") ||
            details.includes("no matching record");
    }

    function recordsFromResponse(response) {
        if (!response || typeof response !== "object") return [];
        if (Array.isArray(response.data)) return response.data;
        for (const value of Object.values(response)) {
            const records = recordsFromResponse(value);
            if (records.length) return records;
        }
        return [];
    }

    function recordIdFromResponse(response) {
        if (!response || typeof response !== "object") return "";
        if (response.data && !Array.isArray(response.data) && text(response.data.ID)) return text(response.data.ID);
        if (text(response.ID)) return text(response.ID);
        for (const value of Object.values(response)) {
            if (value && typeof value === "object") {
                const id = recordIdFromResponse(value);
                if (id) return id;
            }
        }
        return "";
    }

    function workspaceCriteria(workspaceId) {
        return CONFIG.fields.companyId + '=="' + escapeCriteria(workspaceId) + '"';
    }

    async function getWorkspace(companyId, customerName) {
        const workspaceId = identity(companyId, customerName);
        if (!workspaceId || !sdkAvailable()) return null;
        if (typeof global.__PRESENTATION_WORKSPACE_GET_TEST_HANDLER__ === "function") {
            return global.__PRESENTATION_WORKSPACE_GET_TEST_HANDLER__(workspaceId, customerName);
        }
        try {
            const response = await ZOHO.CREATOR.DATA.getRecords({
                app_name: CONFIG.appName,
                report_name: CONFIG.reportName,
                criteria: workspaceCriteria(workspaceId),
                field_config: "all",
                max_records: 200
            });
            return recordsFromResponse(response)[0] || null;
        } catch (error) {
            if (isNoRecordError(error)) return null;
            throw new Error(errorMessage(error));
        }
    }

    async function ensureWorkspace(companyId, customerName) {
        const workspaceId = identity(companyId, customerName);
        if (!workspaceId) throw new Error("The CRM company ID is unavailable for this customer.");
        let record = await getWorkspace(workspaceId, customerName);
        if (record) return record;
        const response = await ZOHO.CREATOR.DATA.addRecords({
            app_name: CONFIG.appName,
            form_name: CONFIG.formName,
            payload: {
                data: {
                    [CONFIG.fields.companyId]: workspaceId,
                    [CONFIG.fields.customerName]: text(customerName),
                    [CONFIG.fields.existingReady]: false,
                    [CONFIG.fields.missingReady]: false
                },
                skip_workflow: ["form_workflow"]
            }
        });
        const recordId = recordIdFromResponse(response);
        if (!recordId) {
            record = await getWorkspace(workspaceId, customerName);
            if (!record) throw new Error("The presentation workspace record could not be created.");
            return record;
        }
        return { ID: recordId, [CONFIG.fields.companyId]: workspaceId, [CONFIG.fields.customerName]: text(customerName) };
    }

    function canvasFile(canvas, filename) {
        return new Promise(function (resolve, reject) {
            if (!canvas || typeof canvas.toBlob !== "function") {
                reject(new Error("A presentation image could not be rendered."));
                return;
            }
            canvas.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error("A presentation image could not be created."));
                    return;
                }
                if (blob.size > 512000) {
                    reject(new Error(filename + " exceeds Zoho Show's 500 KB image limit."));
                    return;
                }
                resolve(new File([blob], filename, { type: "image/png" }));
            }, "image/png");
        });
    }

    async function uploadFile(recordId, fieldName, file) {
        if (typeof global.__PRESENTATION_WORKSPACE_UPLOAD_TEST_HANDLER__ === "function") {
            return global.__PRESENTATION_WORKSPACE_UPLOAD_TEST_HANDLER__(recordId, fieldName, file);
        }
        return ZOHO.CREATOR.FILE.uploadFile({
            app_name: CONFIG.appName,
            report_name: CONFIG.reportName,
            id: text(recordId),
            field_name: fieldName,
            file: file,
            skip_workflow: ["form_workflow"]
        });
    }

    async function markReady(recordId, customerName, kind) {
        const data = { [CONFIG.fields.customerName]: text(customerName) };
        data[kind === "existing" ? CONFIG.fields.existingReady : CONFIG.fields.missingReady] = true;
        return ZOHO.CREATOR.DATA.updateRecords({
            app_name: CONFIG.appName,
            report_name: CONFIG.reportName,
            payload: {
                criteria: 'ID=="' + escapeCriteria(recordId) + '"',
                data: data,
                skip_workflow: ["form_workflow"]
            }
        });
    }

    async function saveSlides(options) {
        if (!options || !sdkAvailable()) return null;
        const customerName = text(options.customerName);
        const companyId = identity(options.companyId, customerName);
        const fallbackSlides = Array.isArray(options.slides) ? options.slides : [];
        const slidesWithoutPrices = Array.isArray(options.slidesWithoutPrices) ? options.slidesWithoutPrices : fallbackSlides;
        const slidesWithPrices = Array.isArray(options.slidesWithPrices) ? options.slidesWithPrices : fallbackSlides;
        if (!customerName || !companyId || slidesWithoutPrices.length !== 2 || slidesWithPrices.length !== 2) return null;
        const record = await ensureWorkspace(companyId, customerName);
        const recordId = text(record.ID);
        const safeCustomer = normalise(customerName) || "customer";
        const fieldsWithoutPrices = options.kind === "existing"
            ? [CONFIG.fields.existingServices, CONFIG.fields.riskAnalysis]
            : [CONFIG.fields.missingServices, CONFIG.fields.proposalPhases];
        const fieldsWithPrices = options.kind === "existing"
            ? [CONFIG.fields.existingServicesWithPrices, CONFIG.fields.riskAnalysisWithPrices]
            : [CONFIG.fields.missingServicesWithPrices, CONFIG.fields.proposalPhasesWithPrices];
        const filenamesWithoutPrices = options.kind === "existing"
            ? [safeCustomer + "-existing-services.png", safeCustomer + "-risk-analysis.png"]
            : [safeCustomer + "-missing-services.png", safeCustomer + "-proposal-phases.png"];
        const filenamesWithPrices = options.kind === "existing"
            ? [safeCustomer + "-existing-services-with-prices.png", safeCustomer + "-risk-analysis-with-prices.png"]
            : [safeCustomer + "-missing-services-with-prices.png", safeCustomer + "-proposal-phases-with-prices.png"];
        const canvases = slidesWithoutPrices.concat(slidesWithPrices);
        const fieldNames = fieldsWithoutPrices.concat(fieldsWithPrices);
        const filenames = filenamesWithoutPrices.concat(filenamesWithPrices);
        const files = await Promise.all(canvases.map(function (canvas, index) {
            return canvasFile(canvas, filenames[index]);
        }));
        await Promise.all(files.map(function (file, index) {
            return uploadFile(recordId, fieldNames[index], file);
        }));
        await markReady(recordId, customerName, options.kind);
        return { recordId: recordId, companyId: companyId, customerName: customerName };
    }

    function queueSave(kind, supplier, delay) {
        if (timers.has(kind)) global.clearTimeout(timers.get(kind));
        timers.set(kind, global.setTimeout(async function () {
            timers.delete(kind);
            try {
                const options = typeof supplier === "function" ? supplier() : null;
                if (!options) return;
                const workspaceId = identity(options.companyId, options.customerName);
                const key = kind + "|" + workspaceId;
                const fingerprint = text(options.fingerprint);
                if (fingerprint && fingerprints.get(key) === fingerprint) return;
                await saveSlides(Object.assign({}, options, { kind: kind }));
                if (fingerprint) fingerprints.set(key, fingerprint);
            } catch (error) {
                if (global.console && typeof global.console.warn === "function") {
                    global.console.warn("Presentation image save failed:", error);
                }
            }
        }, Number(delay) || 1800));
    }

    function truthy(value) {
        return value === true || text(value).toLowerCase() === "true" || text(value).toLowerCase() === "yes";
    }

    function fileValuePresent(value) {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === "object") return Object.keys(value).length > 0;
        return Boolean(text(value));
    }

    async function status(companyId, customerName) {
        const record = await getWorkspace(companyId, customerName);
        const existingWithPricesReady = Boolean(record && fileValuePresent(record[CONFIG.fields.existingServicesWithPrices]) && fileValuePresent(record[CONFIG.fields.riskAnalysisWithPrices]));
        const missingWithPricesReady = Boolean(record && fileValuePresent(record[CONFIG.fields.missingServicesWithPrices]) && fileValuePresent(record[CONFIG.fields.proposalPhasesWithPrices]));
        return {
            record: record,
            ready: Boolean(record && truthy(record[CONFIG.fields.existingReady]) && truthy(record[CONFIG.fields.missingReady])),
            existingReady: Boolean(record && truthy(record[CONFIG.fields.existingReady])),
            missingReady: Boolean(record && truthy(record[CONFIG.fields.missingReady])),
            withPricesReady: existingWithPricesReady && missingWithPricesReady,
            existingWithPricesReady: existingWithPricesReady,
            missingWithPricesReady: missingWithPricesReady
        };
    }

    function bytesToPngBlob(bytes) {
        return new Blob([bytes], { type: "image/png" });
    }

    function base64ToPngBlob(value) {
        const decoded = global.atob(String(value || "").replace(/\s+/g, ""));
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
            bytes[index] = decoded.charCodeAt(index);
        }
        return bytesToPngBlob(bytes);
    }

    function binaryStringToPngBlob(value) {
        const source = String(value || "");
        const bytes = new Uint8Array(source.length);
        for (let index = 0; index < source.length; index += 1) {
            bytes[index] = source.charCodeAt(index) & 255;
        }
        return bytesToPngBlob(bytes);
    }

    function responseToBlob(response, depth) {
        const level = Number(depth) || 0;
        if (level > 4) return Promise.reject(new Error("A saved presentation image could not be read."));
        if (response instanceof Blob) return Promise.resolve(response);
        if (response instanceof ArrayBuffer) return Promise.resolve(bytesToPngBlob(response));
        if (ArrayBuffer.isView(response)) {
            return Promise.resolve(bytesToPngBlob(response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength)));
        }
        if (typeof response === "string") {
            const value = response.trim();
            if (/^data:image\/png;base64,/i.test(value)) {
                return Promise.resolve(base64ToPngBlob(value.slice(value.indexOf(",") + 1)));
            }
            if (/^iVBORw0KGgo/i.test(value)) {
                return Promise.resolve(base64ToPngBlob(value));
            }
            return Promise.resolve(binaryStringToPngBlob(response));
        }
        if (response && typeof response === "object") {
            const possibleValues = [response.data, response.response, response.responseText, response.value, response.filecontent];
            for (const possible of possibleValues) {
                if (possible !== undefined && possible !== null && possible !== response) {
                    return responseToBlob(possible, level + 1);
                }
            }
        }
        return Promise.reject(new Error("A saved presentation image could not be read."));
    }

    async function readImage(recordId, fieldName) {
        const response = await ZOHO.CREATOR.FILE.readFile({
            app_name: CONFIG.appName,
            report_name: CONFIG.reportName,
            id: text(recordId),
            field_name: fieldName
        });
        return responseToBlob(response);
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onerror = function () { reject(new Error("A presentation image could not be encoded.")); };
            reader.onload = function () {
                const value = String(reader.result || "");
                resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
            };
            reader.readAsDataURL(blob);
        });
    }

    function findCreateResult(value, depth) {
        if (depth > 8 || value === null || value === undefined) return null;
        if (typeof value === "string") {
            try { return findCreateResult(JSON.parse(value), depth + 1); } catch (error) { return null; }
        }
        if (typeof value !== "object") return null;
        if (text(value.showUrl) || text(value.presentationId) || text(value.status).toLowerCase() === "error") return value;
        for (const child of Object.values(value)) {
            const found = findCreateResult(child, depth + 1);
            if (found) return found;
        }
        return null;
    }

    function wait(milliseconds) {
        return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
    }

    async function invokePresentationApi(request) {
        const response = typeof global.__PRESENTATION_CREATE_TEST_HANDLER__ === "function"
            ? await global.__PRESENTATION_CREATE_TEST_HANDLER__(request)
            : await ZOHO.CREATOR.DATA.invokeCustomApi({
                api_name: CONFIG.createApiName,
                http_method: "POST",
                content_type: "application/json",
                payload: { request_data: JSON.stringify(request) }
            });
        const result = findCreateResult(response, 0);
        if (!result) throw new Error("Zoho Show did not return a presentation result.");
        if (text(result.status).toLowerCase() === "error") {
            throw new Error(result.message || "Zoho Show could not create the presentation.");
        }
        return result;
    }

    async function createPresentation(options) {
        if (!sdkAvailable()) throw new Error("Zoho Creator is unavailable.");
        const customerName = text(options && options.customerName);
        const companyId = identity(options && options.companyId, customerName);
        const includePrices = Boolean(options && options.includePrices);
        const onProgress = options && typeof options.onProgress === "function" ? options.onProgress : function () {};
        const current = await status(companyId, customerName);
        if (!current.record) throw new Error("No saved presentation images were found for this customer.");
        if (!current.existingReady || !current.missingReady) {
            throw new Error("Existing and Missing presentation images must be saved for the same customer first.");
        }
        if (includePrices && !current.withPricesReady) {
            throw new Error("The with-prices presentation images are not ready. Open Existing and Missing once with the updated widgets, then try again.");
        }

        onProgress("Creating the customer copy in Zoho Show…");
        const duplicateResult = await invokePresentationApi({
            action: "duplicate",
            companyId: companyId,
            customerName: customerName,
            priceMode: includePrices ? "with" : "without"
        });
        if (text(duplicateResult.status).toLowerCase() === "success" && text(duplicateResult.showUrl)) {
            return duplicateResult;
        }
        const presentationId = text(duplicateResult.presentationId);
        if (!presentationId) throw new Error("Zoho Show created the copy but did not return its presentation ID.");

        onProgress("The copy is ready. Preparing the four saved images…");
        const recordId = text(current.record.ID);
        const populateRequest = {
            action: "populate",
            companyId: companyId,
            customerName: customerName,
            presentationId: presentationId,
            workspaceRecordId: recordId,
            priceMode: includePrices ? "with" : "without"
        };

        onProgress("Waiting for Zoho Show to prepare the copied slides…");
        await wait(8000);
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            onProgress("Checking the copied slides and inserting the images… (attempt " + attempt + " of 4)");
            const result = await invokePresentationApi(populateRequest);
            const resultStatus = text(result.status).toLowerCase();
            if (resultStatus === "success" && text(result.showUrl)) return result;
            if (resultStatus !== "pending") {
                throw new Error(result.message || "Zoho Show did not return the new presentation link.");
            }
            if (attempt < 4) {
                onProgress("Zoho Show is still preparing the copy. Waiting before the next check…");
                await wait(5000);
            }
        }
        throw new Error("Zoho Show created the customer copy, but its slides were not ready after about 23 seconds. Please try again later.");
    }

    global.MCGPresentationWorkspace = {
        config: CONFIG,
        identity: identity,
        getWorkspace: getWorkspace,
        ensureWorkspace: ensureWorkspace,
        saveSlides: saveSlides,
        queueSave: queueSave,
        status: status,
        errorMessage: errorMessage,
        createPresentation: createPresentation
    };
}(window));
