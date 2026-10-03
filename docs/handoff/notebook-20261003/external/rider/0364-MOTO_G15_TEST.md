# Moto G15 physical test

Device requested: `ZY32LHS6PS` / `moto_g15` / Android 15 / SDK 35.

Earlier ADB preflight detected the requested device with:

`ZY32LHS6PS device product:lamu_g model:moto_g15 device:lamu transport_id:3`

At the start of the physical run, the device was no longer attached. A fresh
`adb start-server` followed by `adb devices -l` returned no devices. Therefore
the following are intentionally **not certified**:

- Chrome login and precise-location permission;
- rider claim/start from the Moto UI;
- MapLibre marker backed by a real device GPS fix;
- physical movement and changed sample observed by a customer device;
- screen off/on and foreground recovery;
- reliable background tracking.

No simulated GPS was used and no physical PASS is claimed.

Continuation recheck: branch/HEAD remained correct and a second
`adb start-server` plus `adb devices -l` still returned an empty device list.
Third continuation recheck: `adb devices -l` remains empty; the physical test
cannot proceed without an external device/USB state change.
The HTTPS origin remained reachable (local HTTP 200, public HTTPS 200), so the
remaining blocker is the physical USB/ADB connection only.
