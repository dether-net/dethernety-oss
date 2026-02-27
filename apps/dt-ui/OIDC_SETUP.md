# OIDC Authentication Setup

This application supports both development (HTTP) and production (HTTPS) environments for OIDC authentication with Zitadel.

## Environment Variables

Create a `.env.local` file in the `apps/dt-ui` directory with the following variables:

### Development Environment (HTTP)
```bash
VITE_OIDC_ISSUER=http://dethernety.corp:8080
VITE_OIDC_CLIENT_ID=your-development-client-id
VITE_OIDC_REDIRECT_URI=http://dethernety.corp:3005/auth/callback
```

### Production Environment (HTTPS)
```bash
VITE_OIDC_ISSUER=https://your-zitadel-domain.com
VITE_OIDC_CLIENT_ID=your-production-client-id
VITE_OIDC_REDIRECT_URI=https://your-domain.com/auth/callback
```

## Development vs Production

The authentication store automatically detects whether it's running in:
- **Development mode**: Uses fallback crypto implementations for HTTP contexts
- **Production mode**: Uses secure Web Crypto API for HTTPS contexts

### Security Note

In development mode (HTTP), the application uses a fallback SHA-256 implementation that is **NOT cryptographically secure**. This is only for development purposes and should never be used in production.

## Zitadel Configuration

Make sure your Zitadel application is configured with:
- **Redirect URIs**: Include both development and production callback URLs
- **PKCE**: Enabled (Code Challenge Method: S256)
- **Grant Types**: Authorization Code
- **Response Types**: Code
- **Scopes**: openid, profile, email

## Testing

1. Start the development server: `pnpm run dev`
2. Navigate to `/login` to test the authentication flow
3. Check browser console for any warnings about fallback crypto usage

## What's Fixed

The authentication store now:
- ✅ **Supports both HTTP (development) and HTTPS (production)** environments
- ✅ **Uses fallback crypto implementation** when `crypto.subtle` is unavailable (HTTP contexts)
- ✅ **Includes proper error handling** with loading states and user feedback
- ✅ **Implements CSRF protection** using state parameters
- ✅ **Validates environment variables** before attempting authentication
- ✅ **Provides clear error messages** for debugging

## Development vs Production Behavior

### Development Mode (HTTP)
- Uses PKCE "plain" method (code_challenge = code_verifier)
- Shows warning in console about using plain method
- Still provides PKCE flow for OAuth2 compliance (less secure but valid)
- Environment detection shows "Development (HTTP)"

### Production Mode (HTTPS)
- Uses PKCE "S256" method with secure Web Crypto API (`crypto.subtle`)
- Full cryptographic security with SHA-256 hashing
- Environment detection shows "Production (HTTPS)"
