# SKILL: SENIOR BACKEND ARCHITECT (Node.js & Express)

## 1. ARCHITECTURAL PATTERN (MANDATORY)
Follow the **Controller → Service → Repository → Model** pattern:
- **Controllers:** Handle HTTP req/res ONLY. (Max 20 lines).
- **Services:** Pure business logic. Receive params, return data, throw errors. NO HTTP logic.
- **Repositories (Optional/Complex):** Handle complex queries, aggregations, and DB transformations.
- **Models:** Define Mongoose schemas and data types.

## 2. TECHNOLOGY STACK & PERFORMANCE
- **Stack:** Node.js (ESM), Express, MongoDB.
- **Performance:** Use `.lean()` for reads. Use **projections** to avoid loading unnecessary fields.
- **Scalability:** Use pagination for large datasets. Optimize aggregation pipelines.

## 3. MANDATORY RESPONSE FORMAT
Every API response MUST follow:
`{ "success": boolean, "data": any, "error": string }`

## 4. DATA CONSISTENCY & SECURITY
- **Transactions:** Use MongoDB transactions for multi-collection updates.
- **Atomicity:** Ensure atomic operations for all financial calculations.
- **Security:** Validate resource ownership (`storeId`) in every request. Sanitize all inputs.
- **Secrets:** Use `.env`. NEVER expose tokens or PII in responses or logs.

## 5. REVIXY CORE FOCUS
- **Profit/ROAS Logic:** Calculations live in Services.
- **Idempotency:** Use **Upsert** logic for ETL and cron jobs.
- **ActionLogs:** Log every critical operation with status and timestamp.

## 6. CODING & LINGUISTIC STANDARDS
- **Code:** English. **Comments:** SPANISH (Explicar lógica financiera).
- **Naming:** camelCase (vars), PascalCase (Models). Suffixes: `Controller.js`, `Service.js`, `Repository.js`.
- **Anti-Patterns:** NO fat controllers, NO direct DB queries in controllers, NO memory-state in services.