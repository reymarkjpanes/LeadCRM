## Status: RESOLVED

**Fix applied:** `frontend/middleware.ts` and `frontend/src/shared/providers/auth-guard.tsx`

- **Middleware:** `/settings` added to `isCompletionExempt` — Google OAuth users with `requiresProfileCompletion: true` are no longer redirected to `/onboarding` when navigating to `/settings` or any `/settings/*` sub-route.
- **AuthGuard:** Removed unused `nextAuthSession?.requiresProfileCompletion` dep from `useEffect` and the `useSession()` hook call. Routing after OAuth profile completion is handled by `company-setup/page.tsx` directly via `router.push('/dashboard')` after `updateSession()`.

All 7 acceptance criteria satisfied. `npm run lint` passes.

---

# Bugfix Requirements Document

## Introduction

Clicking "Workspace Settings" in the user profile dropdown redirects Google OAuth users to `/onboarding` instead of rendering the `/settings` page. This occurs because the Next.js Edge Middleware profile-completion gate treats `/settings` as a standard protected route and redirects incomplete-profile users away from it. The `/settings` route should be exempt from this redirect since users need access to workspace configuration regardless of profile completion status.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to `/settings` THEN the system redirects them to `/onboarding` instead of rendering the settings page

1.2 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to any `/settings/*` sub-route THEN the system redirects them to `/onboarding` instead of rendering the settings sub-page

### Expected Behavior (Correct)

2.1 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to `/settings` THEN the system SHALL render the settings page without redirecting

2.2 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to any `/settings/*` sub-route THEN the system SHALL render the settings sub-page without redirecting

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to `/dashboard` THEN the system SHALL CONTINUE TO redirect them to `/onboarding`

3.2 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to `/contacts` THEN the system SHALL CONTINUE TO redirect them to `/onboarding`

3.3 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to `/onboarding` THEN the system SHALL CONTINUE TO render the onboarding page without redirecting

3.4 WHEN a Google OAuth user with `requiresProfileCompletion: true` navigates to `/company-setup` THEN the system SHALL CONTINUE TO render the company-setup page without redirecting

3.5 WHEN a Google OAuth user with `requiresProfileCompletion: false` (completed profile) navigates to `/settings` THEN the system SHALL CONTINUE TO render the settings page normally

3.6 WHEN a non-Google-OAuth user (credentials login) navigates to `/settings` THEN the system SHALL CONTINUE TO render the settings page normally (middleware does not apply to non-NextAuth sessions)

3.7 WHEN mock auth mode is enabled (`NEXT_PUBLIC_USE_MOCK_AUTH !== 'false'`) THEN the system SHALL CONTINUE TO bypass the middleware entirely regardless of route
