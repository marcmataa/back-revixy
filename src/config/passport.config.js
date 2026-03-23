// Configuramos Passport con GoogleStrategy — sin sesiones de servidor (JWT stateless)
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { googleAuth } from "../services/auth.service.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      // En producción detrás de un proxy: confiamos en X-Forwarded-Proto
      proxy: true,
      scope: ["profile", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Seguridad: nunca exponemos accessToken/refreshToken
        const result = await googleAuth(profile);
        return done(null, result);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

// No usamos serializeUser/deserializeUser — REVIXY usa JWT stateless
export default passport;

