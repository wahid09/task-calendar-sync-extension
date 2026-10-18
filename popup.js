const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'savedSpreadsheets';
const SETTINGS = {
  taskHeader: 'Task Name',
  dateHeader: 'Planned Date',
  startTimeHeader: 'Start Time',
  endTimeHeader: 'End Time',
  taskStatusHeader: 'Status',
  eventIdHeader: 'Calendar Event ID',
  statusHeader: 'Calendar Sync Status',
  calendarId: 'primary'
};

let savedSpreadsheets = [];
let isBusy = false;

function showStatus(title, message, type = '', details = '') {
  const panel = $('statusPanel');
  panel.className = 'status-panel' + (type ? ` ${type}` : '');
  $('statusTitle').textContent = title;
  $('statusMessage').textContent = message;
  $('statusDetails').textContent = details;
}

function setBusy(busy) {
  isBusy = busy;
  updateButtons();
  $('addButton').disabled = busy;
  $('spreadsheetUrl').disabled = busy;
}

function updateButtons() {
  const hasSelection = Boolean($('spreadsheetSelect').value);
  $('syncButton').disabled = isBusy || !hasSelection;
  $('removeButton').disabled = isBusy || !hasSelection;
}

function extractSpreadsheetId(input) {
  const value = input.trim();
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  throw new Error('Enter a valid Google Sheets URL or spreadsheet ID.');
}

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(columnNumber) {
  let n = columnNumber;
  let result = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!token) return reject(new Error('Google authorization did not return an access token.'));
      resolve(token);
    });
  });
}

async function apiRequest(url, options = {}, retryAuth = true) {
  let token = await getAuthToken(true);
  let response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });

  if (response.status === 401 && retryAuth) {
    await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
    token = await getAuthToken(true);
    response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch (_) {
      detail = await response.text().catch(() => '');
    }
    throw new Error(`Google API error (${response.status}): ${detail || response.statusText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getSpreadsheetMetadata(spreadsheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent('spreadsheetId,properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))')}`;
  return apiRequest(url);
}

async function getSpreadsheetValues(spreadsheetId, sheetTitle) {
  const range = `${quoteSheetName(sheetTitle)}!A1:ZZ`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  return apiRequest(url);
}

async function updateCells(spreadsheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  return apiRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values })
  });
}

async function getDateColumnFormats(spreadsheetId, sheetTitle, dateColumn, rowCount) {
  const range = `${quoteSheetName(sheetTitle)}!${columnLetter(dateColumn)}1:${columnLetter(dateColumn)}${Math.max(rowCount, 1)}`;
  const fields = 'sheets(data(rowData(values(effectiveFormat(numberFormat(type)),effectiveValue))))';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent(fields)}`;
  const data = await apiRequest(url);
  return data.sheets?.[0]?.data?.[0]?.rowData || [];
}

function cellValue(cell) {
  if (!cell || !cell.effectiveValue) return null;
  const value = cell.effectiveValue;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'numberValue')) return value.numberValue;
  if (Object.prototype.hasOwnProperty.call(value, 'boolValue')) return value.boolValue;
  return null;
}

function dateToIso(value, numberFormatType) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && (numberFormatType === 'DATE' || numberFormatType === 'DATE_TIME')) {
    // Google Sheets serial dates use 1899-12-30 as day zero.
    const milliseconds = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    // A numeric cell without a date format is not safely identifiable as a date.
    return null;
  }

  const text = String(value).trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) return validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  // Also accept common day/month/year text dates, e.g. 20/10/2026.
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return validIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  return null;
}

function validIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nextIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function parseTime(value) {
  if (value === null || value === undefined || value === '') return null;

  // Google Sheets returns time-only cells as a fraction of one day.
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0 || value >= 1) return null;
    let minutes = Math.round(value * 24 * 60);
    if (minutes >= 1440) minutes = 0;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  const text = String(value).trim();
  let match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = (match[3] || '').toUpperCase();

  if (minutes > 59 || hours > 23 || (meridiem && (hours < 1 || hours > 12))) return null;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (meridiem === 'PM' && hours !== 12) hours += 12;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildEventTimes(isoDate, startTime, endTime, timeZone) {
  const hasStart = startTime !== null && startTime !== undefined && startTime !== '';
  const hasEnd = endTime !== null && endTime !== undefined && endTime !== '';

  if (!hasStart && !hasEnd) {
    return {
      start: { date: isoDate },
      end: { date: nextIsoDate(isoDate) },
      mode: 'all-day'
    };
  }

  if (!hasStart || !hasEnd) {
    throw new Error('Enter both Start Time and End Time, or leave both blank for an all-day event.');
  }

  const start = parseTime(startTime);
  const end = parseTime(endTime);

  if (!start || !end) {
    throw new Error('Invalid Start Time or End Time. Use a valid time such as 9:30 AM or 14:00.');
  }

  if (start >= end) {
    throw new Error('Start Time must be earlier than End Time. Overnight events are not supported.');
  }

  return {
    start: { dateTime: `${isoDate}T${start}:00`, timeZone },
    end: { dateTime: `${isoDate}T${end}:00`, timeZone },
    mode: 'timed'
  };
}

async function createCalendarEvent(task, eventTimes) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(SETTINGS.calendarId)}/events`;
  return apiRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: task,
      start: eventTimes.start,
      end: eventTimes.end
    })
  });
}

async function getCalendarEvent(eventId) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(SETTINGS.calendarId)}/events/${encodeURIComponent(eventId)}`;
  try {
    return await apiRequest(url);
  } catch (error) {
    if (String(error.message).includes('(404)')) return null;
    throw error;
  }
}

async function updateCalendarEvent(eventId, task, eventTimes) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(SETTINGS.calendarId)}/events/${encodeURIComponent(eventId)}`;
  return apiRequest(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: task,
      start: eventTimes.start,
      end: eventTimes.end
    })
  });
}

async function syncSelectedSpreadsheet() {
  if (isBusy) return;
  const spreadsheetId = $('spreadsheetSelect').value;
  const spreadsheet = savedSpreadsheets.find(item => item.id === spreadsheetId);
  if (!spreadsheet) return;

  setBusy(true);
  showStatus('Connecting…', 'Authorizing access and reading spreadsheet.');

  try {
    const metadata = await getSpreadsheetMetadata(spreadsheetId);
    const tabs = metadata.sheets || [];
    if (!tabs.length) throw new Error('No worksheet tabs were found in this spreadsheet.');

    let selectedTab = spreadsheet.tabTitle;
    if (!selectedTab || !tabs.some(tab => tab.properties.title === selectedTab)) {
      selectedTab = tabs[0].properties.title;
    }

    const valuesResponse = await getSpreadsheetValues(spreadsheetId, selectedTab);
    const rows = valuesResponse.values || [];
    if (!rows.length) throw new Error(`The worksheet “${selectedTab}” is empty.`);

    const headers = rows[0].map(value => String(value ?? '').trim());
    const taskIndex = headers.indexOf(SETTINGS.taskHeader);
    const dateIndex = headers.indexOf(SETTINGS.dateHeader);
    const startTimeIndex = headers.indexOf(SETTINGS.startTimeHeader);
    const endTimeIndex = headers.indexOf(SETTINGS.endTimeHeader);
    const taskStatusIndex = headers.indexOf(SETTINGS.taskStatusHeader);
    if (taskIndex < 0 || dateIndex < 0 || startTimeIndex < 0 || endTimeIndex < 0 || taskStatusIndex < 0) {
      throw new Error(`Required headers not found in row 1. Expected “${SETTINGS.taskHeader}”, “${SETTINGS.dateHeader}”, “${SETTINGS.startTimeHeader}”, “${SETTINGS.endTimeHeader}”, and “${SETTINGS.taskStatusHeader}”.`);
    }

    const timeZone = metadata.properties?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dhaka';

    let eventIdIndex = headers.indexOf(SETTINGS.eventIdHeader);
    let statusIndex = headers.indexOf(SETTINGS.statusHeader);
    let nextColumn = headers.length;
    const newHeaders = [];

    if (eventIdIndex < 0) {
      eventIdIndex = nextColumn++;
      newHeaders.push({ index: eventIdIndex, name: SETTINGS.eventIdHeader });
    }
    if (statusIndex < 0) {
      statusIndex = nextColumn++;
      newHeaders.push({ index: statusIndex, name: SETTINGS.statusHeader });
    }

    if (newHeaders.length) {
      const endColumn = columnLetter(Math.max(...newHeaders.map(item => item.index + 1)));
      const startColumn = columnLetter(Math.min(...newHeaders.map(item => item.index + 1)));
      const range = `${quoteSheetName(selectedTab)}!${startColumn}1:${endColumn}1`;
      const outputHeaders = [];
      for (let i = Math.min(...newHeaders.map(item => item.index)); i <= Math.max(...newHeaders.map(item => item.index)); i++) {
        const found = newHeaders.find(item => item.index === i);
        outputHeaders.push(found ? found.name : '');
      }
      await updateCells(spreadsheetId, range, [outputHeaders]);
      // Refresh values after creating helper columns.
      const refreshed = await getSpreadsheetValues(spreadsheetId, selectedTab);
      rows.splice(0, rows.length, ...(refreshed.values || []));
    }

    const dateColumn = dateIndex + 1;
    const formatRows = await getDateColumnFormats(spreadsheetId, selectedTab, dateColumn, Math.max(rows.length, 1));
    const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
    const statusUpdates = [];
    const eventIdUpdates = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const task = String(row[taskIndex] ?? '').trim();
      const rawDate = row[dateIndex];
      const rawStartTime = row[startTimeIndex];
      const rawEndTime = row[endTimeIndex];
      const rawTaskStatus = String(row[taskStatusIndex] ?? '').trim();
      const normalizedTaskStatus = rawTaskStatus.toLowerCase();
      const calendarStatus = normalizedTaskStatus === 'pending' ? 'Pending' : (normalizedTaskStatus === 'in progress' ? 'In Progress' : rawTaskStatus);
      const calendarTaskTitle = `[${calendarStatus}] ${task}`;
      const formatCell = formatRows[i]?.values?.[0] || {};
      const formatType = formatCell.effectiveFormat?.numberFormat?.type;
      const isoDate = dateToIso(rawDate, formatType);
      let eventId = String(row[eventIdIndex] ?? '').trim();
      let status = '';

      if (normalizedTaskStatus !== 'pending' && normalizedTaskStatus !== 'in progress') {
        status = normalizedTaskStatus === 'completed'
          ? 'Skipped: Completed task'
          : (rawTaskStatus ? `Skipped: unsupported status “${rawTaskStatus}”` : 'Skipped: missing Status');
        counts.skipped++;
      } else if (!task || rawDate === '' || rawDate === null || rawDate === undefined) {
        status = 'Skipped: missing task or date';
        counts.skipped++;
      } else if (!isoDate) {
        status = 'Error: invalid date; use a real date cell';
        counts.errors++;
      } else {
        try {
          const eventTimes = buildEventTimes(isoDate, rawStartTime, rawEndTime, timeZone);
          let event = eventId ? await getCalendarEvent(eventId) : null;

          if (event) {
            const expectedStart = eventTimes.start.dateTime || eventTimes.start.date;
            const expectedEnd = eventTimes.end.dateTime || eventTimes.end.date;
            const currentStart = event.start?.dateTime || event.start?.date || null;
            const currentEnd = event.end?.dateTime || event.end?.date || null;
            const currentStartKey = event.start?.dateTime
              ? event.start.dateTime.slice(0, 16)
              : currentStart;
            const currentEndKey = event.end?.dateTime
              ? event.end.dateTime.slice(0, 16)
              : currentEnd;
            const expectedStartKey = eventTimes.start.dateTime
              ? eventTimes.start.dateTime.slice(0, 16)
              : expectedStart;
            const expectedEndKey = eventTimes.end.dateTime
              ? eventTimes.end.dateTime.slice(0, 16)
              : expectedEnd;

            if (event.summary !== calendarTaskTitle ||
                currentStartKey !== expectedStartKey ||
                currentEndKey !== expectedEndKey) {
              await updateCalendarEvent(eventId, calendarTaskTitle, eventTimes);
            }
            status = `Synced: ${eventTimes.mode} event updated/checked`;
            counts.updated++;
          } else {
            event = await createCalendarEvent(calendarTaskTitle, eventTimes);
            eventId = event.id;
            status = `Synced: ${eventTimes.mode} event created`;
            counts.created++;
          }
        } catch (error) {
          status = `Error: ${String(error.message || error).slice(0, 180)}`;
          counts.errors++;
        }
      }

      eventIdUpdates.push({ row: i + 1, value: eventId });
      statusUpdates.push({ row: i + 1, value: status });
    }

    // Write helper values in contiguous column ranges, one API request per column.
    if (rows.length > 1) {
      const firstDataRow = 2;
      const lastDataRow = rows.length;
      const eventRange = `${quoteSheetName(selectedTab)}!${columnLetter(eventIdIndex + 1)}${firstDataRow}:${columnLetter(eventIdIndex + 1)}${lastDataRow}`;
      const statusRange = `${quoteSheetName(selectedTab)}!${columnLetter(statusIndex + 1)}${firstDataRow}:${columnLetter(statusIndex + 1)}${lastDataRow}`;
      await updateCells(spreadsheetId, eventRange, eventIdUpdates.map(item => [item.value]));
      await updateCells(spreadsheetId, statusRange, statusUpdates.map(item => [item.value]));
    }

    spreadsheet.tabTitle = selectedTab;
    spreadsheet.lastSync = new Date().toISOString();
    await saveSpreadsheets();
    renderSpreadsheetList();

    const details = `Created: ${counts.created}  |  Updated/checked: ${counts.updated}\nSkipped: ${counts.skipped}  |  Errors: ${counts.errors}\nWorksheet: ${selectedTab}`;
    showStatus(counts.errors ? 'Sync completed with errors' : 'Sync completed', `Finished syncing “${metadata.properties?.title || spreadsheet.title}”.`, counts.errors ? 'error' : 'success', details);
  } catch (error) {
    showStatus('Sync failed', error.message || String(error), 'error', 'Check your spreadsheet ID, worksheet headers, sharing permissions, and Google Cloud API setup.');
  } finally {
    setBusy(false);
  }
}

async function saveSpreadsheets() {
  await chrome.storage.local.set({ [STORAGE_KEY]: savedSpreadsheets });
}

function renderSpreadsheetList() {
  const select = $('spreadsheetSelect');
  const previous = select.value;
  select.innerHTML = '';

  if (!savedSpreadsheets.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No spreadsheet added';
    select.appendChild(option);
  } else {
    savedSpreadsheets.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title || item.id;
      select.appendChild(option);
    });
    select.value = savedSpreadsheets.some(item => item.id === previous) ? previous : savedSpreadsheets[0].id;
  }

  updateSheetInfo();
  updateButtons();
}

function updateSheetInfo() {
  const selected = savedSpreadsheets.find(item => item.id === $('spreadsheetSelect').value);
  if (!selected) {
    $('sheetInfo').textContent = 'Add a Google Sheet to get started.';
    return;
  }
  const lastSync = selected.lastSync ? new Date(selected.lastSync).toLocaleString() : 'Never';
  $('sheetInfo').textContent = `Worksheet: ${selected.tabTitle || 'First tab (default)'} · Last sync: ${lastSync}`;
}

async function addSpreadsheet() {
  if (isBusy) return;
  setBusy(true);
  try {
    const id = extractSpreadsheetId($('spreadsheetUrl').value);
    if (savedSpreadsheets.some(item => item.id === id)) {
      $('spreadsheetSelect').value = id;
      showStatus('Already added', 'This spreadsheet is already in your list.');
      return;
    }
    showStatus('Checking spreadsheet…', 'Google authorization may be requested.');
    const metadata = await getSpreadsheetMetadata(id);
    const firstTab = metadata.sheets?.[0]?.properties?.title || '';
    savedSpreadsheets.push({
      id,
      title: metadata.properties?.title || id,
      tabTitle: firstTab,
      lastSync: null
    });
    await saveSpreadsheets();
    renderSpreadsheetList();
    $('spreadsheetSelect').value = id;
    $('spreadsheetUrl').value = '';
    updateSheetInfo();
    showStatus('Spreadsheet added', `“${metadata.properties?.title || id}” is ready to sync.`, 'success', `Default worksheet: ${firstTab || 'not available'}`);
  } catch (error) {
    showStatus('Could not add spreadsheet', error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function removeSpreadsheet() {
  const id = $('spreadsheetSelect').value;
  if (!id) return;
  const item = savedSpreadsheets.find(entry => entry.id === id);
  if (!confirm(`Remove “${item?.title || id}” from this extension? Existing calendar events will not be deleted.`)) return;
  savedSpreadsheets = savedSpreadsheets.filter(entry => entry.id !== id);
  await saveSpreadsheets();
  renderSpreadsheetList();
  showStatus('Spreadsheet removed', 'The spreadsheet was removed from this extension. Calendar events were left unchanged.');
}

$('addButton').addEventListener('click', addSpreadsheet);
$('syncButton').addEventListener('click', syncSelectedSpreadsheet);
$('removeButton').addEventListener('click', removeSpreadsheet);
$('spreadsheetSelect').addEventListener('change', () => {
  updateSheetInfo();
  updateButtons();
  showStatus('Ready', 'Click Sync Now to synchronize the selected spreadsheet.');
});
$('spreadsheetUrl').addEventListener('keydown', event => {
  if (event.key === 'Enter') addSpreadsheet();
});

(async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  savedSpreadsheets = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  renderSpreadsheetList();
})();
