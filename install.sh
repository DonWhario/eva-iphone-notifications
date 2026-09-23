#!/usr/bin/env bash
# Instala la extension de GNOME Shell "EVA - iPhone Notifications" en el usuario.
set -e

UUID="iphone-notify@fabarca"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo ">> Compilando esquema de GSettings…"
glib-compile-schemas "$SRC/schemas/"

echo ">> Copiando a $DEST"
mkdir -p "$DEST"
cp -r "$SRC/metadata.json" "$SRC/extension.js" "$SRC/prefs.js" \
      "$SRC/stylesheet.css" "$SRC/schemas" "$SRC/icons" "$DEST/"

echo ">> Habilitando la extension…"
gnome-extensions enable "$UUID" 2>/dev/null || true

echo
echo "Listo. Recarga GNOME Shell:"
echo "  - Xorg:    Alt+F2, escribe 'r' y Enter."
echo "  - Wayland: cierra sesion y vuelve a entrar."
echo
echo "Abre las preferencias con:  gnome-extensions prefs $UUID"
echo "IMPORTANTE: necesitas ademas 'ancs4linux' (ver scripts/ y README.md)."
