(function (global) {
    "use strict";

    const STORAGE_KEY = "mcg_quote_workspaces_v2";
    const VERSION = 2;
    const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const MAX_SESSIONS = 25;

    function text(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    function customerKey(value) {
        return text(value).toLowerCase().replace(/\s+/g, " ");
    }

    function blankRoot() {
        return { version: VERSION, currentCustomer: "", sessions: {} };
    }

    function parse(value) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function isFresh(session) {
        if (!session || typeof session !== "object") return false;
        const updated = Date.parse(session.updatedAt);
        return Number.isFinite(updated) && Date.now() - updated <= MAX_AGE_MS;
    }

    function readRoot() {
        let root = blankRoot();
        try {
            const parsed = parse(global.localStorage.getItem(STORAGE_KEY));
            if (parsed && parsed.sessions && typeof parsed.sessions === "object") {
                root = parsed;
            }
        } catch (error) {
            return root;
        }

        const cleaned = {};
        Object.keys(root.sessions).forEach(function (key) {
            if (isFresh(root.sessions[key])) cleaned[key] = root.sessions[key];
        });
        root.version = VERSION;
        root.sessions = cleaned;
        if (!cleaned[root.currentCustomer]) root.currentCustomer = "";
        return root;
    }

    function writeRoot(root) {
        try {
            const sessions = Object.values(root.sessions || {}).sort(function (left, right) {
                return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
            }).slice(0, MAX_SESSIONS);
            const trimmed = {};
            sessions.forEach(function (session) {
                const key = customerKey(session.customerName);
                if (key) trimmed[key] = session;
            });
            root.version = VERSION;
            root.sessions = trimmed;
            if (!trimmed[root.currentCustomer]) root.currentCustomer = "";
            global.localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
            return true;
        } catch (error) {
            return false;
        }
    }

    function normaliseSession(session) {
        if (!session || !text(session.customerName)) return null;
        return Object.assign({
            version: VERSION,
            customerName: text(session.customerName),
            crmAccountId: "",
            proposals: [],
            existingPackage: null,
            selectedPhase: null,
            createdQuotes: {},
            updatedAt: new Date().toISOString()
        }, session, {
            version: VERSION,
            customerName: text(session.customerName),
            crmAccountId: text(session.crmAccountId),
            updatedAt: text(session.updatedAt) || new Date().toISOString()
        });
    }

    function get(customerName) {
        const root = readRoot();
        const key = customerKey(customerName);
        if (!key || !isFresh(root.sessions[key])) return null;
        return root.sessions[key];
    }

    function current() {
        const root = readRoot();
        return root.currentCustomer && isFresh(root.sessions[root.currentCustomer])
            ? root.sessions[root.currentCustomer]
            : null;
    }

    function save(customerName, changes) {
        const name = text(customerName || (changes && changes.customerName));
        const key = customerKey(name);
        if (!key) return null;
        const root = readRoot();
        const previous = root.sessions[key] || { customerName: name };
        const session = normaliseSession(Object.assign({}, previous, changes || {}, {
            customerName: name,
            updatedAt: new Date().toISOString()
        }));
        root.sessions[key] = session;
        root.currentCustomer = key;
        writeRoot(root);
        return session;
    }

    function replace(session) {
        const normalised = normaliseSession(session);
        if (!normalised) return null;
        return save(normalised.customerName, normalised);
    }

    function setCurrent(customerName) {
        const root = readRoot();
        const key = customerKey(customerName);
        if (!key || !root.sessions[key]) return false;
        root.currentCustomer = key;
        return writeRoot(root);
    }

    function remove(customerName) {
        const root = readRoot();
        const key = customerKey(customerName);
        if (!key) return false;
        delete root.sessions[key];
        if (root.currentCustomer === key) root.currentCustomer = "";
        return writeRoot(root);
    }

    function encode(payload) {
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        let binary = "";
        bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
        return global.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
    }

    function decode(value) {
        const encoded = text(value).replaceAll("-", "+").replaceAll("_", "/");
        if (!encoded) return null;
        try {
            const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
            const binary = global.atob(padded);
            const bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
            return parse(new TextDecoder().decode(bytes));
        } catch (error) {
            return null;
        }
    }

    function bytesToBase64Url(bytes) {
        let binary = "";
        bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
        return global.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
    }

    function base64UrlToBytes(value) {
        const encoded = text(value).replaceAll("-", "+").replaceAll("_", "/");
        const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
        const binary = global.atob(padded);
        return Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
    }

    async function encodeTransfer(payload) {
        const legacy = encode(payload);
        if (
            typeof global.CompressionStream !== "function" ||
            typeof global.Blob !== "function" ||
            typeof global.Response !== "function"
        ) return "j." + legacy;

        try {
            const source = new global.Blob([JSON.stringify(payload)]).stream();
            const compressedStream = source.pipeThrough(new global.CompressionStream("gzip"));
            const compressed = new Uint8Array(await new global.Response(compressedStream).arrayBuffer());
            const encoded = "g." + bytesToBase64Url(compressed);
            return encoded.length < legacy.length + 2 ? encoded : "j." + legacy;
        } catch (error) {
            return "j." + legacy;
        }
    }

    async function decodeTransfer(value) {
        const encoded = text(value);
        if (!encoded) return null;
        if (encoded.startsWith("j.")) return decode(encoded.slice(2));
        if (!encoded.startsWith("g.")) return decode(encoded);
        if (
            typeof global.DecompressionStream !== "function" ||
            typeof global.Blob !== "function" ||
            typeof global.Response !== "function"
        ) return null;

        try {
            const source = new global.Blob([base64UrlToBytes(encoded.slice(2))]).stream();
            const decompressedStream = source.pipeThrough(new global.DecompressionStream("gzip"));
            return parse(await new global.Response(decompressedStream).text());
        } catch (error) {
            return null;
        }
    }


    global.MCGQuoteWorkspace = {
        storageKey: STORAGE_KEY,
        maxAgeMs: MAX_AGE_MS,
        get: get,
        current: current,
        save: save,
        replace: replace,
        setCurrent: setCurrent,
        remove: remove,
        encode: encode,
        decode: decode,
        encodeTransfer: encodeTransfer,
        decodeTransfer: decodeTransfer,
        customerKey: customerKey
    };
}(window));
