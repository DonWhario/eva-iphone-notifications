#!/usr/bin/env bash
# Evita el parpadeo de los iconos del systray causado por el reproductor AVRCP
# del iPhone. Cuando el iPhone esta conectado (para ANCS) tambien expone un
# reproductor multimedia (AVRCP) que iOS registra/de-registra en bucle; eso hace
# que GNOME redibuje sus widgets -> parpadeo.
#
# Este instalador crea un servicio de USUARIO (sin sudo) que, cada vez que
# aparece ese reproductor, desconecta SOLO el perfil AVRCP del iPhone. Se
# mantienen intactos:
#   - la conexion BLE/ANCS del iPhone (las notificaciones), y
#   - los controles multimedia de otros equipos (p.ej. auriculares) via
#     mpris-proxy.
#
# Uso:   bash setup-iphone-noavrcp.sh <MAC_DEL_IPHONE>
#   ej:  bash setup-iphone-noavrcp.sh AA:BB:CC:11:22:33
# La MAC:  bluetoothctl devices | grep -i iphone
#
# Revertir:  systemctl --user disable --now iphone-noavrcp.service
set -euo pipefail

MAC="${1:-${IPHONE_MAC:-}}"
if [ -z "$MAC" ]; then
    echo "Falta la MAC del iPhone." >&2
    echo "Uso:  bash setup-iphone-noavrcp.sh <MAC_DEL_IPHONE>" >&2
    echo "Verla con:  bluetoothctl devices | grep -i iphone" >&2
    exit 1
fi
MAC_UP="$(echo "$MAC" | tr '[:lower:]' '[:upper:]')"
DEV_TAG="dev_$(echo "$MAC_UP" | tr ':' '_')"
echo ">> iPhone: $MAC_UP  ($DEV_TAG)"

mkdir -p "$HOME/.local/bin" "$HOME/.config/systemd/user"

# --- Script vigilante (estatico; recibe el DEV_TAG como argumento) ------------
cat > "$HOME/.local/bin/iphone-noavrcp.sh" <<'SCRIPT'
#!/usr/bin/env bash
# Suprime el reproductor AVRCP del iPhone para evitar el parpadeo del systray.
# Uso interno:  iphone-noavrcp.sh dev_AA_BB_CC_DD_EE_FF
set -u
DEV_TAG="${1:?uso: iphone-noavrcp.sh dev_AA_BB_CC_DD_EE_FF}"
AVRCP_UUID="0000110e-0000-1000-8000-00805f9b34fb"   # A/V Remote Control

drop() {
    gdbus call --system --dest org.bluez \
        --object-path "/org/bluez/hci0/$DEV_TAG" \
        --method org.bluez.Device1.DisconnectProfile "$AVRCP_UUID" \
        >/dev/null 2>&1 || true
}

drop   # por si el reproductor ya existe al arrancar

last=0
gdbus monitor --system --dest org.bluez 2>/dev/null | while read -r line; do
    case "$line" in
        *"$DEV_TAG"*player*|*"$DEV_TAG"*MediaControl1*)
            now=$(date +%s)
            [ $((now - last)) -lt 2 ] && continue   # anti-rebote
            last=$now
            sleep 1
            drop
            ;;
    esac
done
SCRIPT
chmod +x "$HOME/.local/bin/iphone-noavrcp.sh"

# --- Servicio de usuario ------------------------------------------------------
cat > "$HOME/.config/systemd/user/iphone-noavrcp.service" <<UNIT
[Unit]
Description=Suprime el reproductor AVRCP del iPhone (evita parpadeo del systray)
After=bluetooth.target

[Service]
ExecStart=%h/.local/bin/iphone-noavrcp.sh $DEV_TAG
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now iphone-noavrcp.service

echo
echo "Listo. Estado: $(systemctl --user is-active iphone-noavrcp.service)"
echo "Revertir con:  systemctl --user disable --now iphone-noavrcp.service"
echo
echo "Nota: asume el adaptador 'hci0' (lo habitual). Si el tuyo es otro,"
echo "edita la ruta en ~/.local/bin/iphone-noavrcp.sh."
