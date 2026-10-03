# Validación de certificado y clave

Herramienta disponible desde el worktree ARCA:

```powershell
npm run arca:credentials -- inspect-cert --cert C:\ruta-secreta\arca-cert.pem
npm run arca:credentials -- verify-pair --cert C:\ruta-secreta\arca-cert.pem --key C:\ruta-secreta\arca-key.pem --cuit 20123456789
npm run arca:credentials -- verify-cuit --cert C:\ruta-secreta\arca-cert.pem --cuit 20123456789
npm run arca:credentials -- verify-validity --cert C:\ruta-secreta\arca-cert.pem
npm run arca:credentials -- verify-chain --cert C:\ruta-secreta\arca-cert.pem --ca C:\ruta-secreta\arca-chain.pem
npm run arca:credentials -- check-clock --reference 2026-08-03T12:00:00Z
npm run arca:health
```

La herramienta sólo informa sujeto, emisor, huella SHA-256, vigencia, coincidencias y estado. Nunca imprime PEM, clave privada, token, contraseña ni service role.
