# Domain Configuration and HTTPS

Master spec §60 lists "Domain configuration" and "HTTPS" as their own steps
in the deploy sequence, after "Application deployment." Per §59, this app
does not hard-code any specific hosting provider, so the exact steps below
vary by host — this document covers the general pattern plus the
self-hosted fallback.

## If using a platform with managed domains/TLS (recommended)

Most modern hosts (Vercel, Railway, Fly.io, Render, and similar) handle
both domain binding and certificate provisioning/renewal for you once DNS
is pointed correctly:

1. Add the custom domain in the host's dashboard/CLI.
2. The host gives you a DNS target — typically either a CNAME record (for
   a subdomain like `app.example.com`) or an A/AAAA record pair (for a
   root/apex domain, since CNAMEs aren't valid at the zone apex per DNS
   spec).
3. Add that record at your domain registrar / DNS provider.
4. Wait for DNS propagation (usually minutes, can take up to ~48 hours
   depending on TTLs and registrar).
5. The host automatically provisions a TLS certificate (typically via Let's
   Encrypt) once it can verify domain ownership through the DNS record —
   no manual certificate handling needed.
6. Update `APP_URL` to the final `https://` domain (see
   `production-checklist.md` step 3) and redeploy if it wasn't already set
   to this value.

This is the recommended path — it eliminates certificate renewal as an
ongoing operational burden entirely.

## Self-hosted (a plain VM, or a Kubernetes cluster without a managed
   ingress/cert-manager already handling this)

If deploying the `Dockerfile` image directly onto infrastructure with no
built-in domain/TLS handling:

1. Point your domain's A/AAAA record at the host's public IP.
2. Run a reverse proxy in front of the app container (nginx, Caddy, or
   Traefik are all common choices — none is prescribed by this codebase,
   consistent with §59's provider-agnostic requirement) that:
   - Terminates TLS.
   - Proxies to the app container's internal port (`3000` by default per
     `Dockerfile`'s `EXPOSE`).
   - Forwards `X-Forwarded-Proto`/`X-Forwarded-For` headers so the app can
     tell it's being served over HTTPS if it ever needs to (Next.js itself
     doesn't require this for basic operation, but some libraries do).
3. Obtain a certificate. **Caddy** does this automatically (Let's Encrypt,
   zero config beyond pointing it at your domain). With **nginx**, use
   `certbot` (the standard ACME client for Let's Encrypt) to obtain and
   auto-renew a certificate, then reference it in the nginx TLS config.
4. Confirm auto-renewal is actually scheduled (`certbot`'s installer
   typically sets up a systemd timer or cron job for this — verify it
   exists rather than assuming) — an expired certificate silently taking
   down HTTPS is one of the most common self-inflicted outages in this
   category of setup.

## Verifying HTTPS is correctly in front of the app

Once traffic is flowing through HTTPS:

```bash
curl -sI https://<your-domain>/ | grep -i strict-transport-security
```

should show the `Strict-Transport-Security` header from
`next.config.js`'s `SECURITY_HEADERS` (Phase 15 hardening) — that header
only has any effect once real HTTPS is in place; it's a no-op over plain
HTTP.

Also confirm plain HTTP either redirects to HTTPS or is not reachable at
all (most managed platforms and Caddy do this automatically; an nginx/
certbot setup typically needs an explicit `return 301 https://$host$request_uri;`
server block for port 80).
