/**
 * App-level feature flags.
 *
 * NEXT_PUBLIC_USE_MOCK_AUTH=true   → localStorage auth (demo, no backend needed)
 * NEXT_PUBLIC_USE_MOCK_AUTH=false  → real Express backend auth
 *
 * NEXT_PUBLIC_USE_MOCK_DATA=true   → localStorage data (demo, no backend needed)
 * NEXT_PUBLIC_USE_MOCK_DATA=false  → real Express backend API calls
 *
 * Set both to false + run the backend to use the full production stack.
 */
export const USE_MOCK_AUTH = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_USE_MOCK_AUTH === 'true';
export const USE_MOCK_DATA = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
