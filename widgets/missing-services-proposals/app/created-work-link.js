(function () {
    "use strict";
    const link = document.getElementById("createdWorkShortcut");
    if (!link) return;
    link.addEventListener("click", function (event) {
        if (link.getAttribute("href") === "#") event.preventDefault();
    });
    const base = "https://creatorapp.zoho.com/michaella2";
    if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.UTIL ||
        typeof ZOHO.CREATOR.UTIL.getInitParams !== "function") {
        link.title = "Created Work is available after opening this page in Creator.";
        return;
    }
    ZOHO.CREATOR.UTIL.getInitParams().then(function (params) {
        const fragment = params && /^\/environment\/(development|stage|staging)$/.test(params.envUrlFragment || "")
            ? params.envUrlFragment : "";
        link.href = base + fragment + "/recurring-invoice-report/page-embed/Created_Works";
        link.removeAttribute("aria-disabled");
    }).catch(function () {
        link.title = "Could not find the Created Work page in this Creator environment.";
    });
})();
