#!/usr/bin/env bash
# Instala un servicio que reconecta automaticamente el iPhone para ancs4linux.
#
# Uso:   sudo bash setup-autoconnect.sh <MAC_DEL_IPHONE>
#   ej:  sudo bash setup-autoconnect.sh AA:BB:CC:11:22:33
#
# Puedes ver la MAC de tu iPhone (ya emparejado) con:
#   bluetoothctl devices | grep -i iphone
set -euo pipefail

# La MAC se pasa como argumento, o se define aqui.
DEV="${1:-${IPHONE_MAC:-}}"

if [ "$(id -u)" != "0" ]; then
    echo "Ejecuta con sudo:  sudo bash setup-autoconnect.sh <MAC_DEL_IPHONE>" >&2
    exit 1
fi

if [ -z "$DEV" ]; then
    echo "Falta la MAC del iPhone." >&2
    echo "Uso:  sudo bash setup-autoconnect.sh <MAC_DEL_IPHONE>" >&2
    echo "Verla con:  bluetoothctl devices | grep -i iphone" >&2
    exit 1
fi
echo ">> iPhone: $DEV"

# Script vigilante: si el iPhone no esta conectado, lo reconecta.
install -d /opt/ancs4linux
cat > /opt/ancs4linux/autoconnect.sh <<EOF
#!/usr/bin/env bash
DEV="$DEV"
while true; do
    if ! bluetoothctl info "\$DEV" 2>/dev/null | grep -q "Connected: yes"; then
        bluetoothctl connect "\$DEV" >/dev/null 2>&1 || true
    fi
    sleep 30
done
EOF
chmod +x /opt/ancs4linux/autoconnect.sh

# Marcar el iPhone como de confianza (ayuda a la reconexion automatica).
bluetoothctl trust "$DEV" >/dev/null 2>&1 || true

cat > /etc/systemd/system/ancs4linux-autoconnect.service <<EOF
[Unit]
Description=Auto-reconnect iPhone for ancs4linux
Requires=bluetooth.service
After=bluetooth.service ancs4linux-observer.service

[Service]
ExecStart=/opt/ancs4linux/autoconnect.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl daemon-reload
systemctl enable --now ancs4linux-autoconnect.service

echo
echo "Listo. El iPhone se reconectara solo cada vez que se caiga el enlace."
echo "Estado:  systemctl status ancs4linux-autoconnect"
