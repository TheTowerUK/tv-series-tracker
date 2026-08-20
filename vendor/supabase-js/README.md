# Vendored Supabase JavaScript client

- Package: `@supabase/supabase-js`
- Version: `2.112.3`
- Source: npm registry package `@supabase/supabase-js@2.112.3`
- npm integrity: `sha512-Jv1bxVQmEJNkjvPEhFaKjPzsh+Ozyew6lWGD+SoYcsclDEP1z7yEvKvfUQfzy0DkxRIQnZNxmmWtAzw5XLTQoA==`
- Vendored file: `2.112.3/supabase.js` from `dist/umd/supabase.js`
- Vendored-file SHA-256: `10e9e53b8072b680dba9be76a58063b7fabd9f888552d7579465c6027296f42a`

The vendored file differs from the npm UMD text only by removal of trailing whitespace so the repository passes `git diff --check`. The versioned browser build avoids a runtime CDN dependency and does not add a frontend bundler. Upgrade it only as an explicit reviewed dependency change: obtain the exact npm package, normalize trailing whitespace, replace the versioned asset and license, update this record and the script path, and rerun the browser-foundation tests.
