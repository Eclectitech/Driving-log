# Virginia Teen Driving Log (Pixel 11 Pro + TrueNAS NextCloud)

An offline-first Progressive Web App (PWA) designed specifically for tracking supervised practice driving hours under the **Virginia Department of Motor Vehicles (DMV)** rules (Code of Virginia § 46.2-334), with automated and on-demand backup to a **TrueNAS-hosted NextCloud** server.

---

## 🌟 Key Features

1. **Virginia DMV Compliance & Tracking**:
   - **45 Total Hours**: Real-time circular progress meter and remaining hours calculation.
   - **15 Night Hours**: Dedicated night driving meter (after sunset).
   - **Official Virginia DMV 45-Hour Driving Log**: Generates the exact formatted Parent/Teen Driving Log table with calculated cumulative running totals, conditions, maneuvers, and parent certification signature block.
   - **Print to PDF**: One-tap print-ready document formatted for DMV submission.

2. **Pixel 11 Pro & 100% Offline Capability**:
   - **AMOLED Dark Mode**: Pure blacks (`#06070a`) reduce glare during night driving and save battery.
   - **Service Worker & IndexedDB**: Works completely offline with zero internet connection.
   - **Installable PWA**: Runs full-screen with native app feel, app icon, and haptic feedback.
   - **Live Drive Timer**: Glanceable in a dashboard phone mount; auto-calculates Day/Night splits; resilient against phone sleep and app backgrounding.
   - **Manual Entry & Backfill**: Log drives with date, start/end time, day/night split, weather, road conditions, and skills checklist.

3. **NextCloud & TrueNAS Backup**:
   - **Direct WebDAV Sync**: Uses standard NextCloud WebDAV (`PUT` / `GET` / `PROPFIND`) directly to `/DrivingLog/va_driving_log_backup.json`.
   - **One-Tap "Sync Now" & Auto-Backup**: Automatically backs up after recording drives when connected to home Wi-Fi.
   - **Restore from TrueNAS**: Pulls latest backup into any new device.
   - **Offline File Export**: Download standard JSON and CSV files anytime.

---

## 📱 How to Install on Pixel 11 Pro

1. Open **Google Chrome** on your Pixel 11 Pro.
2. Navigate to your app address (e.g. `http://<your-local-ip>:8080` or your home server domain).
3. In Chrome, tap the **three-dot menu (⋮)** in the top right.
4. Tap **"Add to Home screen"** or **"Install app"**.
5. The **VA Driving Log** icon will appear on your home screen and app drawer.
6. Launch it from your home screen — it will open full-screen like a native Android app without any browser URL bars, and will continue working offline even with Airplane Mode enabled!

---

## ☁️ NextCloud / TrueNAS Setup Guide

To enable automated backups to your TrueNAS NextCloud instance:

1. Log into your NextCloud web interface.
2. Go to **Files** > scroll to bottom left > click **Files settings**.
3. Copy the **WebDAV URL** (e.g. `https://nextcloud.lan/remote.php/dav/files/yourusername/`).
4. In NextCloud, go to **User Settings** (top right avatar) > **Security** > **Devices & client apps**.
5. In the *New app name* field, type `DrivingLog` and click **Create new app password**.
6. Open the **VA Driving Log** app, go to the **Backup** tab (cloud icon), and paste:
   - **NextCloud WebDAV URL**
   - **NextCloud Username**
   - **NextCloud App Password**
   - **Backup Destination Folder**: `DrivingLog`
7. Click **"Save WebDAV Settings"** and tap **"Test Connection"** to verify.
8. Tap **"Sync Now"** anytime, or let the app automatically back up whenever you finish a drive at home!

---

## 🚗 Virginia DMV Requirements Reference

* Under Virginia law, all drivers under age 18 must complete **at least 45 hours** of supervised driving.
* **At least 15 of those hours** must occur after sunset (night driving).
* Driving must be supervised by a licensed driver who is at least 21 years old, or at least 18 years old if an immediate family member (parent or legal guardian).
* The supervisor must occupy the front passenger seat.

---

## 🛠️ Running Locally

To run the local server on your network:

```bash
cd /Users/jon/Driving-log
ruby serve.rb
```

The app will be available on port `8080` (e.g., `http://localhost:8080` or `http://<your-computer-ip>:8080`).
