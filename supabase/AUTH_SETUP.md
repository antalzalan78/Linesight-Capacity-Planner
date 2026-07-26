# Secure Supabase authentication setup

1. In Supabase Authentication, enable the Email provider.
2. Add `https://antalzalan78.github.io/Linesight-Capacity-Planner/` to the allowed redirect URLs.
3. Keep the default Supabase confirmation/sign-in email. LineSight uses the link in that email and does not require a six-digit code.
4. Run `secure_auth_migration.sql` in the Supabase SQL Editor.
5. In Project Settings → API, copy only the Project URL and publishable key into the planner's Sync settings.
6. Sign in to LineSight once.
7. If a plan already exists, copy the signed-in user's UUID from Authentication → Users and run the ownership update shown at the bottom of the migration.
8. Enable automatic sync and push the plan once.

Never place a Supabase secret key or legacy service-role key in the browser or repository.
