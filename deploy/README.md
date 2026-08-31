# Deploying Agent Zen Garden

Target stack: **Nix** (node + chromium via flake), **Caddy** (reverse proxy +
auto-HTTPS), **systemd** (process management). Domain: `agentzen.garden`.

## 1. DNS

An apex `A` record for `agentzen.garden` must point at the VPS IP before Caddy
can issue the TLS cert.

```
dig +short agentzen.garden   # should return the VPS IP
```

## 2. First-time setup on the VPS

Requires Nix with flakes (the Determinate Systems installer enables them):

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

git clone https://github.com/ducks/agent-zen-garden.git ~/services/agent-zen-garden
cd ~/services/agent-zen-garden

# Enter the flake shell (fetches node 22 + chromium) and install node deps.
# PUPPETEER_SKIP_DOWNLOAD is set by the flake, so npm won't fetch Chromium.
nix develop --command npm ci
```

## 3. systemd service

The unit runs the server inside `nix develop`, so node and chromium come from
the flake automatically. It assumes user `ducks` and `~/services/agent-zen-garden`.

```bash
sudo cp ~/services/agent-zen-garden/deploy/agent-zen-garden.service \
        /etc/systemd/system/agent-zen-garden.service

sudo systemctl daemon-reload
sudo systemctl enable --now agent-zen-garden
sudo systemctl status agent-zen-garden --no-pager
```

Logs: `journalctl -u agent-zen-garden -f`

## 4. Caddy

```bash
cat ~/services/agent-zen-garden/deploy/Caddyfile.snippet | sudo tee -a /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Visit https://agentzen.garden — Caddy issues the cert on first request.

## 5. Redeploy (after pushing new commits)

```bash
cd ~/services/agent-zen-garden
git pull
nix develop --command npm ci   # only if package-lock changed
sudo systemctl restart agent-zen-garden
```

## Verifying

```bash
curl https://agentzen.garden/.well-known/mcp.json
```

Tool endpoints should show `https://agentzen.garden/...` (the server trusts
Caddy's `X-Forwarded-Proto`).
