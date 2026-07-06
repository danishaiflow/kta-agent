const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve a minimal admin UI for secure enrollments (do not expose ADMIN_API_KEY in public sites)
app.use('/admin/static', express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve the main widget at root if present (fixes "Cannot GET /" on hosts)
app.get('/', (_req, res) => {
  const widgetPath = path.join(__dirname, 'kta-chat-widget.html');
  if (fs.existsSync(widgetPath)) return res.sendFile(widgetPath);
  res.send('KTA agent running. Use POST /api/chat to query.');
});

// Simple in-memory rate limiter for admin actions (per IP)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // max requests per window per IP
const rateMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const state = rateMap.get(ip) || { count: 0, reset: now + RATE_LIMIT_WINDOW_MS };
  if (now > state.reset) {
    state.count = 0;
    state.reset = now + RATE_LIMIT_WINDOW_MS;
  }
  state.count += 1;
  rateMap.set(ip, state);
  return state.count <= RATE_LIMIT_MAX;
}

function appendAuditLog(entry) {
  try {
    const logPath = path.join(__dirname, 'admin_audit.log');
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n';
    fs.appendFileSync(logPath, line, { encoding: 'utf8' });
  } catch (err) {
    console.warn('Unable to write audit log:', err.message);
  }
}

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'A:Z';
const SHEET_TABS = process.env.GOOGLE_SHEET_TABS
  ? process.env.GOOGLE_SHEET_TABS.split(',').map((name) => name.trim()).filter(Boolean)
  : ['Subjects Fees', 'Enrollments', 'Policy'];
const REFUND_TAB = process.env.GOOGLE_SHEET_REFUND_TAB || 'Refunds';
const ENROLLMENTS_TAB = process.env.GOOGLE_SHEET_ENROLLMENTS_TAB || 'Enrollments';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || null;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'for', 'from', 'how', 'i',
  'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'please', 'the', 'to', 'what', 'when',
  'where', 'who', 'why', 'with', 'you', 'your', 'about', 'course', 'student', 'id',
  'help', 'need', 'want'
]);

function extractKeywords(message) {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function scoreRow(row, message) {
  const keywords = extractKeywords(message);
  if (!keywords.length || !Array.isArray(row)) return 0;
  const text = row.join(' ').toLowerCase();
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function findBestMatch(rows, message) {
  let bestRow = null;
  let bestScore = 0;

  rows.forEach((row) => {
    const score = scoreRow(row, message);
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  });

  return { row: bestRow, score: bestScore };
}

function getColumnValue(row, candidates, headerRow = []) {
  if (!Array.isArray(row)) return '';
  const lowerCandidates = candidates.map((value) => value.toLowerCase());
  const searchRow = headerRow.length ? headerRow : row;
  const headerIndex = searchRow.findIndex((cell) => {
    const text = String(cell || '').trim().toLowerCase();
    return lowerCandidates.includes(text);
  });

  if (headerIndex < 0) return '';
  if (headerRow.length) return String(row[headerIndex] || '').trim();
  return String(row[headerIndex + 1] || '').trim();
}

function extractStudentId(message) {
  const directMatch = message.match(/\b(E\d{3,})\b/i);
  if (directMatch) return directMatch[1].toUpperCase();
  const labelMatch = message.match(/student\s*id\s*[:\-\s]*([A-Za-z0-9_\-]+)/i);
  return labelMatch ? labelMatch[1].toUpperCase() : '';
}

function findAllRowsByHeaderValue(rows, headerNames, value) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headerRow = rows[0].map((cell) => String(cell || '').trim().toLowerCase());
  const fieldIndex = headerRow.findIndex((header) => headerNames.includes(header));
  if (fieldIndex < 0) return [];
  return rows.slice(1).filter((row) => String(row[fieldIndex] || '').trim().toUpperCase() === value.toUpperCase());
}

function extractSubjectFromMessage(message, enrollmentRows, enrollmentHeader) {
  if (!message || !Array.isArray(enrollmentRows) || !enrollmentHeader) return '';
  const lower = message.toLowerCase();
  for (const row of enrollmentRows) {
    const obj = rowsToObject(row, enrollmentHeader);
    if (obj.subject && lower.includes(String(obj.subject).toLowerCase())) return obj.subject;
  }
  return '';
}

function extractStudentName(message) {
  if (!message) return '';
  const nameMatch = message.match(/(?:my name is|i am)\s+([A-Za-z][A-Za-z']+(?:\s+[A-Za-z][A-Za-z']+)+)/i);
  if (nameMatch) return nameMatch[1].trim();
  return '';
}

function findAllRowsByName(rows, nameValue) {
  if (!Array.isArray(rows) || rows.length < 2 || !nameValue) return [];
  const headerRow = rows[0].map((cell) => String(cell || '').trim().toLowerCase());
  const fieldIndex = headerRow.findIndex((h) => ['name', 'student_name', 'full_name'].includes(h));
  if (fieldIndex < 0) return [];
  return rows.slice(1).filter((row) => String(row[fieldIndex] || '').trim().toLowerCase() === String(nameValue || '').trim().toLowerCase());
}

function getRefundInstructionReply(studentId) {
  return `You are eligible for a refund. Please write an application for fee refund to the management of KTA at email ID: ktapsw@gmail.com. Include your Student ID: ${studentId} if available. If your refund is approved but not paid within 7 days, contact +923339041689.`;
}

function isEmailFollowupWithDays(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  const sent = /sent|emailed|wrote.*email|i\s*wrote\s*an?\s*email|i\s*emailed/i.test(lower);
  const daysMatch = lower.match(/\b(\d{1,2})\s*days?\b/);
  if (sent && daysMatch) {
    const days = Number(daysMatch[1]);
    return Number.isFinite(days) ? days : null;
  }
  return null;
}

function findRowByHeaderValue(rows, headerNames, value) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const headerRow = rows[0].map((cell) => String(cell || '').trim().toLowerCase());
  const fieldIndex = headerRow.findIndex((header) => headerNames.includes(header));
  if (fieldIndex < 0) return null;
  return rows.slice(1).find((row) => String(row[fieldIndex] || '').trim().toUpperCase() === value.toUpperCase()) || null;
}

function rowsToObject(row, headerRow) {
  if (!Array.isArray(row) || !Array.isArray(headerRow)) return {};
  return headerRow.reduce((obj, header, idx) => {
    obj[String(header || '').trim().toLowerCase()] = String(row[idx] || '').trim();
    return obj;
  }, {});
}

function getSheetsClient() {
  if (!SHEET_ID) return null;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return auth.getClient().then((client) => google.sheets({ version: 'v4', auth: client }));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return auth.getClient().then((client) => google.sheets({ version: 'v4', auth: client }));
  }
  return null;
}

function isRefundRequest(message) {
  return /refund|refund me|refund request|refund policy|fee refund/i.test(message);
}

function isRefundConfirmed(message) {
  return /refunded|refund processed|refund completed|processed refund/i.test(message);
}

function formatSubjectFeeReply(row, headerRow) {
  const subjectName = getColumnValue(row, ['subject', 'name', 'course'], headerRow);
  const onlineFee = getColumnValue(row, ['online_fee', 'online fee', 'fee_paid', 'price', 'amount', 'fee', 'fees', 'tuition'], headerRow);
  const physicalFee = getColumnValue(row, ['physical_fee', 'physical fee'], headerRow);
  const feePaid = getColumnValue(row, ['fee_paid', 'paid', 'amount', 'fee', 'fees', 'tuition'], headerRow);

  if (onlineFee && physicalFee) {
    return `${subjectName ? subjectName + ' has' : 'This subject has'} an online fee of ${onlineFee} and a physical fee of ${physicalFee}.`;
  }
  if (onlineFee) {
    return `${subjectName ? subjectName + ' has' : 'This subject has'} an online fee of ${onlineFee}.`;
  }
  if (physicalFee) {
    return `${subjectName ? subjectName + ' has' : 'This subject has'} a physical fee of ${physicalFee}.`;
  }
  if (feePaid) {
    return `${subjectName ? subjectName + ' has' : 'This subject has'} a fee value of ${feePaid}.`;
  }
  return '';
}

function buildSubjectReply(message, rowsByTab) {
  const subjectTabs = ['Subjects_Fees', 'Subjects Fees'].filter((tab) => Array.isArray(rowsByTab[tab]) && rowsByTab[tab].length > 1);
  if (!subjectTabs.length) return '';

  const match = searchSheetRows(rowsByTab, message, subjectTabs);
  if (!match) return '';

  const { row, headerRow } = match;
  const lowerMessage = message.toLowerCase();
  if (/fee|fees|price|cost|amount|tuition/.test(lowerMessage)) {
    return formatSubjectFeeReply(row, headerRow);
  }

  if (/subject|syllabus|grade/.test(lowerMessage)) {
    const subjectName = getColumnValue(row, ['subject', 'name', 'course'], headerRow) || 'This subject';
    const syllabus = getColumnValue(row, ['syllabus'], headerRow);
    const grade = getColumnValue(row, ['grade', 'class'], headerRow);
    const details = [syllabus ? `syllabus: ${syllabus}` : '', grade ? `grade: ${grade}` : ''].filter(Boolean).join(', ');
    return details ? `${subjectName} details — ${details}.` : '';
  }

  const subjectName = getColumnValue(row, ['subject', 'name', 'course'], headerRow);
  const subjectFeeReply = formatSubjectFeeReply(row, headerRow);
  if (subjectName && subjectFeeReply) {
    return subjectFeeReply;
  }

  if (subjectName) {
    const syllabus = getColumnValue(row, ['syllabus'], headerRow);
    const grade = getColumnValue(row, ['grade', 'class'], headerRow);
    const details = [syllabus ? `syllabus: ${syllabus}` : '', grade ? `grade: ${grade}` : ''].filter(Boolean).join(', ');
    if (details) {
      return `${subjectName} details — ${details}.`;
    }
    return `${subjectName} is available. Ask about fees, syllabus, or enrollment for more details.`;
  }

  return `I found a subject row but could not parse the details clearly. Please ask about fees, syllabus, or registration.`;
}

function classifyQuery(message) {
  const lowerMessage = message.toLowerCase();
  if (/refund|return|reimburse|cancel|chargeback/.test(lowerMessage)) {
    return ['Subjects_Fees', 'Policy', 'Subjects Fees'];
  }
  if (/fee|fees|price|cost|amount|tuition/.test(lowerMessage)) {
    return ['Subjects_Fees', 'Policy', 'Subjects Fees'];
  }
  if (/enroll|admission|register|registration|intake|batch/.test(lowerMessage)) {
    return ['Enrollments'];
  }
  if (extractStudentId(message)) {
    return ['Enrollments'];
  }
  return SHEET_TABS;
}

function searchSheetRows(rowsByTab, message, tabs = []) {
  const candidateTabs = tabs.length ? tabs : Object.keys(rowsByTab);
  let bestMatch = { row: null, headerRow: [], tab: null, score: 0 };

  candidateTabs.forEach((tab) => {
    const rows = rowsByTab[tab] || [];
    const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
    const dataRows = headerRow.length ? rows.slice(1) : rows;
    const { row, score } = findBestMatch(dataRows, message);

    if (row && score > bestMatch.score) {
      bestMatch = { row, headerRow, tab, score };
    }
  });

  return bestMatch.row ? bestMatch : null;
}

function getTabTextFallback(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  if (rows.length === 1 && Array.isArray(rows[0]) && rows[0].length === 1) {
    return String(rows[0][0] || '').trim();
  }
  return '';
}

function chooseAgentReply(message, rowsByTab) {
  const fallbackReply =
    'I can help with fee details, admissions, subjects, or refund requests. Please share your course name, student ID, or the issue you need help with.';

  const allEmpty = Object.values(rowsByTab).every((rows) => !Array.isArray(rows) || rows.length === 0);
  if (allEmpty) return { reply: fallbackReply, sourceTab: 'fallback' };

  const preferredTabs = classifyQuery(message);
  let match = searchSheetRows(rowsByTab, message, preferredTabs);
  if (!match) {
    match = searchSheetRows(rowsByTab, message);
  }

  const policyFallback = getTabTextFallback(rowsByTab['Policy'] || []);
  const studentId = extractStudentId(message);
  const studentName = extractStudentName(message);

  // If the user requests a refund but provided neither ID nor name, ask for one
  if (isRefundRequest(message) && !studentId && !studentName) {
    // prefer an existing refund/policy answer from sheets when available
    if (match && match.tab && match.tab !== 'Enrollments') {
      const { row, headerRow, tab } = match;
      const refundNote = getColumnValue(row, ['refund', 'refund_policy', 'refund_eligible', 'eligible', 'status', 'policy'], headerRow);
      const answer = getColumnValue(row, ['response', 'answer', 'reply', 'message', 'detail', 'notes', 'description'], headerRow);
      const reply = answer || refundNote || policyFallback || fallbackReply;
      return { reply, sourceTab: tab || 'Subjects_Fees' };
    }
    return { reply: 'To check refund eligibility, please provide your student ID (e.g., E005) or your full name (e.g., Ayesha Malik).', sourceTab: 'Enrollments' };
  }

  if ((studentId || studentName) && Array.isArray(rowsByTab['Enrollments'])) {
    const enrollmentHeader = rowsByTab['Enrollments'][0];
    const enrollmentRows = studentId
      ? findAllRowsByHeaderValue(rowsByTab['Enrollments'], ['student_id', 'student id', 'id'], studentId)
      : findAllRowsByName(rowsByTab['Enrollments'], studentName);

    if (enrollmentRows && enrollmentRows.length) {
      const lowerMessage = message.toLowerCase();

      if (isRefundConfirmed(lowerMessage)) {
        const enrollmentData = rowsToObject(enrollmentRows[0], enrollmentHeader);
        return {
          reply: `Refund for student ${enrollmentData.student_id || studentId || ''} is being recorded. Please ensure the payment is completed and the student is notified.`,
          sourceTab: 'Enrollments',
          refundAction: 'processed',
          refundRecord: {
            studentId: enrollmentData.student_id || studentId || '',
            name: enrollmentData.name,
            subject: enrollmentData.subject,
            enrolledDate: enrollmentData.enrolled_date,
            feePaid: enrollmentData.fee_paid,
            status: 'refunded',
            note: 'Refund confirmed processed by staff.'
          }
        };
      }

      if (isRefundRequest(lowerMessage)) {
        const subjectFromMsg = extractSubjectFromMessage(message, enrollmentRows, enrollmentHeader);
        if (!subjectFromMsg && enrollmentRows.length > 1) {
          const subjects = enrollmentRows.map((r) => rowsToObject(r, enrollmentHeader).subject).filter(Boolean);
          const list = subjects.join(', ');
          return { reply: `Which subject is the refund for? You are enrolled in: ${list}. Please reply with the subject or say "Refund for [subject]".`, sourceTab: 'Enrollments' };
        }

        let targetRow = null;
        if (subjectFromMsg) {
          targetRow = enrollmentRows.find((r) => String(rowsToObject(r, enrollmentHeader).subject || '').toLowerCase() === subjectFromMsg.toLowerCase());
        }
        if (!targetRow && enrollmentRows.length === 1) targetRow = enrollmentRows[0];
        if (!targetRow) {
          return { reply: 'Unable to determine which enrollment the refund is for. Please specify the subject.', sourceTab: 'Enrollments' };
        }

        const enrollmentData = rowsToObject(targetRow, enrollmentHeader);
        const daysSince = Number(enrollmentData.days_since_enrollment);
        const enrolledDate = enrollmentData.enrolled_date ? new Date(enrollmentData.enrolled_date) : null;
        let eligible = false;
        if (!Number.isNaN(daysSince) && daysSince !== 0) {
          eligible = daysSince <= 7;
        } else if (enrolledDate instanceof Date && !Number.isNaN(enrolledDate.valueOf())) {
          const diffDays = Math.floor((Date.now() - enrolledDate.getTime()) / (1000 * 60 * 60 * 24));
          eligible = diffDays <= 7;
        }

        if (eligible) {
          return {
            reply: getRefundInstructionReply(enrollmentData.student_id || studentId || ''),
            sourceTab: 'Enrollments',
            refundAction: 'request',
            refundRecord: {
              studentId: enrollmentData.student_id || studentId || '',
              name: enrollmentData.name,
              subject: enrollmentData.subject,
              enrolledDate: enrollmentData.enrolled_date,
              feePaid: enrollmentData.fee_paid,
              status: 'requested',
              note: 'Refund eligibility confirmed and request instruction sent.'
            }
          };
        }

        return { reply: `Your enrollment for ${enrollmentData.subject} is beyond the 7-day refund period, so refund eligibility cannot be confirmed for that subject.`, sourceTab: 'Enrollments' };
      }

      

      const enrollmentData = rowsToObject(enrollmentRows[0], enrollmentHeader);
      if (/status|active|inactive|pending/.test(lowerMessage)) {
        return { reply: `Student ${enrollmentData.student_id || studentId || ''} is currently ${enrollmentData.status || 'unknown'}.`, sourceTab: 'Enrollments' };
      }
      if (/enroll|enrolled|date/.test(lowerMessage)) {
        return { reply: `Student ${enrollmentData.student_id || studentId || ''} enrolled in ${enrollmentData.subject || 'the course'} on ${enrollmentData.enrolled_date || 'unknown'}.`, sourceTab: 'Enrollments' };
      }
      return { reply: `Student ${enrollmentData.student_id || studentId || ''} is enrolled in ${enrollmentData.subject || 'the course'}, has paid ${enrollmentData.fee_paid || 'unknown'}, and is currently ${enrollmentData.status || 'unknown'}.`, sourceTab: 'Enrollments' };
    }
  }

  const subjectReply = buildSubjectReply(message, rowsByTab);
  if (subjectReply) {
    const subjectMatch = searchSheetRows(rowsByTab, message, ['Subjects_Fees', 'Subjects Fees']);
    return { reply: subjectReply, sourceTab: subjectMatch?.tab || 'Subjects_Fees' };
  }

  if (!match) {
    const lowerMessage = message.toLowerCase();
    if (/refund|return|reimburse|cancel|chargeback|policy/.test(lowerMessage) && policyFallback) {
      return { reply: policyFallback, sourceTab: 'Policy' };
    }
    return { reply: fallbackReply, sourceTab: 'fallback' };
  }

  const { row, headerRow, tab } = match;
  const answer = getColumnValue(row, ['response', 'answer', 'reply', 'message', 'detail', 'notes', 'description'], headerRow);
  const refundNote = getColumnValue(row, ['refund', 'refund_policy', 'refund_eligible', 'eligible', 'status', 'policy'], headerRow);
  const feeNote = getColumnValue(row, ['fee', 'fees', 'price', 'cost', 'amount', 'tuition'], headerRow);
  const policyNote = getColumnValue(row, ['policy', 'policy details', 'rules', 'terms', 'refund policy'], headerRow) || policyFallback;
  const sourceTab = tab || 'fallback';

  if (answer) return { reply: answer, sourceTab };

  const lowerMessage = message.toLowerCase();
  if (/refund|return|reimburse|cancel|chargeback/.test(lowerMessage)) {
    return { reply: refundNote || policyNote || feeNote || fallbackReply, sourceTab };
  }

  if (/fee|fees|price|cost|amount|tuition/.test(lowerMessage)) {
    return { reply: feeNote || answer || refundNote || policyNote || fallbackReply, sourceTab };
  }

  if (tab === 'Enrollments' || /enroll|admission|register|registration|intake/.test(lowerMessage)) {
    return { reply: answer || policyNote || feeNote || fallbackReply, sourceTab };
  }

  return { reply: answer || feeNote || refundNote || policyNote || fallbackReply, sourceTab };
}

function buildAgentReply(message, rowsByTab) {
  return chooseAgentReply(message, rowsByTab).reply;
}

async function appendEnrollmentEvent(record) {
  const sheets = await getSheetsClient();
  if (!sheets) return false;

  try {
    const row = [record.studentId || '', record.name || '', record.subject || '', record.enrolledDate || '', record.feePaid || '', record.status || '', record.days_since_enrollment || ''];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `'${ENROLLMENTS_TAB.replace(/'/g, "''")}'!A:G`,
      valueInputOption: 'RAW',
      resource: { values: [row] }
    });
    return true;
  } catch (error) {
    console.warn('Unable to append enrollment event:', error.message);
    return false;
  }
}

async function fetchSheetTabRows(tabName) {
  const nameEscaped = tabName.replace(/'/g, "''");
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${nameEscaped}'!${SHEET_RANGE}`
  });
  return response.data.values || [];
}

async function fetchSheetRows() {
  if (!SHEET_ID) return {};

  let auth;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
  } else {
    return {};
  }

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const rowsByTab = {};

  for (const tab of SHEET_TABS) {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${tab.replace(/'/g, "''")}'!${SHEET_RANGE}`
      });
      rowsByTab[tab] = response.data.values || [];
    } catch (error) {
      console.warn(`Unable to fetch sheet tab ${tab}:`, error.message);
      rowsByTab[tab] = [];
    }
  }

  return rowsByTab;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, sheetIdConfigured: Boolean(SHEET_ID) });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message = '', sessionId = 'default' } = req.body || {};
    if (!message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const rows = await fetchSheetRows();
    const agentResponse = chooseAgentReply(message, rows);

    // If agent intends to write to sheets, require a valid API key in 'x-api-key' header.
    const providedKey = (req.headers['x-api-key'] || '').toString();
    const canWrite = ADMIN_API_KEY && providedKey && providedKey === ADMIN_API_KEY;

    if ((agentResponse.refundAction && agentResponse.refundRecord) || (agentResponse.enrollmentAction && agentResponse.enrollmentRecord)) {
      if (!canWrite) {
        // Don't persist; instead inform caller that an admin key is required for write actions.
        agentResponse.reply += ' (Note: write actions require an admin API key; set `x-api-key` header to allow writing.)';
      } else {
        if (agentResponse.refundAction && agentResponse.refundRecord) await recordRefundEvent(agentResponse.refundRecord);
        if (agentResponse.enrollmentAction && agentResponse.enrollmentRecord) await appendEnrollmentEvent(agentResponse.enrollmentRecord);
      }
    }

    res.json({
      reply: agentResponse.reply,
      sessionId,
      source: SHEET_ID ? 'google-sheets' : 'fallback',
      sourceTab: agentResponse.sourceTab
    });
  } catch (error) {
    console.error('Agent error:', error);
    res.status(500).json({ error: 'Unable to process request', details: error.message });
  }
});

// Admin-protected enrollment endpoint (accepts JSON: { studentId, name, subject, enrolledDate, feePaid, status })
app.post('/api/enroll', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Rate limit exceeded' });

    const providedKey = (req.headers['x-api-key'] || '').toString();
    if (!ADMIN_API_KEY || providedKey !== ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Missing or invalid API key' });
    }
    const body = req.body || {};
    const record = {
      studentId: body.studentId || body.id || '',
      name: body.name || '',
      subject: body.subject || '',
      enrolledDate: body.enrolledDate || (new Date().toISOString().slice(0,10)),
      feePaid: body.feePaid || '',
      status: body.status || 'active',
      days_since_enrollment: body.days_since_enrollment || 0
    };

    const ok = await appendEnrollmentEvent(record);
    if (!ok) return res.status(500).json({ error: 'Unable to append enrollment' });
    // audit
    appendAuditLog({ action: 'enroll', by: ip, record });
    res.json({ ok: true, record });
  } catch (error) {
    console.error('Enroll error:', error);
    res.status(500).json({ error: 'Unable to enroll', details: error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`KTA agent listening on http://localhost:${PORT}`);
  });
}

module.exports = { buildAgentReply, chooseAgentReply, extractKeywords, findBestMatch };
