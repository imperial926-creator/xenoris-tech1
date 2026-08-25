import dotenv from 'dotenv';

// Integration tests need DATABASE_URL pointed at the *test* database, never
// the dev database. See tests/README.md for the exact setup command.
dotenv.config({ path: '.env.test' });
