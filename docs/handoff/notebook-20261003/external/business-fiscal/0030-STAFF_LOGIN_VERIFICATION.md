# Verificación de login staff QA

Fecha: 2026-08-02  
Proyecto: `ukxqbgswjlibmnjemrzd`  
Cuenta: `qa-business-staging@local.taba`

## Resultado

**PASS**

| Control | Resultado |
|---|---|
| Cuenta Auth existente | PASS |
| `user_id` | `542f6931-2050-476c-9cb3-f7e8d0b78254` |
| Business | `00000000-0000-4000-8000-000000000001` |
| Membership | `owner`, activa |
| Rotación por Auth Admin | PASS, sólo staging y sólo el usuario QA esperado |
| `signInWithPassword` / token endpoint | HTTP 200 |
| Validación de sesión `/auth/v1/user` | HTTP 200, mismo `user_id` |
| Lectura autenticada de membership | HTTP 200, una fila exacta |

La sesión administrativa local de Supabase se usó exclusivamente en backend y memoria para la rotación. Ninguna key administrativa fue enviada al frontend, persistida o registrada.

## Archivo privado

Ruta: `C:\1212\secrets\la-taba-staging-business-login.txt`

- Contiene únicamente email y contraseña rotada.
- Owner: usuario Windows actual.
- ACL: un único ACE `Allow` para el usuario Windows actual.
- Herencia: desactivada.
- No se incluye ningún valor secreto en esta evidencia.

