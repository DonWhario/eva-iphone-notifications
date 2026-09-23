/* prefs.js - Preferencias (GNOME 45+, libadwaita) */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

// La ruta del recurso de la clase base cambia segun la version/empaquetado de
// GNOME. En GNOME 48 de Debian es extensions/prefs.js; en otras builds es
// extensionPreferences.js. Se intenta la primera y se recurre a la segunda.
let _base;
try {
    _base = await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
} catch (_e) {
    _base = await import('resource:///org/gnome/Shell/Extensions/js/extensionPreferences.js');
}
const ExtensionPreferences = _base.ExtensionPreferences;
const _ = _base.gettext;

export default class IphoneNotifyPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ---------------------------------------------------------- Conexion
        const connGroup = new Adw.PreferencesGroup({
            title: _('Conexion'),
            description: _('Que dispositivo mostrar y como emparejar (ancs4linux).'),
        });
        page.add(connGroup);

        const devRow = new Adw.EntryRow({
            title: _('Direccion del iPhone (opcional)'),
        });
        settings.bind('device-address', devRow, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        connGroup.add(devRow);

        const hciRow = new Adw.EntryRow({
            title: _('Adaptador Bluetooth / HCI'),
        });
        settings.bind('hci-address', hciRow, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        connGroup.add(hciRow);

        const nameRow = new Adw.EntryRow({
            title: _('Nombre visible en el iPhone'),
        });
        settings.bind('advertise-name', nameRow, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        connGroup.add(nameRow);

        // -------------------------------------------------------- Mensajes
        const msgGroup = new Adw.PreferencesGroup({
            title: _('Mensajes'),
        });
        page.add(msgGroup);

        const appRow = new Adw.EntryRow({
            title: _('Filtrar apps (coma) — vacio = todas'),
        });
        settings.bind('app-filter', appRow, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        msgGroup.add(appRow);

        const previewRow = new Adw.SwitchRow({
            title: _('Mostrar vista previa del mensaje'),
            subtitle: _('Si se desactiva, solo avisa que llego un mensaje.'),
        });
        settings.bind('show-preview', previewRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        msgGroup.add(previewRow);

        // ----------------------------------------------------- Notificaciones
        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notificaciones'),
        });
        page.add(notifGroup);

        const dndRow = new Adw.SwitchRow({
            title: _('No molestar'),
            subtitle: _('No muestra banners ni suena (sigue contando mensajes).'),
        });
        settings.bind('dnd', dndRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(dndRow);

        const soundRow = new Adw.SwitchRow({
            title: _('Sonido de alerta'),
        });
        settings.bind('sound-enabled', soundRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(soundRow);

        // Selector de archivo de sonido
        const fileRow = new Adw.ActionRow({
            title: _('Sonido personalizado'),
            subtitle: settings.get_string('sound-file') || _('Sonido del sistema'),
        });
        const chooseBtn = new Gtk.Button({
            label: _('Elegir…'),
            valign: Gtk.Align.CENTER,
        });
        const clearBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Usar sonido del sistema'),
        });
        chooseBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: _('Elegir sonido')});
            const filter = new Gtk.FileFilter();
            filter.set_name(_('Audio'));
            filter.add_mime_type('audio/*');
            const filters = new Gio.ListStore();
            filters.append(filter);
            dialog.set_filters(filters);
            dialog.open(window, null, (dlg, res) => {
                try {
                    const file = dlg.open_finish(res);
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('sound-file', path);
                        fileRow.subtitle = path;
                    }
                } catch (e) {
                    // cancelado
                }
            });
        });
        clearBtn.connect('clicked', () => {
            settings.set_string('sound-file', '');
            fileRow.subtitle = _('Sonido del sistema');
        });
        fileRow.add_suffix(chooseBtn);
        fileRow.add_suffix(clearBtn);
        notifGroup.add(fileRow);

        // --------------------------------------------- Aparicion / Posicion
        const posGroup = new Adw.PreferencesGroup({
            title: _('Aparicion en pantalla'),
            description: _('Elige si el mensaje se muestra como notificacion del ' +
                'sistema o como una ventana propia con posicion configurable.'),
        });
        page.add(posGroup);

        // Helper: enlaza una ComboRow (lista de valores) a un ajuste de texto.
        const bindCombo = (row, values) => {
            const cur = settings.get_string(row.__key__);
            const idx = values.indexOf(cur);
            row.selected = idx >= 0 ? idx : 0;
            row.connect('notify::selected', () => {
                settings.set_string(row.__key__, values[row.selected]);
            });
        };

        // Modo: sistema / ventana propia
        const modeRow = new Adw.ComboRow({
            title: _('Donde mostrar'),
            model: Gtk.StringList.new([
                _('Notificacion del sistema'),
                _('Ventana propia'),
            ]),
        });
        modeRow.__key__ = 'banner-mode';
        bindCombo(modeRow, ['system', 'custom']);
        posGroup.add(modeRow);

        // Posicion de la ventana propia
        const posRow = new Adw.ComboRow({
            title: _('Posicion de la ventana propia'),
            model: Gtk.StringList.new([
                _('Arriba izquierda'),
                _('Arriba centro'),
                _('Arriba derecha'),
                _('Centro'),
                _('Abajo izquierda'),
                _('Abajo centro'),
                _('Abajo derecha'),
            ]),
        });
        posRow.__key__ = 'banner-position';
        bindCombo(posRow, [
            'top-left', 'top-center', 'top-right', 'center',
            'bottom-left', 'bottom-center', 'bottom-right',
        ]);
        posGroup.add(posRow);

        // Duracion en segundos
        const timeoutRow = new Adw.SpinRow({
            title: _('Duracion (segundos)'),
            subtitle: _('Tiempo visible de la ventana propia.'),
            adjustment: new Gtk.Adjustment({
                lower: 2, upper: 60, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('banner-timeout', timeoutRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(timeoutRow);

        // ----------------------------------------------------------- Ayuda
        const helpGroup = new Adw.PreferencesGroup({
            title: _('Ayuda'),
            description: _('Esta extension necesita "ancs4linux" instalado y en ' +
                'ejecucion. El iPhone envia sus notificaciones por Bluetooth LE ' +
                '(ANCS). Consulta el archivo README para la instalacion.'),
        });
        page.add(helpGroup);
    }
}
