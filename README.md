# Work Plan Calendar Sync — Chrome Extension

A Manifest V3 Chrome extension that manually synchronizes Pending and In Progress tasks from one or more Google Sheets to the signed-in user's **primary Google Calendar** as timed or all-day events.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites & Requirements](#prerequisites--requirements)
- [Setup & Configuration Guide](#setup--configuration-guide)
  - [Step 1 — Create a Google Cloud Project](#step-1--create-a-google-cloud-project)
  - [Step 2 — Enable Required APIs](#step-2--enable-required-apis)
  - [Step 3 — Configure Google Auth Platform / OAuth Consent Screen](#step-3--configure-google-auth-platform--oauth-consent-screen)
  - [Step 4 — Get Your Chrome Extension ID](#step-4--get-your-chrome-extension-id)
  - [Step 5 — Create the Chrome Extension OAuth Client](#step-5--create-the-chrome-extension-oauth-client)
  - [Step 6 — Add the Client ID to `manifest.json`](#step-6--add-the-client-id-to-manifestjson)
  - [Step 7 — Connect and Test Your Spreadsheet](#step-7--connect-and-test-your-spreadsheet)
- [Usage & Worksheet Structure](#usage--worksheet-structure)
  - [Required Row 1 Headers](#required-row-1-headers)
  - [Status Filtering Rules](#status-filtering-rules)
  - [Start Time, End Time & Timed Events](#start-time-end-time--timed-events)
  - [Worksheet Tab Behavior](#worksheet-tab-behavior)
- [Permissions & Privacy](#permissions--privacy)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
  - [Error 403: `access_denied`](#error-403-access_denied)
  - [Checkpoints if Error 403 Persists](#checkpoints-if-error-403-persists)
  - [OAuth Token Expiration](#oauth-token-expiration)
  - [General Issues & Diagnostics](#general-issues--diagnostics)

---

## Overview

**Work Plan Calendar Sync** connects your Google Sheets work plans directly to Google Calendar. It scans your tasks and converts them into timed or all-day events on your primary Google Calendar without relying on third-party servers.

---

## Features

- **Multi-Spreadsheet Support**: Add multiple Google Sheets by URL or spreadsheet ID.
- **Timed & All-Day Events**: Supports specific start/end times or defaults to all-day events.
- **Smart Status Filtering**: Syncs only `Pending` and `In Progress` tasks, prefixing titles accordingly (e.g., `[In Progress] Prepare monthly report`).
- **Duplicate Prevention & Sync Tracking**: Automatically adds helper columns (`Calendar Event ID` and `Calendar Sync Status`) to track and update existing calendar events when task details or dates change.
- **Local & Private**: Runs purely inside your browser using Chrome local storage and direct Google APIs. No third-party backend servers.
- **No Store Publication Required**: Easily installable and fully testable in Chrome Developer mode.

---

## Prerequisites & Requirements

- Google Chrome browser.
- A Google account with edit access to target spreadsheets and permissions to create events on its primary calendar.
- A Google Cloud project with the **Google Sheets API** and **Google Calendar API** enabled.
- An OAuth 2.0 client ID of application type **Chrome Extension**.
- **Folder Persistence**: Keep the extension folder in a consistent location on your computer. Moving or repackaging an unpacked extension will change its Extension ID.

---

## Setup & Configuration Guide

### Step 1 — Create a Google Cloud Project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Sign in with the Google account you wish to use.
3. Click the **Project Selector** dropdown at the top bar and click **New Project**.
4. Enter `Work Plan Calendar Sync` as the project name.
5. Click **Create**, then select your new project from the project selector.

*(Note: You can also use an existing Google Cloud project if you already have one.)*

---

### Step 2 — Enable Required APIs

You must enable both required APIs within the same project:

1. **Google Sheets API**:
   - Go to **APIs & Services > Library** in Google Cloud Console.
   - Search for **Google Sheets API** and click **Enable**.
2. **Google Calendar API**:
   - Search for **Google Calendar API** and click **Enable**.

---

### Step 3 — Configure Google Auth Platform / OAuth Consent Screen

1. Open **Google Auth Platform** (or **OAuth consent screen**).
2. **Branding**:
   - Click **Get Started** if prompted.
   - Set **App name**: `Work Plan Calendar Sync`.
   - Set **User support email**: Your Google email address.
   - Set **Developer contact email**: Your Google email address.
   - Save settings.
3. **Audience**:
   - Select **External** if using a personal Gmail account (or **Internal** if restricted to an eligible Google Workspace organization).
   - If **External** is selected, set status to **Testing** and add your own Google account under **Test users**.
4. **Data Access (Scopes)**:
   - Configure the following two scopes to match `manifest.json`:
     - `https://www.googleapis.com/auth/spreadsheets`
     - `https://www.googleapis.com/auth/calendar.events`

---

### Step 4 — Get Your Chrome Extension ID

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click **Load unpacked** and select the extracted `sheets-calendar-extension` folder (the folder containing `manifest.json`).
4. Locate **Work Plan Calendar Sync** and copy the 32-character ID shown on its card (e.g., `abcdefghijklmnopqrstuvwxyzabcdef`).

> ⚠️ **Important**: Do not use example IDs. Always copy the exact ID generated on your local Chrome extension page.

---

### Step 5 — Create the Chrome Extension OAuth Client

1. Open **Google Auth Platform → Clients** (or **APIs & Services → Credentials**).
2. Click **Create Client**.
3. Select **Chrome Extension** for **Application Type**.
4. Set the name to `Work Plan Calendar Sync Chrome`.
5. In the **Application ID** field, paste your actual extension ID copied from Step 4.
6. Click **Create**.
7. Copy the generated **OAuth Client ID** (ending with `.apps.googleusercontent.com`).

*(Note: If you cannot find "Chrome Extension" in the client-type list, do not select another type.)*

---

### Step 6 — Add the Client ID to `manifest.json`

1. Open `manifest.json` in a text editor (e.g., VS Code or Notepad).
2. Locate the `oauth2` configuration block and insert your generated Client ID:

```json
"oauth2": {
  "client_id": "YOUR_ACTUAL_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar.events"
  ]
}
```

3. Save the file.
4. Return to `chrome://extensions` and click the **Reload** (↺) icon on the extension card.

---

### Step 7 — Connect and Test Your Spreadsheet

1. Click the **Work Plan Calendar Sync** icon in your Chrome toolbar.
2. Enter your Google Sheet URL or Spreadsheet ID and click **Add spreadsheet**.
3. Authorize the Google account when prompted (ensure this account has edit access to the sheet and is added as a Test User in Google Cloud).
4. Select the spreadsheet and click **Sync Now**.
5. Open Google Calendar to verify the created events.
6. **Verification**: Test with two tasks first. After the initial sync, modify one task's title or date in your spreadsheet and click **Sync Now** again to verify that the existing calendar event updates seamlessly.

---

## Usage & Worksheet Structure

### Required Row 1 Headers

Ensure the first worksheet row contains these exact headers:

| Column Header | Description |
| :--- | :--- |
| `Task Name` | Title of the task/event. |
| `Planned Date` | Task date (formatted as Date in Sheets, or text `YYYY-MM-DD`/`DD/MM/YYYY`). |
| `Start Time` | *(Optional)* Start time (e.g., `9:30 AM`). |
| `End Time` | *(Optional)* End time (e.g., `10:30 AM`). |
| `Status` | Task status (`Pending` or `In Progress`). |

*The extension will automatically append `Calendar Event ID` and `Calendar Sync Status` columns if they are not already present.*

### Status Filtering Rules

- Only tasks with `Status` set to **`Pending`** or **`In Progress`** (case-insensitive) are synced.
- Syncing prefixes the event title with the normalized status: e.g., `[Pending] Prepare monthly report`.
- Tasks marked as `Completed`, left blank, or given any other status are skipped.
- **Skipped rows do not delete existing calendar events.** If a row was previously synced and later changed to `Completed`, its existing calendar event remains intact in Google Calendar.

### Start Time, End Time & Timed Events

- **All-Day Events**: Leave both `Start Time` and `End Time` blank.
- **Timed Events**: Fill in both `Start Time` and `End Time` (e.g., `9:30 AM` and `10:30 AM`). Use `Format → Number → Time` in Google Sheets for best results.
- **Time Zone**: The extension utilizes the spreadsheet's configured time zone.
- **Validation**: If only one time cell is filled, or if the start time is not earlier than the end time, the row is flagged as an error in `Calendar Sync Status`. Overnight events crossing midnight are not supported in this version.

### Worksheet Tab Behavior

- The extension reads the **first worksheet tab** by default.
- Header row must always be row 1.
- Advanced users can modify a spreadsheet's saved `tabTitle` in Chrome extension local storage via Chrome DevTools.

---

## Permissions & Privacy

- `identity`: Manages Google OAuth sign-in and access tokens.
- `storage`: Saves spreadsheet IDs and configuration locally in Chrome storage.
- **Google Sheets API Scope**: Reads task rows and updates helper status columns.
- **Google Calendar API Scope**: Creates and updates events on the primary calendar.
- **Data Privacy**: All data processing is strictly local to your browser. No task data or credentials are transmitted to third-party servers.

---

## Limitations

- **Manual Sync Only**: Synchronization is triggered manually via the extension popup; there is no background scheduled sync.
- **No Event Deletion**: Deleting a row from the spreadsheet or removing a spreadsheet from the extension does not delete the corresponding Google Calendar event.
- **Helper Column Integrity**: Do not delete or edit values in the `Calendar Event ID` helper column. Removing IDs breaks the extension's ability to update previously created events.
- **First Worksheet Default**: Selects the first tab in the workbook by default.

---

## Troubleshooting

### Error 403: `access_denied`

- **Cause**: Your Google Cloud OAuth app is in **Testing mode**, and the Google account you are attempting to sign in with has not been added to the **Test users** list.
- **Fix**:
  1. Open **Google Auth Platform > Audience** in Google Cloud Console.
  2. Confirm the correct project (`Work Plan Calendar Sync`) is selected.
  3. Locate **Test users** and click **Add users**.
  4. Add the exact email address used for signing in within the extension.
  5. Click **Save**.
  6. Go to `chrome://extensions`, click **Reload** on the extension card, and retry signing in.

### Checkpoints if Error 403 Persists
- **Account Match**: Ensure the sign-in email matches the test user list character-for-character.
- **Project Verification**: Verify the test user was added to the exact same Google Cloud project that owns the OAuth client ID.
- **Audience Mode**: Ensure External apps in Testing mode explicitly list your email under Test users.
- **Workspace Policies**: Work or school Google Workspace accounts may have administrator restrictions blocking third-party OAuth apps.

### OAuth Token Expiration
- While the Google Cloud app remains in **Testing mode**, granted OAuth authorizations expire after **7 days**. Re-authorization may be required weekly during local testing.

### General Issues & Diagnostics

| Problem | Cause & Solution |
| :--- | :--- |
| **Invalid Client / OAuth Error** | Ensure `manifest.json` contains a **Chrome Extension** OAuth Client ID and that the extension ID in Google Cloud Console matches `chrome://extensions`. |
| **API Not Enabled** | Verify both **Google Sheets API** and **Google Calendar API** are enabled in your Google Cloud project. |
| **Permission Denied** | Sign in with the account that has edit rights to the sheet and owns/uses the target Google Calendar. |
| **Header Not Found** | Ensure `Task Name`, `Planned Date`, and `Status` are placed in **Row 1** with exact spelling and capitalization. |
| **Date Error** | Format date cells as `Date` in Google Sheets (`Format → Number → Date`). |
| **Inspect Debug Logs** | Navigate to `chrome://extensions`, click the popup inspect link or right-click the extension popup window and choose **Inspect** to review console logs. |