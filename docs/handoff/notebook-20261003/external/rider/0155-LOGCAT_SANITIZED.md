# Sanitized logcat evidence

Date: 2026-08-02

The device log was queried after staging installation and smoke using a relevance filter for:

- FATAL EXCEPTION / AndroidRuntime / ANR / FlutterError;
- foreground service, bridge, permission, location, token refresh, outbox, claim and delivery completion;
- the staging Rider package.

Before output, bearer values, JWT-shaped values, email-shaped values, precise coordinate pairs and serial-labelled values were redacted. No complete logcat was retained.

Result: zero filtered records and zero FATAL/AndroidRuntime/ANR/FlutterError records.

This is evidence of the executed smoke window only; it is not a substitute for a real moving GPS route.
