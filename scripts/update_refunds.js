#!/usr/bin/env node
// Usage:
//  node scripts/update_refunds.js --file "KTA Database.xlsx" --student E005 --subject Maths --status follow-up --note "11-day follow-up requested"

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : '';
      out[key] = val;
      if (val) i++;
    }
  }
  return out;
}

function ensureSheet(workbook, name) {
  if (!workbook.Sheets[name]) {
    const ws = XLSX.utils.aoa_to_sheet([['timestamp','studentId','name','subject','enrolledDate','feePaid','status','note']]);
    workbook.Sheets[name] = ws;
    if (!workbook.SheetNames.includes(name)) workbook.SheetNames.push(name);
  }
}

function appendRowToSheet(workbook, sheetName, rowArray) {
  ensureSheet(workbook, sheetName);
  const ws = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, {header:1});
  data.push(rowArray);
  const newWs = XLSX.utils.aoa_to_sheet(data);
  workbook.Sheets[sheetName] = newWs;
}

function main() {
  const args = parseArgs();
  const inputFile = args.file || args.f;
  const studentId = args.student || args.s;
  const subject = args.subject || args.sub;
  const status = args.status || 'requested';
  const note = args.note || '';
  const outputFile = args.out || `KTA Database.updated.xlsx`;

  if (!inputFile || !fs.existsSync(inputFile)) {
    console.error('Input file not found. Place the Excel file in the project root and pass --file "KTA Database.xlsx"');
    process.exit(2);
  }

  const workbook = XLSX.readFile(inputFile);

  // Try to read enrollments to fill name/enrolledDate/feePaid when possible
  const enrollSheetName = Object.keys(workbook.Sheets).find(n => n.toLowerCase().includes('enroll')) || 'Enrollments';
  const enrollData = workbook.Sheets[enrollSheetName] ? XLSX.utils.sheet_to_json(workbook.Sheets[enrollSheetName], {header:1}) : [];
  const header = Array.isArray(enrollData[0]) ? enrollData[0].map(h => String(h||'').toLowerCase()) : [];

  let name = '';
  let enrolledDate = '';
  let feePaid = '';

  if (studentId && enrollData.length>1) {
    for (let i=1;i<enrollData.length;i++){
      const row = enrollData[i];
      const idCell = row[ header.indexOf('student_id') !== -1 ? header.indexOf('student_id') : header.indexOf('student id') ];
      if (idCell && String(idCell).toUpperCase() === String(studentId).toUpperCase()) {
        // if subject provided, prefer row that matches subject
        const subj = row[ header.indexOf('subject') ];
        if (!subject || (subj && String(subj).toLowerCase() === String(subject).toLowerCase())) {
          name = row[ header.indexOf('name') ] || '';
          enrolledDate = row[ header.indexOf('enrolled_date') ] || '';
          feePaid = row[ header.indexOf('fee_paid') ] || '';
          break;
        }
      }
    }
  }

  // Append to Refunds
  const refundRow = [ new Date().toISOString(), studentId || '', name || '', subject || '', enrolledDate || '', feePaid || '', status || '', note || '' ];
  appendRowToSheet(workbook, 'Refunds', refundRow);

  XLSX.writeFile(workbook, outputFile);
  console.log('Wrote', outputFile);
}

main();
