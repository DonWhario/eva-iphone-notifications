# EVA — iPhone Notifications for GNOME (Linux)

Muestra en tu escritorio **GNOME/Linux** las notificaciones y mensajes que llegan
a tu **iPhone**, recibidos por **Bluetooth LE** mediante el servicio **ANCS** de
Apple (Apple Notification Center Service). Sin jailbreak.

Añade un **icono de sobre** en la barra superior (sobre cerrado sin mensajes,
sobre abierto con contador cuando hay), un **modo No molestar**, **sonido de
alerta** configurable y la posibilidad de mostrar los mensajes como
**notificación del sistema** o como una **ventana propia con posición y duración
configurables**.

> Probado en **Debian 13 (Trixie) + GNOME Shell 48** con un **iPhone 11**.
> Compatible con GNOME Shell 45–48.

---

## ¿Cómo funciona?

```
 iPhone  ──Bluetooth LE (ANCS)──▶  ancs4linux (observer)  ──D-Bus──▶  Extensión EVA (GNOME Shell)
                                   [servicio de sistema]              [icono + banner + centro de notif.]
```

- **[ancs4linux](https://github.com/pzmarzly/ancs4linux)** habla con el iPhone por
  Bluetooth y publica cada notificación como la señal D-Bus
  `ancs4linux.Observer.ShowNotification` (bus de sistema).
- **La extensión EVA** escucha esa señal y muestra el mensaje en el escritorio.

La extensión es solo la **interfaz**; la fuente de las notificaciones es
`ancs4linux`.

---

## Funciones

- ✉️ Indicador de sobre en la barra superior: **cerrado** sin mensajes,
  **abierto + número** con mensajes pendientes.
- 🔔 Banner al llegar un mensaje, con la fuente **"EVA"**, integrado en el
  **centro de notificaciones** del sistema.
- 🪟 **Ventana propia** opcional, independiente del sistema, con **posición**
  (9 combinaciones) y **duración** configurables.
- 🌙 **No molestar** (suprime banner y sonido; sigue contando).
- 🔊 **Sonido de alerta** configurable (sonido del sistema o archivo propio).
- 🧹 Contador que se purga solo a las **3 horas**.
- 🎛️ Filtros por **dispositivo** y por **app**; muestra el dispositivo conectado
  ("Conectado a: …") consultando BlueZ.

---

## Requisitos

- GNOME Shell 45–48.
- BlueZ 5.x con **modo experimental** activado.
- Adaptador Bluetooth 4.0+ (LE). Los adaptadores **Intel** funcionan de forma
  fiable; en otros chipsets (Realtek, algunos MediaTek, dongles USB baratos) el
  *bonding* BLE que pide iOS puede fallar.
- Python 3.10+ con `python3-venv` y `python3-gi` (PyGObject ≥ 3.50).

---

## Instalación

### 1. ancs4linux (la fuente de las notificaciones)

```bash
sudo bash scripts/setup-ancs4linux.sh
```

Este script (para Debian/derivadas):

- Crea el grupo `ancs4linux` y te añade a él.
- Activa `Experimental = true` en `/etc/bluetooth/main.conf`.
- Crea un venv en `/opt/ancs4linux` reutilizando el PyGObject del sistema
  (solo instala `dasbus` y `typer`, sin compilar).
- Instala **solo** los servicios `ancs4linux-observer` y
  `ancs4linux-advertising` (no el desktop-integration: lo reemplaza la
  extensión, así no hay notificaciones duplicadas).

**Cierra sesión y vuelve a entrar** después (para entrar en el grupo
`ancs4linux`).

### 2. Emparejar el iPhone

```bash
addr=$(ancs4linux-ctl get-all-hci | jq -r '.[0]')
ancs4linux-ctl enable-pairing
ancs4linux-ctl enable-advertising --hci-address "$addr" --name 'Debian PC'
```

Luego en el iPhone: **Ajustes → Bluetooth → "Debian PC"**, confirma el código y
**permite mostrar notificaciones**.

### 3. La extensión EVA

```bash
./install.sh
```

Recarga GNOME Shell (**Xorg**: `Alt`+`F2` → `r`; **Wayland**: cierra sesión y
entra) y ábrela con:

```bash
gnome-extensions prefs iphone-notify@fabarca
```

### 4. (Opcional) Reconexión automática

iOS corta el enlace BLE cuando el teléfono está inactivo. Este servicio lo
reconecta solo:

```bash
sudo bash scripts/setup-autoconnect.sh <MAC_DEL_IPHONE>
# La MAC:  bluetoothctl devices | grep -i iphone
```

---

## Configuración (Preferencias)

- **Conexión:** dirección del iPhone (filtro), adaptador HCI, nombre visible.
- **Mensajes:** filtro de apps (vacío = todas), vista previa on/off.
- **Notificaciones:** No molestar, sonido, sonido personalizado.
- **Aparición en pantalla:** notificación del sistema **o** ventana propia;
  posición (arriba/centro/abajo × izquierda/centro/derecha) y duración.

---

## Notas de uso

- iOS solo reenvía por ANCS las notificaciones de apps con **notificaciones
  activadas** y que **no estén en primer plano** en ese momento.
- En **Wayland**, para recargar la extensión tras actualizarla, cierra sesión y
  vuelve a entrar (`Alt`+`F2` → `r` solo funciona en Xorg).
- Si dejan de llegar mensajes: reconecta el iPhone
  (`bluetoothctl connect <MAC>`) o reinicia el observer con el teléfono ya
  conectado (`sudo systemctl restart ancs4linux-observer`).

---

## Créditos

- **[ancs4linux](https://github.com/pzmarzly/ancs4linux)** de Paweł Zmarzły
  (GPL-2.0-or-later) — hace posible recibir ANCS en Linux.
- Extensión EVA y scripts de este repositorio.

## Licencia

GPL-3.0-or-later. Ver [LICENSE](LICENSE).
