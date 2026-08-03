# Security Policy

## Supported Version

Security fixes are applied to the latest code on the `main` branch and the latest published container image.

## Reporting a Vulnerability

Please do not publish credentials, music-platform cookies, identity tokens, room passwords, or exploit details in a public issue.

Report security problems privately through GitHub Security Advisories for this repository. Include:

- affected version or commit;
- reproduction steps;
- expected impact;
- relevant logs with all secrets removed.

## Sensitive Data

Music Together can temporarily process music-platform cookies to provide account-scoped playback and playlist features. Never include these values in screenshots, logs, issues, pull requests, or test fixtures.

Production deployments must configure a unique `IDENTITY_SECRET` with at least 32 characters. Rotate the secret if it may have been exposed; existing identity cookies will become invalid after rotation.
