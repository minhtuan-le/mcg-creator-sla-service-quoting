(function () {
    "use strict";

    const WIDTH = 1600;
    const HEIGHT = 900;
    const SCALE = 2;
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
    const RISK_COLORS = [COLORS.blue, COLORS.teal, COLORS.gold, COLORS.purple];

    function createCanvas() {
        const canvas = document.createElement("canvas");
        // Draw at SCALE x the layout size so text and lines stay sharp when
        // Zoho Show or a full-screen display enlarges the slide image.
        canvas.width = WIDTH * SCALE;
        canvas.height = HEIGHT * SCALE;
        const context = canvas.getContext("2d");
        context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
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
        const width = 364;
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

    function drawTable(context, columns, rows, x, y, rowHeight, options) {
        const settings = options || {};
        const width = columns.reduce(function (sum, column) { return sum + column.width; }, 0);
        const headerHeight = Number(settings.headerHeight || 50);
        const headerFontSize = Number(settings.headerFontSize || 13);
        const headerTextOffset = Number(settings.headerTextOffset || 31);
        const rowFontSize = Number(settings.rowFontSize || 14);
        const rowPaddingY = settings.rowPaddingY === undefined ? 14 : Number(settings.rowPaddingY);
        const rowLineHeight = Number(settings.rowLineHeight || 19);
        const forcedMaxLines = settings.maxLines === undefined ? null : Number(settings.maxLines);
        fillRounded(context, x, y, width, headerHeight, 8, COLORS.navy);
        let cursorX = x;
        columns.forEach(function (column) {
            context.fillStyle = COLORS.white;
            font(context, headerFontSize, 800);
            context.textAlign = column.align || "left";
            const labelX = column.align === "right" ? cursorX + column.width - 12 : column.align === "center" ? cursorX + column.width / 2 : cursorX + 12;
            context.fillText(column.label, labelX, y + headerTextOffset);
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
                font(context, column.fontSize || rowFontSize, column.bold ? 700 : 400);
                drawWrapped(
                    context,
                    row[column.key],
                    cellX + 12,
                    rowY + rowPaddingY,
                    column.width - 24,
                    rowLineHeight,
                    forcedMaxLines || column.maxLines || 2,
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
        const totalMissingControls = risks.reduce(function (sum, risk) { return sum + Number(risk.missing || 0); }, 0);
        context.lineWidth = 42;
        context.strokeStyle = "#edf2f5";
        context.beginPath();
        context.arc(centerX, centerY, 112, 0, Math.PI * 2);
        context.stroke();
        let start = -Math.PI / 2;
        risks.forEach(function (risk, index) {
            const fraction = totalMissingControls ? Number(risk.missing || 0) / totalMissingControls : 0;
            if (!fraction) return;
            const end = start + fraction * Math.PI * 2;
            context.strokeStyle = RISK_COLORS[index % RISK_COLORS.length];
            context.lineCap = "butt";
            context.beginPath();
            context.arc(centerX, centerY, 112, start, end);
            context.stroke();
            start = end;
        });
    }

    function renderExistingOverview(model, page, totalPages) {
        const created = createCanvas();
        const context = created.context;
        drawHeader(context, "Existing Services & Risk Analysis", "Current recurring services and subgroup-level security coverage.", model.customer, model.generated, page, totalPages);
        drawCards(context, [
            { label: "Current services", value: model.serviceCount, note: "Recurring services", color: COLORS.blue },
            { label: "Total licences", value: model.licenceCount, note: "Across current services", color: COLORS.teal },
            { label: "Monthly cost ex. GST", value: model.monthlyCost, note: "Normalised monthly value", color: COLORS.navy },
            { label: "Overall security risk", value: model.overallRisk, note: model.riskHeadline, color: COLORS.coral }
        ], 231);

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
            context.fillRect(445, itemY, 12, 42);
            context.fillStyle = COLORS.navy;
            font(context, 16, 800);
            drawWrapped(context, risk.name, 470, itemY, 225, 19, 2);
            context.fillStyle = COLORS.muted;
            font(context, 13, 600);
            context.fillText(risk.missing + " of " + risk.total + " missing", 470, itemY + 43);
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
            context.fillText(Math.round(risk.percentage) + "%", 1510, y);
            context.textAlign = "left";
            fillRounded(context, 800, y + 20, 710, 20, 10, "#eaf0f4");
            const barWidth = Math.max(0, Math.min(710, 710 * Number(risk.percentage || 0) / 100));
            if (barWidth) fillRounded(context, 800, y + 20, barWidth, 20, 10, RISK_COLORS[index % RISK_COLORS.length]);
            context.fillStyle = COLORS.muted;
            font(context, 12, 600);
            context.fillText(risk.missing + " missing · " + (risk.total - risk.missing) + " covered · " + risk.total + " controls", 800, y + 59);
        });
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderExistingTable(model, rows, page, totalPages) {
        const created = createCanvas();
        const context = created.context;
        drawHeader(context, "Existing Services", "Current services grouped for presentation use.", model.customer, model.generated, page, totalPages);
        context.fillStyle = COLORS.navy;
        font(context, 25, 800);
        context.fillText("Current recurring service groups", 60, 252);
        context.fillStyle = COLORS.muted;
        font(context, 14, 400);
        context.fillText("Each row combines active services within the same customer subgroup.", 60, 279);
        const columns = [
            { key: "category", label: "Category", width: 245, bold: true },
            { key: "subgroup", label: "Service type", width: 225, bold: true },
            { key: "services", label: "What you have", width: 455 },
            { key: "quantity", label: "Licences", width: 130, align: "center" },
            { key: "frequency", label: "Frequency", width: 175 },
            { key: "monthly", label: "Monthly ex. GST", width: 250, align: "right", bold: true }
        ];
        drawTable(context, columns, rows, 60, 305, 58);
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderExistingSlides(model) {
        const groups = Array.isArray(model.groups) ? model.groups : [];
        const chunks = [];
        for (let index = 0; index < groups.length; index += 8) chunks.push(groups.slice(index, index + 8));
        if (!chunks.length) chunks.push([{ category: "—", subgroup: "—", services: "No current services found", quantity: "—", frequency: "—", monthly: "—" }]);
        const totalPages = 1 + chunks.length;
        const slides = [renderExistingOverview(model, 1, totalPages)];
        chunks.forEach(function (chunk, index) {
            slides.push(renderExistingTable(model, chunk, index + 2, totalPages));
        });
        return slides;
    }

    function phaseColumns(includePrices) {
        return includePrices ? [
            { key: "service", label: "Service", width: 270, bold: true },
            { key: "recommendation", label: "Recommended solution", width: 800, maxLines: 2 },
            { key: "quantity", label: "Quantity", width: 160, align: "center" },
            { key: "unitPrice", label: "Unit price", width: 250, align: "right" }
        ] : [
            { key: "service", label: "Service", width: 330, bold: true },
            { key: "recommendation", label: "Recommended solution", width: 970, maxLines: 2 },
            { key: "quantity", label: "Quantity", width: 180, align: "center" }
        ];
    }

    function categoryColumns(includePrices) {
        return includePrices ? [
            { key: "service", label: "Missing service", width: 300, bold: true },
            { key: "recommendation", label: "Recommended solution", width: 820, maxLines: 2 },
            { key: "quantity", label: "Quantity", width: 150, align: "center" },
            { key: "unitPrice", label: "Unit price", width: 210, align: "right" }
        ] : [
            { key: "service", label: "Missing service", width: 340, bold: true },
            { key: "recommendation", label: "Recommended solution", width: 990, maxLines: 2 },
            { key: "quantity", label: "Quantity", width: 150, align: "center" }
        ];
    }

    function proposalPhaseLayout(rows, compact) {
        const phaseNumbers = Array.from(new Set(rows.map(function (row) { return Number(row.phaseNumber); })))
            .filter(Number.isFinite)
            .sort(function (a, b) { return a - b; });
        const layout = {
            compact: compact,
            phaseNumbers: phaseNumbers,
            phaseHeaderHeight: compact ? 26 : 32,
            phaseHeaderGap: compact ? 5 : 6,
            tableHeaderHeight: compact ? 32 : 50,
            blockGap: compact ? 6 : 10,
            minimumRowHeight: compact ? 20 : 22,
            maximumRowHeight: compact ? 36 : 58
        };
        layout.phaseOverhead = phaseNumbers.length *
            (layout.phaseHeaderHeight + layout.phaseHeaderGap + layout.tableHeaderHeight + layout.blockGap);
        return layout;
    }

    function rowHeightFor(layout, rowCount, availableHeight) {
        return Math.min(layout.maximumRowHeight, Math.floor((availableHeight - layout.phaseOverhead) / Math.max(1, rowCount)));
    }

    function renderProposalPhases(model, includePrices) {
        const created = createCanvas();
        const context = created.context;
        const allRows = Array.isArray(model.rows) ? model.rows.slice() : [];
        allRows.sort(function (a, b) { return Number(a.phaseNumber) - Number(b.phaseNumber); });
        drawHeader(context, "Proposed Project Plan", "Recommended services organised by implementation phase.", model.customer);

        const availableHeight = 610;
        const noteHeight = 24;
        // Full-size text needs a 50 px row (14 px font, two lines). Below that, or
        // with five or more phases, switch to the compact layout so text fits its
        // row instead of being clipped.
        let layout = proposalPhaseLayout(allRows, false);
        if (layout.phaseNumbers.length >= 5 || rowHeightFor(layout, allRows.length, availableHeight) < 50) {
            layout = proposalPhaseLayout(allRows, true);
        }

        // Everything stays on this one slide. If the rows cannot fit even at the
        // minimum compact row height, show as many as fit and note the rest.
        let rows = allRows;
        while (layout.compact && rows.length > 1 &&
            rowHeightFor(layout, rows.length, availableHeight - (rows.length < allRows.length ? noteHeight : 0)) < layout.minimumRowHeight) {
            rows = rows.slice(0, -1);
            layout = proposalPhaseLayout(rows, true);
        }
        const hiddenCount = allRows.length - rows.length;
        const usableHeight = availableHeight - (hiddenCount ? noteHeight : 0);
        const rowHeight = Math.max(layout.minimumRowHeight, rowHeightFor(layout, rows.length, usableHeight));
        const compactMaxLines = rowHeight >= 34 ? 2 : 1;
        const compactPaddingY = compactMaxLines === 2 ? 4 : Math.max(3, Math.floor((rowHeight - 13) / 2));
        let y = 232;

        layout.phaseNumbers.forEach(function (phaseNumber) {
            const phaseRows = rows.filter(function (row) { return Number(row.phaseNumber) === phaseNumber; });
            fillRounded(context, 60, y, 1480, layout.phaseHeaderHeight, 8, "#cfe7f4", "#bad6e4");
            context.fillStyle = COLORS.navy;
            font(context, layout.compact ? 13 : 15, 800);
            context.fillText("Phase " + phaseNumber, 72, y + (layout.compact ? 18 : 22));
            y += layout.phaseHeaderHeight + layout.phaseHeaderGap;
            y = drawTable(context, phaseColumns(includePrices), phaseRows, 60, y, rowHeight, layout.compact ? {
                headerHeight: layout.tableHeaderHeight,
                headerFontSize: 11,
                headerTextOffset: 21,
                rowFontSize: 11,
                rowPaddingY: compactPaddingY,
                rowLineHeight: 14,
                maxLines: compactMaxLines
            } : null) + layout.blockGap;
        });

        if (hiddenCount) {
            const hiddenPhases = Array.from(new Set(allRows.slice(rows.length).map(function (row) { return Number(row.phaseNumber); })))
                .filter(Number.isFinite);
            context.fillStyle = COLORS.muted;
            font(context, 13, 700);
            context.fillText(
                "+ " + hiddenCount + " more " + (hiddenCount === 1 ? "service" : "services") +
                (hiddenPhases.length ? " in Phase " + hiddenPhases.join(", ") : "") + " (see quote)",
                72,
                y + 12
            );
        }

        if (!layout.phaseNumbers.length) {
            context.fillStyle = COLORS.muted;
            font(context, 20, 700);
            context.fillText("No proposal phases selected.", 60, 275);
        }
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderServicesByCategory(model, includePrices) {
        const created = createCanvas();
        const context = created.context;
        const rows = Array.isArray(model.missingRows) ? model.missingRows : (Array.isArray(model.rows) ? model.rows : []);
        drawHeader(context, "Summary of Missing Services", "Services not covered by the customer’s current environment.", model.customer);
        context.fillStyle = COLORS.navy;
        font(context, 25, 800);
        context.fillText("Services recommended for this customer", 60, 252);
        context.fillStyle = COLORS.muted;
        font(context, 14, 400);
        context.fillText("Each row identifies a missing service and the recommended solution.", 60, 279);
        const rowHeight = Math.max(30, Math.min(70, Math.floor(480 / Math.max(1, rows.length))));
        drawTable(context, categoryColumns(includePrices), rows, 60, 305, rowHeight);
        if (!rows.length) {
            context.fillStyle = COLORS.muted;
            font(context, 18, 600);
            context.fillText("No services from the approved checklist are missing.", 60, 405);
        }
        drawFooter(context, model.customer);
        return created.canvas;
    }

    function renderMissingSlides(model, options) {
        const includePrices = Boolean(options && options.includePrices);
        return [renderProposalPhases(model, includePrices), renderServicesByCategory(model, includePrices)];
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
