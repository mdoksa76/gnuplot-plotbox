import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const PlotBoxIndicator = GObject.registerClass(
class PlotBoxIndicator extends PanelMenu.Button {
    _init(metadata) {
        super._init(0.0, 'PlotBox');
        
        // Load custom icon from extension directory
        const iconPath = GLib.build_filenamev([metadata.path, 'icons', 'gnuplot.svg']);
        const iconFile = Gio.File.new_for_path(iconPath);
        
        let icon;
        if (iconFile.query_exists(null)) {
            // Custom PNG icon exists
            icon = new St.Icon({
                gicon: Gio.icon_new_for_string(iconPath),
                style_class: 'system-status-icon',
            });
        } else {
            // Fallback to system icon if PNG not found
            icon = new St.Icon({
                icon_name: 'applications-science-symbolic',
                style_class: 'system-status-icon',
            });
        }
        
        this.add_child(icon);
        
        this.connect('button-press-event', () => {
            this._openPlotWindow();
            return Clutter.EVENT_STOP;
        });
    }
    
    _checkGnuplotInstalled() {
        try {
            let proc = Gio.Subprocess.new(
                ['which', 'gnuplot'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.wait(null);
            return proc.get_successful();
        } catch (e) {
            return false;
        }
    }
    
    _openPlotWindow() {
        // Check if gnuplot is installed
        if (!this._checkGnuplotInstalled()) {
            Main.notify('PlotBox - Gnuplot Not Found', 
                'Please install gnuplot:\nsudo apt install gnuplot (Debian/Ubuntu)\nsudo dnf install gnuplot (Fedora)\nsudo pacman -S gnuplot (Arch)');
            return;
        }
        
        if (this._plotWindow) {
            this._plotWindow.show();
            return;
        }
        
        let monitor = Main.layoutManager.primaryMonitor;
        let windowWidth = 700;
        let windowHeight = 600;
        let panelHeight = 35;
        
        let x = monitor.x + Math.floor((monitor.width - windowWidth) / 2);
        let y = monitor.y + panelHeight;
        
        this._plotWindow = new St.BoxLayout({
            style_class: 'plotbox-window',
            vertical: true,
            width: windowWidth,
            height: windowHeight,
            x: x,
            y: y,
        });
        
        Main.layoutManager.addChrome(this._plotWindow);
        
        let header = new St.BoxLayout({
            style_class: 'plotbox-header',
            x_expand: true,
        });
        
        let title = new St.Label({
            text: 'GNOME Gnuplot PlotBox',
            style_class: 'plotbox-title',
            x_expand: true,
        });
        
        let closeButton = new St.Button({
            label: '✕',
            style_class: 'plotbox-close-button',
        });
        closeButton.connect('clicked', () => {
            this._plotWindow.hide();
        });
        
        header.add_child(title);
        header.add_child(closeButton);
        this._plotWindow.add_child(header);
        
        let tabBar = new St.BoxLayout({
            style_class: 'plotbox-tabbar',
            x_expand: true,
        });
        
        this._tabs = ['2D Functions', '3D Functions'];
        this._currentTab = 0;
        this._tabButtons = [];
        
        this._tabs.forEach((tabName, index) => {
            let tabButton = new St.Button({
                label: tabName,
                style_class: 'plotbox-tab',
                x_expand: true,
            });
            
            tabButton.connect('clicked', () => {
                this._switchTab(index);
            });
            
            this._tabButtons.push(tabButton);
            tabBar.add_child(tabButton);
        });
        
        this._plotWindow.add_child(tabBar);
        
        this._contentArea = new St.BoxLayout({
            vertical: true,
            style_class: 'plotbox-content',
            x_expand: true,
            y_expand: true,
        });
        
        this._plotWindow.add_child(this._contentArea);
        
        let buttonBar = new St.BoxLayout({
            style_class: 'plotbox-buttonbar',
            x_expand: true,
        });
        
        let savePngButton = new St.Button({
            label: 'Save PNG',
            style_class: 'plotbox-button',
        });
        savePngButton.connect('clicked', () => this._savePng());
        
        let copyImageButton = new St.Button({
            label: 'Copy Image',
            style_class: 'plotbox-button',
        });
        copyImageButton.connect('clicked', () => this._copyImage());
        
        buttonBar.add_child(savePngButton);
        buttonBar.add_child(copyImageButton);
        this._plotWindow.add_child(buttonBar);
        
        this._data = {
            functions: [],
            functions3d: [],
        };
        
        // Initialize 3D function tracker (once, not on every tab rebuild)
        this._current3dFunction = '';
        
        this._currentGraphPath = null;
        
        this._switchTab(0);
        this._plotWindow.show();
    }
    
    _switchTab(index) {
        this._currentTab = index;
        
        if (index === 0) {
            this._currentGraphPath = '/tmp/plotbox_functions.png';
        } else if (index === 1) {
            this._currentGraphPath = '/tmp/plotbox_3d.png';
        }
        
        this._tabButtons.forEach((btn, i) => {
            if (i === index) {
                btn.add_style_class_name('plotbox-tab-active');
            } else {
                btn.remove_style_class_name('plotbox-tab-active');
            }
        });
        
        this._contentArea.destroy_all_children();
        
        if (index === 0) {
            this._buildFunctionsTab();
        } else if (index === 1) {
            this._build3DTab();
        }
    }
    
    _buildFunctionsTab() {
        let funcInputBox = new St.BoxLayout({
            style_class: 'plotbox-input-box',
            vertical: false,
        });
        
        let addButton = new St.Button({
            label: '+',
            style_class: 'plotbox-add-button',
        });
        
        let functionEntry = new St.Entry({
            hint_text: 'f(x)  e.g.: 2*x+3, sin(x), x**2',
            style_class: 'plotbox-entry',
            width: 400,  // Fixed width instead of x_expand
        });
        
        // Force single-line input to prevent multi-line paste issues
        let clutterText = functionEntry.get_clutter_text();
        clutterText.set_single_line_mode(true);
        clutterText.set_activatable(true);
        
        // Additional protection: strip newlines from pasted text
        clutterText.connect('text-changed', () => {
            let text = clutterText.get_text();
            let cleaned = text.replace(/[\r\n]+/g, ' ');  // Replace newlines with space
            if (text !== cleaned) {
                clutterText.set_text(cleaned);
            }
        });
        
        // Examples cycling button
        this._examples2D = [
            { expr: '2*x + 3',         name: 'Linear' },
            { expr: 'x**2',            name: 'Quadratic' },
            { expr: 'x**3',            name: 'Cubic' },
            { expr: 'exp(-x**2)',      name: 'Gaussian' },
            { expr: 'log(abs(x))',     name: 'Log' },
            { expr: 'abs(x)',          name: 'Absolute' },
            { expr: 'sin(x)',          name: 'Sine' },
            { expr: 'sin(x)/x',        name: 'Sinc' },
            { expr: 'besj0(x)',        name: 'Bessel' },
            { expr: 'tanh(x)',         name: 'Sigmoid' }
        ];
        this._currentExample2DIndex = 0;
        
        let exampleButton = new St.Button({
            label: `📚 ${this._examples2D[0].name}`,
            style_class: 'plotbox-example-button',
        });
        
        exampleButton.connect('clicked', () => {
            // Get current example
            let example = this._examples2D[this._currentExample2DIndex];
            
            // Clear all previous functions (one at a time behavior)
            this._data.functions = [];
            
            // Add only the new example function
            const colors = ['#3478F6', '#34C759', '#FF3B30', '#AF52DE', '#FF9500', '#00C7BE'];
            let color = colors[0]; // Always use first color since we only have one function
            
            this._data.functions.push({
                expr: example.expr,
                color: color,
                visible: true
            });
            
            // Update the list and plot
            this._updateFunctionsList();
            this._plotGraph();
            
            // Move to next example
            this._currentExample2DIndex = (this._currentExample2DIndex + 1) % this._examples2D.length;
            let nextExample = this._examples2D[this._currentExample2DIndex];
            exampleButton.label = `📚 ${nextExample.name}`;
        });
        
        funcInputBox.add_child(addButton);
        funcInputBox.add_child(functionEntry);
        funcInputBox.add_child(exampleButton);
        this._contentArea.add_child(funcInputBox);
        
        let rangeBox = new St.BoxLayout({
            style_class: 'plotbox-range-box',
            vertical: true,
        });
        
        let xRangeBox = new St.BoxLayout({
            style_class: 'plotbox-range-row',
        });
        xRangeBox.add_child(new St.Label({ text: 'X Range:', style_class: 'plotbox-range-label' }));
        
        this._xMinEntry = new St.Entry({
            hint_text: 'min',
            style_class: 'plotbox-range-entry',
            width: 80,
        });
        xRangeBox.add_child(this._xMinEntry);
        
        xRangeBox.add_child(new St.Label({ text: 'to', style_class: 'plotbox-range-separator' }));
        
        this._xMaxEntry = new St.Entry({
            hint_text: 'max',
            style_class: 'plotbox-range-entry',
            width: 80,
        });
        xRangeBox.add_child(this._xMaxEntry);
        
        rangeBox.add_child(xRangeBox);
        
        let yRangeBox = new St.BoxLayout({
            style_class: 'plotbox-range-row',
        });
        yRangeBox.add_child(new St.Label({ text: 'Y Range:', style_class: 'plotbox-range-label' }));
        
        this._yMinEntry = new St.Entry({
            hint_text: 'min',
            style_class: 'plotbox-range-entry',
            width: 80,
        });
        yRangeBox.add_child(this._yMinEntry);
        
        yRangeBox.add_child(new St.Label({ text: 'to', style_class: 'plotbox-range-separator' }));
        
        this._yMaxEntry = new St.Entry({
            hint_text: 'max',
            style_class: 'plotbox-range-entry',
            width: 80,
        });
        yRangeBox.add_child(this._yMaxEntry);
        
        rangeBox.add_child(yRangeBox);
        this._contentArea.add_child(rangeBox);
        
        let optionsBox = new St.BoxLayout({
            style_class: 'plotbox-options-box',
        });
        
        optionsBox.add_child(new St.Label({ text: 'X Label:', style_class: 'plotbox-option-label' }));
        this._xLabelEntry = new St.Entry({
            hint_text: 'x',
            style_class: 'plotbox-option-entry',
            width: 100,
        });
        optionsBox.add_child(this._xLabelEntry);
        
        optionsBox.add_child(new St.Label({ text: 'Y Label:', style_class: 'plotbox-option-label' }));
        this._yLabelEntry = new St.Entry({
            hint_text: 'y',
            style_class: 'plotbox-option-entry',
            width: 100,
        });
        optionsBox.add_child(this._yLabelEntry);
        
        let gridButton = new St.Button({
            label: '☑ Grid',
            style_class: 'plotbox-grid-button',
            toggle_mode: true,
        });
        this._gridEnabled = true;
        gridButton.connect('clicked', () => {
            this._gridEnabled = !this._gridEnabled;
            gridButton.label = this._gridEnabled ? '☑ Grid' : '☐ Grid';
            if (this._data.functions.length > 0) {
                this._plotGraph();
            }
        });
        optionsBox.add_child(gridButton);
        
        let refreshButton = new St.Button({
            label: '🔄 Refresh',
            style_class: 'plotbox-refresh-button',
        });
        refreshButton.connect('clicked', () => {
            if (this._data.functions.length > 0) {
                this._plotGraph();
            } else {
                Main.notify('PlotBox', 'Add a function first to see the graph');
            }
        });
        optionsBox.add_child(refreshButton);
        
        this._contentArea.add_child(optionsBox);
        
        addButton.connect('clicked', () => {
            let func = functionEntry.get_text();
            if (func && func.trim() !== '') {
                const colors = ['#3478F6', '#34C759', '#FF3B30', '#AF52DE', '#FF9500', '#00C7BE'];
                let color = colors[this._data.functions.length % colors.length];
                
                this._data.functions.push({
                    expr: func,
                    color: color,
                    visible: true
                });
                
                this._updateFunctionsList();
                functionEntry.set_text('');
                this._plotGraph();
            }
        });
        
        // Functions list with ScrollView
        this._functionsScrollView = new St.ScrollView({
            style_class: 'plotbox-list-scroll',
            overlay_scrollbars: true,
            x_expand: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        
        this._functionsList = new St.BoxLayout({
            vertical: true,
            style_class: 'plotbox-list',
            x_expand: true,
        });
        
        this._functionsScrollView.set_child(this._functionsList);
        this._contentArea.add_child(this._functionsScrollView);
        
        this._graphArea = new St.Bin({
            style_class: 'plotbox-graph',
            width: 600,
            height: 400,
        });
        this._contentArea.add_child(this._graphArea);
        
        this._updateFunctionsList();
    }
    
    _updateFunctionsList() {
        this._functionsList.destroy_all_children();
        
        this._data.functions.forEach((func, index) => {
            let funcBox = new St.BoxLayout({
                style_class: 'plotbox-function-item',
            });
            
            let checkButton = new St.Button({
                label: func.visible ? '☑' : '☐',
                style_class: 'plotbox-check-button',
            });
            
            checkButton.connect('clicked', () => {
                func.visible = !func.visible;
                checkButton.label = func.visible ? '☑' : '☐';
                this._plotGraph();
            });
            
            funcBox.add_child(checkButton);
            
            let funcLabel = new St.Label({
                text: `y = ${func.expr}`,
                x_expand: true,
                style: `color: ${func.color};`,
            });
            
            funcBox.add_child(funcLabel);
            
            let colorBox = new St.Bin({
                style_class: 'plotbox-color-indicator',
                style: `background-color: ${func.color}; width: 30px; height: 16px; border-radius: 4px;`,
            });
            funcBox.add_child(colorBox);
            
            let removeButton = new St.Button({
                label: '✕',
                style_class: 'plotbox-remove-button',
            });
            
            removeButton.connect('clicked', () => {
                this._data.functions.splice(index, 1);
                this._updateFunctionsList();
                this._plotGraph();
            });
            
            funcBox.add_child(removeButton);
            this._functionsList.add_child(funcBox);
        });
    }
    
    
    _plotGraph() {
        if (this._currentTab === 0) {
            this._plotFunctions();
        }
    }
    
    _plotFunctions() {
        let visibleFunctions = this._data.functions.filter(f => f.visible);
        
        if (visibleFunctions.length === 0) {
            this._graphArea.set_child(null);
            return;
        }
        
        let script = 'set terminal pngcairo size 600,400 enhanced font "sans,10"\n';
        script += 'set output "/tmp/plotbox_functions.png"\n';
        
        if (this._gridEnabled) {
            script += 'set grid\n';
        }
        
        let xLabel = this._xLabelEntry.get_text() || 'x';
        let yLabel = this._yLabelEntry.get_text() || 'y';
        script += `set xlabel "${xLabel}"\n`;
        script += `set ylabel "${yLabel}"\n`;
        
        // Set higher samples for smoother 2D plots (especially for oscillating functions)
        script += 'set samples 1000\n';
        
        let xRange = '[]';
        let yRange = '';
        
        let xMin = this._xMinEntry.get_text();
        let xMax = this._xMaxEntry.get_text();
        if (xMin && xMax) {
            xRange = `[${xMin}:${xMax}]`;
        }
        
        let yMin = this._yMinEntry.get_text();
        let yMax = this._yMaxEntry.get_text();
        if (yMin && yMax) {
            yRange = `[${yMin}:${yMax}]`;
        }
        
        script += `plot ${xRange} ${yRange} `;
        
        let plotParts = [];
        visibleFunctions.forEach((func, index) => {
            let title = `y=${func.expr}`;
            plotParts.push(`${func.expr} title '${title}' with lines lw 2 lc rgb '${func.color}'`);
        });
        
        script += plotParts.join(', \\\n     ');
        script += '\n';
        
        let scriptPath = '/tmp/plotbox_script.gp';
        try {
            let oldGraphFile = Gio.File.new_for_path('/tmp/plotbox_functions.png');
            if (oldGraphFile.query_exists(null)) {
                oldGraphFile.delete(null);
            }
            
            let file = Gio.File.new_for_path(scriptPath);
            file.replace_contents(script, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            
            let proc;
            try {
                proc = Gio.Subprocess.new(
                    ['gnuplot', scriptPath],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
            } catch (e) {
                Main.notify('PlotBox Error', 'Failed to run gnuplot. Is it installed?');
                log('Error launching gnuplot: ' + e.message);
                return;
            }
            
            proc.wait_async(null, (proc, res) => {
                try {
                    proc.wait_finish(res);
                    
                    if (proc.get_successful()) {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                            this._displayGraph('/tmp/plotbox_functions.png', this._graphArea);
                            return GLib.SOURCE_REMOVE;
                        });
                    } else {
                        Main.notify('PlotBox Error', 'Gnuplot failed. Check your function syntax.');
                    }
                } catch (e) {
                    log('Error waiting for gnuplot: ' + e.message);
                }
            });
            
        } catch (e) {
            log('Error generating graph: ' + e.message);
        }
    }
    
    _displayGraph(imagePath, targetArea) {
        try {
            let file = Gio.File.new_for_path(imagePath);
            targetArea.set_child(null);
            
            let texture = St.TextureCache.get_default().load_file_async(file, 600, 400, 1, 1);
            let image = new St.Bin({
                child: texture,
                width: 600,
                height: 400,
                style: 'width: 600px; height: 400px;',
            });
            
            targetArea.set_child(image);
        } catch (e) {
            log('Error displaying graph: ' + e.message);
        }
    }
    
    _savePng() {
        if (!this._currentGraphPath) {
            Main.notify('PlotBox', 'No graph to save. Generate a graph first.');
            return;
        }
        
        let sourceFile = Gio.File.new_for_path(this._currentGraphPath);
        if (!sourceFile.query_exists(null)) {
            Main.notify('PlotBox', 'Graph not generated. Try again.');
            return;
        }
        
        let dataDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnuplot-plotbox']);
        GLib.mkdir_with_parents(dataDir, 0o755);
        
        let timestamp = GLib.DateTime.new_now_local().format('%Y%m%d_%H%M%S');
        let tabNames = ['functions', '3d'];
        let tabName = tabNames[this._currentTab] || 'graph';
        let defaultFilename = `${tabName}_${timestamp}.png`;
        let defaultPath = GLib.build_filenamev([dataDir, defaultFilename]);
        
        let argv = [
            'zenity',
            '--file-selection',
            '--save',
            '--confirm-overwrite',
            `--filename=${defaultPath}`,
            '--file-filter=PNG Images | *.png',
            '--file-filter=All Files | *'
        ];
        
        try {
            let proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    
                    if (proc.get_successful() && stdout && stdout.trim()) {
                        let destPath = stdout.trim();
                        
                        if (!destPath.toLowerCase().endsWith('.png')) {
                            destPath += '.png';
                        }
                        
                        let currentSource = Gio.File.new_for_path(this._currentGraphPath);
                        if (!currentSource.query_exists(null)) {
                            Main.notify('PlotBox', 'Graph disappeared. Generate it again.');
                            return;
                        }
                        
                        let destFile = Gio.File.new_for_path(destPath);
                        currentSource.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                        
                        Main.notify('PlotBox', `Graph saved:\n${destPath}`);
                    }
                } catch (e) {
                    Main.notify('PlotBox', 'Error saving: ' + e.message);
                }
            });
            
        } catch (e) {
            Main.notify('PlotBox', 'Error opening dialog: ' + e.message);
        }
    }
    
    _copyImage() {
        if (!this._currentGraphPath) {
            Main.notify('PlotBox', 'No graph to copy. Generate a graph first.');
            return;
        }
        
        try {
            let file = Gio.File.new_for_path(this._currentGraphPath);
            
            if (!file.query_exists(null)) {
                Main.notify('PlotBox', 'Graph not generated. Try again.');
                return;
            }
            
            let [success, contents] = file.load_contents(null);
            
            if (!success) {
                Main.notify('PlotBox', 'No graph to copy. Generate a graph first.');
                return;
            }
            
            let clipboard = St.Clipboard.get_default();
            clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', contents);
            
            Main.notify('PlotBox', 'Graph copied to clipboard!');
        } catch (e) {
            Main.notify('PlotBox', 'Error copying graph');
        }
    }
    
    _build3DTab() {
        // Input box for 3D function
        let funcInputBox = new St.BoxLayout({
            style_class: 'plotbox-input-box',
            vertical: false,
        });
        
        let addButton = new St.Button({
            label: '+',
            style_class: 'plotbox-add-button',
        });
        
        let functionEntry = new St.Entry({
            hint_text: 'f(x,y)  e.g.: x**2 + y**2, sin(x)*cos(y)',
            style_class: 'plotbox-entry',
            width: 400,  // Fixed width - same as 2D for consistency
        });
        
        // Force single-line input to prevent multi-line paste issues
        let clutterText = functionEntry.get_clutter_text();
        clutterText.set_single_line_mode(true);
        clutterText.set_activatable(true);
        
        // Additional protection: strip newlines from pasted text
        clutterText.connect('text-changed', () => {
            let text = clutterText.get_text();
            let cleaned = text.replace(/[\r\n]+/g, ' ');  // Replace newlines with space
            if (text !== cleaned) {
                clutterText.set_text(cleaned);
            }
        });
        
        // Examples cycling button for 3D
        this._examples3D = [
            { expr: 'x**2 + y**2',                                  name: 'Paraboloid' },
            { expr: 'x**2 - y**2',                                  name: 'Saddle' },
            { expr: 'sqrt(1 - x**2 - y**2)',                        name: 'Hemisphere' },
            { expr: 'exp(-(x**2 + y**2))',                          name: 'Gaussian' },
            { expr: '(x**2 + y**2)*exp(-(x**2 + y**2))',           name: 'Mexican Hat' },
            { expr: 'sin(sqrt(x**2 + y**2))',                       name: 'Ripples' },
            { expr: 'besj0(sqrt(x**2 + y**2))',                     name: 'Bessel' },
            { expr: 'sin(x)*cos(y)',                                name: 'Wave Mesh' },
            { expr: '1/(1 + x**2 + y**2)',                          name: 'Lorentzian' },
            { expr: 'sin(sqrt(x**2+y**2))*exp(-sqrt(x**2+y**2)/5)', name: 'Damped' }
        ];
        this._currentExample3DIndex = 0;
        
        let exampleButton = new St.Button({
            label: `📚 ${this._examples3D[0].name}`,
            style_class: 'plotbox-example-button',
        });
        
        exampleButton.connect('clicked', () => {
            // Insert example into input field
            let example = this._examples3D[this._currentExample3DIndex];
            functionEntry.set_text(example.expr);
            
            // Auto-plot (simulate + button click)
            this._current3dFunction = example.expr;
            functionEntry.set_text('');
            this._plot3DGraph();
            
            // Move to next example
            this._currentExample3DIndex = (this._currentExample3DIndex + 1) % this._examples3D.length;
            let nextExample = this._examples3D[this._currentExample3DIndex];
            exampleButton.label = `📚 ${nextExample.name}`;
        });
        
        funcInputBox.add_child(addButton);
        funcInputBox.add_child(functionEntry);
        funcInputBox.add_child(exampleButton);
        this._contentArea.add_child(funcInputBox);
        
        // Range controls - 2 columns: Ranges (left) and Rotation (right)
        let rangeBox = new St.BoxLayout({
            style_class: 'plotbox-range-box',
            vertical: true,
        });
        
        // Row 1: X Range + Rot X
        let row1Box = new St.BoxLayout({
            style_class: 'plotbox-range-row',
        });
        
        // X Range (left)
        row1Box.add_child(new St.Label({ text: 'X Range:', style_class: 'plotbox-range-label' }));
        
        this._x3dMinEntry = new St.Entry({
            hint_text: 'min',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row1Box.add_child(this._x3dMinEntry);
        
        row1Box.add_child(new St.Label({ text: 'to', style_class: 'plotbox-range-separator' }));
        
        this._x3dMaxEntry = new St.Entry({
            hint_text: 'max',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row1Box.add_child(this._x3dMaxEntry);
        
        // Spacer
        row1Box.add_child(new St.Label({ text: '    ', style_class: 'plotbox-range-separator' }));
        
        // Rot X (right)
        row1Box.add_child(new St.Label({ text: 'Rot X:', style_class: 'plotbox-range-label' }));
        this._rotXEntry = new St.Entry({
            text: '60',
            hint_text: '0-180',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row1Box.add_child(this._rotXEntry);
        row1Box.add_child(new St.Label({ text: '°', style_class: 'plotbox-range-separator' }));
        
        rangeBox.add_child(row1Box);
        
        // Row 2: Y Range + Rot Z
        let row2Box = new St.BoxLayout({
            style_class: 'plotbox-range-row',
        });
        
        // Y Range (left)
        row2Box.add_child(new St.Label({ text: 'Y Range:', style_class: 'plotbox-range-label' }));
        
        this._y3dMinEntry = new St.Entry({
            hint_text: 'min',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row2Box.add_child(this._y3dMinEntry);
        
        row2Box.add_child(new St.Label({ text: 'to', style_class: 'plotbox-range-separator' }));
        
        this._y3dMaxEntry = new St.Entry({
            hint_text: 'max',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row2Box.add_child(this._y3dMaxEntry);
        
        // Spacer
        row2Box.add_child(new St.Label({ text: '    ', style_class: 'plotbox-range-separator' }));
        
        // Rot Z (right)
        row2Box.add_child(new St.Label({ text: 'Rot Z:', style_class: 'plotbox-range-label' }));
        this._rotZEntry = new St.Entry({
            text: '30',
            hint_text: '0-360',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row2Box.add_child(this._rotZEntry);
        row2Box.add_child(new St.Label({ text: '°', style_class: 'plotbox-range-separator' }));
        
        rangeBox.add_child(row2Box);
        
        // Row 3: Z Range + Palette
        let row3Box = new St.BoxLayout({
            style_class: 'plotbox-range-row',
        });
        
        // Z Range (left)
        row3Box.add_child(new St.Label({ text: 'Z Range:', style_class: 'plotbox-range-label' }));
        
        this._z3dMinEntry = new St.Entry({
            hint_text: 'min',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row3Box.add_child(this._z3dMinEntry);
        
        row3Box.add_child(new St.Label({ text: 'to', style_class: 'plotbox-range-separator' }));
        
        this._z3dMaxEntry = new St.Entry({
            hint_text: 'max',
            style_class: 'plotbox-range-entry',
            width: 60,
        });
        row3Box.add_child(this._z3dMaxEntry);
        
        // Spacer
        row3Box.add_child(new St.Label({ text: '    ', style_class: 'plotbox-range-separator' }));
        
        // Palette selector (right)
        this._palettes = ['Default', 'Rainbow', 'Hot', 'Cool', 'Grayscale', 'Ocean', 'Viridis'];
        this._currentPaletteIndex = 0;
        
        row3Box.add_child(new St.Label({ text: 'Palette:', style_class: 'plotbox-range-label' }));
        this._paletteButton = new St.Button({
            label: this._palettes[0],
            style_class: 'plotbox-palette-button',
        });
        this._paletteButton.connect('clicked', () => {
            this._currentPaletteIndex = (this._currentPaletteIndex + 1) % this._palettes.length;
            this._paletteButton.label = this._palettes[this._currentPaletteIndex];
            if (this._current3dFunction) {
                this._plot3DGraph();
            }
        });
        row3Box.add_child(this._paletteButton);
        
        rangeBox.add_child(row3Box);
        this._contentArea.add_child(rangeBox);
        
        // Labels row
        let labelsBox = new St.BoxLayout({
            style_class: 'plotbox-options-box',
            vertical: false,
        });
        
        labelsBox.add_child(new St.Label({ text: 'X Label:', style_class: 'plotbox-option-label' }));
        this._x3dLabelEntry = new St.Entry({
            hint_text: 'x',
            style_class: 'plotbox-option-entry',
            width: 60,
        });
        labelsBox.add_child(this._x3dLabelEntry);
        
        labelsBox.add_child(new St.Label({ text: 'Y Label:', style_class: 'plotbox-option-label' }));
        this._y3dLabelEntry = new St.Entry({
            hint_text: 'y',
            style_class: 'plotbox-option-entry',
            width: 60,
        });
        labelsBox.add_child(this._y3dLabelEntry);
        
        labelsBox.add_child(new St.Label({ text: 'Z Label:', style_class: 'plotbox-option-label' }));
        this._z3dLabelEntry = new St.Entry({
            hint_text: 'z',
            style_class: 'plotbox-option-entry',
            width: 60,
        });
        labelsBox.add_child(this._z3dLabelEntry);
        
        this._contentArea.add_child(labelsBox);
        
        // Controls row (Grid + Refresh in new row)
        let controlsBox = new St.BoxLayout({
            style_class: 'plotbox-options-box',
            vertical: false,
        });
        
        let gridButton = new St.Button({
            label: '☑ Grid',
            style_class: 'plotbox-grid-button',
            toggle_mode: true,
        });
        this._grid3dEnabled = true;
        gridButton.connect('clicked', () => {
            this._grid3dEnabled = !this._grid3dEnabled;
            gridButton.label = this._grid3dEnabled ? '☑ Grid' : '☐ Grid';
            if (this._current3dFunction) {
                this._plot3DGraph();
            }
        });
        controlsBox.add_child(gridButton);
        
        let refreshButton = new St.Button({
            label: '🔄 Refresh',
            style_class: 'plotbox-refresh-button',
        });
        refreshButton.connect('clicked', () => {
            if (this._current3dFunction) {
                this._plot3DGraph();
            } else {
                Main.notify('PlotBox', 'Enter a 3D function first');
            }
        });
        controlsBox.add_child(refreshButton);
        
        this._contentArea.add_child(controlsBox);
        
        // Graph area
        this._graph3dArea = new St.Bin({
            style_class: 'plotbox-graph',
            width: 600,
            height: 400,
        });
        this._contentArea.add_child(this._graph3dArea);
        
        // + Button functionality - replaces old function with new one
        addButton.connect('clicked', () => {
            let expr = functionEntry.get_text();
            if (expr) {
                this._current3dFunction = expr;
                functionEntry.set_text('');
                this._plot3DGraph();
            }
        });
        
        // Enter key support
        functionEntry.connect('key-press-event', (actor, event) => {
            let symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                addButton.emit('clicked');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }
    
    _plot3DGraph() {
        if (!this._current3dFunction) {
            this._graph3dArea.set_child(null);
            return;
        }
        
        let script = 'set terminal pngcairo size 600,400 enhanced font "sans,10"\n';
        script += 'set output "/tmp/plotbox_3d.png"\n';
        
        if (this._grid3dEnabled) {
            script += 'set grid\n';
        }
        
        let xLabel = this._x3dLabelEntry.get_text() || 'x';
        let yLabel = this._y3dLabelEntry.get_text() || 'y';
        let zLabel = this._z3dLabelEntry.get_text() || 'z';
        script += `set xlabel "${xLabel}"\n`;
        script += `set ylabel "${yLabel}"\n`;
        script += `set zlabel "${zLabel}"\n`;
        
        // View angle (rotation)
        let rotX = this._rotXEntry.get_text() || '60';
        let rotZ = this._rotZEntry.get_text() || '30';
        script += `set view ${rotX},${rotZ}\n`;
        
        // Set ticslevel to 0 for better Z-axis visualization (XY plane at bottom)
        script += 'set ticslevel 0\n';
        
        script += 'set hidden3d\n';
        script += 'set pm3d at s\n';  // 'at s' = draw only at surface (no base)
        
        // Set higher isosamples for smoother 3D plots (especially for oscillating functions)
        script += 'set isosamples 100,100\n';
        
        // Set color palette
        let palette = this._palettes[this._currentPaletteIndex];
        switch(palette) {
            case 'Default':
                // Use Gnuplot's default palette (no set palette command)
                break;
            case 'Rainbow':
                script += 'set palette rgbformulae 33,13,10\n';
                break;
            case 'Hot':
                script += 'set palette rgbformulae 34,35,36\n';
                break;
            case 'Cool':
                script += 'set palette rgbformulae 23,28,3\n';
                break;
            case 'Grayscale':
                script += 'set palette gray\n';
                break;
            case 'Ocean':
                script += 'set palette defined (0 "dark-blue", 0.5 "cyan", 1 "white")\n';
                break;
            case 'Viridis':
                script += 'set palette defined (0 "#440154", 0.5 "#21918c", 1 "#fde725")\n';
                break;
        }
        
        let xRange = '[]';
        let yRange = '[]';
        let zRange = '';
        
        let xMin = this._x3dMinEntry.get_text();
        let xMax = this._x3dMaxEntry.get_text();
        if (xMin && xMax) {
            xRange = `[${xMin}:${xMax}]`;
        }
        
        let yMin = this._y3dMinEntry.get_text();
        let yMax = this._y3dMaxEntry.get_text();
        if (yMin && yMax) {
            yRange = `[${yMin}:${yMax}]`;
        }
        
        let zMin = this._z3dMinEntry.get_text();
        let zMax = this._z3dMaxEntry.get_text();
        if (zMin && zMax) {
            zRange = `[${zMin}:${zMax}]`;
        }
        
        let title = `z=${this._current3dFunction}`;
        script += `splot ${xRange} ${yRange} ${zRange} ${this._current3dFunction} title '${title}' with lines\n`;
        
        let scriptPath = '/tmp/plotbox_script_3d.gp';
        try {
            let oldGraphFile = Gio.File.new_for_path('/tmp/plotbox_3d.png');
            if (oldGraphFile.query_exists(null)) {
                oldGraphFile.delete(null);
            }
            
            let file = Gio.File.new_for_path(scriptPath);
            file.replace_contents(script, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            
            let proc;
            try {
                proc = Gio.Subprocess.new(
                    ['gnuplot', scriptPath],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
            } catch (e) {
                Main.notify('PlotBox Error', 'Failed to run gnuplot. Is it installed?');
                log('Error launching gnuplot: ' + e.message);
                return;
            }
            
            proc.wait_async(null, (proc, res) => {
                try {
                    proc.wait_finish(res);
                    
                    if (proc.get_successful()) {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                            this._display3DGraph('/tmp/plotbox_3d.png', this._graph3dArea);
                            return GLib.SOURCE_REMOVE;
                        });
                    } else {
                        Main.notify('PlotBox Error', 'Gnuplot failed. Check your function syntax.');
                    }
                } catch (e) {
                    log('Error waiting for gnuplot: ' + e.message);
                }
            });
            
        } catch (e) {
            log('Error generating 3D graph: ' + e.message);
        }
    }
    
    _display3DGraph(imagePath, targetArea) {
        try {
            let file = Gio.File.new_for_path(imagePath);
            targetArea.set_child(null);
            
            let texture = St.TextureCache.get_default().load_file_async(file, 600, 400, 1, 1);
            let image = new St.Bin({
                child: texture,
                width: 600,
                height: 400,
                style: 'width: 600px; height: 400px;',
            });
            
            targetArea.set_child(image);
        } catch (e) {
            log('Error displaying 3D graph: ' + e.message);
        }
    }
    

    destroy() {
        if (this._plotWindow) {
            this._plotWindow.destroy();
            this._plotWindow = null;
        }
        super.destroy();
    }
});

export default class PlotBoxExtension {
    constructor(metadata) {
        this._metadata = metadata;
    }
    
    enable() {
        this._indicator = new PlotBoxIndicator(this._metadata);
        Main.panel.addToStatusArea('plotbox-indicator', this._indicator);
    }
    
    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}