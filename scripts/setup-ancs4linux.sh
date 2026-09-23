#!/usr/bin/env bash
#
# setup-ancs4linux.sh
# Instala ancs4linux (servicios observer + advertising) en Debian 13.
# Pensado para usarse junto con la extension de GNOME "iphone-notify@fabarca",
# por eso NO instala el desktop-integration (evita notificaciones duplicadas).
#
# Uso:   sudo bash setup-ancs4linux.sh
#
set -euo pipefail

VENV=/opt/ancs4linux
SRC=/opt/ancs4linux/src
REPO=https://github.com/pzmarzly/ancs4linux

# --- Debe ejecutarse como root -------------------------------------------------
if [ "$(id -u)" != "0" ]; then
    echo "Ejecuta con sudo:  sudo bash setup-ancs4linux.sh" >&2
    exit 1
fi
REALUSER="${SUDO_USER:-root}"
echo ">> Usuario de escritorio: $REALUSER"

# --- 1. Grupo de acceso D-Bus --------------------------------------------------
echo ">> Creando grupo 'ancs4linux' y anadiendo a $REALUSER"
groupadd -f ancs4linux
usermod -a -G ancs4linux "$REALUSER"

# --- 2. Modo experimental de BlueZ --------------------------------------------
CONF=/etc/bluetooth/main.conf
echo ">> Activando Experimental=true en $CONF"
if grep -qE '^\s*Experimental\s*=\s*true' "$CONF"; then
    echo "   ya estaba activo."
else
    cp -n "$CONF" "${CONF}.bak.ancs4linux" || true
    if grep -qE '^\s*#?\s*Experimental\s*=' "$CONF"; then
        sed -i -E 's/^\s*#?\s*Experimental\s*=.*/Experimental = true/' "$CONF"
    else
        # Insertar justo despues de la primera aparicion de [General]
        awk 'BEGIN{done=0}
             {print}
             /^\[General\]/ && !done {print "Experimental = true"; done=1}' \
             "$CONF" > "${CONF}.tmp" && mv "${CONF}.tmp" "$CONF"
    fi
    echo "   hecho (copia de seguridad en ${CONF}.bak.ancs4linux)."
fi

# --- 3. Codigo fuente ----------------------------------------------------------
echo ">> Descargando ancs4linux en $SRC"
mkdir -p "$VENV"
if [ -d "$SRC/.git" ]; then
    git -C "$SRC" pull --ff-only || true
else
    rm -rf "$SRC"
    git clone --depth 1 "$REPO" "$SRC"
fi

# --- 4. Entorno virtual (usa el PyGObject del sistema) -------------------------
echo ">> Creando entorno virtual con --system-site-packages"
python3 -m venv --system-site-packages "$VENV/venv"
"$VENV/venv/bin/pip" install --upgrade pip >/dev/null
echo ">> Instalando ancs4linux (dasbus, typer) en el venv"
"$VENV/venv/bin/pip" install "$SRC"

OBS="$VENV/venv/bin/ancs4linux-observer"
ADV="$VENV/venv/bin/ancs4linux-advertising"
CTL="$VENV/venv/bin/ancs4linux-ctl"
for b in "$OBS" "$ADV" "$CTL"; do
    [ -x "$b" ] || { echo "ERROR: no se genero $b" >&2; exit 1; }
done
ln -sf "$CTL" /usr/local/bin/ancs4linux-ctl
echo ">> ancs4linux-ctl disponible en /usr/local/bin/ancs4linux-ctl"

# --- 5. Politicas D-Bus del bus de sistema ------------------------------------
echo ">> Instalando politicas D-Bus"
install -m 644 "$SRC/autorun/ancs4linux-observer.xml"    /etc/dbus-1/system.d/ancs4linux-observer.conf
install -m 644 "$SRC/autorun/ancs4linux-advertising.xml" /etc/dbus-1/system.d/ancs4linux-advertising.conf

# --- 6. Servicios systemd (ExecStart -> binarios del venv) --------------------
echo ">> Instalando servicios systemd"
cat > /etc/systemd/system/ancs4linux-observer.service <<EOF
[Unit]
Description=ancs4linux Observer daemon
Requires=bluetooth.service
After=bluetooth.service

[Service]
Type=dbus
BusName=ancs4linux.Observer
ExecStart=$OBS

[Install]
WantedBy=default.target
EOF

cat > /etc/systemd/system/ancs4linux-advertising.service <<EOF
[Unit]
Description=ancs4linux Advertising daemon
Requires=bluetooth.service
After=bluetooth.service

[Service]
Type=dbus
BusName=ancs4linux.Advertising
ExecStart=$ADV

[Install]
WantedBy=default.target
EOF

# --- 7. Arrancar --------------------------------------------------------------
echo ">> Recargando systemd y reiniciando servicios"
systemctl daemon-reload
systemctl restart bluetooth
sleep 1
systemctl enable --now ancs4linux-observer.service
systemctl enable --now ancs4linux-advertising.service

echo
echo "=================================================================="
echo " Instalacion completada."
echo
echo " IMPORTANTE: sal de la sesion y vuelve a entrar (o reinicia) para"
echo " que tu usuario '$REALUSER' entre en el grupo 'ancs4linux'. Sin eso"
echo " la extension no recibe las notificaciones por D-Bus."
echo
echo " Comprueba los servicios:"
echo "   systemctl status ancs4linux-observer ancs4linux-advertising"
echo
echo " Para emparejar el iPhone (tambien puedes usar el menu de la"
echo " extension -> 'Activar emparejamiento'):"
echo "   addr=\$(ancs4linux-ctl get-all-hci | jq -r '.[0]')"
echo "   ancs4linux-ctl enable-pairing"
echo "   ancs4linux-ctl enable-advertising --hci-address \$addr --name 'Debian PC'"
echo "   # luego en el iPhone: Ajustes > Bluetooth > 'Debian PC'"
echo "=================================================================="
