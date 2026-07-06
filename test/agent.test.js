const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAgentReply } = require('../server');

test('buildAgentReply returns a refund-oriented reply from matching rows', () => {
  const rowsByTab = {
    'Subjects Fees': [
      ['Question', 'Answer', 'Refund'],
      ['refund fee', 'Refunds are reviewed within 7 days.', 'Eligible if requested within 3 days.']
    ],
    'Enrollments': [],
    'Policy': []
  };

  const reply = buildAgentReply('Can I refund my fee?', rowsByTab);
  assert.match(reply, /Refunds are reviewed/i);
});

test('buildAgentReply falls back to a helpful default when no data is available', () => {
  const reply = buildAgentReply('What are the fees?', { 'Subjects Fees': [], 'Enrollments': [], 'Policy': [] });
  assert.match(reply, /help with fee details/i);
});

test('buildAgentReply returns enrollment details for a student_id query', () => {
  const rowsByTab = {
    'Subjects Fees': [],
    'Enrollments': [
      ['student_id', 'name', 'subject', 'enrolled_date', 'fee_paid', 'status'],
      ['E005', 'Usman Tariq', 'English', '2026-07-01', '4,000', 'active']
    ],
    'Policy': []
  };

  const reply = buildAgentReply('What is the status of student E005?', rowsByTab);
  assert.match(reply, /currently active/i);
});

test('buildAgentReply records refund completion for a student refund command', () => {
  const rowsByTab = {
    'Subjects Fees': [],
    'Enrollments': [
      ['student_id', 'name', 'subject', 'enrolled_date', 'fee_paid', 'status'],
      ['E005', 'Usman Tariq', 'English', '2026-07-01', '4,000', 'active']
    ],
    'Policy': []
  };

  const reply = buildAgentReply('Mark refund completed for E005', rowsByTab);
  assert.match(reply, /Refund for student E005 is being recorded/i);
});

test('buildAgentReply returns subject fee details for a subject query', () => {
  const rowsByTab = {
    'Subjects_Fees': [
      ['subject', 'grade', 'syllabus', 'online_fee', 'physical_fee'],
      ['Physics', 'O Level', 'IGCSE', '6,000', '9,000']
    ],
    'Enrollments': [],
    'Policy': []
  };

  const reply = buildAgentReply('What is the fee for Physics?', rowsByTab);
  assert.match(reply, /Physics has an online fee of 6,000 and a physical fee of 9,000/i);
});

test('buildAgentReply returns subject details for a subject-only query', () => {
  const rowsByTab = {
    'Subjects_Fees': [
      ['subject', 'grade', 'syllabus', 'online_fee', 'physical_fee'],
      ['Physics', 'O Level', 'IGCSE', '6,000', '9,000']
    ],
    'Enrollments': [],
    'Policy': []
  };

  const reply = buildAgentReply('Physics', rowsByTab);
  assert.match(reply, /Physics has an online fee of 6,000 and a physical fee of 9,000/i);
});

test('buildAgentReply returns a helpful prompt when subject exists but no fee or detail data exists', () => {
  const rowsByTab = {
    'Subjects_Fees': [
      ['subject'],
      ['Biology']
    ],
    'Enrollments': [],
    'Policy': []
  };

  const reply = buildAgentReply('Biology', rowsByTab);
  assert.match(reply, /Biology is available\. Ask about fees, syllabus, or enrollment for more details\./i);
});
