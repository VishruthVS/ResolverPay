{
  description = "Sui Intent Solver Development Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22   # Provides npm and node
            typescript  # For your solver logic
            nodePackages.typescript-language-server
          ];

          shellHook = ''
            echo "--- Sui Intent Solver Environment Loaded ---"
            echo "Node version: $(node -v)"
            echo "NPM version:  $(npm -v)"
          '';
        };
      });
}
