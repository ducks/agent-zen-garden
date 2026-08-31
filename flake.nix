{
  description = "Agent Zen Garden — WebMCP web design server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodejs = pkgs.nodejs_22;
        chromium = pkgs.chromium;
      in
      {
        # `nix develop` — dev shell with node + chromium on PATH.
        devShells.default = pkgs.mkShell {
          buildInputs = [ nodejs chromium ];
          shellHook = ''
            export PUPPETEER_SKIP_DOWNLOAD=1
            export PUPPETEER_EXECUTABLE_PATH="${chromium}/bin/chromium"
            echo "Agent Zen Garden dev shell — node $(node --version), chromium at $PUPPETEER_EXECUTABLE_PATH"
          '';
        };

        # `nix run` — start the server directly.
        apps.default = {
          type = "app";
          program = toString (pkgs.writeShellScript "agent-zen-garden" ''
            export PUPPETEER_SKIP_DOWNLOAD=1
            export PUPPETEER_EXECUTABLE_PATH="${chromium}/bin/chromium"
            export PATH="${nodejs}/bin:$PATH"
            cd "$(dirname "$(readlink -f "$0")")" 2>/dev/null || true
            exec ${nodejs}/bin/node src/server.js
          '');
        };

        # Expose paths so the systemd unit can reference them.
        packages.chromium = chromium;
        packages.nodejs = nodejs;
      });
}
