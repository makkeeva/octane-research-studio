# Octane Research Studio — hosted version

Private Sites deployment of https://github.com/makkeeva/octane-research-studio.
Uses Sites owner access, persistent D1 records, R2 PDFs and AES-256-GCM encrypted platform credentials. No running Codespace is needed.

Generate fonts with `node scripts/generate-fonts.mjs`, check TypeScript, run hosted tests, then build with the supplied Sites build helper. D1 schema and migrations live in db/ and drizzle/.

Runtime secrets: VAULT_KEY_BASE64 (32 random bytes in base64). MIGRATION_PRIVATE_KEY is a temporary PKCS8 RSA key used only for importing the encrypted Codespaces backup; remove it after import. Values must never be committed.

Generation has two persisted phases. The studio advances them while open; concurrent polls share a database lease. Failed or abandoned requests do not silently repeat model calls. Only Gemini is used; HTTP failures never enable a paid fallback. Publisher preparation and publication remain separate actions and require reviewed evidence.

An encrypted migration package includes existing documents, publication state, generation state, PDFs and the legacy credential vault. The importer decrypts and re-encrypts connections on the server, imports only once and returns counts, never credentials. Existing Codespaces data is retained.
