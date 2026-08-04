import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { writeFileSync } from "fs";

const doc = new jsPDF({ unit: "mm", format: "a4" });
const pageWidth = doc.internal.pageSize.getWidth();
const marginX = 14;
let cursorY = 18;

const brand = { r: 58, g: 160, b: 243 };
const dark = { r: 30, g: 30, b: 30 };
const gray = { r: 110, g: 110, b: 110 };

function addHeader(title, subtitle) {
    doc.setFillColor(brand.r, brand.g, brand.b);
    doc.rect(0, 0, pageWidth, 24, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(title, marginX, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(subtitle, marginX, 21);
    cursorY = 32;
}

function ensureSpace(needed) {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (cursorY + needed > pageHeight - 15) {
        doc.addPage();
        cursorY = 18;
    }
}

function sectionTitle(text) {
    ensureSpace(12);
    doc.setTextColor(brand.r, brand.g, brand.b);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(text, marginX, cursorY);
    doc.setDrawColor(brand.r, brand.g, brand.b);
    doc.setLineWidth(0.4);
    doc.line(marginX, cursorY + 1.5, pageWidth - marginX, cursorY + 1.5);
    cursorY += 7;
}

function kpiTable(rows) {
    autoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [["KPI", "Descrizione"]],
        body: rows,
        theme: "striped",
        headStyles: {
            fillColor: [dark.r, dark.g, dark.b],
            textColor: 255,
            fontStyle: "bold",
            fontSize: 9,
        },
        bodyStyles: { fontSize: 8.5, textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [245, 248, 252] },
        columnStyles: {
            0: { cellWidth: 55, fontStyle: "bold" },
            1: { cellWidth: pageWidth - marginX * 2 - 55 },
        },
        didDrawPage: () => {
            cursorY = 18;
        },
    });
    cursorY = doc.lastAutoTable.finalY + 10;
}

addHeader("QA Dashboard — Panoramica KPI", "Elenco degli indicatori chiave attualmente monitorati");

doc.setTextColor(gray.r, gray.g, gray.b);
doc.setFont("helvetica", "italic");
doc.setFontSize(9);
doc.text(`Generato il ${new Date().toLocaleDateString("it-IT")}`, marginX, cursorY);
cursorY += 8;

const sections = [
    {
        title: "Dashboard Principale",
        rows: [
            ["Test Case Totali", "Numero complessivo di test case tracciati"],
            ["Con / Senza Bug Aperti", "Test case collegati o meno a difetti attivi"],
            ["Bug Attivi / Chiusi", "Stato dei difetti collegati ai test case"],
            ["Superati / Falliti / Bloccati / N/A / Non Eseguiti", "Distribuzione degli esiti di esecuzione"],
            ["Percentuale di Successo", "Quota di test case con esito positivo"],
        ],
    },
    {
        title: "Panoramica Piano",
        rows: [
            ["Test Case Totali", "Totale test case nel piano selezionato"],
            ["Bug Totali", "Totale difetti collegati al piano"],
            ["Percentuale di Successo", "Esiti positivi sul totale eseguito"],
            ["Percentuale di Esecuzione", "Quota di test case effettivamente eseguiti"],
        ],
    },
    {
        title: "Report Avanzamento",
        rows: [
            ["Casi di Test / Eseguiti", "Avanzamento dell'esecuzione rispetto al piano"],
            ["Percentuale di Successo", "Esiti positivi sui casi eseguiti"],
        ],
    },
    {
        title: "Dashboard Automazione",
        rows: [
            ["Test Automatizzati / Manuali", "Ripartizione tra test automatizzati e manuali"],
            ["Copertura di Automazione %", "Quota di test coperti da automazione"],
            ["Test Instabili (Flaky)", "Test con esiti incoerenti tra esecuzioni"],
            ["Percentuale di Successo Automazione", "Esiti positivi delle suite automatizzate"],
            ["Pipeline: Successo / Fallimento", "Affidabilità delle pipeline CI/CD"],
            ["Durata Media Pipeline", "Tempo medio di esecuzione della pipeline"],
            ["Tempo di Esecuzione Test", "Durata complessiva dei test automatizzati"],
        ],
    },
    {
        title: "Esecuzione Test",
        rows: [
            ["Test Case Totali / Eseguiti", "Copertura di esecuzione dei test pianificati"],
            ["Superati / Falliti / Bloccati / N/A / Non Eseguiti", "Distribuzione degli esiti"],
            ["Andamento Percentuale di Successo", "Trend del pass rate nel tempo"],
            ["Copertura % (Requisiti / User Story / Feature)", "Copertura test rispetto agli item di riferimento"],
        ],
    },
    {
        title: "Gestione Difetti",
        rows: [
            ["Bug Aperti / Chiusi", "Stato corrente dei difetti"],
            ["Tempo Medio di Risoluzione (MTTR)", "Giorni medi per chiudere un difetto"],
            ["Bug Riaperti / Tasso di Riapertura", "Difetti riaperti dopo la chiusura"],
            ["Percentuale Bug Duplicati", "Quota di difetti segnalati come duplicati"],
            ["Bug per Story", "Densità di difetti per user story"],
            ["Difetti Senza Test Case / Senza Suite", "Gap di tracciabilità dei difetti"],
            ["Tasso di Fuga dei Difetti (Leakage)", "Difetti sfuggiti alle fasi di test"],
            ["Tasso di Rigetto dei Difetti", "Difetti respinti come non validi"],
            ["Tasso di Risoluzione al Primo Tentativo", "Difetti risolti senza riapertura"],
            ["Tasso Fuori Ambito", "Difetti fuori perimetro dello sprint"],
            ["Tasso di Regressione", "Difetti riemersi dopo una precedente risoluzione"],
            ["Andamento del Backlog", "Direzione del backlog: crescita, stabile, diminuzione"],
        ],
    },
    {
        title: "Report di Sprint / Scheda Stato",
        rows: [
            ["Bug Rilevati / Difetti Effettivi / Fuori Ambito", "Classificazione dei difetti dello sprint"],
            ["Casi di Test Totali", "Totale test case dello sprint corrente"],
            ["Pass Rate", "Percentuale di successo dei test dello sprint"],
            ["Bug Chiusi (%)", "Quota di difetti chiusi sul totale"],
            ["Bug Critici", "Numero di difetti di severità critica"],
        ],
    },
    {
        title: "Errori Comuni",
        rows: [
            ["Risultati Falliti Totali", "Totale esecuzioni con esito fallito"],
            ["Firme di Errore Univoche", "Numero di pattern di errore distinti"],
            ["Occorrenze dell'Errore Principale", "Frequenza dell'errore più comune"],
        ],
    },
    {
        title: "Prontezza al Rilascio",
        rows: [
            ["Tasso di Completamento Test", "Eseguiti rispetto ai pianificati nello sprint"],
            ["Test Case Riportati allo Sprint Successivo", "Carry-over di test non completati"],
            ["Non Ancora Eseguiti", "Test rimanenti da eseguire"],
            ["Tasso di Successo vs. Sprint Precedente", "Confronto del pass rate tra sprint"],
            ["Difetti Bloccanti (Critici/Alti)", "Difetti che possono bloccare il rilascio"],
            ["Criteri Release Gate", "Test Eseguiti, Test Superati, Copertura Requisiti, Defect per severità"],
        ],
    },
];

for (const section of sections) {
    sectionTitle(section.title);
    kpiTable(section.rows);
}

const pageCount = doc.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(gray.r, gray.g, gray.b);
    doc.text(
        `QA Dashboard - Panoramica KPI  |  Pagina ${i} di ${pageCount}`,
        marginX,
        doc.internal.pageSize.getHeight() - 8
    );
}

const outPath = new URL("../../kpi-overview.pdf", import.meta.url);
writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
console.log("PDF written to", outPath.pathname);
