# Secure Supabase authentication setup

1. In Supabase Authentication, enable the Email provider.
2. Add `https://antalzalan78.github.io/Linesight-Capacity-Planner/` to the allowed redirect URLs.
3. Choose a sign-in method:
   - **Password (recommended, no email involved):** Authentication → Users → Add user → enter the email and a password and tick *Auto Confirm User*. Sign in with that email and password in LineSight.
   - **Email link:** keep the default Supabase sign-in email and use *Email me a sign-in link*. The built-in Supabase mailer is limited to a few messages per hour; configure custom SMTP under Authentication → Settings if you need more.
4. Run `secure_auth_migration.sql` in the Supabase SQL Editor.
5. In Project Settings → API, copy only the Project URL and publishable key into the planner's Sync settings.
6. Sign in to LineSight once.
7. If a plan already exists, copy the signed-in user's UUID from Authentication → Users and run the ownership update shown at the bottom of the migration.
8. Enable automatic sync and push the plan once.

Never place a Supabase secret key or legacy service-role key in the browser or repository.
