/* extension.js
 * iPhone Notifications - GNOME Shell 45+ (ESM)
 *
 * Escucha las notificaciones que ancs4linux publica en D-Bus (senal
 * ShowNotification del servicio ancs4linux.Observer) y las muestra en el
 * escritorio. Anade un indicador de sobre en la barra superior con contador,
 * modo No molestar, sonido de alerta y opciones de configuracion.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const SOURCE_NAME = 'EVA';

const OBSERVER_NAME = 'ancs4linux.Observer';
const OBSERVER_PATH = '/';
const OBSERVER_IFACE = 'ancs4linux.Observer';

const ADVERTISING_NAME = 'ancs4linux.Advertising';
const ADVERTISING_PATH = '/';
const ADVERTISING_IFACE = 'ancs4linux.Advertising';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('iPhone Notifications'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._messages = [];
        this._source = null;
        this._banners = [];
        this._connected = false;
        this._signalId = 0;
        this._watchId = 0;

        this._iconClosed = Gio.icon_new_for_string(
            extension.path + '/icons/envelope-closed-symbolic.svg');
        this._iconOpen = Gio.icon_new_for_string(
            extension.path + '/icons/envelope-open-symbolic.svg');

        // ---- Barra superior: sobre + contador -------------------------------
        const box = new St.BoxLayout({style_class: 'inm-box'});
        this._icon = new St.Icon({
            gicon: this._iconClosed,
            style_class: 'system-status-icon',
        });
        this._badge = new St.Label({
            style_class: 'inm-badge',
            text: '0',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(this._icon);
        box.add_child(this._badge);
        this.add_child(box);

        this._buildMenu();
        this._subscribeSignal();
        this._watchService();
        this._updateVisual();
        this._refreshStatus();

        // Limpieza periodica: borra mensajes con mas de 3 horas (cada 5 min).
        this._pruneTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 300, () => {
                if (this._pruneOld())
                    this._updateVisual();
                return GLib.SOURCE_CONTINUE;
            });
    }

    // ------------------------------------------------------------------ menu
    _buildMenu() {
        // Estado de conexion
        this._statusItem = new PopupMenu.PopupMenuItem(_('Buscando dispositivo…'), {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Los mensajes NO se listan en el menu: quedan solo en las
        // notificaciones del sistema. Al abrir el menu se refresca el estado y
        // se purga el contador de los que superen las 3 horas.
        this.menu.connect('open-state-changed', (menu, open) => {
            if (!open)
                return;
            this._refreshStatus();
            if (this._pruneOld())
                this._updateVisual();
        });

        // No molestar (enlazado al ajuste)
        this._dndItem = new PopupMenu.PopupSwitchMenuItem(
            _('No molestar'), this._settings.get_boolean('dnd'));
        this._dndItem.connect('toggled', (item, state) => {
            this._settings.set_boolean('dnd', state);
        });
        this.menu.addMenuItem(this._dndItem);

        // Sonido de alerta (enlazado al ajuste)
        this._soundItem = new PopupMenu.PopupSwitchMenuItem(
            _('Sonido de alerta'), this._settings.get_boolean('sound-enabled'));
        this._soundItem.connect('toggled', (item, state) => {
            this._settings.set_boolean('sound-enabled', state);
        });
        this.menu.addMenuItem(this._soundItem);

        // Reflejar cambios hechos desde Preferencias
        this._settingsChangedId = this._settings.connect('changed', (s, key) => {
            if (key === 'dnd')
                this._dndItem.setToggleState(s.get_boolean('dnd'));
            else if (key === 'sound-enabled')
                this._soundItem.setToggleState(s.get_boolean('sound-enabled'));
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Marcar como leidas
        this._readItem = new PopupMenu.PopupMenuItem(_('Marcar como leidas'));
        this._readItem.connect('activate', () => this._resetCount());
        this.menu.addMenuItem(this._readItem);

        // Emparejar un dispositivo NUEVO (no hace falta para el ya conectado)
        const advItem = new PopupMenu.PopupMenuItem(_('Emparejar dispositivo nuevo…'));
        advItem.connect('activate', () => this._enableAdvertising());
        this.menu.addMenuItem(advItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Preferencias
        const prefsItem = new PopupMenu.PopupMenuItem(_('Preferencias…'));
        prefsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefsItem);
    }

    // ------------------------------------------------------- D-Bus: senales
    _subscribeSignal() {
        // ancs4linux corre normalmente como servicio de sistema (habla con BlueZ).
        this._signalId = Gio.DBus.system.signal_subscribe(
            null,                 // sender
            OBSERVER_IFACE,       // interface
            'ShowNotification',   // signal
            null,                 // object path (cualquiera)
            null,                 // arg0
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                this._onNotification(params);
            });
    }

    _watchService() {
        this._watchId = Gio.bus_watch_name_on_connection(
            Gio.DBus.system,
            OBSERVER_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => { this._connected = true; this._refreshStatus(); },
            () => { this._connected = false; this._refreshStatus(); });
    }

    // Consulta a BlueZ el dispositivo movil conectado (preferentemente el que
    // expone el servicio ANCS) y actualiza la etiqueta de estado.
    _refreshStatus() {
        Gio.DBus.system.call(
            'org.bluez', '/', 'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects', null,
            new GLib.VariantType('(a{oa{sa{sv}}})'),
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                let deviceName = null;
                try {
                    const [objects] = conn.call_finish(res).recursiveUnpack();
                    for (const path in objects) {
                        const dev = objects[path]['org.bluez.Device1'];
                        if (!dev || !dev.Connected)
                            continue;
                        const uuids = dev.UUIDs || [];
                        const isAncs = uuids.some(
                            u => `${u}`.toLowerCase().startsWith('7905f431'));
                        const nm = dev.Alias || dev.Name || _('dispositivo');
                        if (isAncs) {
                            deviceName = nm;
                            break;
                        }
                        if (!deviceName)
                            deviceName = nm;
                    }
                } catch (e) {
                    // BlueZ no accesible: se cae al estado por servicio.
                }
                this._setStatus(deviceName);
            });
    }

    _setStatus(deviceName) {
        if (!this._statusItem)
            return;
        if (deviceName)
            this._statusItem.label.text = _('Conectado a: %s').format(deviceName);
        else if (this._connected)
            this._statusItem.label.text = _('Sin dispositivo conectado');
        else
            this._statusItem.label.text =
                _('Sin conexion (ancs4linux no activo)');
    }

    // ----------------------------------------------------- notificacion nueva
    _onNotification(params) {
        let data = {};
        try {
            const [jsonStr] = params.deepUnpack();
            data = JSON.parse(jsonStr);
        } catch (e) {
            logError(e, 'iphone-notify: no se pudo leer la notificacion');
            return;
        }

        // Campos segun ancs4linux ShowNotificationData:
        // device_name, device_handle, app_id, app_name, id, title, body
        const appName = data.app_name || data.app_id || '';
        const title = data.title || appName || _('Mensaje');
        const body = data.body || '';
        const deviceHay = ((data.device_handle || '') + ' ' +
                           (data.device_name || '')).toLowerCase();

        // Filtro por dispositivo (coincidencia por nombre o direccion)
        const wantDev = this._settings.get_string('device-address').trim();
        if (wantDev && deviceHay.trim() &&
            !deviceHay.includes(wantDev.toLowerCase()))
            return;

        // Filtro por aplicacion
        const appFilter = this._settings.get_string('app-filter').trim();
        if (appFilter) {
            const terms = appFilter.split(',')
                .map(t => t.trim().toLowerCase()).filter(t => t.length);
            const hay = (appName + ' ' + (data.app_id || '')).toLowerCase();
            if (terms.length && !terms.some(t => hay.includes(t)))
                return;
        }

        // Guardar el mensaje en la lista de pendientes (tambien en No molestar)
        this._addMessage(appName, title, body);
        this._updateVisual();

        // Modo No molestar: no banner, no sonido (pero queda en la lista)
        if (this._settings.get_boolean('dnd'))
            return;

        this._showBanner(title, body, appName);
        this._playSound();
    }

    _ensureSource() {
        if (this._source)
            return this._source;
        this._source = new MessageTray.Source({
            title: SOURCE_NAME,
            icon: this._iconOpen,
        });
        this._source.connect('destroy', () => {
            this._source = null;
        });
        Main.messageTray.add(this._source);
        return this._source;
    }

    _showBanner(title, body, appName) {
        let heading = title;
        let text;
        if (this._settings.get_boolean('show-preview')) {
            text = body || appName;
        } else {
            heading = appName || _('iPhone');
            text = _('Nuevo mensaje');
        }
        if (this._settings.get_string('banner-mode') === 'custom')
            this._showCustomBanner(heading, text);
        else
            this._postNotification(heading, text);
    }

    // Crea una notificacion en la fuente propia "EVA", de modo que aparezca
    // (con ese nombre) como banner del sistema y en el centro de
    // notificaciones.
    _postNotification(heading, text) {
        const source = this._ensureSource();
        const notification = new MessageTray.Notification({
            source,
            title: heading,
            body: text || '',
            gicon: this._iconOpen,
        });
        source.addNotification(notification);
    }

    // -------------------------------------------------- ventana propia (toast)
    // Notificacion dibujada por la extension, independiente del sistema, con
    // posicion y duracion configurables.
    _showCustomBanner(heading, text) {
        const box = new St.BoxLayout({
            style_class: 'eva-banner',
            reactive: true,
            track_hover: true,
            opacity: 0,
        });
        const icon = new St.Icon({
            gicon: this._iconOpen,
            style_class: 'eva-banner-icon',
            icon_size: 30,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const textBox = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'eva-banner-text',
        });
        const clip = s => (s && s.length > 90 ? s.slice(0, 87) + '…' : (s || ''));
        textBox.add_child(new St.Label({
            text: clip(heading),
            style_class: 'eva-banner-title',
        }));
        if (text) {
            textBox.add_child(new St.Label({
                text: clip(text),
                style_class: 'eva-banner-body',
            }));
        }
        box.add_child(icon);
        box.add_child(textBox);

        // Tocar la ventana la cierra.
        box.connect('button-press-event', () => {
            this._removeBanner(box);
            return Clutter.EVENT_STOP;
        });

        Main.layoutManager.addTopChrome(box);
        this._banners.push(box);
        this._reflowBanners();
        box.ease({opacity: 255, duration: 200});

        let secs = this._settings.get_int('banner-timeout');
        if (secs <= 0)
            secs = 6;
        box._evaTimeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, secs, () => {
                box._evaTimeout = 0;
                this._removeBanner(box);
                return GLib.SOURCE_REMOVE;
            });
    }

    _removeBanner(box) {
        const i = this._banners.indexOf(box);
        if (i < 0)
            return;
        this._banners.splice(i, 1);
        if (box._evaTimeout) {
            GLib.source_remove(box._evaTimeout);
            box._evaTimeout = 0;
        }
        box.ease({
            opacity: 0,
            duration: 200,
            onComplete: () => box.destroy(),
        });
        this._reflowBanners();
    }

    _reflowBanners() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const pos = this._settings.get_string('banner-position');
        const margin = 24;
        const gap = 8;
        const isTop = pos.startsWith('top');
        const isBottom = pos.startsWith('bottom');
        const panelH = isTop ? Main.panel.height : 0;
        let offset = 0;
        for (const box of this._banners) {
            const [, natW] = box.get_preferred_width(-1);
            const [, natH] = box.get_preferred_height(natW);
            let x;
            if (pos.endsWith('left'))
                x = m.x + margin;
            else if (pos.endsWith('right'))
                x = m.x + m.width - natW - margin;
            else
                x = m.x + Math.floor((m.width - natW) / 2);
            let y;
            if (isTop)
                y = m.y + panelH + margin + offset;
            else if (isBottom)
                y = m.y + m.height - margin - natH - offset;
            else
                y = m.y + Math.floor((m.height - natH) / 2) + offset;
            box.set_position(Math.round(x), Math.round(y));
            offset += natH + gap;
        }
    }

    _playSound() {
        if (!this._settings.get_boolean('sound-enabled'))
            return;
        let player;
        try {
            player = global.display.get_sound_player();
        } catch (e) {
            return;
        }
        const file = this._settings.get_string('sound-file').trim();
        try {
            if (file) {
                player.play_from_file(
                    Gio.File.new_for_path(file), 'iphone-message', null);
            } else {
                player.play_from_theme(
                    'message-new-instant', 'iphone-message', null);
            }
        } catch (e) {
            logError(e, 'iphone-notify: no se pudo reproducir el sonido');
        }
    }

    // --------------------------------------------------------- mensajes/estado
    _addMessage(app, title, body) {
        const now = GLib.DateTime.new_now_local();
        this._messages.unshift({
            app: app || _('iPhone'),
            title,
            body,
            time: now.format('%H:%M'),
            ts: Date.now(),
        });
        const MAX = 50;
        if (this._messages.length > MAX)
            this._messages.length = MAX;
    }

    // Elimina de la lista los mensajes con mas de 3 horas. Devuelve true si
    // hubo cambios.
    _pruneOld() {
        const cutoff = Date.now() - 3 * 60 * 60 * 1000;
        const before = this._messages.length;
        this._messages = this._messages.filter(m => m.ts >= cutoff);
        return this._messages.length !== before;
    }

    _resetCount() {
        this._messages = [];
        this._updateVisual();
    }

    _updateVisual() {
        const n = this._messages.length;
        if (n > 0) {
            this._icon.gicon = this._iconOpen;
            this._badge.text = n > 99 ? '99+' : String(n);
            this._badge.visible = true;
        } else {
            this._icon.gicon = this._iconClosed;
            this._badge.visible = false;
        }
        if (this._readItem) {
            this._readItem.label.text = n > 0
                ? _('Marcar como leidas (%d)').format(n)
                : _('Marcar como leidas');
            this._readItem.setSensitive(n > 0);
        }
    }

    // --------------------------------------------------- advertising (pairing)
    _enableAdvertising() {
        const name = this._settings.get_string('advertise-name').trim() ||
            'Debian PC';
        const hci = this._settings.get_string('hci-address').trim();
        if (hci) {
            this._doAdvertising(hci, name);
            return;
        }
        // Sin HCI configurado: pedir el primero a ancs4linux (GetAllHci).
        Gio.DBus.system.call(
            ADVERTISING_NAME, ADVERTISING_PATH, ADVERTISING_IFACE,
            'GetAllHci', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    const [list] = conn.call_finish(res).deepUnpack();
                    if (list && list.length) {
                        this._doAdvertising(list[0], name);
                    } else {
                        Main.notify(_('iPhone Notifications'),
                            _('No se encontro ningun adaptador Bluetooth.'));
                    }
                } catch (e) {
                    Main.notify(_('iPhone Notifications'),
                        _('ancs4linux no responde. ¿Esta instalado y activo? (%s)')
                            .format(e.message));
                }
            });
    }

    _doAdvertising(hci, name) {
        // Activar emparejamiento y luego el advertising.
        Gio.DBus.system.call(
            ADVERTISING_NAME, ADVERTISING_PATH, ADVERTISING_IFACE,
            'EnablePairing', null, null,
            Gio.DBusCallFlags.NONE, -1, null, null);
        Gio.DBus.system.call(
            ADVERTISING_NAME, ADVERTISING_PATH, ADVERTISING_IFACE,
            'EnableAdvertising',
            new GLib.Variant('(ss)', [hci, name]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                    Main.notify(_('iPhone Notifications'),
                        _('Emparejamiento activado (puede tardar ~30 s). Busca "%s" en el Bluetooth del iPhone.')
                            .format(name));
                } catch (e) {
                    Main.notify(_('iPhone Notifications'),
                        _('No se pudo activar el emparejamiento: %s')
                            .format(e.message));
                }
            });
    }

    // -------------------------------------------------------------- destruir
    destroy() {
        if (this._signalId) {
            Gio.DBus.system.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        if (this._watchId) {
            Gio.bus_unwatch_name(this._watchId);
            this._watchId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._pruneTimer) {
            GLib.source_remove(this._pruneTimer);
            this._pruneTimer = 0;
        }
        if (this._source) {
            this._source.destroy();
            this._source = null;
        }
        for (const box of this._banners) {
            if (box._evaTimeout)
                GLib.source_remove(box._evaTimeout);
            box.destroy();
        }
        this._banners = [];
        super.destroy();
    }
});

export default class IphoneNotifyExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
