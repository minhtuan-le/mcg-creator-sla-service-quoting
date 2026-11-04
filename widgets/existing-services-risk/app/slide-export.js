(function () {
    "use strict";

    const WIDTH = 1600;
    const HEIGHT = 900;
    const COLORS = {
        navy: "#103b52",
        blue: "#2f80ed",
        teal: "#14a39a",
        gold: "#f2a93b",
        purple: "#8b5cf6",
        coral: "#df5a5a",
        ink: "#203443",
        muted: "#667985",
        line: "#dbe5eb",
        pale: "#f3f7fa",
        white: "#ffffff"
    };
    const RISK_COLORS = ["#d74747", "#ee8b2d", "#d7ad21", "#2da56e"];

    function createCanvas() {
        const canvas = document.createElement("canvas");
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.fillStyle = COLORS.pale;
        context.fillRect(0, 0, WIDTH, HEIGHT);
        return { canvas: canvas, context: context };
    }

    function roundedRect(context, x, y, width, height, radius) {
        const safeRadius = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + safeRadius, y);
        context.arcTo(x + width, y, x + width, y + height, safeRadius);
        context.arcTo(x + width, y + height, x, y + height, safeRadius);
        context.arcTo(x, y + height, x, y, safeRadius);
        context.arcTo(x, y, x + width, y, safeRadius);
        context.closePath();
    }

    function fillRounded(context, x, y, width, height, radius, fill, stroke) {
        roundedRect(context, x, y, width, height, radius);
        context.fillStyle = fill;
        context.fill();
        if (stroke) {
            context.strokeStyle = stroke;
            context.lineWidth = 1;
            context.stroke();
        }
    }

    function font(context, size, weight) {
        context.font = (weight || 400) + " " + size + "px Arial, sans-serif";
    }

    function text(value) {
        return value === null || value === undefined || value === "" ? "—" : String(value);
    }

    function fitLine(context, value, maxWidth) {
        const original = text(value);
        if (context.measureText(original).width <= maxWidth) return original;
        let shortened = original;
        while (shortened.length > 1 && context.measureText(shortened + "…").width > maxWidth) {
            shortened = shortened.slice(0, -1);
        }
        return shortened + "…";
    }

    function wrapLines(context, value, maxWidth, maxLines) {
        const words = text(value).split(/\s+/).filter(Boolean);
        if (!words.length) return ["—"];
        const lines = [];
        let current = "";
        words.forEach(function (word) {
            const candidate = current ? current + " " + word : word;
            if (context.measureText(candidate).width <= maxWidth || !current) {
                current = candidate;
            } else {
                lines.push(fitLine(context, current, maxWidth));
                current = word;
            }
        });
        if (current) lines.push(fitLine(context, current, maxWidth));
        if (lines.length > maxLines) {
            lines.length = maxLines;
            lines[maxLines - 1] = fitLine(context, lines[maxLines - 1] + "…", maxWidth);
        }
        return lines;
    }

    function drawWrapped(context, value, x, y, maxWidth, lineHeight, maxLines, options) {
        const settings = options || {};
        const lines = wrapLines(context, value, maxWidth, maxLines || 2);
        context.fillStyle = settings.color || COLORS.ink;
        context.textAlign = settings.align || "left";
        context.textBaseline = "top";
        const anchor = settings.align === "right" ? x + maxWidth : settings.align === "center" ? x + maxWidth / 2 : x;
        lines.forEach(function (line, index) {
            context.fillText(line, anchor, y + index * lineHeight);
        });
        context.textAlign = "left";
        return lines.length;
    }

    function drawHeader(context, title, subtitle, customer) {
        const gradient = context.createLinearGradient(0, 0, WIDTH, 0);
        gradient.addColorStop(0, "#0e354a");
        gradient.addColorStop(0.68, "#13536d");
        gradient.addColorStop(1, "#277e96");
        context.fillStyle = gradient;
        context.fillRect(0, 0, WIDTH, 132);

        context.fillStyle = COLORS.white;
        font(context, 39, 900);
        context.fillText("MCG", 58, 53);
        context.fillStyle = "#b9d9e6";
        font(context, 13, 700);
        context.fillText("COMPUTER AUSTRALIA", 59, 78);

        context.fillStyle = COLORS.white;
        font(context, 34, 800);
        context.fillText(title, 275, 55);
        context.fillStyle = "#d8e8ef";
        font(context, 17, 400);
        context.fillText(subtitle, 276, 84);

        fillRounded(context, 48, 151, 1504, 62, 10, COLORS.white, COLORS.line);
        context.fillStyle = COLORS.teal;
        context.fillRect(48, 151, 6, 62);
        context.fillStyle = COLORS.muted;
        font(context, 12, 800);
        context.fillText("PREPARED FOR", 73, 174);
        context.fillStyle = COLORS.navy;
        font(context, 21, 800);
        context.fillText(fitLine(context, customer, 950), 73, 199);
        context.textAlign = "left";
    }

    function drawFooter(context, customer) {
        context.strokeStyle = COLORS.line;
        context.beginPath();
        context.moveTo(48, 862);
        context.lineTo(1552, 862);
        context.stroke();
        context.fillStyle = COLORS.muted;
        font(context, 12, 600);
        context.fillText("MCG Computer Australia", 50, 884);
        context.textAlign = "right";
        context.fillText(fitLine(context, customer, 650), 1550, 884);
        context.textAlign = "left";
    }

    function drawCards(context, cards, y) {
        const x = 48;
        const gap = 16;
        const width = (1504 - gap * Math.max(0, cards.length - 1)) / Math.max(1, cards.length);
        const height = 112;
        cards.forEach(function (card, index) {
            const cardX = x + index * (width + gap);
            fillRounded(context, cardX, y, width, height, 12, COLORS.white, COLORS.line);
            context.fillStyle = card.color;
            context.fillRect(cardX, y, width, 6);
            context.fillStyle = COLORS.muted;
            font(context, 13, 800);
            context.fillText(String(card.label).toUpperCase(), cardX + 20, y + 30);
            context.fillStyle = COLORS.navy;
            font(context, 29, 800);
            context.fillText(fitLine(context, card.value, width - 40), cardX + 20, y + 69);
            if (card.note) {
                context.fillStyle = COLORS.muted;
                font(context, 12, 400);
                context.fillText(fitLine(context, card.note, width - 40), cardX + 20, y + 94);
            }
        });
    }

    function drawPanel(context, x, y, width, height, title, number) {
        fillRounded(context, x, y, width, height, 12, COLORS.white, COLORS.line);
        fillRounded(context, x + 18, y + 16, 38, 38, 8, "#e5f1f6");
        context.fillStyle = COLORS.blue;
        font(context, 13, 900);
        context.textAlign = "center";
        context.fillText(number, x + 37, y + 41);
        context.textAlign = "left";
        context.fillStyle = COLORS.navy;
        font(context, 22, 800);
        context.fillText(title, x + 70, y + 43);
        context.strokeStyle = COLORS.line;
        context.beginPath();
        context.moveTo(x, y + 70);
        context.lineTo(x + width, y + 70);
        context.stroke();
    }

    function drawTable(context, columns, rows, x, y, rowHeight) {
        const width = columns.reduce(function (sum, column) { return sum + column.width; }, 0);
        const headerHeight = 50;
        fillRounded(context, x, y, width, headerHeight, 8, COLORS.navy);
        let cursorX = x;
        columns.forEach(function (column) {
            context.fillStyle = COLORS.white;
            font(context, 13, 800);
            context.textAlign = column.align || "left";
            const labelX = column.align === "right" ? cursorX + column.width - 12 : column.align === "center" ? cursorX + column.width / 2 : cursorX + 12;
            context.fillText(column.label, labelX, y + 31);
            context.textAlign = "left";
            cursorX += column.width;
        });

        rows.forEach(function (row, rowIndex) {
            const rowY = y + headerHeight + rowIndex * rowHeight;
            context.fillStyle = rowIndex % 2 ? "#f7fafc" : COLORS.white;
            context.fillRect(x, rowY, width, rowHeight);
            context.strokeStyle = COLORS.line;
            context.strokeRect(x, rowY, width, rowHeight);
            let cellX = x;
            columns.forEach(function (column) {
                context.save();
                context.beginPath();
                context.rect(cellX + 1, rowY + 1, column.width - 2, rowHeight - 2);
                context.clip();
                context.fillStyle = COLORS.ink;
                font(context, column.fontSize || 14, column.bold ? 700 : 400);
                drawWrapped(
                    context,
                    row[column.key],
                    cellX + 12,
                    rowY + 14,
                    column.width - 24,
                    19,
                    column.maxLines || 2,
                    { align: column.align || "left", color: column.color || COLORS.ink }
                );
                context.restore();
                context.strokeStyle = COLORS.line;
                context.beginPath();
                context.moveTo(cellX + column.width, rowY);
                context.lineTo(cellX + column.width, rowY + rowHeight);
                context.stroke();
                cellX += column.width;
            });
        });
        return y + headerHeight + rows.length * rowHeight;
    }

    function drawDonut(context, risks, centerX, centerY) {
        const totalControls = risks.reduce(function (sum, risk) { return sum + Number(risk.total || 0); }, 0);
        const categoryGap = 5 * Math.PI / 180;
        const controlGap = 1.3 * Math.PI / 180;
        const internalGapCount = Math.max(0, totalControls - risks.length);
        const segmentAngle = totalControls ?
            (Math.PI * 2 - categoryGap * risks.length - controlGap * internalGapCount) / totalControls : 0;
        context.lineWidth = 42;
        context.lineCap = "butt";
        let start = -Math.PI / 2 + categoryGap / 2;
        risks.forEach(function (risk, index) {
            const total = Number(risk.total || 0);
            const covered = Number(risk.covered != null ? risk.covered : total - Number(risk.missing || 0));
            const categoryStart = start;
            context.lineWidth = 42;
            context.lineCap = "butt";
            for (let controlIndex = 0; controlIndex < total; controlIndex += 1) {
                context.globalAlpha = controlIndex < covered ? 1 : 0.18;
                context.strokeStyle = RISK_COLORS[index % RISK_COLORS.length];
                context.beginPath();
                context.arc(centerX, centerY, 112, start, start + segmentAngle);
                context.stroke();
                start += segmentAngle;
                start += controlIndex < total - 1 ? controlGap : categoryGap;
            }

            const categoryEnd = start - categoryGap;
            const labelAngle = categoryStart + (categoryEnd - categoryStart) / 2;
            const lineStartX = centerX + Math.cos(labelAngle) * 135;
            const lineStartY = centerY + Math.sin(labelAngle) * 135;
            const lineBendX = centerX + Math.cos(labelAngle) * 151;
            const lineBendY = centerY + Math.sin(labelAngle) * 151;
            const onRight = Math.cos(labelAngle) >= 0;
            const lineEndX = onRight ? centerX + 124 : centerX - 124;
            const textX = onRight ? lineEndX + 5 : lineEndX - 5;
            const color = RISK_COLORS[index % RISK_COLORS.length];

            context.globalAlpha = 1;
            context.strokeStyle = color;
            context.fillStyle = color;
            context.lineWidth = 1.5;
            context.beginPath();
            context.moveTo(lineStartX, lineStartY);
            context.lineTo(lineBendX, lineBendY);
            context.lineTo(lineEndX, lineBendY);
            context.stroke();
            context.beginPath();
            context.arc(lineStartX, lineStartY, 2, 0, Math.PI * 2);
            context.fill();

            context.fillStyle = color;
            font(context, 12, 800);
            context.textAlign = onRight ? "left" : "right";
            context.textBaseline = "middle";
            const calloutLines = wrapLines(
                context,
                risk.name + " " + Math.round(risk.percentage) + "%",
                onRight ? 110 : 88,
                3
            );
            const calloutY = lineBendY - (calloutLines.length - 1) * 7;
            calloutLines.forEach(function (line, lineIndex) {
                context.fillText(line, textX, calloutY + lineIndex * 14);
            });
            context.textAlign = "left";
            context.textBaseline = "alphabetic";
        });
        context.globalAlpha = 1;
    }

    function renderExistingOverview(model, includePrices) {
        const created = createCanvas();
        const context = created.context;
        drawHeader(context, "Existing Services & Risk Analysis", "Current recurring services and subgroup-level security coverage.", model.customer);
        const summaryCards = [
            { label: "Current services", value: model.serviceCount, note: "Recurring services", color: COLORS.blue },
            { label: "Total licences", value: model.licenceCount, note: "Across current services", color: COLORS.teal },
            { label: "Overall security risk", value: model.overallRisk, note: model.riskHeadline, color: COLORS.coral }
        ];
        if (includePrices) summaryCards.splice(2, 0, { label: "Monthly cost ex. GST", value: model.monthlyCost, note: "Normalised monthly value", color: COLORS.navy });
        drawCards(context, summaryCards, 231);

        drawPanel(context, 48, 365, 690, 475, "Security risk overview", "01");
        drawDonut(context, model.risks, 270, 595);
        context.fillStyle = COLORS.navy;
        font(context, 38, 900);
        context.textAlign = "center";
        context.fillText(model.overallRisk, 270, 590);
        context.fillStyle = COLORS.muted;
        font(context, 14, 700);
        context.fillText("SECURITY RISK", 270, 617);
        context.textAlign = "left";

        model.risks.forEach(function (risk, index) {
            const itemY = 485 + index * 70;
            context.fillStyle = RISK_COLORS[index % RISK_COLORS.length];
            context.fillRect(510, itemY, 12, 42);
            context.fillStyle = COLORS.navy;
            font(context, 15, 800);
            drawWrapped(context, risk.name, 535, itemY, 175, 18, 2);
            context.fillStyle = COLORS.muted;
            font(context, 11, 600);
            context.fillText(
                fitLine(
                    context,
                    (risk.covered != null ? risk.covered : risk.total - risk.missing) + "/" +
                        risk.total + " covered · " + Math.round(risk.percentage) + "% unprotected",
                    175
                ),
                535,
                itemY + 43
            );
        });

        drawPanel(context, 760, 365, 792, 475, "Risk by category", "02");
        model.risks.forEach(function (risk, index) {
            const y = 468 + index * 84;
            context.fillStyle = COLORS.navy;
            font(context, 17, 700);
            context.fillText(risk.name, 800, y);
            context.textAlign = "right";
            context.fillStyle = RISK_COLORS[index % RISK_COLORS.length];
            font(context, 19, 900);
            context.fillText(Math.round(risk.percentage) + "% unprotected", 1510, y);
            context.textAlign = "left";
            fillRounded(context, 800, y + 20, 710, 20, 10, "#eaf0f4");
            const covered = Number(risk.covered != null ? risk.covered : risk.total - risk.missing);
            const coveragePercentage = risk.total ? covered / Number(risk.total) * 100 : 0;
            const barWidth = Math.max(0, Math.min(710, 710 * coveragePercentage / 100));
            if (barWidth) fillRounded(context, 800, y + 20, barWidth, 20, 10, RISK_COLORS[index % RISK_COLORS.length]);
            context.fillStyle = COLORS.muted;
            font(context, 12, 600);
            context.fillText(covered + " covered · " + risk.missing + " missing · " + risk.total + " controls", 800, y + 59);
        });
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderExistingTable(model, rows, includePrices) {
        const created = createCanvas();
        const context = created.context;
        drawHeader(context, "Existing Services", "Current services grouped for presentation use.", model.customer);
        context.fillStyle = COLORS.navy;
        font(context, 25, 800);
        context.fillText("Checked existing services", 60, 252);
        context.fillStyle = COLORS.muted;
        font(context, 14, 400);
        context.fillText("Only services retained in the proposed package are shown.", 60, 279);
        const columns = includePrices ? [
            { key: "category", label: "Category", width: 245, bold: true },
            { key: "subgroup", label: "Service type", width: 225, bold: true },
            { key: "services", label: "What you have", width: 455 },
            { key: "quantity", label: "Licences", width: 130, align: "center" },
            { key: "frequency", label: "Frequency", width: 175 },
            { key: "monthly", label: "Monthly ex. GST", width: 250, align: "right", bold: true }
        ] : [
            { key: "category", label: "Category", width: 280, bold: true },
            { key: "subgroup", label: "Service type", width: 260, bold: true },
            { key: "services", label: "What you have", width: 620 },
            { key: "quantity", label: "Licences", width: 140, align: "center" },
            { key: "frequency", label: "Frequency", width: 180 }
        ];
        const availableHeight = 520;
        const rowHeight = Math.max(26, Math.min(58, Math.floor(availableHeight / Math.max(1, rows.length))));
        drawTable(context, columns, rows, 60, 305, rowHeight);
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderExistingSlides(model, options) {
        const includePrices = Boolean(options && options.includePrices);
        const groups = Array.isArray(model.groups) ? model.groups : [];
        const rows = groups.length ? groups : [{ category: "—", subgroup: "—", services: "No checked services", quantity: "—", frequency: "—", monthly: "—" }];
        return [renderExistingTable(model, rows, includePrices), renderExistingOverview(model, includePrices)];
    }

    function missingColumns() {
        return [
            { key: "phase", label: "Phase", width: 90, align: "center", bold: true },
            { key: "group", label: "Category", width: 200, bold: true },
            { key: "service", label: "Missing service", width: 240, bold: true },
            { key: "recommendation", label: "Recommended solution", width: 540 },
            { key: "quantity", label: "Qty", width: 100, align: "center" },
            { key: "monthly", label: "Monthly", width: 155, align: "right", bold: true },
            { key: "setup", label: "Setup", width: 155, align: "right", bold: true }
        ];
    }

    function renderMissingFirst(model, rows, page, totalPages) {
        const created = createCanvas();
        const context = created.context;
        drawHeader(context, "Missing Services & Proposals", "Selected services organised for customer presentation.", model.customer, model.generated, page, totalPages);
        drawCards(context, [
            { label: "Selected services", value: model.selectedCount, note: "Entered in SLA tracking", color: COLORS.coral },
            { label: "Phases", value: model.phases, note: "Implementation sequence", color: COLORS.teal },
            { label: "Monthly quote", value: model.monthlyTotal, note: "Normalised monthly value", color: COLORS.blue },
            { label: "Setup total", value: model.setupTotal, note: "Once-off setup", color: COLORS.gold }
        ], 231);
        context.fillStyle = COLORS.navy;
        font(context, 25, 800);
        context.fillText("Selected proposal services", 60, 389);
        context.fillStyle = COLORS.muted;
        font(context, 14, 400);
        context.fillText("Missing coverage selected for the customer, including phase and pricing.", 60, 416);
        const tableEnd = drawTable(context, missingColumns(), rows, 60, 442, 58);
        fillRounded(context, 60, tableEnd + 14, 1480, 58, 8, "#e9f4f6", "#cce0e6");
        context.fillStyle = COLORS.navy;
        font(context, 16, 800);
        context.fillText("Proposal total", 82, tableEnd + 49);
        context.textAlign = "right";
        context.fillText("Monthly " + model.monthlyTotal + "     Setup " + model.setupTotal, 1518, tableEnd + 49);
        context.textAlign = "left";
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderMissingTable(model, rows, page, totalPages) {
        const created = createCanvas();
        const context = created.context;
        drawHeader(context, "Missing Services & Proposals", "Proposal service details continued.", model.customer, model.generated, page, totalPages);
        context.fillStyle = COLORS.navy;
        font(context, 25, 800);
        context.fillText("Proposal details", 60, 252);
        context.fillStyle = COLORS.muted;
        font(context, 14, 400);
        context.fillText("Additional selected services, phases and customer pricing.", 60, 279);
        drawTable(context, missingColumns(), rows, 60, 305, 58);
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderMissingSlides(model) {
        const rows = Array.isArray(model.rows) ? model.rows : [];
        const firstRows = rows.slice(0, 5);
        const remaining = rows.slice(5);
        const chunks = [];
        for (let index = 0; index < remaining.length; index += 8) chunks.push(remaining.slice(index, index + 8));
        const totalPages = 1 + chunks.length;
        const slides = [renderMissingFirst(model, firstRows, 1, totalPages)];
        chunks.forEach(function (chunk, index) {
            slides.push(renderMissingTable(model, chunk, index + 2, totalPages));
        });
        return slides;
    }

    function safeName(value) {
        return String(value || "report")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "report";
    }

    function canvasBlob(canvas) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error("The slide image could not be created."));
            }, "image/png");
        });
    }

    async function copyCanvas(canvas) {
        if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
            throw new Error("Image clipboard access is unavailable.");
        }
        const blob = await canvasBlob(canvas);
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
    }

    function downloadCanvas(canvas, filename) {
        const link = document.createElement("a");
        link.download = safeName(filename) + ".png";
        link.href = canvas.toDataURL("image/png");
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    window.MCGSlideExport = {
        renderExistingSlides: renderExistingSlides,
        renderMissingSlides: renderMissingSlides,
        copyCanvas: copyCanvas,
        downloadCanvas: downloadCanvas
    };
}());
