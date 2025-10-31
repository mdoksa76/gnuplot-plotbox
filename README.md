# Gnuplot PlotBox

Mathematical graphing extension for GNOME Shell using gnuplot.

## Requirements

```bash
sudo apt install gnuplot gnuplot-x11  # Debian/Ubuntu
sudo dnf install gnuplot              # Fedora
sudo pacman -S gnuplot                # Arch
```

## Usage

Click the PlotBox icon in the top panel to open the plotting window.

### 2D Functions Tab

**Input area:**
- **Text field**: Enter function (e.g., `sin(x)`, `x**2`, `2*x+3`)
- **Example button**: Cycle through example functions
- **+ button**: Add function to list

**Function list:**
- **Checkbox**: Show/hide function on graph
- **Color box**: Function color indicator
- **X button**: Remove function

**X Range:** Set min/max values for x-axis

**Options:**
- **Title**: Graph title
- **X/Y Labels**: Axis labels
- **Grid button**: Toggle grid lines
- **Refresh button**: Redraw graph

### 3D Functions Tab

**Input area:**
- **Text field**: Enter 3D function (e.g., `sin(sqrt(x**2+y**2))`)
- **Example button**: Cycle through 3D examples
- **+ button**: Plot function (replaces previous)

**Ranges:** Set X, Y, Z axis ranges

**View rotation:** Adjust 3D viewing angle

**Palette button:** Cycle through color schemes

**Labels:** Set X, Y, Z axis labels

**Controls:**
- **Grid button**: Toggle grid
- **Refresh button**: Redraw graph

### Bottom buttons

- **Save PNG**: Opens file dialog (default: `~/.local/share/gnuplot-plotbox/`)
- **Copy Image**: Copy graph to clipboard