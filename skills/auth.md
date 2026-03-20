# SKILL: AUTH ARCHITECT (JWT + OAuth Social)

## 1. ROLE & RESPONSIBILITY

You are a Senior Auth Architect specialized in secure authentication systems for SaaS applications.
Your mission is to build bulletproof, production-ready authentication flows that combine:

- Email/Password with JWT (already implemented — DO NOT touch)
- OAuth 2.0 Social Login (Google) as an additional auth method
- Seamless account linking between email and social providers

---

## 2. ARCHITECTURAL PATTERN (MANDATORY)

Follow the existing **Controller → Service → Model** pattern:

- **Controllers:** Handle HTTP req/res ONLY. Max 20 lines.
- **Services:** Pure business logic. No HTTP logic.
- **Models:** Mongoose schemas only. No business logic.

The existing `auth.service.js`, `auth.controller.js`, and `auth.routes.js` must be extended, NOT replaced.

---

## 3. GOOGLE OAUTH FLOW (MANDATORY)

### Step 1 — Initiate

`GET /api/auth/google` → Redirect to Google consent screen.

### Step 2 — Callback

`GET /api/auth/google/callback` → Google redirects here with `code`.
Exchange `code` for Google profile via `passport-google-oauth20`.

### Step 2.1 — Error & Cancel Handling

If Google returns an error or the user cancels the consent screen:

- Google sends `?error=access_denied` to the callback URL.
- Detect this BEFORE attempting token exchange or upsert logic.
- Redirect immediately to: `${FRONTEND_URL}/login?error=auth_cancelled`
- Never attempt upsert logic if Google returned an error param.

### Step 3 — Upsert Logic (CRITICAL — ACCOUNT TAKEOVER PREVENTION)

````
1. Extract email from Google profile.
2. Find existing user by email in MongoDB.
   a. If user exists AND has googleId → login directly, issue JWT.
   b. If user exists AND no googleId:
      - Check if user.isEmailVerified === true.
      - If verified → link Google to existing account, issue JWT.
      - If NOT verified → reject with error: "Verifica tu email antes de vincular Google."
        This prevents account takeover via unverified email addresses.
   c. If user does NOT exist → create new user with googleId, mark isEmailVerified: true
      (Google guarantees email ownership), issue JWT.
3. Never create duplicate accounts for the same email.
    **Race condition protection (Duplicate Key):**
Wrap the `User.create()` call in a try/catch that handles MongoDB error code `11000`:
```js
try {
  user = await User.create({ ... });
} catch (error) {
  if (error.code === 11000) {
    // Condición de carrera — el usuario fue creado por otra petición simultánea
    // Recuperamos el usuario que ganó la carrera y continuamos
    user = await User.findOne({ email });
    if (!user) throw new Error("Unexpected race condition in user creation");
  } else {
    throw error;
  }
}
````

````

**Why this matters:** If an attacker registers with someone else's email (unverified),
and the real owner tries to login with Google, the attacker could maintain access.
Requiring `isEmailVerified: true` before linking prevents this attack vector.

---

## 4. USER MODEL EXTENSIONS (MANDATORY)
Add these fields to the existing `User.model.js`:
```js
googleId: {
  type: String,
  unique: true,
  sparse: true, // Permite múltiples nulls — usuarios sin Google login
  select: false,
},
avatar: {
  type: String,
  default: null,
  validate: {
    validator: (v) => !v || v.startsWith("https://"),
    message: "Avatar must be a secure HTTPS URL",
  },
},
authProvider: {
  type: String,
  enum: ["local", "google", "both"],
  default: "local",
},
isEmailVerified: {
  type: Boolean,
  default: false, // false for local users until verified; true for Google users
},
````

**NEVER remove or modify existing fields.** Only add new ones.

---

## 5. PASSWORD HANDLING & AUTHPROVIDER RULES

- Users who register via Google do NOT have a password initially.
- The `password` field must be conditional: `required: function() { return this.authProvider === "local"; }`
- If a Google user tries to login with email/password → return error: `"Esta cuenta usa Google para iniciar sesión."`
  **Local login guard (MANDATORY):**
  In the existing `login` function in `auth.service.js`, add this check BEFORE
  calling `comparePassword`:

```js
if (user.authProvider === "google") {
  throw new Error(
    "Esta cuenta utiliza Google. Inicia sesión con Google o establece una contraseña primero.",
  );
}
```

This prevents bcrypt from receiving a null/undefined password hash,
which causes unpredictable behavior depending on the bcrypt implementation.

**`authProvider` state machine (EXPLICIT):**

```
"local"  → has password, no googleId
"google" → has googleId, no password
"both"   → has googleId AND password (user added password after Google signup)
```

- When linking Google to a local account → set to `"both"` if password exists, else `"google"`.
- When a `"google"` user sets a password → update `authProvider` to `"both"`.
- Never set to `"local"` if `googleId` is present.

---

## 6. TOKEN IN URL — SECURITY (MANDATORY)

Passing `accessToken` in query params (`?token=...`) risks exposure in browser history
and server/proxy logs.

**Mitigation strategy (implement both):**

1. **Backend:** Set a short-lived `Set-Cookie` with `accessToken` (5 minutes, httpOnly)
   as a handoff mechanism instead of query param.
2. **Frontend note (document in comment):** If using query param as fallback,
   the frontend MUST call `window.history.replaceState({}, '', '/dashboard')`
   immediately after reading the token to remove it from browser history.
3. **Preferred approach for REVIXY:** Use a signed cookie for the handoff:
   ```js
   res.cookie("oauth_handoff", accessToken, {
     httpOnly: true,
     secure: process.env.NODE_ENV === "production",
     maxAge: 5 * 60 * 1000, // 5 minutes only
     signed: true,
   });
   res.redirect(`${frontendUrl}/auth/callback`);
   ```
   The frontend calls `GET /api/auth/token` to exchange the handoff cookie for the token,
   then the backend clears the cookie.

---

## 7. STATELESS OAUTH STATE (NO SERVER SESSIONS)

REVIXY uses JWT and must remain stateless for horizontal scaling compatibility.
Do NOT use `express-session` with in-memory store for the OAuth `state` param.

**Use signed cookies instead:**

```js
// Al iniciar OAuth — generamos state y lo guardamos en cookie firmada
const state = crypto.randomBytes(16).toString("hex");
res.cookie("oauth_state", state, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: 10 * 60 * 1000, // 10 minutos — solo para el flujo OAuth
  signed: true,
  sameSite: "lax",
});

// En el callback — verificamos state contra la cookie
const receivedState = req.query.state;
const storedState = req.signedCookies.oauth_state;
if (!storedState || receivedState !== storedState) {
  throw new Error("OAuth state mismatch — possible CSRF attack");
}
res.clearCookie("oauth_state");
```

**IMPORTANT — Passport state integration:**
The `state` value must be passed explicitly to `passport.authenticate`:

```js
passport.authenticate("google", {
  scope: ["profile", "email"],
  session: false,
  state: stateValue,
})(req, res);
```

This keeps the backend 100% stateless — no Redis, no in-memory sessions needed.
Works correctly in Docker, Kubernetes, and serverless deployments.

---

## 8. SECURITY RULES (NON-NEGOTIABLE)

- **Account takeover prevention:** Never link Google to unverified email accounts.
- **`sparse: true`** on `googleId` — mandatory to allow users without Google login.
- **`sameSite: "lax"`** on OAuth cookies — Google redirects require lax, not strict.
- **Never log** Google's `accessToken` or `refreshToken` from the OAuth profile.
- **Avatar HTTPS validation** — never store `http://` avatars.
- **Stateless state param** — use signed cookies, not server sessions.
- **`authProvider` integrity** — always enforce the state machine from section 5.
- **No duplicate emails** — the upsert logic must check email before creating a new user.
- **`cookieParser` with secret** — required for signed cookies (`cookieParser(process.env.COOKIE_SECRET)`).

---

## 9. ENVIRONMENT VARIABLES NEEDED

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
FRONTEND_URL=http://localhost:5173
COOKIE_SECRET=genera_uno_con_crypto_randomBytes_32
```

---

## 10. DEPENDENCIES REQUIRED

```bash
npm install passport passport-google-oauth20
```

No `express-session` needed — we use signed cookies instead.

---

## 11. PASSPORT CONFIGURATION

Create `src/config/passport.config.js`:

- Initialize `passport` with `GoogleStrategy`.
- Use `clientID`, `clientSecret`, `callbackURL` from `.env`.
- In the `verify` callback → call `googleAuth(profile)` from auth.service.js.
- Export `passport` instance.
- Do NOT call `passport.serializeUser` or `passport.deserializeUser` — we use JWT.
- Set `proxy: true` in the GoogleStrategy options to trust `X-Forwarded-Proto` headers
  when running behind a reverse proxy (Nginx, Railway, Render, Heroku).
  Without this, the callbackURL will use `http` instead of `https` in production,
  causing Google to reject the callback.

---

## 12. CODING & LINGUISTIC STANDARDS

- **Code:** English. **Comments:** Spanish (explicar lógica de upsert, prevención de account takeover y manejo de estado OAuth).
- **ESM syntax:** `import/export`. Always include `.js` extension in all import paths.
- **Naming:** `passport.config.js`, extend existing auth files.
- **Anti-patterns:** NO `express-session`. NO storing Google tokens. NO modifying existing auth endpoints. NO query param token without URL cleanup instruction.

---

## 13. FILES TO CREATE OR MODIFY

| File                                 | Action                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| `src/config/passport.config.js`      | CREATE                                                       |
| `src/models/User.model.js`           | MODIFY — add 4 fields only                                   |
| `src/services/auth.service.js`       | MODIFY — add `googleAuth()` function                         |
| `src/controllers/auth.controller.js` | MODIFY — add `googleInitiate` and `googleCallback` handlers  |
| `src/routes/auth.routes.js`          | MODIFY — add 2 Google OAuth routes                           |
| `app.js`                             | MODIFY — add `cookieParser` with secret, initialize passport |

---

## 14. ANTI-PATTERNS (PROHIBITED)

- NO `express-session` or any server-side session store.
- NO linking Google to unverified email accounts.
- NO using Google tokens as app tokens.
- NO requesting unnecessary Google scopes (only `profile` and `email`).
- NO exposing `googleId` or Google tokens in any API response or log.
- NO creating duplicate users for the same email.
- NO passing `accessToken` in URL query params without cleanup instruction.
- NO setting `authProvider` to inconsistent values — always follow the state machine.
