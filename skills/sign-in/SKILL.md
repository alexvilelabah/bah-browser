---
name: sign-in
description: When what the task needs is behind a sign-in, get the user signed in — they enter the password, never the agent.
states: [signin]
priority: 55
---
The page asks for a sign-in (a login form, a "Sign in to see…" wall, or a login page).
1. Does the task need the user's account? Yes when it names their own things ("my list", "my jobs", saved items, orders, inbox, recommendations) or when the content is hidden behind the sign-in. If not, close the prompt (popup-dismiss) and carry on without an account.
2. If yes and you are not on the login form yet, click the site's "Sign in" / "Log in" button once.
3. On the login form Bah pauses and asks the user to sign in (they can pick a login saved in Bah's password manager). Never type a password; never guess an email or username.
   If the user has a password-manager extension (LastPass, Bitwarden, 1Password), Bah first waits a few seconds for the extension's own auto-login and continues once you are signed in (a SIGN-IN line says so). Never click the extension's icon or menu in the field.
4. "Continue with Google/Apple" and two-step codes are the user's to complete too.
5. After they sign in, go back to what the task needed (e.g. the jobs page) and carry on.
6. Careful-mode sites (Bah says CAREFUL SITE) allow no clicking: tell the user to sign in by hand there.
