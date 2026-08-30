# Deploying Agent Zen Garden

Target stack: **Caddy** (reverse proxy + auto-HTTPS), **systemd** (process
management), **GitHub** (code delivery). Domain: `agentzen.garden`.

## 1. DNS

Point an `A` record for `agentzen.garden` at your VPS's public IP. Wait for it
to resolve before starting Caddy (Caddy needs it to issue the TLS cert).

```
dig +short agentzen.garden   # should return your VPS IP
```

## 2. First-time setup on the VPS

```bash
# Node 20+ (skip if already installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Chromium system libraries required by Puppeteer's bundled browser
sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpango-1.0-0 libcairo2 libatspi2.0-0

# Clone into /srv (matches the systemd unit's WorkingDirectory)
sudo mkdir -p /srv/agent-zen-garden
sudo chown "$USER":"$USER" /srv/agent-zen-garden
git clone https://github.com/ducks/agent-zen-garden.git /srv/agent-zen-garden
cd /srv/agent-zen-garden

# Install deps (this triggers Puppeteer's Chromium download into .cache/)
npm ci
```

## 3. systemd service

The unit file assumes user `deploy` and dir `/srv/agent-zen-garden`. Edit
`User=` if your VPS user differs.

```bash
sudo cp /srv/agent-zen-garden/deploy/agent-zen-garden.service \
        /etc/systemd/system/agent-zen-garden.service
# edit User= if needed:
sudo sed -i "s/^User=deploy/User=$USER/" /etc/systemd/system/agent-zen-garden.service

sudo systemctl daemon-reload
sudo systemctl enable --now agent-zen-garden
sudo systemctl status agent-zen-garden --no-pager
```

Logs: `journalctl -u agent-zen-garden -f`

## 4. Caddy

```bash
# Append the site block to your Caddyfile
cat /srv/agent-zen-garden/deploy/Caddyfile.snippet | sudo tee -a /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Visit https://agentzen.garden — Caddy issues the cert on first request.

## 5. Redeploy (after pushing new commits)

```bash
cd /srv/agent-zen-garden
git pull
npm ci                 # only if package-lock changed
sudo systemctl restart agent-zen-garden
```

## Verifying the WebMCP endpoint

```bash
curl https://agentzen.garden/.well-known/mcp.json
```

Tool endpoints in the manifest should show `https://agentzen.garden/...`
(the server trusts Caddy's `X-Forwarded-Proto` header).
